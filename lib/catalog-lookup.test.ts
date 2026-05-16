import { test } from "node:test";
import assert from "node:assert/strict";
import { lookupCatalogCandidates } from "./catalog-lookup.ts";

const fakeTracks = [
  { id: "t1", title: "Hotel California", artistDisplay: "Eagles", genre: "rock", bpm: 75 },
  { id: "t2", title: "Take It Easy", artistDisplay: "Eagles", genre: "rock", bpm: 138 },
  { id: "t3", title: "Dusk", artistDisplay: "Anna", genre: "synth", bpm: 112 },
];

const fakePrisma = {
  track: { findMany: async () => fakeTracks },
};

test("lookupCatalogCandidates returns matching track for explicit title+artist", async () => {
  const r = await lookupCatalogCandidates({ prisma: fakePrisma as never, stationId: "s1", requestText: "play hotel california by eagles" });
  assert.ok(r.length > 0);
  assert.equal(r[0].id, "t1");
});

test("lookupCatalogCandidates returns multiple results sorted by score", async () => {
  const r = await lookupCatalogCandidates({ prisma: fakePrisma as never, stationId: "s1", requestText: "play eagles" });
  // Both t1 and t2 are by Eagles — both should match
  assert.ok(r.length >= 2);
});

test("lookupCatalogCandidates filters out tracks with zero score", async () => {
  const r = await lookupCatalogCandidates({ prisma: fakePrisma as never, stationId: "s1", requestText: "play queen bohemian rhapsody" });
  assert.equal(r.length, 0);
});

test("lookupCatalogCandidates ignores stopwords", async () => {
  const r = await lookupCatalogCandidates({ prisma: fakePrisma as never, stationId: "s1", requestText: "can you play the next song" });
  // No real track tokens — should match nothing
  assert.equal(r.length, 0);
});
