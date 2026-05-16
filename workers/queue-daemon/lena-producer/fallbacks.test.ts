import { test } from "node:test";
import assert from "node:assert/strict";
import { safeDefaultDecision } from "./fallbacks.ts";

test("safeDefaultDecision for auto_track_boundary returns aside/low-key/short with null callbackTo", () => {
  const d = safeDefaultDecision({ source: "auto_track_boundary" });
  assert.equal(d.mode, "aside");
  assert.equal(d.tone, "low-key");
  assert.equal(d.lengthHint, "short");
  assert.equal(d.callbackTo, null);
  assert.equal(d.addressListener, null);
  assert.equal(typeof d.targetFocus, "string");
});
