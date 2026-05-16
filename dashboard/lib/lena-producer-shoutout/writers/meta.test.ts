import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMetaShoutoutPrompt } from "./meta";

const ctx = {
  trigger: { source: "booth_shoutout" as const, handle: "Slim", text: "love this station" },
  now: { localTime: "21:00", bucket: "night" },
  recentShoutouts: [],
  recentLenaLines: [],
};

test("buildMetaShoutoutPrompt forbids third-person narration", () => {
  const decision = { mode: "shoutout_meta" as const, targetFocus: "respond warmly", callbackTo: null, lengthHint: "short" as const, tone: "warm" as const };
  const p = buildMetaShoutoutPrompt(decision, ctx, []);
  assert.match(p.system, /First person/i);
  assert.match(p.system, /Do NOT narrate/);
});

test("buildMetaShoutoutPrompt bans 'let it ride'", () => {
  const decision = { mode: "shoutout_meta" as const, targetFocus: "x", callbackTo: null, lengthHint: "short" as const, tone: "warm" as const };
  const p = buildMetaShoutoutPrompt(decision, ctx, []);
  assert.match(p.system, /let it ride/i);
});

test("buildMetaShoutoutPrompt includes listener_handle + listener_said in user message", () => {
  const decision = { mode: "shoutout_meta" as const, targetFocus: "x", callbackTo: null, lengthHint: "short" as const, tone: "warm" as const };
  const p = buildMetaShoutoutPrompt(decision, ctx, []);
  assert.match(p.user, /Slim/);
  assert.match(p.user, /love this station/);
});
