import { test } from "node:test";
import assert from "node:assert/strict";
import { profanityPrefilter } from "./moderate.ts";

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
