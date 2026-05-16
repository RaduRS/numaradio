import { test } from "node:test";
import assert from "node:assert/strict";
import { runShoutoutProducer } from "./producer.ts";
import type { ShoutoutContext } from "./shoutout-context.ts";

function ctx(): ShoutoutContext {
  return {
    trigger: { source: "booth_shoutout", handle: "anna", text: "hi" },
    now: { localTime: "23:00", bucket: "night" },
    recentShoutouts: [{ id: "s1", handle: "bob", text: "hi", minsAgo: 5 }],
    recentLenaLines: [],
  };
}

test("runShoutoutProducer happy path", async () => {
  const llm = async () => JSON.stringify({ mode: "shoutout_inline", target_focus: "x", callback_to: null, length_hint: "short", tone: "warm" });
  const d = await runShoutoutProducer(ctx(), { llm });
  assert.equal(d.mode, "shoutout_inline");
});

test("runShoutoutProducer rejects silence — retry then fallback to classic", async () => {
  let call = 0;
  const llm = async () => { call += 1; return JSON.stringify({ mode: "silence", target_focus: "", callback_to: null, length_hint: "short", tone: "low-key" }); };
  const d = await runShoutoutProducer(ctx(), { llm });
  assert.equal(call, 2);
  assert.equal(d.mode, "shoutout_classic"); // safe default
});

test("runShoutoutProducer: invalid JSON → fallback", async () => {
  const d = await runShoutoutProducer(ctx(), { llm: async () => "garbage" });
  assert.equal(d.mode, "shoutout_classic");
});

test("runShoutoutProducer: callback_to unknown id → stripped to null", async () => {
  const llm = async () => JSON.stringify({ mode: "shoutout_callback", target_focus: "x", callback_to: "not_real", length_hint: "short", tone: "warm" });
  const d = await runShoutoutProducer(ctx(), { llm });
  assert.equal(d.callbackTo, null);
});
