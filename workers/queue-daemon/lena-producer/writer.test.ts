// workers/queue-daemon/lena-producer/writer.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { runWriter } from "./writer.ts";
import type { ProducerContext } from "./producer-context.ts";
import type { ProducerDecision } from "./modes.ts";

const ctx: ProducerContext = {
  trigger: { source: "auto_track_boundary", nextTrack: { id: "x", title: "Dusk", artist: "Anna", genre: "synth", bpm: 112 } },
  now: { localTime: "23:15", bucket: "night" },
  show: { name: "Prime Hours", minutesIn: 60, minutesUntilNext: 360 },
  recentTracksSummary: "(none)",
  recentLinesSummary: "(none)",
  callbackPool: [{ id: "s1", description: "Anna shouted out earlier", minsAgo: 18 }],
  counters: { msSinceLastLine: Infinity, msSinceLastWeatherMention: Infinity, msSinceLastStationDrop: Infinity, tracksSinceLastShoutout: 0 },
  mood: { currentRun: { genre: null, count: 0 }, tempoTrend: "steady", avgBpmLast5: null, topGenreThisHour: null },
  catalogCandidates: [{ id: "c1", title: "Switch", artist: "Bea", genre: "ambient", bpm: 88 }],
};

test("runWriter mode=opinion uses opinion prompt and returns the LLM's trimmed text", async () => {
  const decision: ProducerDecision = { mode: "opinion", targetFocus: "x", callbackTo: null, lengthHint: "short", tone: "warm", addressListener: null, queueAction: null };
  const llm = async (p: { system: string }) => {
    assert.match(p.system, /opinion/i);
    return "  this one's grown on me.  \n";
  };
  const out = await runWriter(decision, ctx, [], { llm });
  assert.equal(out, "this one's grown on me.");
});

test("runWriter mode=aside uses aside prompt", async () => {
  const decision: ProducerDecision = { mode: "aside", targetFocus: "x", callbackTo: null, lengthHint: "short", tone: "low-key", addressListener: null, queueAction: null };
  const llm = async (p: { system: string }) => {
    assert.match(p.system, /aside/i);
    return "still and easy in here tonight.";
  };
  const out = await runWriter(decision, ctx, [], { llm });
  assert.equal(out, "still and easy in here tonight.");
});

test("runWriter mode=callback uses callback prompt", async () => {
  const decision: ProducerDecision = { mode: "callback", targetFocus: "x", callbackTo: "s1", lengthHint: "short", tone: "warm", addressListener: null, queueAction: null };
  const llm = async (p: { system: string }) => {
    assert.match(p.system, /callback/i);
    return "anna's been with us a while.";
  };
  const out = await runWriter(decision, ctx, [], { llm });
  assert.equal(out, "anna's been with us a while.");
});

test("runWriter mode=silence returns null without calling LLM", async () => {
  const decision: ProducerDecision = { mode: "silence", targetFocus: "", callbackTo: null, lengthHint: "short", tone: "low-key", addressListener: null, queueAction: null };
  let called = false;
  const llm = async () => {
    called = true;
    return "should not call";
  };
  const out = await runWriter(decision, ctx, [], { llm });
  assert.equal(out, null);
  assert.equal(called, false);
});

test("runWriter throws on unsupported mode (for Phase 2 — answer/shoutout_read etc. land in 3-5)", async () => {
  const decision: ProducerDecision = { mode: "answer", targetFocus: "x", callbackTo: null, lengthHint: "short", tone: "warm", addressListener: null, queueAction: null };
  const llm = async () => "ok";
  await assert.rejects(() => runWriter(decision, ctx, [], { llm }), /unsupported mode/i);
});

test("runWriter mode=queue_pick uses queue-pick prompt", async () => {
  const decision: ProducerDecision = {
    mode: "queue_pick",
    targetFocus: "mood shift",
    callbackTo: null,
    lengthHint: "short",
    tone: "warm",
    addressListener: null,
    queueAction: { kind: "pick", trackId: "c1", reason: "mood_shift" },
  };
  const llm = async (p: { system: string; user: string }) => {
    assert.match(p.system, /queue_pick/i);
    assert.match(p.user, /Switch/);
    return "switching gears — Switch from Bea, ambient for the hour.";
  };
  const out = await runWriter(decision, ctx, [], { llm });
  assert.equal(out, "switching gears — Switch from Bea, ambient for the hour.");
});
