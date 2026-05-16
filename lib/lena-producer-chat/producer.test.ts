import { test } from "node:test";
import assert from "node:assert/strict";
import { runChatProducer } from "./producer.ts";
import type { ChatContext } from "./chat-context.ts";

function ctx(): ChatContext {
  return {
    trigger: { source: "youtube_chat_mention", handle: "anna", text: "hey" },
    now: { localTime: "23:15", bucket: "night" },
    recentShoutouts: [{ id: "s1", handle: "bob", originalText: "hi", minsAgo: 5 }],
    recentLenaLines: [],
  };
}

test("runChatProducer happy path", async () => {
  const llm = async () => JSON.stringify({ mode: "answer", target_focus: "say hi back", callback_to: null, length_hint: "short", tone: "warm" });
  const d = await runChatProducer(ctx(), { llm });
  assert.equal(d.mode, "answer");
  assert.equal(d.tone, "warm");
});

test("runChatProducer rejects silence — retry then fallback to answer", async () => {
  let call = 0;
  const llm = async () => {
    call += 1;
    return JSON.stringify({ mode: "silence", target_focus: "", callback_to: null, length_hint: "short", tone: "low-key" });
  };
  const d = await runChatProducer(ctx(), { llm });
  assert.equal(call, 2); // retried once
  assert.equal(d.mode, "answer"); // safe default
});

test("runChatProducer: invalid JSON → retry → fallback to answer", async () => {
  const llm = async () => "garbage";
  const d = await runChatProducer(ctx(), { llm });
  assert.equal(d.mode, "answer");
});

test("runChatProducer: callback_to unknown id → stripped to null", async () => {
  const llm = async () => JSON.stringify({ mode: "callback", target_focus: "x", callback_to: "not_real", length_hint: "short", tone: "warm" });
  const d = await runChatProducer(ctx(), { llm });
  assert.equal(d.callbackTo, null);
});
