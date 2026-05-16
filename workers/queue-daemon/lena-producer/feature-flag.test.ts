import { test } from "node:test";
import assert from "node:assert/strict";
import { isShiftMemoryEnabled } from "./feature-flag.ts";

test("isShiftMemoryEnabled returns true when env='on'", () => {
  assert.equal(isShiftMemoryEnabled({ LENA_SHIFT_MEMORY: "on" }), true);
});

test("isShiftMemoryEnabled returns true when env='true'", () => {
  assert.equal(isShiftMemoryEnabled({ LENA_SHIFT_MEMORY: "true" }), true);
});

test("isShiftMemoryEnabled returns false when env is unset", () => {
  assert.equal(isShiftMemoryEnabled({}), false);
});

test("isShiftMemoryEnabled returns false when env='off'", () => {
  assert.equal(isShiftMemoryEnabled({ LENA_SHIFT_MEMORY: "off" }), false);
});
