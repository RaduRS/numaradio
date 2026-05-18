import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcilePriorityQueue, type ReconcileDeps } from "./reconciler.ts";
import type { StagedItem } from "./hydrator.ts";

function deps(over: Partial<ReconcileDeps> & Pick<ReconcileDeps, "request">): ReconcileDeps {
  const sent: string[] = [];
  const base: ReconcileDeps = {
    listStaged: async () => [],
    resolveAssetUrl: async () => null,
    request: over.request,
    send: async (line: string) => { sent.push(line); },
    now: () => 1_000_000,
    minAgeMs: 10_000,
  };
  return { ...base, ...over, send: over.send ?? base.send };
}

// Helper: build a request() mock with canned responses keyed by command.
function mockRequest(responses: Record<string, string[]>): ReconcileDeps["request"] {
  return async (cmd: string) => {
    const key = Object.keys(responses).find((k) => cmd === k || cmd.startsWith(k + " "));
    if (key === undefined) throw new Error(`unmocked request: ${cmd}`);
    return responses[key];
  };
}

const stagedAt = (id: string, trackId: string, ageMs: number, now = 1_000_000): StagedItem & { createdAt: number } => ({
  id, trackId, positionIndex: 0, queueType: "music", createdAt: now - ageMs,
});

test("reconcile no-ops when DB empty and Liquidsoap empty", async () => {
  const sent: string[] = [];
  const d = deps({
    listStaged: async () => [],
    request: mockRequest({ "priority.queue": [] }),
    send: async (l) => { sent.push(l); },
  });
  const r = await reconcilePriorityQueue(d);
  assert.equal(r.repushed, 0);
  assert.deepEqual(sent, []);
});

test("reconcile no-ops when staged URL already in Liquidsoap", async () => {
  const sent: string[] = [];
  const url = "https://cdn.example.com/track-a.mp3";
  const d = deps({
    listStaged: async () => [stagedAt("qi1", "track-a", 30_000)],
    resolveAssetUrl: async () => url,
    request: mockRequest({
      "priority.queue": ["100"],
      "request.metadata": [`rid="100"`, `initial_uri="${url}"`, `status="ready"`],
    }),
    send: async (l) => { sent.push(l); },
  });
  const r = await reconcilePriorityQueue(d);
  assert.equal(r.repushed, 0);
  assert.deepEqual(sent, []);
});

test("reconcile re-pushes staged item missing from Liquidsoap", async () => {
  const sent: string[] = [];
  const url = "https://cdn.example.com/track-b.mp3";
  const d = deps({
    listStaged: async () => [stagedAt("qi2", "track-b", 30_000)],
    resolveAssetUrl: async () => url,
    request: mockRequest({ "priority.queue": [] }),
    send: async (l) => { sent.push(l); },
  });
  const r = await reconcilePriorityQueue(d);
  assert.equal(r.repushed, 1);
  assert.deepEqual(sent, [`priority.push ${url}`]);
});

test("reconcile skips items younger than minAgeMs", async () => {
  const sent: string[] = [];
  const url = "https://cdn.example.com/track-c.mp3";
  const d = deps({
    listStaged: async () => [stagedAt("qi3", "track-c", 5_000)], // 5s < 10s default
    resolveAssetUrl: async () => url,
    request: mockRequest({ "priority.queue": [] }),
    send: async (l) => { sent.push(l); },
  });
  const r = await reconcilePriorityQueue(d);
  assert.equal(r.repushed, 0);
  assert.deepEqual(sent, []);
});

test("reconcile ignores shoutout queue items", async () => {
  const sent: string[] = [];
  const d = deps({
    listStaged: async () => [{ id: "qi4", trackId: "voice-1", positionIndex: 0, queueType: "shoutout", createdAt: 1 } as StagedItem & { createdAt: number }],
    resolveAssetUrl: async () => "https://cdn.example.com/voice.mp3",
    request: mockRequest({ "priority.queue": [] }),
    send: async (l) => { sent.push(l); },
  });
  const r = await reconcilePriorityQueue(d);
  assert.equal(r.repushed, 0);
  assert.deepEqual(sent, []);
});

