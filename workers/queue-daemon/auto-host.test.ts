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

interface RecordedFailure { reason: string; detail?: string }
interface RecordedPush { url: string }

function fakeDeps(overrides: Partial<Parameters<typeof AutoHostOrchestrator.prototype.constructor>[0]> = {}) {
  const failures: RecordedFailure[] = [];
  const pushes: RecordedPush[] = [];
  const sleepCalls: number[] = [];
  const deps = {
    flag: { async isEnabled() { return true; } },
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
  return { deps, failures, pushes, sleepCalls };
}

test("orchestrator happy path: generate, upload, push, markSuccess", async () => {
  const { deps, pushes } = fakeDeps();
  const orch = new AutoHostOrchestrator(deps);
  await orch.runChatter();
  assert.equal(pushes.length, 1);
  assert.match(pushes[0].url, /chatter\/.+\.mp3$/);
  assert.equal(orch.state.slotCounter, 1);
});

test("orchestrator skips when flag is off", async () => {
  const { deps, pushes } = fakeDeps({
    flag: { async isEnabled() { return false; } },
  });
  const orch = new AutoHostOrchestrator(deps);
  await orch.runChatter();
  assert.equal(pushes.length, 0);
  assert.equal(orch.state.slotCounter, 0);
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
    generateScript: async (p: { system: string; user: string }) => {
      capturedUser = p.user;
      return "A line.";
    },
  });
  const orch = new AutoHostOrchestrator(deps);
  // Simulate three music-track boundaries to populate the ring.
  orch.onMusicTrackStart("Russell Ross");
  orch.onMusicTrackStart("Russell Ross");
  orch.onMusicTrackStart("Numa Radio");
  // Now runChatter — slot 0 = back_announce.
  await orch.runChatter();
  assert.ok(capturedUser, "generateScript should have been called");
  assert.match(capturedUser!, /Context \(optional/);
  assert.match(capturedUser!, /Current show: (Night Shift|Morning Room|Daylight Channel|Prime Hours)/);
  assert.match(capturedUser!, /Last 3 artists aired.*Numa Radio, Russell Ross, Russell Ross/);
  // slotsSinceOpening for slot 0 is 0
  assert.match(capturedUser!, /Position in the 20-slot rotation: 0/);
});

test("orchestrator.onMusicTrackStart forwards artist to the state machine", () => {
  const { deps } = fakeDeps();
  const orch = new AutoHostOrchestrator(deps);
  orch.onMusicTrackStart("Test Artist");
  assert.deepEqual(orch.state.recentArtists, ["Test Artist"]);
});
