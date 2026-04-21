import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldFallbackToInstrumental } from "./pipeline.ts";

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
