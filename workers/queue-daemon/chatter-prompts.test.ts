import { test } from "node:test";
import assert from "node:assert/strict";
import { slotTypeFor, promptFor, type ChatterType } from "./chatter-prompts.ts";

test("slotTypeFor matches the hand-crafted 20-slot rotation", () => {
  // slot:  0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19
  // type:  A SO  A  B  A SG  A  B  A SO  A SG  A  B  A SO  A  B  A SG
  const expected: ChatterType[] = [
    "back_announce", "shoutout_cta", "back_announce", "filler",
    "back_announce", "song_cta",     "back_announce", "filler",
    "back_announce", "shoutout_cta", "back_announce", "song_cta",
    "back_announce", "filler",       "back_announce", "shoutout_cta",
    "back_announce", "filler",       "back_announce", "song_cta",
  ];
  for (let i = 0; i < 20; i++) assert.equal(slotTypeFor(i), expected[i]);
});

test("slotTypeFor wraps with modulo 20", () => {
  assert.equal(slotTypeFor(20), slotTypeFor(0));
  assert.equal(slotTypeFor(41), slotTypeFor(1));
  assert.equal(slotTypeFor(999), slotTypeFor(999 % 20));
});

test("slot distribution over one full cycle is 10/3/3/4", () => {
  const tally: Record<ChatterType, number> = {
    back_announce: 0, shoutout_cta: 0, song_cta: 0, filler: 0,
  };
  for (let i = 0; i < 20; i++) tally[slotTypeFor(i)] += 1;
  assert.equal(tally.back_announce, 10);
  assert.equal(tally.shoutout_cta, 3);
  assert.equal(tally.song_cta, 3);
  assert.equal(tally.filler, 4);
});

test("no same-type adjacency in the 20-slot pattern", () => {
  for (let i = 0; i < 20; i++) {
    assert.notEqual(slotTypeFor(i), slotTypeFor((i + 1) % 20),
      `slots ${i} and ${(i + 1) % 20} share a type`);
  }
});

test("promptFor(back_announce) includes title and artist in the user prompt", () => {
  const p = promptFor("back_announce", { title: "Midnight Drive", artist: "Russell Ross" });
  assert.match(p.user, /Midnight Drive/);
  assert.match(p.user, /Russell Ross/);
  assert.ok(p.system.length > 50, "system prompt should be substantial");
});

test("promptFor(shoutout_cta) mentions shoutout and the site URL", () => {
  const p = promptFor("shoutout_cta", {});
  assert.match(p.user + p.system, /shoutout/i);
  assert.match(p.user + p.system, /numaradio/i);
});

test("promptFor(song_cta) mentions song request and the site URL", () => {
  const p = promptFor("song_cta", {});
  assert.match(p.user + p.system, /song/i);
  assert.match(p.user + p.system, /numaradio/i);
});

test("promptFor(filler) needs no context and has no track references", () => {
  const p = promptFor("filler", {});
  assert.ok(p.user.length > 20);
  assert.doesNotMatch(p.user, /\$\{.+\}/); // no unresolved template vars
});

test("all variants share the same word count target in system prompt", () => {
  for (const type of ["back_announce", "shoutout_cta", "song_cta", "filler"] as ChatterType[]) {
    const p = promptFor(type, { title: "X", artist: "Y" });
    assert.match(p.system, /20[–-]30 words/i,
      `system prompt for ${type} should specify word count`);
  }
});

test("system prompt forbids poetic/atmospheric language explicitly", () => {
  const p = promptFor("back_announce", { title: "X", artist: "Y" });
  // Spot-check a few of the forbidden phrases — these are the specific
  // failure modes observed live on 2026-04-22.
  assert.match(p.system, /wandering piano lines/i);
  assert.match(p.system, /dawn peeking/i);
  assert.match(p.system, /night settles/i);
  assert.match(p.system, /real DJ/i);
});

test("back_announce user prompt includes bad-example anti-patterns", () => {
  const p = promptFor("back_announce", { title: "Midnight Drive", artist: "Russell Ross" });
  assert.match(p.user, /Bad examples/i);
  assert.match(p.user, /do NOT/);
});
