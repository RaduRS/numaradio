import { test } from "node:test";
import assert from "node:assert/strict";
import { isSuspiciousRewrite } from "./humanize.ts";

test("isSuspiciousRewrite: empty rewrite → suspicious", () => {
  assert.equal(isSuspiciousRewrite("hello world", ""), true);
});

test("isSuspiciousRewrite: clean Lena rewrite of a short YouTube shoutout passes", () => {
  // Repro of the 2026-05-02 incident: a held-then-approved YouTube
  // shoutout aired verbatim because this check falsely flagged the
  // perfectly good MiniMax rewrite (124 chars from 44 = 2.8× ratio).
  const original = "can you give me a big shoutout on YouTube ?"; // 44 chars
  const rewrite =
    "Going out to inRhino, who asked for a shoutout on YouTube. " +
    "There it is, straight from the source. We'll let it ride."; // 124 chars
  assert.equal(isSuspiciousRewrite(original, rewrite), false);
});

test("isSuspiciousRewrite: short input + reasonable expansion (under absolute cap) passes", () => {
  // 30→90 chars is 3× — would have been flagged by the old strict
  // 2× rule, but that ratio was tuned for meaty inputs. Short
  // inputs naturally need more characters to humanize.
  const original = "shoutout to my friend Marek!"; // 28
  const rewrite =
    "Sending one out to Marek — keep going. " +
    "Stay close, more music ahead."; // ~70
  assert.equal(isSuspiciousRewrite(original, rewrite), false);
});

test("isSuspiciousRewrite: rewrite over the absolute char ceiling is suspicious", () => {
  const original = "morning";
  // > MAX_REWRITE_CHARS (320) — would air as a 30s+ monologue
  const rewrite = "x".repeat(400);
  assert.equal(isSuspiciousRewrite(original, rewrite), true);
});

test("isSuspiciousRewrite: hard contraction (lost meaning) is suspicious", () => {
  const original = "Big shoutout to the entire night-shift team, you've kept us going through every storm";
  const rewrite = "thanks"; // dropped almost everything
  assert.equal(isSuspiciousRewrite(original, rewrite), true);
});

test("isSuspiciousRewrite: meaty input + 2x expansion is suspicious (hallucination guard)", () => {
  // Long inputs (>= 100 chars) keep the strict 2x cap to catch
  // model rambling. 110→230 chars trips it.
  const original = "x".repeat(110);
  const rewrite = "y".repeat(230);
  assert.equal(isSuspiciousRewrite(original, rewrite), true);
});

test("isSuspiciousRewrite: AI-disclaimer leakage is always suspicious", () => {
  assert.equal(
    isSuspiciousRewrite("a normal listener message", "As an AI assistant I can't"),
    true,
  );
  assert.equal(
    isSuspiciousRewrite("hi", "I cannot help with that"),
    true,
  );
});

test("isSuspiciousRewrite: very short input (< 20 chars) only checked against absolute cap", () => {
  // < 20 chars → ratio guards skipped entirely. Only the absolute
  // ceiling applies. This was already the behaviour before; pin it
  // so it can't quietly regress.
  assert.equal(isSuspiciousRewrite("hi!", "Sending one out to whoever's tuning in. Stay close."), false);
});
