import { test } from "node:test";
import assert from "node:assert/strict";
import { runShoutoutWriter } from "./writer";

const ctx = {
  trigger: { source: "booth_shoutout" as const, handle: "anna", text: "hi" },
  now: { localTime: "23:00", bucket: "night" },
  recentShoutouts: [{ id: "s1", handle: "bob", text: "hi", minsAgo: 5 }],
  recentLenaLines: [],
};

test("runShoutoutWriter routes mode=shoutout_inline", async () => {
  const decision = { mode: "shoutout_inline" as const, targetFocus: "x", callbackTo: null, lengthHint: "short" as const, tone: "warm" as const };
  const llm = async (p: { system: string }) => {
    assert.match(p.system, /shoutout_inline/i);
    return "anna sends word — loving this set.";
  };
  assert.match((await runShoutoutWriter(decision, ctx, [], { llm })) ?? "", /anna/);
});

test("runShoutoutWriter routes mode=shoutout_callback", async () => {
  const decision = { mode: "shoutout_callback" as const, targetFocus: "x", callbackTo: "s1", lengthHint: "short" as const, tone: "warm" as const };
  const llm = async (p: { system: string }) => {
    assert.match(p.system, /callback/i);
    return "anna joining bob — same Berlin energy.";
  };
  assert.match((await runShoutoutWriter(decision, ctx, [], { llm })) ?? "", /bob/);
});
