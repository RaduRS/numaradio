import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseYoutubeAudience,
  fetchYoutubeAudience,
} from "./youtube-audience.ts";

test("parseYoutubeAudience extracts state and concurrentViewers", () => {
  const r = parseYoutubeAudience({
    state: "live",
    concurrentViewers: 12,
  });
  assert.deepEqual(r, { state: "live", viewers: 12 });
});

test("parseYoutubeAudience treats missing concurrentViewers as 0", () => {
  const r = parseYoutubeAudience({ state: "ready" });
  assert.deepEqual(r, { state: "ready", viewers: 0 });
});

test("parseYoutubeAudience treats null concurrentViewers as 0", () => {
  const r = parseYoutubeAudience({ state: "live", concurrentViewers: null });
  assert.deepEqual(r, { state: "live", viewers: 0 });
});

test("parseYoutubeAudience defaults missing state to 'off'", () => {
  const r = parseYoutubeAudience({ concurrentViewers: 5 });
  assert.deepEqual(r, { state: "off", viewers: 5 });
});

test("parseYoutubeAudience returns null for non-object input", () => {
  assert.equal(parseYoutubeAudience(null), null);
  assert.equal(parseYoutubeAudience("string"), null);
  assert.equal(parseYoutubeAudience(42), null);
});

test("fetchYoutubeAudience returns parsed object on 200", async () => {
  const mockFetch = (async () =>
    new Response(
      JSON.stringify({ state: "live", concurrentViewers: 7 }),
      { status: 200 },
    )) as typeof fetch;
  const r = await fetchYoutubeAudience({
    url: "http://x/y",
    fetcher: mockFetch,
  });
  assert.deepEqual(r, { state: "live", viewers: 7 });
});

test("fetchYoutubeAudience returns null on non-200", async () => {
  const mockFetch = (async () =>
    new Response("err", { status: 500 })) as typeof fetch;
  const r = await fetchYoutubeAudience({ url: "http://x/y", fetcher: mockFetch });
  assert.equal(r, null);
});

test("fetchYoutubeAudience returns null on network error", async () => {
  const mockFetch = (async () => {
    throw new Error("ECONNREFUSED");
  }) as typeof fetch;
  const r = await fetchYoutubeAudience({ url: "http://x/y", fetcher: mockFetch });
  assert.equal(r, null);
});

test("fetchYoutubeAudience returns null on malformed JSON", async () => {
  const mockFetch = (async () =>
    new Response("not json", { status: 200 })) as typeof fetch;
  const r = await fetchYoutubeAudience({ url: "http://x/y", fetcher: mockFetch });
  assert.equal(r, null);
});
