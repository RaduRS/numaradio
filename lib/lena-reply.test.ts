import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReply, generateLenaReply } from "./lena-reply.ts";

// ─── parseReply ─────────────────────────────────────────────────────────

test("parseReply: clean short reply", () => {
  const r = parseReply("You're welcome, inRhino. Glad it's landing right.");
  assert.equal(r.text, "You're welcome, inRhino. Glad it's landing right.");
  assert.equal(r.reason, "ok");
});

test("parseReply: strips wrapping quotes", () => {
  const r = parseReply('"That means a lot, glad you\'re here."');
  assert.equal(r.text, "That means a lot, glad you're here.");
});

test("parseReply: strips Output: label", () => {
  const r = parseReply("Output: Hey Berlin. Glad you found us tonight.");
  assert.equal(r.text, "Hey Berlin. Glad you found us tonight.");
});

test("parseReply: collapses chain-of-thought leakage whitespace", () => {
  const r = parseReply("\n\nThat's   a   warm vibe tonight.\n");
  assert.equal(r.text, "That's a warm vibe tonight.");
});

test("parseReply: rejects empty response", () => {
  assert.equal(parseReply("").text, null);
  assert.equal(parseReply("   ").text, null);
});

test("parseReply: rejects too-short", () => {
  const r = parseReply("ok");
  assert.equal(r.text, null);
  assert.equal(r.reason, "reply_too_short");
});

test("parseReply: rejects too-long", () => {
  const long = "x".repeat(300);
  const r = parseReply(long);
  assert.equal(r.text, null);
  assert.equal(r.reason, "reply_too_long");
});

test("parseReply: rejects refusal-pattern outputs", () => {
  for (const refusal of [
    "I can't respond to that.",
    "Sorry, I'm unable to help.",
    "I don't know how to reply.",
  ]) {
    const r = parseReply(refusal);
    assert.equal(r.text, null, `should reject: ${refusal}`);
    assert.equal(r.reason, "reply_refused");
  }
});

// ─── generateLenaReply ──────────────────────────────────────────────────

test("generateLenaReply: returns null when API key missing", async () => {
  delete process.env.MINIMAX_API_KEY;
  const r = await generateLenaReply("@lena thanks for this set");
  assert.equal(r.text, null);
  assert.equal(r.reason, "minimax_not_configured");
});

test("generateLenaReply: passes display name into prompt", async (t) => {
  process.env.MINIMAX_API_KEY = "test-key";
  t.after(() => delete process.env.MINIMAX_API_KEY);
  let body: { messages?: { content: string }[] } | null = null;
  const fetcher: typeof fetch = (async (_url, init) => {
    body = JSON.parse((init as RequestInit).body as string) as typeof body;
    return new Response(
      JSON.stringify({
        content: [{ type: "text", text: "You're welcome, inRhino. Glad you're here." }],
      }),
    );
  }) as typeof fetch;
  const r = await generateLenaReply("thanks for this set", {
    displayName: "inRhino",
    fetcher,
  });
  assert.equal(r.text, "You're welcome, inRhino. Glad you're here.");
  assert.match(body!.messages![0].content, /inRhino/);
});

test("generateLenaReply: anonymises bad name tokens", async (t) => {
  process.env.MINIMAX_API_KEY = "test-key";
  t.after(() => delete process.env.MINIMAX_API_KEY);
  let body: { messages?: { content: string }[] } | null = null;
  const fetcher: typeof fetch = (async (_url, init) => {
    body = JSON.parse((init as RequestInit).body as string) as typeof body;
    return new Response(
      JSON.stringify({
        content: [{ type: "text", text: "Glad you're here tonight." }],
      }),
    );
  }) as typeof fetch;
  await generateLenaReply("hey lena", { displayName: "user1234", fetcher });
  assert.match(body!.messages![0].content, /anonymous/);
});

test("generateLenaReply: returns null on HTTP error", async (t) => {
  process.env.MINIMAX_API_KEY = "test-key";
  t.after(() => delete process.env.MINIMAX_API_KEY);
  const fetcher: typeof fetch = (async () =>
    new Response("rate limited", { status: 429 })) as typeof fetch;
  const r = await generateLenaReply("hey lena", { fetcher });
  assert.equal(r.text, null);
  assert.match(r.reason, /minimax_http_429/);
});

test("generateLenaReply: returns null on network error", async (t) => {
  process.env.MINIMAX_API_KEY = "test-key";
  t.after(() => delete process.env.MINIMAX_API_KEY);
  const fetcher: typeof fetch = (async () => {
    throw new Error("ECONNREFUSED");
  }) as typeof fetch;
  const r = await generateLenaReply("hey lena", { fetcher });
  assert.equal(r.text, null);
  assert.equal(r.reason, "minimax_network");
});
