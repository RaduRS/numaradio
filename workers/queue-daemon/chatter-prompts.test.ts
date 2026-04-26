import { test } from "node:test";
import assert from "node:assert/strict";
import {
  slotTypeFor,
  promptFor,
  announcementPrompt,
  type ChatterType,
} from "./chatter-prompts.ts";

test("slotTypeFor matches the hand-crafted 20-slot rotation (with world_aside)", () => {
  // World asides at slots 4, 10, 16 — perfectly even spacing (gap 6/6/6).
  // Filler safety net at slot 14. BA preserved at 10/20.
  const expected: ChatterType[] = [
    "shoutout_cta", "back_announce", "song_cta",     "back_announce",
    "world_aside",  "back_announce", "shoutout_cta", "back_announce",
    "song_cta",     "back_announce", "world_aside",  "back_announce",
    "shoutout_cta", "back_announce", "filler",       "back_announce",
    "world_aside",  "back_announce", "song_cta",     "back_announce",
  ];
  for (let i = 0; i < 20; i++) assert.equal(slotTypeFor(i), expected[i]);
});

test("slotTypeFor wraps with modulo 20", () => {
  assert.equal(slotTypeFor(20), slotTypeFor(0));
  assert.equal(slotTypeFor(41), slotTypeFor(1));
  assert.equal(slotTypeFor(999), slotTypeFor(999 % 20));
});

test("slot distribution over one full cycle is BA=10 / SC=3 / SG=3 / F=1 / W=3", () => {
  const tally: Record<ChatterType, number> = {
    back_announce: 0, shoutout_cta: 0, song_cta: 0, filler: 0, world_aside: 0,
    // listener_song_announce is event-driven, never in the rotation.
    listener_song_announce: 0,
  };
  for (let i = 0; i < 20; i++) tally[slotTypeFor(i)] += 1;
  assert.equal(tally.back_announce, 10);
  assert.equal(tally.shoutout_cta, 3);
  assert.equal(tally.song_cta, 3);
  assert.equal(tally.filler, 1);
  assert.equal(tally.world_aside, 3);
  assert.equal(tally.listener_song_announce, 0,
    "listener_song_announce must never appear in the 20-slot rotation");
});

test("world_aside slots are at positions 4, 10, 16 (even spacing)", () => {
  const wIndices: number[] = [];
  for (let i = 0; i < 20; i++) {
    if (slotTypeFor(i) === "world_aside") wIndices.push(i);
  }
  assert.deepEqual(wIndices, [4, 10, 16]);
});

test("no same-type adjacency in the 20-slot pattern (incl. wrap)", () => {
  for (let i = 0; i < 20; i++) {
    assert.notEqual(slotTypeFor(i), slotTypeFor((i + 1) % 20),
      `slots ${i} and ${(i + 1) % 20} share a type`);
  }
});

