import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAcceptRequestDeferredPrompt } from "./accept-request-deferred.ts";
import type { ChatContext } from "../chat-context.ts";

const ctx: ChatContext = {
  trigger: { source: "youtube_chat_mention", handle: "anna", text: "play dusk", intent: "request" },
  now: { localTime: "23:00", bucket: "night" },
  recentShoutouts: [],
  recentLenaLines: [],
  catalogCandidates: [{ id: "t1", title: "Dusk", artist: "Anna", genre: "synth", bpm: 112 }],
  recentlyAiredTrackIds: [],
  queueDepth: 3,
};

test("buildAcceptRequestDeferredPrompt includes queue depth + estimate", () => {
  const decision = {
    mode: "accept_request_deferred" as const,
    targetFocus: "x",
    callbackTo: null,
    lengthHint: "medium" as const,
    tone: "warm" as const,
    pickedTrackId: "t1",
    declineReason: null,
  };
  const p = buildAcceptRequestDeferredPrompt(decision, ctx);
  assert.match(p.user, /3 other picks/);
  assert.match(p.user, /9 min out/);
});

test("buildAcceptRequestDeferredPrompt floors minsBehind at 3 when queueDepth small", () => {
  const ctxLow: ChatContext = { ...ctx, queueDepth: 1 };
  const decision = {
    mode: "accept_request_deferred" as const,
    targetFocus: "x",
    callbackTo: null,
    lengthHint: "medium" as const,
    tone: "warm" as const,
    pickedTrackId: "t1",
    declineReason: null,
  };
  const p = buildAcceptRequestDeferredPrompt(decision, ctxLow);
  assert.match(p.user, /1 other picks/);
  assert.match(p.user, /3 min out/);
});
