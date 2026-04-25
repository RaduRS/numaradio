import { test } from "node:test";
import { strict as assert } from "node:assert";
import { inferShowFromMetadata } from "./show-mapping.ts";

test("ambient mood + slow BPM → night_shift", () => {
  assert.equal(inferShowFromMetadata({ bpm: 75, genre: "Ambient", mood: "Calm" }), "night_shift");
});
test("bright mood + mid BPM → morning_room", () => {
  assert.equal(inferShowFromMetadata({ bpm: 105, genre: "Pop", mood: "Bright" }), "morning_room");
});
test("nu-disco + mid-high BPM → daylight_channel", () => {
  assert.equal(inferShowFromMetadata({ bpm: 118, genre: "NuDisco", mood: null }), "daylight_channel");
});
test("energetic mood + fast BPM → prime_hours", () => {
  assert.equal(inferShowFromMetadata({ bpm: 124, genre: "House", mood: "Energetic" }), "prime_hours");
});
test("all-null fallback → daylight_channel", () => {
  assert.equal(inferShowFromMetadata({ bpm: null, genre: null, mood: null }), "daylight_channel");
});
test("ambient mood at 110 BPM still → night_shift (mood beats BPM)", () => {
  assert.equal(inferShowFromMetadata({ bpm: 110, genre: "Lofi", mood: "Mellow" }), "night_shift");
});
test("DnB → prime_hours via genre", () => {
  assert.equal(inferShowFromMetadata({ bpm: null, genre: "DnB", mood: null }), "prime_hours");
});
test("BPM-only fallback for slow → night_shift", () => {
  assert.equal(inferShowFromMetadata({ bpm: 80, genre: null, mood: null }), "night_shift");
});
test("BPM-only fallback for fast → prime_hours", () => {
  assert.equal(inferShowFromMetadata({ bpm: 130, genre: null, mood: null }), "prime_hours");
});
