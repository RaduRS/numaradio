import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCallbackShoutoutPrompt } from "./callback.ts";

const decision = { mode: "shoutout_callback" as const, targetFocus: "tie to bob", callbackTo: "s1", lengthHint: "medium" as const, tone: "warm" as const };
const ctx = {
  trigger: { source: "booth_shoutout" as const, handle: "anna", text: "hey" },
  now: { localTime: "23:15", bucket: "night" },
  recentShoutouts: [{ id: "s1", handle: "bob", text: "hi from berlin", minsAgo: 5 }],
  recentLenaLines: [],
};

test("buildCallbackShoutoutPrompt resolves callback_to to the recent shoutout", () => {
  const p = buildCallbackShoutoutPrompt(decision, ctx, []);
  assert.match(p.user, /bob/);
  assert.match(p.user, /berlin/);
});

test("buildCallbackShoutoutPrompt bans 'let it ride'", () => {
  const p = buildCallbackShoutoutPrompt(decision, ctx, []);
  assert.match(p.system, /let it ride/i);
});
