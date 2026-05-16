import { test } from "node:test";
import assert from "node:assert/strict";
import { runChatProducer } from "./producer.ts";
import type { ChatContext } from "./chat-context.ts";

function ctx(): ChatContext {
  return {
    trigger: { source: "youtube_chat_mention", handle: "anna", text: "hey" },
    now: { localTime: "23:15", bucket: "night" },
    recentShoutouts: [{ id: "s1", handle: "bob", originalText: "hi", minsAgo: 5 }],
    recentLenaLines: [],
    catalogCandidates: [],
    recentlyAiredTrackIds: [],
    queueDepth: 0,
  };
}

test("runChatProducer happy path", async () => {
  const llm = async () => JSON.stringify({ mode: "answer", target_focus: "say hi back", callback_to: null, length_hint: "short", tone: "warm", picked_track_id: null, decline_reason: null });
  const d = await runChatProducer(ctx(), { llm });
  assert.equal(d.mode, "answer");
  assert.equal(d.tone, "warm");
  assert.equal(d.pickedTrackId, null);
  assert.equal(d.declineReason, null);
});

test("runChatProducer rejects silence — retry then fallback to answer", async () => {
  let call = 0;
  const llm = async () => {
    call += 1;
    return JSON.stringify({ mode: "silence", target_focus: "", callback_to: null, length_hint: "short", tone: "low-key", picked_track_id: null, decline_reason: null });
  };
  const d = await runChatProducer(ctx(), { llm });
  assert.equal(call, 2); // retried once
  assert.equal(d.mode, "answer"); // safe default
  assert.equal(d.pickedTrackId, null);
  assert.equal(d.declineReason, null);
});

test("runChatProducer: invalid JSON → retry → fallback to answer", async () => {
  const llm = async () => "garbage";
  const d = await runChatProducer(ctx(), { llm });
  assert.equal(d.mode, "answer");
  assert.equal(d.pickedTrackId, null);
  assert.equal(d.declineReason, null);
});

test("runChatProducer: callback_to unknown id → stripped to null", async () => {
  const llm = async () => JSON.stringify({ mode: "callback", target_focus: "x", callback_to: "not_real", length_hint: "short", tone: "warm", picked_track_id: null, decline_reason: null });
  const d = await runChatProducer(ctx(), { llm });
  assert.equal(d.callbackTo, null);
});

test("runChatProducer accepts a request: catalog candidate available, not recently aired, queue light", async () => {
  const ctxReq: ChatContext = {
    trigger: { source: "youtube_chat_mention", handle: "anna", text: "play hotel california", intent: "request" },
    now: { localTime: "23:00", bucket: "night" },
    recentShoutouts: [],
    recentLenaLines: [],
    catalogCandidates: [{ id: "t1", title: "Hotel California", artist: "Eagles", genre: "rock", bpm: 75 }],
    recentlyAiredTrackIds: [],
    queueDepth: 0,
  };
  const llm = async () => JSON.stringify({
    mode: "accept_request",
    target_focus: "queue it",
    callback_to: null,
    length_hint: "short",
    tone: "warm",
    picked_track_id: "t1",
    decline_reason: null,
  });
  const d = await runChatProducer(ctxReq, { llm });
  assert.equal(d.mode, "accept_request");
  assert.equal(d.pickedTrackId, "t1");
  assert.equal(d.declineReason, null);
});

test("runChatProducer empty catalogCandidates + bad LLM → safe-default declines with not_in_catalog", async () => {
  const ctxReq: ChatContext = {
    trigger: { source: "youtube_chat_mention", handle: "anna", text: "play queen", intent: "request" },
    now: { localTime: "23:00", bucket: "night" },
    recentShoutouts: [],
    recentLenaLines: [],
    catalogCandidates: [],
    recentlyAiredTrackIds: [],
    queueDepth: 0,
  };
  const llm = async () => "garbage"; // force fallback
  const d = await runChatProducer(ctxReq, { llm });
  assert.equal(d.mode, "decline_request");
  assert.equal(d.declineReason, "not_in_catalog");
  assert.equal(d.pickedTrackId, null);
});

test("runChatProducer: accept_request with invalid picked_track_id → null → mode-consistency rejected, retry, safe-default", async () => {
  const ctxReq: ChatContext = {
    trigger: { source: "youtube_chat_mention", handle: "anna", text: "play x", intent: "request" },
    now: { localTime: "23:00", bucket: "night" },
    recentShoutouts: [],
    recentLenaLines: [],
    catalogCandidates: [{ id: "t1", title: "X", artist: "Y", genre: "rock", bpm: 120 }],
    recentlyAiredTrackIds: [],
    queueDepth: 0,
  };
  let calls = 0;
  const llm = async () => {
    calls += 1;
    return JSON.stringify({
      mode: "accept_request",
      target_focus: "x",
      callback_to: null,
      length_hint: "short",
      tone: "warm",
      picked_track_id: "fake_id",
      decline_reason: null,
    });
  };
  const d = await runChatProducer(ctxReq, { llm });
  // both attempts rejected → safe-default declines
  assert.equal(calls, 2);
  assert.equal(d.mode, "decline_request");
  assert.equal(d.declineReason, "not_in_catalog");
});
