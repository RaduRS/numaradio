import { test } from "node:test";
import assert from "node:assert/strict";
import { AutoHostStateMachine } from "./auto-host.ts";

test("fresh state: no trigger on first track", () => {
  const sm = new AutoHostStateMachine();
  assert.equal(sm.onMusicTrackStart(), "idle");
  assert.equal(sm.tracksSinceVoice, 1);
});

test("triggers on 2nd track with no voice", () => {
  const sm = new AutoHostStateMachine();
  sm.onMusicTrackStart();
  assert.equal(sm.onMusicTrackStart(), "trigger");
});

test("voice event resets counter (simple reset)", () => {
  const sm = new AutoHostStateMachine();
  sm.onMusicTrackStart();
  sm.onVoicePushed();
  assert.equal(sm.tracksSinceVoice, 0);
  assert.equal(sm.onMusicTrackStart(), "idle"); // need 2 more music tracks
  assert.equal(sm.onMusicTrackStart(), "trigger");
});

test("slotCounter advances only on markSuccess", () => {
  const sm = new AutoHostStateMachine();
  sm.onMusicTrackStart();
  const action = sm.onMusicTrackStart(); // "trigger"
  assert.equal(action, "trigger");
  assert.equal(sm.slotCounter, 0);
  sm.markInFlight();
  sm.markSuccess();
  assert.equal(sm.slotCounter, 1);
  assert.equal(sm.tracksSinceVoice, 0);
});

test("slotCounter does NOT advance on markFailure; counter still resets", () => {
  const sm = new AutoHostStateMachine();
  sm.onMusicTrackStart();
  sm.onMusicTrackStart(); // trigger
  sm.markInFlight();
  sm.markFailure();
  assert.equal(sm.slotCounter, 0); // unchanged — same type retries next opportunity
  assert.equal(sm.tracksSinceVoice, 0);
});

test("inFlight guard prevents double-trigger", () => {
  const sm = new AutoHostStateMachine();
  sm.onMusicTrackStart();
  assert.equal(sm.onMusicTrackStart(), "trigger");
  sm.markInFlight();
  // Another track boundary arrives before generation completes:
  assert.equal(sm.onMusicTrackStart(), "idle"); // suppressed
});

test("onVoicePushed during in-flight cancels and resets", () => {
  const sm = new AutoHostStateMachine();
  sm.onMusicTrackStart();
  sm.onMusicTrackStart();
  sm.markInFlight();
  sm.onVoicePushed();  // shoutout arrived during our gen
  assert.equal(sm.tracksSinceVoice, 0);
  assert.equal(sm.isInFlight(), false); // cancelled
});

test("markSuccess throws when called without markInFlight", () => {
  const sm = new AutoHostStateMachine();
  assert.throws(() => sm.markSuccess(), /markSuccess called without markInFlight/);
});

test("markFailure throws when called without markInFlight", () => {
  const sm = new AutoHostStateMachine();
  assert.throws(() => sm.markFailure(), /markFailure called without markInFlight/);
});

test("state fields are readable but not writable from outside", () => {
  const sm = new AutoHostStateMachine();
  sm.onMusicTrackStart();
  assert.equal(sm.tracksSinceVoice, 1);
  // Attempting to write should be a no-op or TypeError at runtime — at
  // minimum, the getter's value is not changeable by external code:
  // (we don't assert the TS compile error, just that reads stay correct
  // after manipulation attempts)
  try {
    // @ts-expect-error — readonly getter, intentional
    sm.tracksSinceVoice = 999;
  } catch {
    // either a TypeError or silently ignored; both fine
  }
  assert.equal(sm.tracksSinceVoice, 1);
});

test("recentArtists ring starts empty", () => {
  const sm = new AutoHostStateMachine();
  assert.deepEqual(sm.recentArtists, []);
});

test("onMusicTrackStart pushes artist onto recentArtists, newest-first", () => {
  const sm = new AutoHostStateMachine();
  sm.onMusicTrackStart("Alice");
  sm.onMusicTrackStart("Bob");
  assert.deepEqual(sm.recentArtists, ["Bob", "Alice"]);
});