test("promptFor(world_aside) throws — externally supplied by NanoClaw", () => {
  assert.throws(() => promptFor("world_aside", {}), /externally supplied|NanoClaw/i);
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
    assert.match(p.system, /35[–-]50 words/i,
      `system prompt for ${type} should specify the new 35–50 word budget`);
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

test("announcementPrompt includes listener name, prompt, and title in the user prompt", () => {
  const p = announcementPrompt({
    listenerName: "Mihai",
    userPrompt: "chill house 120 BPM",
    title: "Sunday Drive",
  });
  assert.match(p.user, /Mihai/);
  assert.match(p.user, /chill house 120 BPM/);
  assert.match(p.user, /Sunday Drive/);
  // Shares the same DJ-plain system prompt as all other variants.
  assert.match(p.system, /real DJ/i);
});

test("announcementPrompt flags the track as a new listener song", () => {
  const p = announcementPrompt({
    listenerName: "Anna",
    userPrompt: "something lofi",
    title: "Lost Hours",
  });
  // The core framing: this is a FRESH / NEW listener song's first air.
  assert.match(p.user, /(fresh|new|first time|brand.?new|just made|just in)/i);
});

test("promptFor throws if called with listener_song_announce (wrong path)", () => {
  assert.throws(
    () => promptFor("listener_song_announce" as ChatterType, {}),
    /announcementPrompt/,
  );
});

test("promptFor omits the Context block when no optional fields are set", () => {
  const p = promptFor("filler", {});
  assert.doesNotMatch(p.user, /Context \(optional/);
});

test("promptFor renders a Context block when currentShow is provided", () => {
  const p = promptFor("back_announce", {
    title: "Neon Fever",
    artist: "Russell Ross",
    currentShow: "Prime Hours",
  });
  assert.match(p.user, /Context \(optional/);
  assert.match(p.user, /Current show: Prime Hours/);
  // Description from SHOW_SCHEDULE is included alongside the name.
  assert.match(p.user, /request wall runs hottest/i);
});

test("promptFor Context block lists recent artists newest-first when provided", () => {
  const p = promptFor("back_announce", {
    title: "Neon Fever",
    artist: "Russell Ross",
    recentArtists: ["Russell Ross", "Russell Ross", "Numa Radio"],
  });
  assert.match(p.user, /Last 3 artists aired.*Russell Ross, Russell Ross, Numa Radio/);
});

test("promptFor Context block includes rotation position when provided", () => {
  const p = promptFor("back_announce", {
    title: "X",
    artist: "Y",
    slotsSinceOpening: 12,
  });
  assert.match(p.user, /Position in the 20-slot rotation: 12/);
});

test("promptFor Context block includes the opt-out instruction", () => {
  const p = promptFor("filler", { currentShow: "Morning Room" });
  assert.match(p.user, /weave in only if natural/i);
});

test("promptFor Context block only lists fields that are present", () => {
  const p = promptFor("filler", {
    currentShow: "Morning Room",
    // recentArtists and slotsSinceOpening intentionally omitted
  });
  assert.match(p.user, /Current show: Morning Room/);
  assert.doesNotMatch(p.user, /Last 3 artists aired/);
  assert.doesNotMatch(p.user, /Position in the 20-slot rotation/);
});

test("BASE_SYSTEM actively encourages DJ-riff texture (not just anti-poetry)", () => {
  const p = promptFor("filler", {});
  // Sentinel phrase from the new "Actively encourage" section.
  assert.match(p.system, /non-music riff/i);
});

test("each variant ships at least 6 example shapes", () => {
  const types: ChatterType[] = ["back_announce", "shoutout_cta", "song_cta", "filler"];
  for (const type of types) {
    const p = promptFor(type, { title: "X", artist: "Y" });
    // Examples are rendered as quoted lines; count the opening quote characters
    // at line starts in the "Good example shapes" section.
    const match = p.user.match(/Good example shapes[\s\S]*?(?=\n\n|$)/);
    assert.ok(match, `${type} should have a Good example shapes section`);
    const shapeLines = match![0].split("\n").filter((l) => l.trim().startsWith("- "));
    assert.ok(
      shapeLines.length >= 6,
      `${type} has only ${shapeLines.length} example shapes, need ≥ 6`,
    );
  }
});

test("anti-poetry guardrails remain (wandering piano lines stays banned)", () => {
  const p = promptFor("back_announce", { title: "X", artist: "Y" });
  assert.match(p.system, /wandering piano lines/i);
  assert.match(p.system, /dawn peeking/i);
});

test("promptFor Context block renders localTime + timeOfDay when provided", () => {
  const p = promptFor("shoutout_cta", {
    localTime: "08:40",
    timeOfDay: "morning",
  });
  assert.match(p.user, /Local time: 08:40 \(morning\)/);
});

test("promptFor Context block renders timeOfDay alone when only bucket is given", () => {
  const p = promptFor("filler", { timeOfDay: "evening" });
  assert.match(p.user, /Time of day: evening/);
  assert.doesNotMatch(p.user, /Local time:/);
});

test("BASE_SYSTEM permits context-provided time but forbids invented time", () => {
  const p = promptFor("filler", {});
  // The new rule: time-of-day IS allowed if the Context block gave one.
  assert.match(p.system, /match the time-of-day word to the Local time given/i);
  // And still forbidden to invent one.
  assert.match(p.system, /don't invent one if it isn't provided/i);
});

test("shoutout_cta examples are no longer all time-locked to 'tonight'", () => {
  const p = promptFor("shoutout_cta", {});
  // The old prompts had "tonight" twice in six examples with no morning/afternoon
  // counterparts — the model pattern-matched and said "tonight" at 8:40 AM.
  // New prompts mix morning/afternoon/tonight/neutral so the model adapts.
  assert.match(p.user, /this morning/i);
  assert.match(p.user, /this afternoon/i);
});
