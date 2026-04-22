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
  sm.markSuccess();
  assert.equal(sm.slotCounter, 1);
  assert.equal(sm.tracksSinceVoice, 0);
});

test("slotCounter does NOT advance on markFailure; counter still resets", () => {
  const sm = new AutoHostStateMachine();
  sm.onMusicTrackStart();
  sm.onMusicTrackStart(); // trigger
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