test("recentArtists caps at 3 entries", () => {
  const sm = new AutoHostStateMachine();
  sm.onMusicTrackStart("A");
  sm.onMusicTrackStart("B");
  sm.onMusicTrackStart("C");
  sm.onMusicTrackStart("D");
  assert.deepEqual(sm.recentArtists, ["D", "C", "B"]);
});

test("onMusicTrackStart without artist arg does not push to recentArtists", () => {
  const sm = new AutoHostStateMachine();
  sm.onMusicTrackStart();
  assert.deepEqual(sm.recentArtists, []);
});

test("onMusicTrackStart with empty-string artist does not push", () => {
  const sm = new AutoHostStateMachine();
  sm.onMusicTrackStart("");
  assert.deepEqual(sm.recentArtists, []);
});

import { AutoHostOrchestrator } from "./auto-host.ts";
import type { StationConfig, StationConfigBlock } from "./station-config.ts";

interface RecordedFailure { reason: string; detail?: string }
interface RecordedPush { url: string }
interface RecordedRevert {
  block: "autoHost" | "worldAside";
  fromMode: "forced_on" | "forced_off";
  forcedUntil: Date;
}

const AUTO_BLOCK: StationConfigBlock = { mode: "auto", forcedUntil: null, forcedBy: null };
const AUTO_CFG: StationConfig = { autoHost: AUTO_BLOCK, worldAside: AUTO_BLOCK };

function blockFor(
  mode: "auto" | "forced_on" | "forced_off",
  forcedUntilIso?: string,
): StationConfigBlock {
  return {
    mode,
    forcedUntil: forcedUntilIso ? new Date(forcedUntilIso) : null,
    forcedBy: forcedUntilIso ? "op@example.com" : null,
  };
}

function configFor(
  mode: "auto" | "forced_on" | "forced_off",
  forcedUntilIso?: string,
): StationConfig {
  return { autoHost: blockFor(mode, forcedUntilIso), worldAside: AUTO_BLOCK };
}

function fakeDeps(overrides: Partial<Parameters<typeof AutoHostOrchestrator.prototype.constructor>[0]> = {}) {
  const failures: RecordedFailure[] = [];
  const pushes: RecordedPush[] = [];
  const sleepCalls: number[] = [];
  const reverts: RecordedRevert[] = [];
  const deps = {
    config: async () => AUTO_CFG,
    getListenerCount: async () => 100 as number | null,
    // Default: no YouTube fold-in. Tests that exercise the fold-in
    // override this. null preserves pre-fold-in behaviour for every
    // existing test.
    getYoutubeAudience: async () =>
      null as { state: string; viewers: number } | null,
    revertExpired: async (entry: RecordedRevert) => { reverts.push(entry); },
    // Default: duration=null so the orchestrator skips the pre-end wait
    // and pushes immediately. Tests that care about timing override this.
    resolveCurrentTrack: async () => ({
      title: "Midnight Drive",
      artist: "Russell Ross",
      startedAtMs: 0,
      durationSeconds: null as number | null,
    }),
    generateScript: async () => "That was Midnight Drive by Russell Ross. Stick around.",
    synthesizeSpeech: async () => Buffer.from([0xff, 0xfb]),
    uploadChatter: async () => "https://cdn.numaradio.com/file/numaradio/stations/numaradio/chatter/x.mp3",
    pushToOverlay: async (url: string) => { pushes.push({ url }); },
    logPush: () => {},
    logFailure: (f: RecordedFailure) => { failures.push(f); },
    sleep: async (ms: number) => { sleepCalls.push(ms); },
    ...overrides,
  };
  return { deps, failures, pushes, sleepCalls, reverts };
}

test("orchestrator happy path: generate, upload, push, markSuccess", async () => {
  const { deps, pushes } = fakeDeps();
  const orch = new AutoHostOrchestrator(deps);
  await orch.runChatter();
  assert.equal(pushes.length, 1);
  assert.match(pushes[0].url, /chatter\/.+\.mp3$/);
  assert.equal(orch.state.slotCounter, 1);
});

test("forced_on speaks even when listeners=0", async () => {
  const { deps, pushes } = fakeDeps({
    config: async () => configFor("forced_on", "2099-01-01T00:00:00Z"),
    getListenerCount: async () => 0,
  });
  const orch = new AutoHostOrchestrator(deps);
  await orch.runChatter();
  assert.equal(pushes.length, 1);
});

