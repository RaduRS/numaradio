import { test } from "node:test";
import assert from "node:assert/strict";
import { lenaSpeakShoutout } from "./index";

const T0 = new Date("2026-05-16T23:15:00").getTime();

test("lenaSpeakShoutout happy path", async () => {
  const fakePrisma = {
    shoutout: { findMany: async () => [] },
    chatter: { findMany: async () => [] },
  };
  const llm = async (p: { system: string }) => {
    if (p.system.startsWith("You are the producer")) {
      return JSON.stringify({ mode: "shoutout_inline", target_focus: "x", callback_to: null, length_hint: "short", tone: "warm" });
    }
    return "anna sends word — loving this set tonight.";
  };
  const r = await lenaSpeakShoutout({
    trigger: { source: "booth_shoutout", handle: "anna", text: "loving this" },
    prisma: fakePrisma as never,
    stationId: "s1",
    nowMs: T0,
    llm,
  });
  assert.ok(r);
  assert.equal(r!.mode, "shoutout_inline");
  assert.match(r!.text, /anna/);
});

test("lenaSpeakShoutout returns null on DB error", async () => {
  const fakePrisma = {
    shoutout: { findMany: async () => { throw new Error("db down"); } },
    chatter: { findMany: async () => [] },
  };
  const r = await lenaSpeakShoutout({
    trigger: { source: "booth_shoutout", handle: "anna", text: "hi" },
    prisma: fakePrisma as never,
    stationId: "s1",
    nowMs: T0,
    llm: async () => "n/a",
  });
  assert.equal(r, null);
});
