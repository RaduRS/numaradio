import { test } from "node:test";
import assert from "node:assert/strict";
import { buildChatProducerPrompt } from "./producer-prompt.ts";
import type { ChatContext } from "./chat-context.ts";

function ctx(): ChatContext {
  return {
    trigger: { source: "youtube_chat_mention", handle: "anna", text: "hey lena loving this" },
    now: { localTime: "23:15", bucket: "night" },
    recentShoutouts: [{ id: "s1", handle: "bob", originalText: "hi from berlin", minsAgo: 18 }],
    recentLenaLines: [{ text: "earlier line", airedAt: 0 }],
  };
}

test("buildChatProducerPrompt enforces strict JSON output", () => {
  const p = buildChatProducerPrompt(ctx());
  assert.match(p.system, /strict JSON/i);
  assert.match(p.system, /no prose/i);
});

test("buildChatProducerPrompt forbids silence", () => {
  const p = buildChatProducerPrompt(ctx());
  assert.match(p.system, /NEVER/);
  assert.match(p.system, /silence/i);
});

test("buildChatProducerPrompt mode allowlist is answer + callback only", () => {
  const p = buildChatProducerPrompt(ctx());
  assert.match(p.system, /"answer"/);
  assert.match(p.system, /"callback"/);
});

test("buildChatProducerPrompt user message includes the listener message + shoutout pool", () => {
  const p = buildChatProducerPrompt(ctx());
  assert.match(p.user, /anna/);
  assert.match(p.user, /hey lena loving this/);
  assert.match(p.user, /bob/);
});
