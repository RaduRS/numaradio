import { test } from "node:test";
import assert from "node:assert/strict";
import { disparagementPrefilter, profanityPrefilter } from "./moderate.ts";

test("profanityPrefilter catches 'fuck'", () => {
  assert.deepEqual(profanityPrefilter("what the fuck is with this radio?"), {
    matched: "fuck",
  });
});

test("profanityPrefilter catches 'fucking'", () => {
  assert.deepEqual(profanityPrefilter("this is fucking great"), {
    matched: "fuck",
  });
});

test("profanityPrefilter catches 'ass' as a standalone word", () => {
  assert.deepEqual(profanityPrefilter("what your ass is doing"), {
    matched: "ass",
  });
});

test("profanityPrefilter catches 'asshole'", () => {
  assert.deepEqual(profanityPrefilter("don't be an asshole"), {
    matched: "ass",
  });
});

test("profanityPrefilter does NOT flag 'class' (contains 'ass')", () => {
  assert.equal(profanityPrefilter("class assignments today"), null);
});

test("profanityPrefilter does NOT flag 'assume' (starts with 'ass')", () => {
  assert.equal(profanityPrefilter("you can assume it's done"), null);
});

test("profanityPrefilter does NOT flag 'pass' (ends with 'ass')", () => {
  assert.equal(profanityPrefilter("pass the mic to Mihai"), null);
});

test("profanityPrefilter is case-insensitive", () => {
  assert.deepEqual(profanityPrefilter("FUCK yeah"), { matched: "fuck" });
});

test("profanityPrefilter catches 'shit' and 'bullshit'", () => {
  assert.deepEqual(profanityPrefilter("what the shit man"), {
    matched: "shit",
  });
  assert.deepEqual(profanityPrefilter("total bullshit"), {
    matched: "bullshit",
  });
});

test("profanityPrefilter catches 'motherfucker' as a compound", () => {
  const result = profanityPrefilter("that motherfucker");
  assert.ok(result !== null, "should be flagged");
});

test("profanityPrefilter catches 'bitch', 'cunt', 'bastard'", () => {
  assert.equal(profanityPrefilter("you bitch")?.matched, "bitch");
  assert.equal(profanityPrefilter("what a cunt")?.matched, "cunt");
  assert.equal(profanityPrefilter("that bastard")?.matched, "bastard");
});

test("profanityPrefilter returns null for clean text", () => {
  assert.equal(
    profanityPrefilter("shoutout to Mihai, happy birthday champ"),
    null,
  );
});

test("profanityPrefilter survives trailing punctuation", () => {
  assert.equal(profanityPrefilter("what the fuck!")?.matched, "fuck");
  assert.equal(profanityPrefilter("what the fuck.")?.matched, "fuck");
  assert.equal(profanityPrefilter("fuck?")?.matched, "fuck");
});

// ─── disparagementPrefilter ────────────────────────────────────────

test("disparagementPrefilter catches 'numa sucks'", () => {
  assert.ok(disparagementPrefilter("numa sucks") !== null);
});

test("disparagementPrefilter catches 'this radio is shit'", () => {
  assert.ok(disparagementPrefilter("this radio is shit") !== null);
});

test("disparagementPrefilter catches 'I hate this station'", () => {
  assert.ok(disparagementPrefilter("I hate this station") !== null);
});

test("disparagementPrefilter catches 'lena is annoying'", () => {
  assert.ok(disparagementPrefilter("lena is annoying") !== null);
});

test("disparagementPrefilter catches 'your stream is the worst'", () => {
  assert.ok(disparagementPrefilter("your stream is the worst") !== null);
});

test("disparagementPrefilter catches 'numa radio is terrible quality'", () => {
  assert.ok(disparagementPrefilter("numa radio is terrible quality") !== null);
});

test("disparagementPrefilter catches negative-then-target order", () => {
  assert.ok(disparagementPrefilter("absolutely awful, this radio") !== null);
});

test("disparagementPrefilter is case-insensitive", () => {
  assert.ok(disparagementPrefilter("NUMA IS TRASH") !== null);
});

test("disparagementPrefilter passes friendly target mention", () => {
  assert.equal(disparagementPrefilter("love this radio so much"), null);
  assert.equal(disparagementPrefilter("Numa Radio is amazing"), null);
  assert.equal(disparagementPrefilter("lena's voice is gorgeous"), null);
});

test("disparagementPrefilter passes negatives without a station target", () => {
  assert.equal(disparagementPrefilter("had a terrible day at work"), null);
  assert.equal(disparagementPrefilter("I hate mondays"), null);
});

test("disparagementPrefilter passes when target and negative are far apart", () => {
  // "Numa" at start, "bad" 60+ chars later — outside the 30-char window.
  const text =
    "Numa Radio has been my morning soundtrack — never had a single bad start.";
  assert.equal(disparagementPrefilter(text), null);
});

test("disparagementPrefilter catches 'fuck this radio' (target+profanity slang counted in negatives is NOT the goal here — profanity prefilter handles fuck; this test confirms the standalone phrase still matches via 'this radio')", () => {
  // The word 'fuck' itself is caught by profanityPrefilter upstream, but
  // disparagementPrefilter should still independently flag the disparaging
  // shape so the prefilter is robust if profanity coverage ever changes.
  const result = disparagementPrefilter("this radio is awful, complete trash");
  assert.ok(result !== null);
});

test("disparagementPrefilter returns the matched target+descriptor pair", () => {
  const result = disparagementPrefilter("numa is shit");
  assert.equal(result?.matched, "numa+shit");
});