test("forced_off skips even when listeners=50", async () => {
  const { deps, pushes } = fakeDeps({
    config: async () => configFor("forced_off", "2099-01-01T00:00:00Z"),
    getListenerCount: async () => 50,
  });
  const orch = new AutoHostOrchestrator(deps);
  await orch.runChatter();
  assert.equal(pushes.length, 0);
  assert.equal(orch.state.slotCounter, 0);
});

test("auto mode skips when listeners < 3", async () => {
  const { deps, pushes } = fakeDeps({
    config: async () => configFor("auto"),
    getListenerCount: async () => 2,
  });
  const orch = new AutoHostOrchestrator(deps);
  await orch.runChatter();
  assert.equal(pushes.length, 0);
  assert.equal(orch.state.slotCounter, 0);
});

test("auto mode speaks when listeners >= 3", async () => {
  const { deps, pushes } = fakeDeps({
    config: async () => configFor("auto"),
    getListenerCount: async () => 3,
  });
  const orch = new AutoHostOrchestrator(deps);
  await orch.runChatter();
  assert.equal(pushes.length, 1);
});

test("auto mode fails closed when listener count is null (Icecast error)", async () => {
  const { deps, pushes } = fakeDeps({
    config: async () => configFor("auto"),
    getListenerCount: async () => null,
  });
  const orch = new AutoHostOrchestrator(deps);
  await orch.runChatter();
  assert.equal(pushes.length, 0);
});

test("expired forced_on lazy-reverts then re-evaluates in auto (skips on low listeners)", async () => {
  const { deps, pushes, reverts } = fakeDeps({
    config: async () => configFor("forced_on", "2000-01-01T00:00:00Z"),
    getListenerCount: async () => 0,
  });
  const orch = new AutoHostOrchestrator(deps);
  await orch.runChatter();
  assert.equal(reverts.length, 1);
  assert.equal(reverts[0]?.fromMode, "forced_on");
  assert.equal(pushes.length, 0); // reverted to auto, listeners=0, skip
});

test("expired forced_off lazy-reverts and then speaks when listeners>=3", async () => {
  const { deps, pushes, reverts } = fakeDeps({
    config: async () => configFor("forced_off", "2000-01-01T00:00:00Z"),
    getListenerCount: async () => 10,
  });
  const orch = new AutoHostOrchestrator(deps);
  await orch.runChatter();
  assert.equal(reverts.length, 1);
  assert.equal(reverts[0]?.fromMode, "forced_off");
  assert.equal(pushes.length, 1);
});

test("forced_on with null getListenerCount still speaks (force overrides)", async () => {
  const { deps, pushes } = fakeDeps({
    config: async () => configFor("forced_on", "2099-01-01T00:00:00Z"),
    getListenerCount: async () => null,
  });
  const orch = new AutoHostOrchestrator(deps);
  await orch.runChatter();
  assert.equal(pushes.length, 1);
});

test("orchestrator retries once on MiniMax failure, then succeeds", async () => {
  let calls = 0;
  const { deps, failures, pushes } = fakeDeps({
    generateScript: async () => {
      calls += 1;
      if (calls === 1) throw new Error("minimax http 503");
      return "Retry succeeded.";
    },
  });
  const orch = new AutoHostOrchestrator(deps);
  await orch.runChatter();
  assert.equal(pushes.length, 1);
  assert.equal(failures.length, 1); // first-attempt failure logged
  assert.match(failures[0].reason, /auto_chatter_script_failed/);
});

test("orchestrator logs both attempts and skips when retry also fails", async () => {
  const { deps, failures, pushes } = fakeDeps({
    generateScript: async () => { throw new Error("minimax http 500"); },
  });
  const orch = new AutoHostOrchestrator(deps);
  await orch.runChatter();
  assert.equal(pushes.length, 0);
  assert.equal(failures.length, 2); // initial + retry
  assert.equal(orch.state.slotCounter, 0); // unchanged on failure
  assert.equal(orch.state.tracksSinceVoice, 0); // counter still resets
});

test("orchestrator logs auto_chatter_tts_failed specifically for Deepgram errors", async () => {
  const { deps, failures } = fakeDeps({
    synthesizeSpeech: async () => { throw new Error("deepgram 500"); },
  });
  const orch = new AutoHostOrchestrator(deps);
  await orch.runChatter();
  assert.ok(failures.every((f) => f.reason === "auto_chatter_tts_failed"));
});

