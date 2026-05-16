// workers/queue-daemon/lena-producer/producer.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { runProducer } from "./producer.ts";
import type { ProducerContext } from "./producer-context.ts";

function ctx(): ProducerContext {
  return {
    trigger: {
      source: "auto_track_boundary",
      nextTrack: { id: "x", title: "X", artist: null, genre: null, bpm: null },
    },
    now: { localTime: "00:00", bucket: "late night" },
    show: { name: "Night Shift", minutesIn: 0, minutesUntilNext: 300 },
    recentTracksSummary: "(no recent tracks)",
    recentLinesSummary: "(no recent Lena lines this shift)",
    callbackPool: [],
    counters: { msSinceLastLine: Infinity, msSinceLastWeatherMention: Infinity, msSinceLastStationDrop: Infinity, tracksSinceLastShoutout: 0 },
    mood: { currentRun: { genre: null, count: 0 }, tempoTrend: "steady", avgBpmLast5: null, topGenreThisHour: null },
  };
}

test("runProducer happy path: LLM returns valid JSON → parsed decision", async () => {
  const llm = async () =>
    JSON.stringify({
      mode: "opinion",
      target_focus: "the next track's mood",
      callback_to: null,
      length_hint: "medium",
      tone: "warm",
      address_listener: null,
    });
  const d = await runProducer(ctx(), { llm });
  assert.equal(d.mode, "opinion");
  assert.equal(d.targetFocus, "the next track's mood");
  assert.equal(d.lengthHint, "medium");
  assert.equal(d.tone, "warm");
});

test("runProducer: invalid JSON first time → retries → second valid call wins", async () => {
  let call = 0;
  const llm = async () => {
    call += 1;
    if (call === 1) return "not json at all";
    return JSON.stringify({
      mode: "aside",
      target_focus: "weather",
      callback_to: null,
      length_hint: "short",
      tone: "low-key",
      address_listener: null,
    });
  };
  const d = await runProducer(ctx(), { llm });
  assert.equal(call, 2);
  assert.equal(d.mode, "aside");
});

test("runProducer: two bad calls → safeDefaultDecision (aside / low-key / short)", async () => {
  const llm = async () => "garbage";
  const d = await runProducer(ctx(), { llm });
  assert.equal(d.mode, "aside");
  assert.equal(d.tone, "low-key");
});

test("runProducer: invalid mode (not in PHASE_2_MODES) → retry, then fallback", async () => {
  let call = 0;
  const llm = async () => {
    call += 1;
    return JSON.stringify({
      mode: "queue_pick",
      target_focus: "x",
      callback_to: null,
      length_hint: "short",
      tone: "warm",
      address_listener: null,
    });
  };
  const d = await runProducer(ctx(), { llm });
  assert.equal(call, 2);
  assert.equal(d.mode, "aside"); // fallback
});

test("runProducer: callback_to references unknown id → strip to null, do not retry", async () => {
  const llm = async () =>
    JSON.stringify({
      mode: "opinion",
      target_focus: "x",
      callback_to: "does_not_exist",
      length_hint: "short",
      tone: "warm",
      address_listener: null,
    });
  const d = await runProducer(ctx(), { llm });
  assert.equal(d.mode, "opinion");
  assert.equal(d.callbackTo, null);
});

test("runProducer: silence is allowed for auto_track_boundary", async () => {
  const llm = async () =>
    JSON.stringify({
      mode: "silence",
      target_focus: "",
      callback_to: null,
      length_hint: "short",
      tone: "low-key",
      address_listener: null,
    });
  const d = await runProducer(ctx(), { llm });
  assert.equal(d.mode, "silence");
});
