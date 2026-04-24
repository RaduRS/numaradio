import { test } from "node:test";
import assert from "node:assert/strict";
import { synthesizeChatter } from "./deepgram-tts.ts";

function bytesResponse(bytes: Uint8Array, status = 200): Response {
  return new Response(bytes, { status });
}

test("synthesizeChatter posts to Aura and returns MP3 buffer", async () => {
  const calls: string[] = [];
  const fake: typeof fetch = (async (url: string) => {
    calls.push(String(url));
    return bytesResponse(new Uint8Array([0xff, 0xfb, 0x00, 0x00]));
  }) as typeof fetch;
  const buf = await synthesizeChatter("Hello.", { apiKey: "k", fetcher: fake });
  assert.equal(buf.length, 4);
  assert.ok(calls[0].includes("aura-2-helena-en"), "should call helena first");
});

test("synthesizeChatter falls back to aura-asteria on 400 from primary", async () => {
  const urls: string[] = [];
  const fake: typeof fetch = (async (url: string) => {
    urls.push(String(url));
    if (urls.length === 1) return new Response("bad model", { status: 400 });
    return bytesResponse(new Uint8Array([0xff, 0xfb]));
  }) as typeof fetch;
  const buf = await synthesizeChatter("Hi.", { apiKey: "k", fetcher: fake });
  assert.equal(buf.length, 2);
  assert.equal(urls.length, 2);
  assert.ok(urls[0].includes("aura-2-helena-en"));
  assert.ok(urls[1].includes("aura-asteria-en"));
});

test("synthesizeChatter throws when both models fail", async () => {
  const fake: typeof fetch = (async () =>
    new Response("boom", { status: 500 })) as typeof fetch;
  await assert.rejects(
    () => synthesizeChatter("Hi.", { apiKey: "k", fetcher: fake }),
    /deepgram 500/i,
  );
});

test("synthesizeChatter throws on missing api key", async () => {
  await assert.rejects(
    () => synthesizeChatter("Hi.", { apiKey: "", fetcher: fetch }),
    /DEEPGRAM_API_KEY/,
  );
});

test("synthesizeChatter throws on empty text", async () => {
  await assert.rejects(
    () => synthesizeChatter("", { apiKey: "k", fetcher: fetch }),
    /empty text/i,
  );
});