test("orchestrator logs auto_chatter_b2_failed for upload errors", async () => {
  const { deps, failures } = fakeDeps({
    uploadChatter: async () => { throw new Error("b2 down"); },
  });
  const orch = new AutoHostOrchestrator(deps);
  await orch.runChatter();
  assert.ok(failures.every((f) => f.reason === "auto_chatter_b2_failed"));
});

test("orchestrator logs auto_chatter_push_failed for socket errors", async () => {
  const { deps, failures } = fakeDeps({
    pushToOverlay: async () => { throw new Error("socket closed"); },
  });
  const orch = new AutoHostOrchestrator(deps);
  await orch.runChatter();
  assert.ok(failures.every((f) => f.reason === "auto_chatter_push_failed"));
});

test("orchestrator is a no-op while a chatter is already in flight", async () => {
  let calls = 0;
  const { deps, pushes } = fakeDeps({
    generateScript: async () => {
      calls += 1;
      // Yield so a second runChatter can see in-flight:
      await new Promise((r) => setTimeout(r, 5));
      return "A line.";
    },
  });
  const orch = new AutoHostOrchestrator(deps);
  await Promise.all([orch.runChatter(), orch.runChatter()]);
  assert.equal(pushes.length, 1);
  assert.equal(calls, 1);
});

test("back_announce without a current track falls back to generic prompt context", async () => {
  const { deps, pushes } = fakeDeps({
    resolveCurrentTrack: async () => null,
  });
  const orch = new AutoHostOrchestrator(deps);
  // Force slot 0 (back_announce) — happy path:
  await orch.runChatter();
  assert.equal(pushes.length, 1); // still airs, just without track-specific data
});

test("runChatter waits until 15s before current track ends before pushing", async () => {
  // Track started at 1000ms, lasts 30s → ends at 31000ms.
  // Target push time = end − 15s = 16000ms.
  // Now is 6000ms (5s into track) → expected waitMs = 10000.
  const { deps, pushes, sleepCalls } = fakeDeps({
    now: () => 6000,
    resolveCurrentTrack: async () => ({
      title: "X", artist: "Y",
      startedAtMs: 1000,
      durationSeconds: 30,
    }),
  });
  const orch = new AutoHostOrchestrator(deps);
  await orch.runChatter();
  assert.ok(
    sleepCalls.includes(10000),
    `expected a 10000ms sleep, got ${JSON.stringify(sleepCalls)}`,
  );
  assert.equal(pushes.length, 1);
});

test("runChatter pushes immediately when duration is unknown", async () => {
  const { deps, pushes, sleepCalls } = fakeDeps({
    resolveCurrentTrack: async () => ({
      title: "X", artist: "Y",
      startedAtMs: 0,
      durationSeconds: null,
    }),
  });
  const orch = new AutoHostOrchestrator(deps);
  await orch.runChatter();
  // No pre-end wait recorded — push fired immediately.
  assert.equal(sleepCalls.length, 0);
  assert.equal(pushes.length, 1);
});

test("runChatter pushes immediately when the target push time is already past", async () => {
  // Track started at 0, duration 30 → ends at 30000. Target = 15000.
  // Now = 25000 (5s before end, well past the 15-s-before-end target).
  const { deps, pushes, sleepCalls } = fakeDeps({
    now: () => 25_000,
    resolveCurrentTrack: async () => ({
      title: "X", artist: "Y",
      startedAtMs: 0,
      durationSeconds: 30,
    }),
  });
  const orch = new AutoHostOrchestrator(deps);
  await orch.runChatter();
  // No wait fired (waitMs would be negative; orchestrator skips it).
  assert.equal(sleepCalls.length, 0);
  assert.equal(pushes.length, 1);
});

