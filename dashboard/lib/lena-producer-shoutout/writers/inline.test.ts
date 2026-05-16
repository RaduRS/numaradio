import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInlineShoutoutPrompt } from "./inline";

const decision = { mode: "shoutout_inline" as const, targetFocus: "x", callbackTo: null, lengthHint: "short" as const, tone: "warm" as const };
const ctx = {
  trigger: { source: "booth_shoutout" as const, handle: "anna", text: "loving this" },
  now: { localTime: "23:15", bucket: "night" },
  recentShoutouts: [],
  recentLenaLines: [],
};

test("buildInlineShoutoutPrompt bans 'let it ride'", () => {
  const p = buildInlineShoutoutPrompt(decision, ctx, []);
  assert.match(p.system, /let it ride/i);
});

test("buildInlineShoutoutPrompt includes sender + message in user", () => {
  const p = buildInlineShoutoutPrompt(decision, ctx, []);
  assert.match(p.user, /anna/);
  assert.match(p.user, /loving this/);
});
