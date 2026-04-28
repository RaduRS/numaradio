import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyShoutoutIntent,
  parseIntentReply,
} from "./classify-shoutout-intent.ts";

// ─── parseIntentReply ───────────────────────────────────────────────────

test("parseIntentReply: worthy decision", () => {
  assert.deepEqual(parseIntentReply('{"d":"worthy"}'), {
    worthy: true,
    reason: "ok",
  });
});

test("parseIntentReply: noise decision with reason", () => {
  assert.deepEqual(parseIntentReply('{"d":"noise","r":"low_effort"}'), {
    worthy: false,
    reason: "low_effort",
  });
});

test("parseIntentReply: tolerates stray whitespace + prose", () => {
  assert.deepEqual(
    parseIntentReply(
      'I think this is noise so:\n{"d": "noise", "r": "greeting"}\nDone.',
    ),
    { worthy: false, reason: "greeting" },
  );
});

test("parseIntentReply: unparseable → fail-open", () => {
  const r = parseIntentReply("I don't know.");
  assert.equal(r.worthy, true);
  assert.match(r.reason, /classifier_no_decision/);
});

test("parseIntentReply: unknown decision token → fail-open", () => {
  const r = parseIntentReply('{"d":"maybe"}');
  assert.equal(r.worthy, true);
  assert.match(r.reason, /classifier_unknown:maybe/);
});

test("parseIntentReply: noise without reason gets default reason", () => {
  assert.deepEqual(parseIntentReply('{"d":"noise"}'), {
    worthy: false,
    reason: "noise",
  });
});

// ─── classifyShoutoutIntent ─────────────────────────────────────────────

function mockFetcher(json: unknown, status = 200) {
  return (async () =>
    new Response(JSON.stringify(json), { status })) as typeof fetch;
}

test("classifyShoutoutIntent rejects too-short text without an API call", async (t) => {
  let called = 0;
  const fetcher: typeof fetch = (async () => {
    called += 1;
    return new Response("{}");
  }) as typeof fetch;
  const r = await classifyShoutoutIntent("hi", { fetcher });
  assert.deepEqual(r, { worthy: false, reason: "too_short" });
  assert.equal(called, 0);
});

test("classifyShoutoutIntent forwards MiniMax decision when API responds", async (t) => {
  process.env.MINIMAX_API_KEY = "test-key";
  t.after(() => delete process.env.MINIMAX_API_KEY);
  const fetcher = mockFetcher({
    content: [
      { type: "thinking", thinking: "ok this is a real shoutout" },
      { type: "text", text: '{"d":"worthy"}' },
    ],
  });
  const r = await classifyShoutoutIntent(
    "shoutout to my brother in Bucharest",
    { fetcher },
  );
  assert.deepEqual(r, { worthy: true, reason: "ok" });
});

test("classifyShoutoutIntent forwards noise verdict from MiniMax", async (t) => {
  process.env.MINIMAX_API_KEY = "test-key";
  t.after(() => delete process.env.MINIMAX_API_KEY);
  const fetcher = mockFetcher({
    content: [
      { type: "text", text: '{"d":"noise","r":"low_effort"}' },
    ],
  });
  const r = await classifyShoutoutIntent("first comment", { fetcher });
  assert.deepEqual(r, { worthy: false, reason: "low_effort" });
});

test("classifyShoutoutIntent fails open when API key missing", async () => {
  delete process.env.MINIMAX_API_KEY;
  const r = await classifyShoutoutIntent("hello there");
  assert.equal(r.worthy, true);
  assert.equal(r.reason, "classifier_not_configured");
});

test("classifyShoutoutIntent fails open on HTTP error", async (t) => {
  process.env.MINIMAX_API_KEY = "test-key";
  t.after(() => delete process.env.MINIMAX_API_KEY);
  const fetcher = mockFetcher({ error: "rate limited" }, 429);
  const r = await classifyShoutoutIntent("test message", { fetcher });
  assert.equal(r.worthy, true);
  assert.match(r.reason, /classifier_http_429/);
});

test("classifyShoutoutIntent fails open on network error", async (t) => {
  process.env.MINIMAX_API_KEY = "test-key";
  t.after(() => delete process.env.MINIMAX_API_KEY);
  const fetcher: typeof fetch = (async () => {
    throw new Error("ECONNREFUSED");
  }) as typeof fetch;
  const r = await classifyShoutoutIntent("test message", { fetcher });
  assert.equal(r.worthy, true);
  assert.match(r.reason, /classifier_network/);
});
