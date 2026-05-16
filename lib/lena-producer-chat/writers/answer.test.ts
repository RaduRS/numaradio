import { test } from "node:test";
import assert from "node:assert/strict";
import { buildChatAnswerPrompt } from "./answer.ts";

const decision = { mode: "answer" as const, targetFocus: "say hi", callbackTo: null, lengthHint: "short" as const, tone: "warm" as const };
const ctx = {
  trigger: { source: "youtube_chat_mention" as const, handle: "anna", text: "hi lena" },
  now: { localTime: "23:15", bucket: "night" },
  recentShoutouts: [],
  recentLenaLines: [],
};

test("buildChatAnswerPrompt bans 'let it ride'", () => {
  const p = buildChatAnswerPrompt(decision, ctx);
  assert.match(p.system, /let it ride/i);
});

test("buildChatAnswerPrompt addresses listener by handle", () => {
  const p = buildChatAnswerPrompt(decision, ctx);
  assert.match(p.user, /anna/);
});

test("buildChatAnswerPrompt includes the original message", () => {
  const p = buildChatAnswerPrompt(decision, ctx);
  assert.match(p.user, /hi lena/);
});
