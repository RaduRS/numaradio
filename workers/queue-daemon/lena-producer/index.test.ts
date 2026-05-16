// workers/queue-daemon/lena-producer/index.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { lenaSpeak, type LenaResult } from "./index.ts";
import { ShiftMemory } from "./shift-memory.ts";

test("lenaSpeak auto_track_boundary happy path: Producer→Writer→{ text, mode }", async () => {
  const mem = new ShiftMemory();
  const calls: string[] = [];
  const llm = async (p: { system: string }) => {
    calls.push(p.system.slice(0, 40));
    if (p.system.startsWith("You are the producer")) {
      return JSON.stringify({
        mode: "opinion",
        target_focus: "this one",
        callback_to: null,
        length_hint: "short",
        tone: "warm",
        address_listener: null,
      });
    }
    return "this one's a sleeper hit.";
  };
  const r: LenaResult | null = await lenaSpeak({
    trigger: { source: "auto_track_boundary", nextTrack: { id: "x", title: "X", artist: null, genre: null, bpm: null } },
    memory: mem,
    llm,
    nowMs: Date.now(),
  });
  assert.ok(r);
  assert.equal(r!.mode, "opinion");
  assert.equal(r!.text, "this one's a sleeper hit.");
  assert.equal(calls.length, 2); // Producer then Writer
});

test("lenaSpeak returns null when Producer chooses silence", async () => {
  const mem = new ShiftMemory();
  const llm = async () =>
    JSON.stringify({
      mode: "silence",
      target_focus: "",
      callback_to: null,
      length_hint: "short",
      tone: "low-key",
      address_listener: null,
    });
  const r = await lenaSpeak({
    trigger: { source: "auto_track_boundary", nextTrack: { id: "x", title: "X", artist: null, genre: null, bpm: null } },
    memory: mem,
    llm,
    nowMs: Date.now(),
  });
  assert.equal(r, null);
});

test("lenaSpeak falls back when Producer fails twice then Writer also fails — returns null (caller falls back to legacy path)", async () => {
  const mem = new ShiftMemory();
  let llmCalls = 0;
  const llm = async (p: { system: string }) => {
    llmCalls += 1;
    if (p.system.startsWith("You are the producer")) return "garbage";
    throw new Error("writer down");
  };
  const r = await lenaSpeak({
    trigger: { source: "auto_track_boundary", nextTrack: { id: "x", title: "X", artist: null, genre: null, bpm: null } },
    memory: mem,
    llm,
    nowMs: Date.now(),
  });
  assert.equal(r, null);
  assert.ok(llmCalls >= 3); // producer x2 + writer x1
});

test("lenaSpeak passes last 5 lena lines to Writer for anti-echo", async () => {
  const mem = new ShiftMemory();
  const now = Date.now();
  for (let i = 0; i < 5; i += 1) {
    mem.record({
      type: "lena_line_aired",
      id: `c${i}`,
      mode: "opinion",
      targetFocus: null,
      text: `line ${i}`,
      airedAt: now - (5 - i) * 60_000,
      trigger: "auto_track_boundary",
      addressedListener: null,
    });
  }
  let writerUserSeen = "";
  const llm = async (p: { system: string; user: string }) => {
    if (p.system.startsWith("You are the producer")) {
      return JSON.stringify({
        mode: "opinion",
        target_focus: "x",
        callback_to: null,
        length_hint: "short",
        tone: "warm",
        address_listener: null,
      });
    }
    writerUserSeen = p.user;
    return "fresh line";
  };
  await lenaSpeak({
    trigger: { source: "auto_track_boundary", nextTrack: { id: "x", title: "X", artist: null, genre: null, bpm: null } },
    memory: mem,
    llm,
    nowMs: now,
  });
  assert.match(writerUserSeen, /line 4/);
  assert.match(writerUserSeen, /line 0/);
});
