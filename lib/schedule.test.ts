import { test } from "node:test";
import assert from "node:assert/strict";
import { SHOW_SCHEDULE, showForHour } from "./schedule.ts";

test("SHOW_SCHEDULE covers all 24 hours with no gaps or overlaps", () => {
  const covered = new Set<number>();
  for (const slot of SHOW_SCHEDULE) {
    for (let h = slot.startHour; h < slot.endHour; h++) {
      assert.ok(!covered.has(h), `hour ${h} covered twice`);
      covered.add(h);
    }
  }
  for (let h = 0; h < 24; h++) {
    assert.ok(covered.has(h), `hour ${h} not covered`);
  }
});

test("SHOW_SCHEDULE has the four expected show blocks in order", () => {
  assert.equal(SHOW_SCHEDULE.length, 4);
  assert.equal(SHOW_SCHEDULE[0].name, "Night Shift");
  assert.equal(SHOW_SCHEDULE[1].name, "Morning Room");
  assert.equal(SHOW_SCHEDULE[2].name, "Daylight Channel");
  assert.equal(SHOW_SCHEDULE[3].name, "Prime Hours");
});

test("showForHour maps each bucket correctly", () => {
  assert.equal(showForHour(0).name, "Night Shift");
  assert.equal(showForHour(4).name, "Night Shift");
  assert.equal(showForHour(5).name, "Morning Room");
  assert.equal(showForHour(9).name, "Morning Room");
  assert.equal(showForHour(10).name, "Daylight Channel");
  assert.equal(showForHour(16).name, "Daylight Channel");
  assert.equal(showForHour(17).name, "Prime Hours");
  assert.equal(showForHour(23).name, "Prime Hours");
});

test("showForHour returns the same object instance as SHOW_SCHEDULE", () => {
  // Reference identity — avoids future drift between SHOW_SCHEDULE and showForHour.
  assert.strictEqual(showForHour(7), SHOW_SCHEDULE[1]);
});

test("every slot has non-empty title lines, description, and time label", () => {
  for (const slot of SHOW_SCHEDULE) {
    assert.equal(slot.titleLines.length, 2);
    assert.ok(slot.titleLines[0].length > 0, `${slot.name} titleLines[0] empty`);
    assert.ok(slot.titleLines[1].length > 0, `${slot.name} titleLines[1] empty`);
    assert.ok(slot.description.length > 20, `${slot.name} description too short`);
    assert.match(slot.timeLabel, /^\d{2} – \d{2}$/);
  }
});