test("reconcile skips items with no resolvable asset URL", async () => {
  const sent: string[] = [];
  const d = deps({
    listStaged: async () => [stagedAt("qi5", "track-missing", 30_000)],
    resolveAssetUrl: async () => null,
    request: mockRequest({ "priority.queue": [] }),
    send: async (l) => { sent.push(l); },
  });
  const r = await reconcilePriorityQueue(d);
  assert.equal(r.repushed, 0);
  assert.deepEqual(sent, []);
});

test("reconcile re-pushes only the missing one when LS has some items", async () => {
  const sent: string[] = [];
  const urlA = "https://cdn.example.com/track-a.mp3";
  const urlB = "https://cdn.example.com/track-b.mp3";
  const responses: Record<string, string[]> = {
    "priority.queue": ["100"],
    "request.metadata 100": [`rid="100"`, `initial_uri="${urlA}"`],
  };
  const d = deps({
    listStaged: async () => [
      stagedAt("qiA", "track-a", 30_000),
      stagedAt("qiB", "track-b", 30_000),
    ],
    resolveAssetUrl: async (t) => (t === "track-a" ? urlA : urlB),
    request: async (cmd) => {
      const exact = responses[cmd];
      if (exact) return exact;
      const prefix = Object.keys(responses).find((k) => cmd.startsWith(k + " ") || cmd === k);
      if (prefix) return responses[prefix];
      throw new Error(`unmocked: ${cmd}`);
    },
    send: async (l) => { sent.push(l); },
  });
  const r = await reconcilePriorityQueue(d);
  assert.equal(r.repushed, 1);
  assert.deepEqual(sent, [`priority.push ${urlB}`]);
});

test("reconcile marks completed (and skips re-push) when track already aired since createdAt", async () => {
  // This is the No Rush / EUTHANIZE loop bug: a staged item is older than the
  // 5-min window the legacy `isTrackRecentlyPlayed` checked, but the track DID
  // already play. Reconciler kept re-pushing it forever. New check uses
  // queueItem.createdAt as the lower bound — any play since the row was created
  // counts as "this item already aired, mark it completed".
  const sent: string[] = [];
  const url = "https://cdn.example.com/no-rush.mp3";
  let markedCompleted: string | null = null;
  const d = deps({
    // Created 30 min ago — way outside the old 5-min recency window.
    listStaged: async () => [stagedAt("qi-norush", "track-norush", 30 * 60_000)],
    resolveAssetUrl: async () => url,
    request: mockRequest({ "priority.queue": [] }),
    send: async (l) => { sent.push(l); },
    isTrackRecentlyPlayed: async (trackId, queueItemCreatedAt) => {
      // The track aired 20 minutes ago — after the queue item was created.
      // Old code would have returned false (older than 5-min window).
      // New code returns true (aired AFTER queueItemCreatedAt).
      void queueItemCreatedAt; // suppress unused-arg warning
      return trackId === "track-norush";
    },
    markCompleted: async (id) => { markedCompleted = id; },
  });
  const r = await reconcilePriorityQueue(d);
  assert.equal(r.repushed, 0, "must NOT re-push a track that already aired");
  assert.equal(markedCompleted, "qi-norush", "must mark the stuck row completed");
  assert.deepEqual(sent, []);
});

test("reconcile tolerates request() failure without throwing", async () => {
  const sent: string[] = [];
  const d = deps({
    listStaged: async () => [stagedAt("qi6", "track-x", 30_000)],
    resolveAssetUrl: async () => "https://cdn.example.com/x.mp3",
    request: async () => { throw new Error("telnet timeout"); },
    send: async (l) => { sent.push(l); },
  });
  // Should not throw — a single failed reconcile tick must not kill the loop.
  const r = await reconcilePriorityQueue(d);
  assert.equal(r.repushed, 0);
  assert.deepEqual(sent, []);
});
