import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAcceptRequestPrompt } from "./accept-request.ts";
import type { ChatContext } from "../chat-context.ts";

const ctx: ChatContext = {
  trigger: { source: "youtube_chat_mention", handle: "anna", text: "play hotel california", intent: "request" },
  now: { localTime: "23:00", bucket: "night" },
  recentShoutouts: [],
  recentLenaLines: [],
  catalogCandidates: [{ id: "t1", title: "Hotel California", artist: "Eagles", genre: "rock", bpm: 75 }],
  recentlyAiredTrackIds: [],
  queueDepth: 0,
};

test("buildAcceptRequestPrompt names track + artist + handle", () => {
  const decision = {
    mode: "accept_request" as const,
    targetFocus: "x",
    callbackTo: null,
    lengthHint: "short" as const,
    tone: "warm" as const,
    pickedTrackId: "t1",
    declineReason: null,
  };
  const p = buildAcceptRequestPrompt(decision, ctx);
  assert.match(p.user, /anna/);
  assert.match(p.user, /Hotel California/);
  assert.match(p.user, /Eagles/);
});

test("buildAcceptRequestPrompt bans 'let it ride'", () => {
  const decision = {
    mode: "accept_request" as const,
    targetFocus: "x",
    callbackTo: null,
    lengthHint: "short" as const,
    tone: "warm" as const,
    pickedTrackId: "t1",
    declineReason: null,
  };
  const p = buildAcceptRequestPrompt(decision, ctx);
  assert.match(p.system, /let it ride/i);
});

test("buildAcceptRequestPrompt marks unresolved when pickedTrackId is missing from candidates", () => {
  const decision = {
    mode: "accept_request" as const,
    targetFocus: "x",
    callbackTo: null,
    lengthHint: "short" as const,
    tone: "warm" as const,
    pickedTrackId: "tNOPE",
    declineReason: null,
  };
  const p = buildAcceptRequestPrompt(decision, ctx);
  assert.match(p.user, /\(unresolved\)/);
});
