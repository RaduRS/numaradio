import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { shouldFallbackToInstrumental, showEnumFor } from "./pipeline.ts";

test("shouldFallbackToInstrumental returns true when lyrics contain a profanity match", () => {
  assert.equal(
    shouldFallbackToInstrumental("[verse] what the fuck is happening"),
    true,
  );
  assert.equal(
    shouldFallbackToInstrumental("[verse] rainy days soft sighs"),
    false,
  );
});

test("shouldFallbackToInstrumental returns false for undefined / empty lyrics", () => {
  assert.equal(shouldFallbackToInstrumental(undefined), false);
  assert.equal(shouldFallbackToInstrumental(""), false);
});

// showEnumFor maps a Date to the Prisma show enum value.
// 12:00 UTC is 12:00 GMT (winter) / 13:00 BST (summer) — either way
// it falls in the Daylight Channel window (10–17 local) on the mini-server.
// Testing via the exported helper validates the exact logic used in
// `prisma.track.create({ data: { show: showEnumFor(new Date()) } })`.
test("song-worker tags new tracks with current-hour show", () => {
  // UTC 12:00 → local 12 (GMT) or 13 (BST) → Daylight Channel (10–17)
  const noon = new Date("2026-04-25T12:00:00.000Z");
  assert.equal(showEnumFor(noon), "daylight_channel");

  // UTC 02:00 → local 02 (GMT) or 03 (BST) → Night Shift (0–5)
  const lateNight = new Date("2026-04-25T02:00:00.000Z");
  assert.equal(showEnumFor(lateNight), "night_shift");

  // UTC 06:00 → local 06 (GMT) or 07 (BST) → Morning Room (5–10)
  const morning = new Date("2026-04-25T06:00:00.000Z");
  assert.equal(showEnumFor(morning), "morning_room");

  // UTC 18:00 → local 18 (GMT) or 19 (BST) → Prime Hours (17–24)
  const evening = new Date("2026-04-25T18:00:00.000Z");
  assert.equal(showEnumFor(evening), "prime_hours");
});
