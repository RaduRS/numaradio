import { test } from "node:test";
import assert from "node:assert/strict";
import { hydrate } from "./hydrator.ts";

test("hydrate pushes resolved URLs in positionIndex order", async () => {
  const sent: string[] = [];
  await hydrate({
    listStaged: async () => [
      { id: "q1", trackId: "t1", positionIndex: 1 },
      { id: "q2", trackId: "t2", positionIndex: 2 },
    ],
    resolveAssetUrl: async (tid) => `https://b2/${tid}.mp3`,
    markFailed: async () => {},
    send: async (line) => void sent.push(line),
  });
  assert.deepEqual(sent, [
    "priority.push https://b2/t1.mp3",
    "priority.push https://b2/t2.mp3",
  ]);
});

test("hydrate marks items with missing asset as failed and skips them", async () => {
  const sent: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];
  await hydrate({
    listStaged: async () => [
      { id: "q1", trackId: "t1", positionIndex: 1 },
      { id: "q2", trackId: "missing", positionIndex: 2 },
      { id: "q3", trackId: "t3", positionIndex: 3 },
    ],
    resolveAssetUrl: async (tid) => (tid === "missing" ? null : `https://b2/${tid}.mp3`),
    markFailed: async (id, reason) => void failed.push({ id, reason }),
    send: async (line) => void sent.push(line),
  });
  assert.deepEqual(sent, [
    "priority.push https://b2/t1.mp3",
    "priority.push https://b2/t3.mp3",
  ]);
  assert.deepEqual(failed, [{ id: "q2", reason: "hydrate_missing_asset" }]);
});

test("hydrate does nothing when there are no staged items", async () => {
  const sent: string[] = [];
  await hydrate({
    listStaged: async () => [],
    resolveAssetUrl: async () => "unused",
    markFailed: async () => {},
    send: async (line) => void sent.push(line),
  });
  assert.deepEqual(sent, []);
});

test("hydrate routes shoutouts to overlay_queue and music to priority", async () => {
  const sent: string[] = [];
  await hydrate({
    listStaged: async () => [
      { id: "q1", trackId: "t1", positionIndex: 1, queueType: "music" },
      { id: "q2", trackId: "t2", positionIndex: 2, queueType: "shoutout" },
      { id: "q3", trackId: "t3", positionIndex: 3 },
    ],
    resolveAssetUrl: async (tid) => `https://b2/${tid}.mp3`,
    markFailed: async () => {},
    send: async (line) => void sent.push(line),
  });
  assert.deepEqual(sent, [
    "priority.push https://b2/t1.mp3",
    "overlay_queue.push https://b2/t2.mp3",
    "priority.push https://b2/t3.mp3",
  ]);
});
