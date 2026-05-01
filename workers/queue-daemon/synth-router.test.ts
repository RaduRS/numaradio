import { test } from "node:test";
import assert from "node:assert/strict";
import { createSynthesizer } from "./synth-router.ts";

const fakeMp3 = Buffer.from([0xff, 0xfb, 0x00]);

test("router calls deepgram when provider is deepgram", async () => {
  const calls: string[] = [];
  const synth = createSynthesizer({
    getProvider: async () => "deepgram",
    deepgramKey: "k",
    vertexProject: "p",
    deepgramSynth: async (text) => {
      calls.push(`deepgram:${text}`);
      return fakeMp3;
    },
    vertexSynth: async (text) => {
      calls.push(`vertex:${text}`);
      return fakeMp3;
    },
  });
  await synth("Hello.");
  assert.deepEqual(calls, ["deepgram:Hello."]);
});

test("router calls vertex when provider is vertex", async () => {
  const calls: string[] = [];
  const synth = createSynthesizer({
    getProvider: async () => "vertex",
    deepgramKey: "k",
    vertexProject: "p",
    deepgramSynth: async (text) => {
      calls.push(`deepgram:${text}`);
      return fakeMp3;
    },
    vertexSynth: async (text) => {
      calls.push(`vertex:${text}`);
      return fakeMp3;
    },
  });
  await synth("Hi.");
  assert.deepEqual(calls, ["vertex:Hi."]);
});

test("router falls back to deepgram if getProvider throws", async () => {
  const calls: string[] = [];
  const synth = createSynthesizer({
    getProvider: async () => {
      throw new Error("db down");
    },
    deepgramKey: "k",
    vertexProject: "p",
    deepgramSynth: async () => {
      calls.push("deepgram");
      return fakeMp3;
    },
    vertexSynth: async () => {
      calls.push("vertex");
      return fakeMp3;
    },
  });
  await synth("Hi.");
  assert.deepEqual(calls, ["deepgram"]);
});

test("router falls back to deepgram if vertex fails", async () => {
  const calls: string[] = [];
  const synth = createSynthesizer({
    getProvider: async () => "vertex",
    deepgramKey: "k",
    vertexProject: "p",
    deepgramSynth: async () => {
      calls.push("deepgram-fallback");
      return fakeMp3;
    },
    vertexSynth: async () => {
      calls.push("vertex-tried");
      throw new Error("vertex 503");
    },
  });
  await synth("Hi.");
  assert.deepEqual(calls, ["vertex-tried", "deepgram-fallback"]);
});

test("router rethrows when both providers fail", async () => {
  const synth = createSynthesizer({
    getProvider: async () => "vertex",
    deepgramKey: "k",
    vertexProject: "p",
    deepgramSynth: async () => {
      throw new Error("deepgram 500");
    },
    vertexSynth: async () => {
      throw new Error("vertex 503");
    },
  });
  await assert.rejects(() => synth("Hi."), /deepgram 500/);
});
