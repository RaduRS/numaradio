import { test } from "node:test";
import assert from "node:assert/strict";
import { generateChatterScript } from "./minimax-script.ts";

function okFetcher(body: object): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
}

test("generateChatterScript returns cleaned text from Anthropic-compat response", async () => {
  const fake = okFetcher({
    content: [{ type: "text", text: "That was Midnight Drive by Russell Ross. Stick around." }],
  });
  const out = await generateChatterScript(
    { system: "sys", user: "usr" },
    { apiKey: "k", fetcher: fake },
  );
  assert.equal(out, "That was Midnight Drive by Russell Ross. Stick around.");
});

test("generateChatterScript strips leading preamble and code fences", async () => {
  const fake = okFetcher({
    content: [{ type: "text", text: "Sure! Here's the line:\n```\nNuma Radio, always on.\n```" }],
  });
  const out = await generateChatterScript(
    { system: "sys", user: "usr" },
    { apiKey: "k", fetcher: fake },
  );
  assert.equal(out, "Numa Radio, always on.");
});

test("generateChatterScript throws on missing api key", async () => {
  await assert.rejects(
    () => generateChatterScript({ system: "s", user: "u" }, { apiKey: "", fetcher: fetch }),
    /MINIMAX_API_KEY/,
  );
});

test("generateChatterScript throws on non-200 HTTP", async () => {
  const fake: typeof fetch = (async () =>
    new Response("rate limited", { status: 429 })) as typeof fetch;
  await assert.rejects(
    () => generateChatterScript({ system: "s", user: "u" }, { apiKey: "k", fetcher: fake }),
    /minimax http 429/i,
  );
});

test("generateChatterScript throws on empty text in response", async () => {
  const fake = okFetcher({ content: [{ type: "text", text: "" }] });
  await assert.rejects(
    () => generateChatterScript({ system: "s", user: "u" }, { apiKey: "k", fetcher: fake }),
    /empty script/i,
  );
});

test("generateChatterScript rejects obvious AI-assistant leaks", async () => {
  const fake = okFetcher({
    content: [{ type: "text", text: "As an AI language model, I cannot..." }],
  });
  await assert.rejects(
    () => generateChatterScript({ system: "s", user: "u" }, { apiKey: "k", fetcher: fake }),
    /suspicious/i,
  );
});
