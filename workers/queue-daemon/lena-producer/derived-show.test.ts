import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveShowContext, SHIFT_BOUNDARIES_HOURS } from "./derived-show.ts";

test("deriveShowContext at 02:15 sits inside Night Shift", () => {
  // 2026-05-16 02:15 local
  const now = new Date(2026, 4, 16, 2, 15, 0).getTime();
  const ctx = deriveShowContext(now);
  assert.equal(ctx.name, "Night Shift");
  assert.equal(ctx.minutesIn, 2 * 60 + 15);
  assert.equal(ctx.minutesUntilNext, 5 * 60 - 135);
  assert.equal(ctx.overlapWindowStart, new Date(2026, 4, 16, 0, -30).getTime());
});

test("deriveShowContext just after 17:00 is Prime Hours with overlap covering 16:30", () => {
  const now = new Date(2026, 4, 16, 17, 10, 0).getTime();
  const ctx = deriveShowContext(now);
  assert.equal(ctx.name, "Prime Hours");
  assert.equal(ctx.minutesIn, 10);
  const sixteenThirty = new Date(2026, 4, 16, 16, 30, 0).getTime();
  assert.equal(ctx.overlapWindowStart, sixteenThirty);
});

test("SHIFT_BOUNDARIES_HOURS matches existing context-line.ts boundaries (00/05/10/17)", () => {
  assert.deepEqual(SHIFT_BOUNDARIES_HOURS, [0, 5, 10, 17]);
});
