import { test } from "node:test";
import assert from "node:assert/strict";
import { runChatWriter } from "./writer.ts";
import type { ChatContext } from "./chat-context.ts";

const ctx: ChatContext = {
  trigger: { source: "youtube_chat_mention", handle: "anna", text: "hi" },
  now: { localTime: "23:00", bucket: "night" },
  recentShoutouts: [],
  recentLenaLines: [],
  catalogCandidates: [{ id: "t1", title: "Hotel California", artist: "Eagles", genre: "rock", bpm: 75 }],
  recentlyAiredTrackIds: [],
  queueDepth: 0,
};

test("runChatWriter answer mode calls answer prompt", async () => {
  const decision = {
    mode: "answer" as const,
    targetFocus: "x",
    callbackTo: null,
    lengthHint: "short" as const,
    tone: "warm" as const,
    pickedTrackId: null,
    declineReason: null,
  };
  const llm = async (p: { system: string }) => {
    assert.match(p.system, /always replies/i);
    return "hey anna!";
  };
  assert.equal(await runChatWriter(decision, ctx, { llm }), "hey anna!");
});

test("runChatWriter callback mode calls callback prompt", async () => {
  const decision = {
    mode: "callback" as const,
    targetFocus: "x",
    callbackTo: "s1",
    lengthHint: "short" as const,
    tone: "warm" as const,
    pickedTrackId: null,
    declineReason: null,
  };
  const llm = async (p: { system: string }) => {
    assert.match(p.system, /tying/i);
    return "hey anna, bob was on earlier too";
  };
  assert.match((await runChatWriter(decision, ctx, { llm })) ?? "", /bob/);
});

test("runChatWriter accept_request mode calls accept-request prompt", async () => {
  const decision = {
    mode: "accept_request" as const,
    targetFocus: "x",
    callbackTo: null,
    lengthHint: "short" as const,
    tone: "warm" as const,
    pickedTrackId: "t1",
    declineReason: null,
  };
  const llm = async (p: { system: string }) => {
    assert.match(p.system, /confirming a listener's song request she's queuing up/i);
    return "pulling hotel california up for you anna.";
  };
  const out = await runChatWriter(decision, ctx, { llm });
  assert.match(out ?? "", /hotel california/i);
});

test("runChatWriter accept_request_deferred mode calls deferred prompt", async () => {
  const decision = {
    mode: "accept_request_deferred" as const,
    targetFocus: "x",
    callbackTo: null,
    lengthHint: "medium" as const,
    tone: "warm" as const,
    pickedTrackId: "t1",
    declineReason: null,
  };
  const llm = async (p: { system: string }) => {
    assert.match(p.system, /BEHIND other listener picks/i);
    return "queued behind a couple picks, anna.";
  };
  assert.ok(await runChatWriter(decision, ctx, { llm }));
});

test("runChatWriter decline_request mode calls decline prompt", async () => {
  const decision = {
    mode: "decline_request" as const,
    targetFocus: "x",
    callbackTo: null,
    lengthHint: "short" as const,
    tone: "warm" as const,
    pickedTrackId: null,
    declineReason: "not_in_catalog" as const,
  };
  const llm = async (p: { system: string }) => {
    assert.match(p.system, /politely declining/i);
    return "not in our crates tonight, anna.";
  };
  assert.ok(await runChatWriter(decision, ctx, { llm }));
});
