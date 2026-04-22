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
