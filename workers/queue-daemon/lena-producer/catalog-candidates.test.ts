// workers/queue-daemon/lena-producer/catalog-candidates.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchCatalogCandidates } from "./catalog-candidates.ts";

const T0 = new Date("2026-05-16T23:15:00").getTime();

test("fetchCatalogCandidates returns tracks NOT recently played and matching show genre", async () => {
  const fakePrisma = {
    track: {
      findMany: async (args: { where: { stationId: string; trackStatus: string; airingPolicy: string; id: { notIn: string[] } } }) => {
        // Pretend the catalog has 5 tracks; recently-aired list excludes some.
        const allTracks = [
          { id: "t1", title: "A", artistDisplay: "X", genre: "synth", bpm: 120 },
          { id: "t2", title: "B", artistDisplay: "Y", genre: "ambient", bpm: 80 },
          { id: "t3", title: "C", artistDisplay: "Z", genre: "rock", bpm: 130 },
          { id: "t4", title: "D", artistDisplay: "W", genre: "synth", bpm: 110 },
          { id: "t5", title: "E", artistDisplay: "V", genre: "pop", bpm: 100 },
        ];
        return allTracks.filter((t) => !args.where.id.notIn.includes(t.id)).slice(0, 10);
      },
    },
    playHistory: {
      findMany: async () => [
        { trackId: "t1", startedAt: new Date(T0 - 15 * 60_000) },  // 15min ago — exclude
        { trackId: "t3", startedAt: new Date(T0 - 50 * 60_000) },  // 50min ago — exclude
      ],
    },
  };
  const candidates = await fetchCatalogCandidates({
    prisma: fakePrisma as never,
    stationId: "s1",
    currentShow: "Prime Hours",
    nowMs: T0,
  });
  // t1 (synth, recently played), t3 (rock, recently played) excluded.
  // t2 (ambient) — does NOT fit Prime Hours.
  // t4 (synth) fits Prime Hours, not recently played → IN
  // t5 (pop) fits Prime Hours → IN
  const ids = candidates.map((c) => c.id);
  assert.ok(ids.includes("t4"));
  assert.ok(ids.includes("t5"));
  assert.ok(!ids.includes("t1"));  // recently played
  assert.ok(!ids.includes("t2"));  // wrong show-block
});

test("fetchCatalogCandidates caps at 10 candidates", async () => {
  const manyTracks = Array.from({ length: 50 }, (_, i) => ({
    id: `t${i}`,
    title: `T${i}`,
    artistDisplay: `A${i}`,
    genre: "synth",
    bpm: 120,
  }));
  const fakePrisma = {
    track: { findMany: async () => manyTracks.slice(0, 30) },  // returns more than 10
    playHistory: { findMany: async () => [] },
  };
  const candidates = await fetchCatalogCandidates({
    prisma: fakePrisma as never,
    stationId: "s1",
    currentShow: "Prime Hours",
    nowMs: T0,
  });
  assert.ok(candidates.length <= 10);
});
