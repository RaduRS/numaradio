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
});
