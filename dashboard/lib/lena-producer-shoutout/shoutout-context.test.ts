import { test } from "node:test";
import assert from "node:assert/strict";
import { buildShoutoutContext, fetchShoutoutContext } from "./shoutout-context";

const T0 = new Date("2026-05-16T23:15:00").getTime();

test("buildShoutoutContext composes trigger + now + recents", () => {
  const ctx = buildShoutoutContext({
    trigger: { source: "booth_shoutout", handle: "anna", text: "loving this set" },
    nowMs: T0,
    recentShoutouts: [{ id: "s1", handle: "bob", text: "hi", minsAgo: 12 }],
    recentLenaLines: [],
  });
  assert.equal(ctx.trigger.handle, "anna");
  assert.equal(ctx.now.localTime, "23:15");
  assert.equal(ctx.now.bucket, "night");
});

test("fetchShoutoutContext queries Postgres for recent shoutouts + chatter (mocked)", async () => {
  const fakePrisma = {
    shoutout: {
      findMany: async () => [
        { id: "s1", requesterName: "bob", cleanText: "hi", createdAt: new Date(T0 - 12 * 60_000) },
      ],
    },
    chatter: {
      findMany: async () => [{ id: "c1", script: "earlier line", airedAt: new Date(T0 - 8 * 60_000) }],
    },
  };
  const ctx = await fetchShoutoutContext({
    prisma: fakePrisma as never,
    stationId: "s1",
    trigger: { source: "booth_shoutout", handle: "anna", text: "loving this" },
    nowMs: T0,
  });
  assert.equal(ctx.recentShoutouts.length, 1);
  assert.equal(ctx.recentLenaLines.length, 1);
});
