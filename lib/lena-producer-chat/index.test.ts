import { test } from "node:test";
import assert from "node:assert/strict";
import { lenaSpeakChat } from "./index.ts";

const T0 = new Date("2026-05-16T23:15:00").getTime();

test("lenaSpeakChat happy path: Producer→Writer→{text, mode}", async () => {
  const fakePrisma = {
    shoutout: { findMany: async () => [] },
    chatter: { findMany: async () => [] },
  };
  let llmCall = 0;
  const llm = async (p: { system: string }) => {
    llmCall += 1;
    if (p.system.includes("you are the producer") || p.system.includes("You are the producer")) {
      return JSON.stringify({ mode: "answer", target_focus: "hi back", callback_to: null, length_hint: "short", tone: "warm" });
    }
    return "hey anna!";
  };
  const r = await lenaSpeakChat({
    trigger: { source: "youtube_chat_mention", handle: "anna", text: "hi lena" },
    prisma: fakePrisma as never,
    stationId: "s1",
    nowMs: T0,
    llm,
  });
  assert.ok(r);
  assert.equal(r!.text, "hey anna!");
  assert.equal(r!.mode, "answer");
  assert.equal(llmCall, 2);
});

test("lenaSpeakChat returns null when fetchChatContext throws", async () => {
  const fakePrisma = {
    shoutout: { findMany: async () => { throw new Error("db down"); } },
    chatter: { findMany: async () => [] },
  };
  const llm = async () => "n/a";
  const r = await lenaSpeakChat({
    trigger: { source: "youtube_chat_mention", handle: "anna", text: "hi" },
    prisma: fakePrisma as never,
    stationId: "s1",
    nowMs: T0,
    llm,
  });
  assert.equal(r, null);
});
