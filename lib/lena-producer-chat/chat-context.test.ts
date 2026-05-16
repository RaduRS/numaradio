import { test } from "node:test";
import assert from "node:assert/strict";
import { buildChatContext, fetchChatContext } from "./chat-context.ts";

const T0 = new Date("2026-05-16T23:15:00").getTime();

test("buildChatContext composes trigger + now + recentShoutouts + recentLenaLines", () => {
  const ctx = buildChatContext({
    trigger: { source: "youtube_chat_mention", handle: "anna", text: "hey lena, loving this set" },
    nowMs: T0,
    recentShoutouts: [{ id: "s1", handle: "bob", originalText: "hi from berlin", minsAgo: 12 }],
    recentLenaLines: [{ text: "earlier line", airedAt: T0 - 5 * 60_000 }],
  });
  assert.equal(ctx.trigger.handle, "anna");
  assert.equal(ctx.now.localTime, "23:15");
  assert.equal(ctx.now.bucket, "night");
  assert.equal(ctx.recentShoutouts.length, 1);
  assert.equal(ctx.recentLenaLines.length, 1);
  // Phase 5b: new fields default to empty/0 when not passed
  assert.equal(ctx.catalogCandidates.length, 0);
  assert.equal(ctx.recentlyAiredTrackIds.length, 0);
  assert.equal(ctx.queueDepth, 0);
});

test("fetchChatContext queries Postgres for last 30min of shoutouts + chatter (mocked)", async () => {
  const fakePrisma = {
    shoutout: {
      findMany: async () => [
        { id: "s1", requesterName: "bob", cleanText: "hi", createdAt: new Date(T0 - 12 * 60_000) },
      ],
    },
    chatter: {
      findMany: async () => [
        { id: "c1", script: "earlier line", airedAt: new Date(T0 - 5 * 60_000) },
      ],
    },
    playHistory: { findMany: async () => [] },
    queueItem: { findMany: async () => [] },
  };
  const ctx = await fetchChatContext({
    prisma: fakePrisma as never,
    stationId: "s1",
    trigger: { source: "youtube_chat_mention", handle: "anna", text: "hey" },
    nowMs: T0,
  });
  assert.equal(ctx.recentShoutouts.length, 1);
  assert.equal(ctx.recentShoutouts[0].id, "s1");
  assert.equal(ctx.recentShoutouts[0].handle, "bob");
  assert.equal(ctx.recentShoutouts[0].minsAgo, 12);
  assert.equal(ctx.catalogCandidates.length, 0);
  assert.equal(ctx.recentlyAiredTrackIds.length, 0);
  assert.equal(ctx.queueDepth, 0);
});

test("buildChatContext exposes catalogCandidates + recentlyAired + queueDepth when passed", () => {
  const ctx = buildChatContext({
    trigger: { source: "youtube_chat_mention", handle: "anna", text: "play x", intent: "request" },
    nowMs: T0,
    recentShoutouts: [],
    recentLenaLines: [],
    catalogCandidates: [{ id: "t1", title: "X", artist: "Y", genre: "rock", bpm: 120 }],
    recentlyAiredTrackIds: ["t2"],
    queueDepth: 3,
  });
  assert.equal(ctx.trigger.intent, "request");
  assert.equal(ctx.catalogCandidates.length, 1);
  assert.equal(ctx.catalogCandidates[0].id, "t1");
  assert.equal(ctx.recentlyAiredTrackIds.length, 1);
  assert.equal(ctx.recentlyAiredTrackIds[0], "t2");
  assert.equal(ctx.queueDepth, 3);
});

test("fetchChatContext fetches playHistory + queueItem ONLY when intent is request", async () => {
  let playHistoryCalled = false;
  let queueItemCalled = false;
  const fakePrisma = {
    shoutout: { findMany: async () => [] },
    chatter: { findMany: async () => [] },
    playHistory: {
      findMany: async () => {
        playHistoryCalled = true;
        return [{ trackId: "tA" }, { trackId: null }, { trackId: "tB" }];
      },
    },
    queueItem: {
      findMany: async () => {
        queueItemCalled = true;
        return [{ id: "q1" }, { id: "q2" }];
      },
    },
  };

  // reply intent → no DB calls for the new fields
  await fetchChatContext({
    prisma: fakePrisma as never,
    stationId: "s1",
    trigger: { source: "youtube_chat_mention", handle: "anna", text: "hi", intent: "reply" },
    nowMs: T0,
  });
  assert.equal(playHistoryCalled, false);
  assert.equal(queueItemCalled, false);

  // request intent → both queried, filtered nulls, queueDepth counted
  const ctx = await fetchChatContext({
    prisma: fakePrisma as never,
    stationId: "s1",
    trigger: { source: "youtube_chat_mention", handle: "anna", text: "play x", intent: "request" },
    nowMs: T0,
    catalogCandidates: [{ id: "tC", title: "C", artist: null, genre: null, bpm: null }],
  });
  assert.equal(playHistoryCalled, true);
  assert.equal(queueItemCalled, true);
  assert.equal(ctx.recentlyAiredTrackIds.length, 2);
  assert.deepEqual(ctx.recentlyAiredTrackIds, ["tA", "tB"]);
  assert.equal(ctx.queueDepth, 2);
  assert.equal(ctx.catalogCandidates.length, 1);
});
