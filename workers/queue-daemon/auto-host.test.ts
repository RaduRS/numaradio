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

import { AutoHostOrchestrator } from "./auto-host.ts";

interface RecordedFailure { reason: string; detail?: string }
interface RecordedPush { url: string }

function fakeDeps(overrides: Partial<Parameters<typeof AutoHostOrchestrator.prototype.constructor>[0]> = {}) {
  const failures: RecordedFailure[] = [];
  const pushes: RecordedPush[] = [];
  const deps = {
    flag: { async isEnabled() { return true; } },
    resolveNowPlaying: async () => ({ title: "Midnight Drive", artist: "Russell Ross" }),
    generateScript: async () => "That was Midnight Drive by Russell Ross. Stick around.",
    synthesizeSpeech: async () => Buffer.from([0xff, 0xfb]),
    uploadChatter: async () => "https://cdn.numaradio.com/file/numaradio/stations/numaradio/chatter/x.mp3",
    pushToOverlay: async (url: string) => { pushes.push({ url }); },
    logPush: () => {},
    logFailure: (f: RecordedFailure) => { failures.push(f); },
    sleep: async () => {}, // instant retries in tests
    ...overrides,
  };
  return { deps, failures, pushes };
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

test("back_announce without NowPlaying falls back to generic prompt context", async () => {
  const { deps, pushes } = fakeDeps({
    resolveNowPlaying: async () => null,
  });
  const orch = new AutoHostOrchestrator(deps);
  // Force slot 0 (back_announce) — happy path:
  await orch.runChatter();
  assert.equal(pushes.length, 1); // still airs, just without track-specific data
});
