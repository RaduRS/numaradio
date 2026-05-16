import { test } from "node:test";
import assert from "node:assert/strict";
import { lenaSpeakChat } from "./index.ts";

const T0 = new Date("2026-05-16T23:15:00").getTime();

function baseFakePrisma() {
  return {
    shoutout: { findMany: async () => [] },
    chatter: { findMany: async () => [] },
    playHistory: { findMany: async () => [] },
    queueItem: { findMany: async () => [] },
    track: { findMany: async () => [] },
    $transaction: async (_fn: unknown) => {
      throw new Error("$transaction not stubbed in this test");
    },
  };
}

test("lenaSpeakChat happy path: Producer→Writer→{text, mode, queuedTrackId:null}", async () => {
  const fakePrisma = baseFakePrisma();
  let llmCall = 0;
  const llm = async (p: { system: string }) => {
    llmCall += 1;
    if (p.system.includes("you are the producer") || p.system.includes("You are the producer")) {
      return JSON.stringify({ mode: "answer", target_focus: "hi back", callback_to: null, length_hint: "short", tone: "warm", picked_track_id: null, decline_reason: null });
    }
    return "hey anna!";
  };
  const r = await lenaSpeakChat({
    trigger: { source: "youtube_chat_mention", handle: "anna", text: "hi lena" },
    prisma: fakePrisma as never,
    stationId: "s1",
    nowMs: T0,
    llm,
  });
  assert.ok(r);
  assert.equal(r!.text, "hey anna!");
  assert.equal(r!.mode, "answer");
  assert.equal(r!.queuedTrackId, null);
  assert.equal(llmCall, 2);
});

test("lenaSpeakChat returns null when fetchChatContext throws", async () => {
  const fakePrisma = {
    ...baseFakePrisma(),
    shoutout: { findMany: async () => { throw new Error("db down"); } },
  };
  const llm = async () => "n/a";
  const r = await lenaSpeakChat({
    trigger: { source: "youtube_chat_mention", handle: "anna", text: "hi" },
    prisma: fakePrisma as never,
    stationId: "s1",
    nowMs: T0,
    llm,
  });
  assert.equal(r, null);
});

test("lenaSpeakChat accept_request: inserts into queue + returns queuedTrackId", async () => {
  let insertCalled = false;
  let insertedData: { trackId?: string; insertedBy?: string; reasonCode?: string } | null = null;
  const fakePrisma = {
    shoutout: { findMany: async () => [] },
    chatter: { findMany: async () => [] },
    playHistory: { findMany: async () => [] },
    queueItem: { findMany: async () => [] },
    track: { findMany: async () => [] },
    $transaction: async (fn: (tx: unknown) => unknown) => {
      const tx = {
        $executeRaw: async () => 0,
        queueItem: {
          findFirst: async () => null,
          create: async ({ data }: { data: typeof insertedData }) => {
            insertCalled = true;
            insertedData = data;
            return { id: "qi1" };
          },
        },
      };
      return fn(tx);
    },
  };
  const llm = async (p: { system: string }) => {
    if (p.system.includes("producer for Lena, deciding how she handles")) {
      return JSON.stringify({
        mode: "accept_request",
        target_focus: "queue it",
        callback_to: null,
        length_hint: "short",
        tone: "warm",
        picked_track_id: "t1",
        decline_reason: null,
      });
    }
    return "pulling it up for you, anna.";
  };
  const r = await lenaSpeakChat({
    trigger: { source: "youtube_chat_mention", handle: "anna", text: "play x", intent: "request" },
    prisma: fakePrisma as never,
    stationId: "s1",
    nowMs: T0,
    llm,
    catalogCandidates: [{ id: "t1", title: "X", artist: "Y", genre: "rock", bpm: 120 }],
  });
  assert.ok(r);
  assert.equal(r!.mode, "accept_request");
  assert.equal(r!.queuedTrackId, "t1");
  assert.equal(insertCalled, true);
  assert.equal(insertedData!.trackId, "t1");
  assert.equal(insertedData!.insertedBy, "lena_listener_request");
  assert.match(insertedData!.reasonCode ?? "", /^lena_listener_request:anna$/);
});

test("lenaSpeakChat accept_request: queue insert failure → downgrades to decline queue_full", async () => {
  const fakePrisma = {
    shoutout: { findMany: async () => [] },
    chatter: { findMany: async () => [] },
    playHistory: { findMany: async () => [] },
    queueItem: { findMany: async () => [] },
    track: { findMany: async () => [] },
    $transaction: async () => {
      throw new Error("simulated insert failure");
    },
  };
  const llm = async (p: { system: string }) => {
    if (p.system.includes("producer for Lena, deciding how she handles")) {
      return JSON.stringify({
        mode: "accept_request",
        target_focus: "queue it",
        callback_to: null,
        length_hint: "short",
        tone: "warm",
        picked_track_id: "t1",
        decline_reason: null,
      });
    }
    // Writer for decline_request will be called
    return "queue's stacked, anna — try again in a bit.";
  };
  const r = await lenaSpeakChat({
    trigger: { source: "youtube_chat_mention", handle: "anna", text: "play x", intent: "request" },
    prisma: fakePrisma as never,
    stationId: "s1",
    nowMs: T0,
    llm,
    catalogCandidates: [{ id: "t1", title: "X", artist: "Y", genre: "rock", bpm: 120 }],
  });
  assert.ok(r);
  assert.equal(r!.mode, "decline_request");
  assert.equal(r!.queuedTrackId, null);
});
