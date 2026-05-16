import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQuoteShoutoutPrompt } from "./quote.ts";

const decision = { mode: "shoutout_quote" as const, targetFocus: "x", callbackTo: null, lengthHint: "short" as const, tone: "warm" as const };
const ctx = {
  trigger: { source: "booth_shoutout" as const, handle: "anna", text: "loving this" },
  now: { localTime: "23:15", bucket: "night" },
  recentShoutouts: [],
  recentLenaLines: [],
};

test("buildQuoteShoutoutPrompt bans 'let it ride'", () => {
  const p = buildQuoteShoutoutPrompt(decision, ctx, []);
  assert.match(p.system, /let it ride/i);
});

test("buildQuoteShoutoutPrompt includes sender + message in user", () => {
  const p = buildQuoteShoutoutPrompt(decision, ctx, []);
  assert.match(p.user, /anna/);
  assert.match(p.user, /loving this/);
});