test("onVoicePushed during the pre-push wait cancels the chatter push", async () => {
  // Set up: sleep resolves only when we explicitly tell it to. That way we
  // can simulate "the sleep hasn't finished yet" and fire a voice event
  // before pushing.
  let sleepResolver: (() => void) | null = null;
  const sleepPromise = new Promise<void>((resolve) => {
    sleepResolver = resolve;
  });
  const { deps, pushes } = fakeDeps({
    now: () => 0,
    sleep: (ms: number) => {
      // Only stub the long pre-end wait; instant-resolve anything shorter
      // (e.g. the 2s retry delay) by not trapping it.
      if (ms > 1000) return sleepPromise;
      return Promise.resolve();
    },
    resolveCurrentTrack: async () => ({
      title: "X", artist: "Y",
      startedAtMs: 0,
      durationSeconds: 30, // target push at 20000ms, waitMs = 20000
    }),
  });
  const orch = new AutoHostOrchestrator(deps);
  const runPromise = orch.runChatter();
  // Let the orchestrator reach its pre-push wait.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  // Shoutout arrives — cancels the scheduled push.
  orch.onVoicePushed();
  // Let sleep resolve (simulate time passing).
  sleepResolver?.();
  await runPromise;
  assert.equal(pushes.length, 0, "push should have been cancelled");
});

