import { test } from "node:test";
import assert from "node:assert/strict";
import { AnnouncementOrchestrator, type AnnounceDeps } from "./announce.ts";

interface Recorded {
  pushes: string[];
  logPushes: Array<{ trackId: string; script: string }>;
  logFailures: Array<{ reason: string; detail?: string }>;
  onVoicePushedCalls: number;
}

function fakeDeps(
  overrides: Partial<AnnounceDeps> = {},
): { deps: AnnounceDeps; rec: Recorded } {
  const rec: Recorded = {
    pushes: [],
    logPushes: [],
    logFailures: [],
    onVoicePushedCalls: 0,
  };
  const deps: AnnounceDeps = {
    generateScript: async () => "Here's a fresh one from Mihai.",
    synthesizeSpeech: async () => Buffer.from([0xff, 0xfb]),
    uploadChatter: async () =>
      "https://cdn.numaradio.com/file/numaradio/stations/numaradio/chatter/announce-x.mp3",
    pushToOverlay: async (url) => {
      rec.pushes.push(url);
    },
    logPush: ({ trackId, script }) => {
      rec.logPushes.push({ trackId, script });
    },
    logFailure: (entry) => {
      rec.logFailures.push(entry);
    },
    onVoicePushed: () => {
      rec.onVoicePushedCalls += 1;
    },
    ...overrides,
  };
  return { deps, rec };
}

async function settle(): Promise<void> {
  // Drain the microtask queue so fire-and-forget promises have a chance
  // to run their continuations before the test assertions.
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
}

test("schedule + announceIfPending: happy path pushes and resets counter", async () => {
  const { deps, rec } = fakeDeps();
  const orch = new AnnouncementOrchestrator(deps);
  orch.schedule("track-1", {
    listenerName: "Mihai",
    userPrompt: "chill beat",
    title: "Sunday Drive",
  });
  orch.announceIfPending("track-1");
  await settle();
  assert.equal(rec.pushes.length, 1);
  assert.match(rec.pushes[0], /chatter\/announce-x\.mp3$/);
  assert.equal(rec.logPushes.length, 1);
  assert.equal(rec.logPushes[0].trackId, "track-1");
  assert.equal(rec.onVoicePushedCalls, 1);
  assert.equal(orch.has("track-1"), false, "stash should be cleared after push");
});

test("announceIfPending before generation completes awaits, then pushes", async () => {
  let resolveGen: ((s: string) => void) | null = null;
  const genPromise = new Promise<string>((resolve) => {
    resolveGen = resolve;
  });
  const { deps, rec } = fakeDeps({
    generateScript: () => genPromise,
  });
  const orch = new AnnouncementOrchestrator(deps);
  orch.schedule("track-2", {
    listenerName: "Anna",
    userPrompt: "lofi",
    title: "Lost Hours",
  });
  orch.announceIfPending("track-2");
  await settle();
  // Generation still pending — no push yet.
  assert.equal(rec.pushes.length, 0);
  // Resolve generation.
  resolveGen?.("A brand new one from Anna.");
  await settle();
  assert.equal(rec.pushes.length, 1);
  assert.equal(rec.onVoicePushedCalls, 1);
});

test("generation failure is logged and announceIfPending does NOT push", async () => {
  const { deps, rec } = fakeDeps({
    generateScript: async () => {
      throw new Error("minimax http 500");
    },
  });
  const orch = new AnnouncementOrchestrator(deps);
  orch.schedule("track-3", {
    listenerName: "M", userPrompt: "x", title: "y",
  });
  orch.announceIfPending("track-3");
  await settle();
  assert.equal(rec.pushes.length, 0);
  assert.equal(rec.logPushes.length, 0);
  assert.equal(rec.onVoicePushedCalls, 0);
  assert.equal(rec.logFailures.length, 1);
  assert.equal(rec.logFailures[0].reason, "listener_song_announce_gen_failed");
});

test("push failure is logged separately from generation failure", async () => {
  const { deps, rec } = fakeDeps({
    pushToOverlay: async () => {
      throw new Error("socket closed");
    },
  });
  const orch = new AnnouncementOrchestrator(deps);
  orch.schedule("track-4", {
    listenerName: "M", userPrompt: "x", title: "y",
  });
  orch.announceIfPending("track-4");
  await settle();
  assert.equal(rec.pushes.length, 0);
  assert.equal(rec.onVoicePushedCalls, 0);
  assert.equal(rec.logFailures.length, 1);
  assert.equal(rec.logFailures[0].reason, "listener_song_announce_push_failed");
  // Stash still cleared, so announceIfPending doesn't loop forever.
  assert.equal(rec.logPushes.length, 0);
});

test("announceIfPending is a no-op for unknown trackId", async () => {
  const { deps, rec } = fakeDeps();
  const orch = new AnnouncementOrchestrator(deps);
  orch.announceIfPending("never-scheduled");
  await settle();
  assert.equal(rec.pushes.length, 0);
  assert.equal(rec.onVoicePushedCalls, 0);
});

test("schedule is idempotent for the same trackId", async () => {
  let gens = 0;
  const { deps } = fakeDeps({
    generateScript: async () => {
      gens += 1;
      return "A";
    },
  });
  const orch = new AnnouncementOrchestrator(deps);
  orch.schedule("track-5", { listenerName: "A", userPrompt: "a", title: "b" });
  orch.schedule("track-5", { listenerName: "A", userPrompt: "a", title: "b" });
  orch.schedule("track-5", { listenerName: "A", userPrompt: "a", title: "b" });
  await settle();
  assert.equal(gens, 1, "pipeline should run exactly once per trackId");
});
