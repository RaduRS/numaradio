import { test } from "node:test";
import assert from "node:assert/strict";
import type { ShiftEvent } from "./shift-event.ts";
import { summarizeEvent } from "./callback-summarizer.ts";

test("summarizeEvent: shoutout — sends event to LLM and returns trimmed line", async () => {
  const event: ShiftEvent = {
    type: "shoutout_aired",
    id: "s1",
    handle: "anna",
    originalText: "love this set, late-night vibes",
    airedAt: 1,
  };
  const fakeLlm = async (_prompt: string): Promise<string> => "Anna shouted out about late-night vibes.\n";
  const out = await summarizeEvent(event, { llm: fakeLlm });
  assert.equal(out, "Anna shouted out about late-night vibes.");
});

test("summarizeEvent: mention — uses fake LLM and returns line", async () => {
  const event: ShiftEvent = {
    type: "youtube_mention",
    id: "m1",
    handle: "bob",
    text: "tuning in from Berlin",
    intent: "reply",
    airedAt: 1,
  };
  const fakeLlm = async (_prompt: string): Promise<string> => "Bob said he's tuning in from Berlin.";
  const out = await summarizeEvent(event, { llm: fakeLlm });
  assert.equal(out, "Bob said he's tuning in from Berlin.");
});

test("summarizeEvent: unsummarizable event types return null", async () => {
  const event: ShiftEvent = {
    type: "track_aired",
    id: "t1",
    trackId: "x",
    title: "Y",
    artist: null,
    genre: null,
    bpm: null,
    key: null,
    airedAt: 1,
  };
  const fakeLlm = async (): Promise<string> => "should not be called";
  const out = await summarizeEvent(event, { llm: fakeLlm });
  assert.equal(out, null);
});

test("summarizeEvent: LLM failure → returns null (caller falls back to structural description)", async () => {
  const event: ShiftEvent = {
    type: "shoutout_aired",
    id: "s2",
    handle: "anna",
    originalText: "hi",
    airedAt: 1,
  };
  const fakeLlm = async (): Promise<string> => {
    throw new Error("rate limit");
  };
  const out = await summarizeEvent(event, { llm: fakeLlm });
  assert.equal(out, null);
});
