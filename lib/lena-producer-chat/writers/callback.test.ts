import { test } from "node:test";
import assert from "node:assert/strict";
import { buildChatCallbackPrompt } from "./callback.ts";

const decision = { mode: "callback" as const, targetFocus: "tie to bob's shoutout", callbackTo: "s1", lengthHint: "medium" as const, tone: "warm" as const };
const ctx = {
  trigger: { source: "youtube_chat_mention" as const, handle: "anna", text: "what was that last shoutout" },
  now: { localTime: "23:30", bucket: "night" },
  recentShoutouts: [{ id: "s1", handle: "bob", originalText: "hi from berlin", minsAgo: 5 }],
  recentLenaLines: [],
};

test("buildChatCallbackPrompt resolves callback_to to a recent shoutout description", () => {
  const p = buildChatCallbackPrompt(decision, ctx);
  assert.match(p.user, /bob/);
  assert.match(p.user, /berlin/);
});

test("buildChatCallbackPrompt bans 'let it ride'", () => {
  const p = buildChatCallbackPrompt(decision, ctx);
  assert.match(p.system, /let it ride/i);
});

test("buildChatCallbackPrompt enforces TRACK-CURRENCY rule (Vercel side has no nowplaying context)", () => {
  const p = buildChatCallbackPrompt(decision, ctx);
  assert.match(p.system, /TRACK-CURRENCY RULE/);
  assert.match(p.system, /rolling right now/);
});