test("generateAsset includes currentShow + recentArtists + slotsSinceOpening in the prompt", async () => {
  let capturedUser: string | null = null;
  const { deps } = fakeDeps({
    // Pin randomGate below the 0.15 threshold so the show-name throttle
    // deterministically includes currentShow for this test.
    randomGate: () => 0.0,
    generateScript: async (p: { system: string; user: string }) => {
      capturedUser = p.user;
      return "A line.";
    },
  });
  const orch = new AutoHostOrchestrator(deps);
  // Advance to slot 1 (back_announce in the new rotation — slot 0 is
  // shoutout_cta which doesn't slice recentArtists).
  orch.state.markInFlight();
  orch.state.markSuccess();
  // Simulate three music-track boundaries to populate the ring.
  orch.onMusicTrackStart("Russell Ross");
  orch.onMusicTrackStart("Russell Ross");
  orch.onMusicTrackStart("Numa Radio");
  // Now runChatter — slot 1 = back_announce. For back_announce we slice
  // ring[0] (the currently-announcing artist, already named in the "by X"
  // clause), so the Context block should list only the 2 artists BEFORE
  // "Numa Radio": Russell Ross, Russell Ross.
  await orch.runChatter();
  assert.ok(capturedUser, "generateScript should have been called");
  assert.match(capturedUser!, /Context \(optional/);
  assert.match(capturedUser!, /Current show: (Night Shift|Morning Room|Daylight Channel|Prime Hours)/);
  assert.match(capturedUser!, /Last 2 artists aired.*Russell Ross, Russell Ross/);
  assert.doesNotMatch(capturedUser!, /Numa Radio, Russell Ross, Russell Ross/,
    "currently-announcing artist (Numa Radio) must not duplicate in the recentArtists list");
  // slotsSinceOpening for slot 1 is 1
  assert.match(capturedUser!, /Position in the 20-slot rotation: 1/);
});

test("generateAsset omits currentShow when the 15% throttle gate rolls above threshold", async () => {
  let capturedUser: string | null = null;
  const { deps } = fakeDeps({
    // Pin randomGate above 0.15 so the throttle omits currentShow.
    randomGate: () => 0.5,
    generateScript: async (p: { system: string; user: string }) => {
      capturedUser = p.user;
      return "A line.";
    },
  });
  const orch = new AutoHostOrchestrator(deps);
  orch.onMusicTrackStart("Russell Ross");
  orch.onMusicTrackStart("Russell Ross");
  await orch.runChatter();
  assert.ok(capturedUser);
  assert.doesNotMatch(capturedUser!, /Current show:/,
    "show-name should be withheld when the random gate rolls above 0.15");
});

test("generateAsset falls back to filler when back_announce fires without a resolved current track", async () => {
  let capturedPrompts: { system: string; user: string } | null = null;
  const { deps, pushes } = fakeDeps({
    resolveCurrentTrack: async () => null,
    generateScript: async (p) => { capturedPrompts = p; return "A line."; },
  });
  const orch = new AutoHostOrchestrator(deps);
  // slot 0 would normally be back_announce, but with no current track the
  // orchestrator should substitute filler to avoid airing "that one" / "the
  // artist" placeholders.
  await orch.runChatter();
  assert.equal(pushes.length, 1);
  assert.ok(capturedPrompts, "generateScript should have been called");
  // Filler prompt's signature phrase — back_announce's "track that just
  // ended was" must NOT appear.
  assert.doesNotMatch(capturedPrompts!.user, /track that just ended/i);
  assert.doesNotMatch(capturedPrompts!.user, /that one|the artist/,
    "placeholder fallback strings must not reach the outgoing prompt");
});

test("orchestrator.onMusicTrackStart forwards artist to the state machine", () => {
  const { deps } = fakeDeps();
  const orch = new AutoHostOrchestrator(deps);
  orch.onMusicTrackStart("Test Artist");
  assert.deepEqual(orch.state.recentArtists, ["Test Artist"]);
});

test("generateAsset always passes localTime + timeOfDay derived from deps.now", async () => {
  let capturedUser: string | null = null;
  // 2026-04-24 08:40 local. Intentionally a morning time — this is the exact
  // scenario that fired "tonight" on air before the time-context fix.
  const fixedEpoch = new Date(2026, 3, 24, 8, 40, 0).getTime();
  const { deps } = fakeDeps({
    now: () => fixedEpoch,
    // Pin the show-name gate above 0.15 so currentShow is withheld — keeps
    // this test focused on the time-context assertion.
    randomGate: () => 0.5,
    generateScript: async (p: { system: string; user: string }) => {
      capturedUser = p.user;
      return "A line.";
    },
  });
  const orch = new AutoHostOrchestrator(deps);
  await orch.runChatter();
  assert.ok(capturedUser, "generateScript should have been called");
  assert.match(capturedUser!, /Local time: 08:40 \(morning\)/);
});

// ─── world_aside (Tier 2.5) ─────────────────────────────────────────

/** Advance the orchestrator state machine to a target slot via paired
 *  markInFlight/markSuccess calls. Used by world_aside tests since slots
 *  4/10/16 are the world_aside slots in the new rotation. */
function advanceToSlot(orch: AutoHostOrchestrator, target: number) {
  while (orch.state.slotCounter % 20 !== target) {
    orch.state.markInFlight();
    orch.state.markSuccess();
  }
}

test("world_aside slot: NanoClaw returns ok → uses external line, skips MiniMax", async () => {
  let scriptCalls = 0;
  const { deps, pushes } = fakeDeps({
    fetchWorldAside: async () => ({ ok: true, topic: "weather:tokyo", line: "Tokyo's wet right now." }),
    generateScript: async () => { scriptCalls += 1; return "should not be called"; },
  });
  const orch = new AutoHostOrchestrator(deps);
  advanceToSlot(orch, 4); // first world_aside slot
  await orch.runChatter();
  assert.equal(pushes.length, 1, "should push the world_aside audio");
  assert.equal(scriptCalls, 0, "MiniMax should be bypassed when NanoClaw returns a line");
  assert.deepEqual(orch.recentWorldTopics.snapshot(), ["weather:tokyo"]);
});

test("world_aside slot: toggle B forced_off → demote to filler (MiniMax fires)", async () => {
  let scriptCalls = 0;
  let fetchCalls = 0;
  const { deps, pushes } = fakeDeps({
    config: async () => ({
      autoHost: { mode: "auto", forcedUntil: null, forcedBy: null },
      worldAside: { mode: "forced_off", forcedUntil: new Date("2099-01-01"), forcedBy: "op" },
    }),
    fetchWorldAside: async () => { fetchCalls += 1; return { ok: false, reason: "should-not-be-called" }; },
    generateScript: async () => { scriptCalls += 1; return "Filler line."; },
  });
  const orch = new AutoHostOrchestrator(deps);
  advanceToSlot(orch, 4);
  await orch.runChatter();
  assert.equal(fetchCalls, 0, "world_aside fetch must not fire when toggle B is forced_off");
  assert.equal(scriptCalls, 1, "MiniMax should fire for the demoted filler");
  assert.equal(pushes.length, 1, "still pushes — listener hears chatter");
});

test("world_aside slot: NanoClaw returns ok:false → demote, log failure, MiniMax fills in", async () => {
  let scriptCalls = 0;
  const { deps, pushes, failures } = fakeDeps({
    fetchWorldAside: async () => ({ ok: false, reason: "no_good_topic" }),
    generateScript: async () => { scriptCalls += 1; return "Filler."; },
  });
  const orch = new AutoHostOrchestrator(deps);
  advanceToSlot(orch, 4);
  await orch.runChatter();
  assert.equal(scriptCalls, 1, "MiniMax fires for the demoted filler");
  assert.equal(pushes.length, 1);
  assert.ok(failures.some((f) => f.reason === "world_aside_no_good_topic"),
    "world_aside failure should be logged with reason prefix");
});

test("world_aside slot: HTTP throw caught → demote, log unexpected error", async () => {
  const { deps, pushes, failures } = fakeDeps({
    fetchWorldAside: async () => { throw new Error("ECONNREFUSED"); },
    generateScript: async () => "Filler.",
  });
  const orch = new AutoHostOrchestrator(deps);
  advanceToSlot(orch, 4);
  await orch.runChatter();
  assert.equal(pushes.length, 1, "still pushes filler");
  assert.ok(failures.some((f) => f.reason === "world_aside_unexpected_error"));
});

test("world_aside slot: no fetchWorldAside dep wired → demote silently", async () => {
  const { deps, pushes, failures } = fakeDeps({
    // fetchWorldAside intentionally omitted
    generateScript: async () => "Filler.",
  });
  const orch = new AutoHostOrchestrator(deps);
  advanceToSlot(orch, 4);
  await orch.runChatter();
  assert.equal(pushes.length, 1);
  // No failure should be logged — toggle off / no client is a benign demotion.
  assert.equal(
    failures.filter((f) => f.reason.startsWith("world_aside_")).length,
    0,
  );
});

test("world_aside slot: recentTopics snapshot is sent on each call", async () => {
  let captured: string[] | null = null;
  const { deps } = fakeDeps({
    fetchWorldAside: async (req) => {
      captured = req.recentTopics;
      return { ok: true, topic: "weather:lisbon", line: "Lisbon's grey." };
    },
  });
  const orch = new AutoHostOrchestrator(deps);
  // Pre-populate the ring buffer manually (e.g. simulating prior calls).
  orch.recentWorldTopics.push("weather:tokyo");
  orch.recentWorldTopics.push("music:lineup");
  advanceToSlot(orch, 4);
  await orch.runChatter();
  assert.deepEqual(captured, ["music:lineup", "weather:tokyo"]);
});

test("world_aside slot: topic NOT recorded if upload fails (don't poison anti-repeat)", async () => {
  const { deps } = fakeDeps({
    fetchWorldAside: async () => ({ ok: true, topic: "weather:tokyo", line: "Tokyo's wet." }),
    uploadChatter: async () => { throw new Error("b2 down"); },
  });
  const orch = new AutoHostOrchestrator(deps);
  advanceToSlot(orch, 4);
  await orch.runChatter();
  assert.deepEqual(orch.recentWorldTopics.snapshot(), [],
    "failed upload must not record the topic");
});

// ─── pendingOverride (operator chip-click) ───────────────────────────

test("setPendingOverride: pending type replaces next slot type", async () => {
  let scriptCalls = 0;
  const { deps, pushes } = fakeDeps({
    fetchWorldAside: async () => ({ ok: true, topic: "weather:lisbon", line: "Lisbon's 26°C." }),
    generateScript: async () => { scriptCalls += 1; return "should not be called"; },
  });
  const orch = new AutoHostOrchestrator(deps);
  // Slot 0 in the new rotation = shoutout_cta. Override to world_aside.
  orch.setPendingOverride("world_aside");
  await orch.runChatter();
  assert.equal(pushes.length, 1, "override fires");
  assert.equal(scriptCalls, 0, "world_aside path skips MiniMax — Brave + opt.generate stays in client");
  // Override consumed
  assert.equal(orch.pendingOverride, null);
});

test("setPendingOverride: consumed even on failure", async () => {
  const { deps } = fakeDeps({
    fetchWorldAside: async () => ({ ok: false, reason: "no_good_topic" }),
    generateScript: async () => { throw new Error("boom"); },
  });
  const orch = new AutoHostOrchestrator(deps);
  orch.setPendingOverride("world_aside");
  await orch.runChatter();
  // Override was consumed (read+clear) at start of generateAsset, before
  // the demote-to-filler path ran. So next run goes back to rotation.
  assert.equal(orch.pendingOverride, null);
});

test("setPendingOverride: rejects listener_song_announce", () => {
  const { deps } = fakeDeps({});
  const orch = new AutoHostOrchestrator(deps);
  assert.throws(() => orch.setPendingOverride("listener_song_announce"));
});

test("setPendingOverride: second call overwrites first (latest wins)", () => {
  const { deps } = fakeDeps({});
  const orch = new AutoHostOrchestrator(deps);
  orch.setPendingOverride("filler");
  orch.setPendingOverride("world_aside");
  assert.equal(orch.pendingOverride, "world_aside");
});

test("setPendingOverride: filler override at slot that was world_aside still uses MiniMax", async () => {
  let scriptCalls = 0;
  const { deps, pushes } = fakeDeps({
    generateScript: async () => { scriptCalls += 1; return "Filler line."; },
  });
  const orch = new AutoHostOrchestrator(deps);
  // Advance to a world_aside slot then override to filler.
  while (orch.state.slotCounter % 20 !== 4) {
    orch.state.markInFlight();
    orch.state.markSuccess();
  }
  orch.setPendingOverride("filler");
  await orch.runChatter();
  assert.equal(scriptCalls, 1, "filler path goes through MiniMax");
  assert.equal(pushes.length, 1);
});

test("world_aside slot: expired forced state is reverted then call proceeds", async () => {
  const { deps, reverts, pushes } = fakeDeps({
    config: async () => ({
      autoHost: { mode: "auto", forcedUntil: null, forcedBy: null },
      worldAside: {
        mode: "forced_off",
        forcedUntil: new Date("2000-01-01"), // expired
        forcedBy: "op",
      },
    }),
    fetchWorldAside: async () => ({ ok: true, topic: "music:x", line: "Hi." }),
    generateScript: async () => "Filler.",
  });
  const orch = new AutoHostOrchestrator(deps);
  advanceToSlot(orch, 4);
  await orch.runChatter();
  // Revert was called for the expired worldAside forced state
  assert.ok(
    reverts.some((r) => r.block === "worldAside" && r.fromMode === "forced_off"),
    "expected a worldAside revert",
  );
  // Effective mode is now auto → world_aside fires (NanoClaw mocked ok)
  assert.equal(pushes.length, 1);
});

// ─── YouTube audience fold-in ───────────────────────────────────────────

test("auto + yt live: subtracts encoder, adds viewers, speaks when total >= 3", async () => {
  // icecast=2 (1 real + 1 OBS), yt=live, viewers=5 → effective = 2+5-1 = 6 → speak
  const { deps, pushes } = fakeDeps({
    config: async () => configFor("auto"),
    getListenerCount: async () => 2,
    getYoutubeAudience: async () => ({ state: "live", viewers: 5 }),
  });
  const orch = new AutoHostOrchestrator(deps);
  await orch.runChatter();
  assert.equal(pushes.length, 1);
});

test("auto + yt live: encoder-only icecast + zero viewers → skips", async () => {
  // icecast=1 (just OBS), yt=live, viewers=0 → effective = 1+0-1 = 0 → skip
  const { deps, pushes } = fakeDeps({
    config: async () => configFor("auto"),
    getListenerCount: async () => 1,
    getYoutubeAudience: async () => ({ state: "live", viewers: 0 }),
  });
  const orch = new AutoHostOrchestrator(deps);
  await orch.runChatter();
  assert.equal(pushes.length, 0);
});

test("auto + yt off: ignores YT entirely, uses raw icecast (skips at 2)", async () => {
  // icecast=2, yt=off → effective = 2 + 0 - 0 = 2 → skip
  const { deps, pushes } = fakeDeps({
    config: async () => configFor("auto"),
    getListenerCount: async () => 2,
    getYoutubeAudience: async () => ({ state: "off", viewers: 0 }),
  });
  const orch = new AutoHostOrchestrator(deps);
  await orch.runChatter();
  assert.equal(pushes.length, 0);
});

test("auto + yt fetch failed (null): falls back to raw icecast (speaks at 3)", async () => {
  // icecast=3, yt=null → effective = 3 + 0 - 0 = 3 → speak (today's behaviour)
  const { deps, pushes } = fakeDeps({
    config: async () => configFor("auto"),
    getListenerCount: async () => 3,
    getYoutubeAudience: async () => null,
  });
  const orch = new AutoHostOrchestrator(deps);
  await orch.runChatter();
  assert.equal(pushes.length, 1);
});
