import { test } from "node:test";
import assert from "node:assert/strict";
import { isShiftMemoryEnabled, isProducerAutoEnabled } from "./feature-flag.ts";

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

test("isProducerAutoEnabled returns true when env='on'", () => {
  assert.equal(isProducerAutoEnabled({ LENA_PRODUCER_AUTO: "on" }), true);
});

test("isProducerAutoEnabled returns true when env='true'", () => {
  assert.equal(isProducerAutoEnabled({ LENA_PRODUCER_AUTO: "true" }), true);
});

test("isProducerAutoEnabled returns false when env is unset", () => {
  assert.equal(isProducerAutoEnabled({}), false);
});

test("isProducerAutoEnabled returns false when env='off'", () => {
  assert.equal(isProducerAutoEnabled({ LENA_PRODUCER_AUTO: "off" }), false);
});
