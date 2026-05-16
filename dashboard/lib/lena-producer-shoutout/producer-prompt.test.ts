import { test } from "node:test";
import assert from "node:assert/strict";
import { buildShoutoutProducerPrompt } from "./producer-prompt.ts";
import type { ShoutoutContext } from "./shoutout-context.ts";

function ctx(): ShoutoutContext {
  return {
    trigger: { source: "booth_shoutout", handle: "anna", text: "loving this set" },
    now: { localTime: "23:15", bucket: "night" },
    recentShoutouts: [{ id: "s1", handle: "bob", text: "hi from berlin", minsAgo: 18 }],
    recentLenaLines: [{ text: "Going out to friends in Berlin tonight.", airedAt: 0 }],
  };
}

test("buildShoutoutProducerPrompt forbids silence", () => {
  const p = buildShoutoutProducerPrompt(ctx());
  assert.match(p.system, /NEVER/);
  assert.match(p.system, /silence/i);
});

test("buildShoutoutProducerPrompt mode allowlist", () => {
  const p = buildShoutoutProducerPrompt(ctx());
  assert.match(p.system, /shoutout_classic/);
  assert.match(p.system, /shoutout_inline/);
  assert.match(p.system, /shoutout_quote/);
  assert.match(p.system, /shoutout_callback/);
});

test("buildShoutoutProducerPrompt nudges against repeating the legacy 'going out to' opener too often", () => {
  const p = buildShoutoutProducerPrompt(ctx());
  assert.match(p.system, /shape/i); // mentions varying shapes
});

test("buildShoutoutProducerPrompt user message has the new shoutout + recent shoutouts", () => {
  const p = buildShoutoutProducerPrompt(ctx());
  assert.match(p.user, /loving this set/);
  assert.match(p.user, /bob/);
  assert.match(p.user, /hi from berlin/);
});
