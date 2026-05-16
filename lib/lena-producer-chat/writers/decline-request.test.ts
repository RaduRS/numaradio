import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDeclineRequestPrompt } from "./decline-request.ts";
import type { ChatContext } from "../chat-context.ts";

const ctx: ChatContext = {
  trigger: { source: "youtube_chat_mention", handle: "anna", text: "play x", intent: "request" },
  now: { localTime: "23:00", bucket: "night" },
  recentShoutouts: [],
  recentLenaLines: [],
  catalogCandidates: [],
  recentlyAiredTrackIds: [],
  queueDepth: 0,
};

test("buildDeclineRequestPrompt passes reason guidance for not_in_catalog", () => {
  const decision = {
    mode: "decline_request" as const,
    targetFocus: "x",
    callbackTo: null,
    lengthHint: "short" as const,
    tone: "warm" as const,
    pickedTrackId: null,
    declineReason: "not_in_catalog" as const,
  };
  const p = buildDeclineRequestPrompt(decision, ctx);
  assert.match(p.user, /not in our catalog/i);
});

test("buildDeclineRequestPrompt passes reason guidance for recently_aired", () => {
  const decision = {
    mode: "decline_request" as const,
    targetFocus: "x",
    callbackTo: null,
    lengthHint: "short" as const,
    tone: "warm" as const,
    pickedTrackId: null,
    declineReason: "recently_aired" as const,
  };
  const p = buildDeclineRequestPrompt(decision, ctx);
  assert.match(p.user, /just played/i);
});

test("buildDeclineRequestPrompt bans 'let it ride'", () => {
  const decision = {
    mode: "decline_request" as const,
    targetFocus: "x",
    callbackTo: null,
    lengthHint: "short" as const,
    tone: "warm" as const,
    pickedTrackId: null,
    declineReason: "queue_full" as const,
  };
  const p = buildDeclineRequestPrompt(decision, ctx);
  assert.match(p.system, /let it ride/i);
});
