import { test } from "node:test";
import assert from "node:assert/strict";
import { runChatWriter } from "./writer.ts";

const ctx = {
  trigger: { source: "youtube_chat_mention" as const, handle: "anna", text: "hi" },
  now: { localTime: "23:00", bucket: "night" },
  recentShoutouts: [],
  recentLenaLines: [],
};

test("runChatWriter answer mode calls answer prompt", async () => {
  const decision = { mode: "answer" as const, targetFocus: "x", callbackTo: null, lengthHint: "short" as const, tone: "warm" as const };
  const llm = async (p: { system: string }) => {
    assert.match(p.system, /always replies/i);
    return "hey anna!";
  };
  assert.equal(await runChatWriter(decision, ctx, { llm }), "hey anna!");
});

test("runChatWriter callback mode calls callback prompt", async () => {
  const decision = { mode: "callback" as const, targetFocus: "x", callbackTo: "s1", lengthHint: "short" as const, tone: "warm" as const };
  const llm = async (p: { system: string }) => {
    assert.match(p.system, /tying/i);
    return "hey anna, bob was on earlier too";
  };
  assert.match((await runChatWriter(decision, ctx, { llm })) ?? "", /bob/);
});
