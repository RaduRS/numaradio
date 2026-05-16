import { test } from "node:test";
import assert from "node:assert/strict";
import { reconstructEvents, pollSince } from "./reconstruction.ts";

const T0 = 1_700_000_000_000;

test("reconstructEvents merges PlayHistory + Chatter + Shoutout into one sorted log", async () => {
  const fakePrisma = {
    playHistory: {
      findMany: async () => [
        {
          id: "p1",
          trackId: "tr1",
          titleSnapshot: "Song A",
          startedAt: new Date(T0 - 600_000),
          track: { artistDisplay: "Anna", genre: "rock", bpm: 120 },
        },
      ],
    },
    chatter: {
      findMany: async () => [
        {
          id: "c1",
          chatterType: "back_announce",
          script: "next up",
          airedAt: new Date(T0 - 400_000),
          producerVersion: null,
        },
      ],
    },
    shoutout: {
      findMany: async () => [
        {
          id: "s1",
          cleanText: "hi lena",
          requesterName: "anna",
          createdAt: new Date(T0 - 200_000),
        },
      ],
    },
  };

  const events = await reconstructEvents({
    prisma: fakePrisma as never,
    stationId: "station1",
    sinceMs: T0 - 4 * 60 * 60_000,
    nowMs: T0,
  });

  assert.equal(events.length, 3);
  assert.equal(events[0].type, "track_aired");
  assert.equal(events[1].type, "lena_line_aired");
  assert.equal((events[1] as { mode: string }).mode, "legacy");
  assert.equal(events[2].type, "shoutout_aired");
});

test("reconstructEvents tags producerVersion!=null Chatter rows with their mode, legacy otherwise", async () => {
  const fakePrisma = {
    playHistory: { findMany: async () => [] },
    chatter: {
      findMany: async () => [
        { id: "c1", chatterType: "opinion", script: "x", airedAt: new Date(T0 - 60_000), producerVersion: 1 },
        { id: "c2", chatterType: "filler", script: "y", airedAt: new Date(T0 - 30_000), producerVersion: null },
      ],
    },
    shoutout: { findMany: async () => [] },
  };

  const events = await reconstructEvents({
    prisma: fakePrisma as never,
    stationId: "station1",
    sinceMs: T0 - 60 * 60_000,
    nowMs: T0,
  });

  const c1 = events.find((e) => e.id === "c1") as { type: "lena_line_aired"; mode: string };
  const c2 = events.find((e) => e.id === "c2") as { type: "lena_line_aired"; mode: string };
  assert.equal(c1.mode, "opinion");
  assert.equal(c2.mode, "legacy");
});

test("pollSince returns only rows with createdAt/airedAt > the watermark", async () => {
  const fakePrisma = {
    playHistory: {
      findMany: async (args: { where: { startedAt: { gt: Date } } }) => {
        const since = args.where.startedAt.gt.getTime();
        return [
          { id: "p_old", trackId: "x", titleSnapshot: "old", startedAt: new Date(since - 1), track: null },
          { id: "p_new", trackId: "y", titleSnapshot: "new", startedAt: new Date(since + 1), track: null },
        ].filter((p) => p.startedAt.getTime() > since);
      },
    },
    chatter: { findMany: async () => [] },
    shoutout: { findMany: async () => [] },
  };

  const events = await pollSince({
    prisma: fakePrisma as never,
    stationId: "s1",
    sincePlayHistoryAt: T0 - 10_000,
    sinceChatterAt: T0,
    sinceShoutoutAt: T0,
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].id, "p_new");
});
