import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fetchWorldAside,
  pickTopic,
  buildPrompt,
  validateLine,
  type WorldAsideClientOpts,
} from "./world-aside-client.ts";

// ─── pickTopic ──────────────────────────────────────────────────────

test("pickTopic returns a valid category + query", () => {
  const now = new Date("2026-04-26T22:00:00Z");
  const p = pickTopic([], () => 0.0, now); // pin rand low to land on first weather city
  assert.ok(p);
  if (p) {
    assert.equal(p.category, "weather");
    assert.match(p.topic, /^weather:/);
    assert.match(p.query, /weather lisbon today/);
  }
});

test("pickTopic excludes recent weather cities", () => {
  const now = new Date("2026-04-26T22:00:00Z");
  // All 5 cities recent → no weather available → must pick a non-weather category.
  const p = pickTopic(
    ["weather:lisbon", "weather:london", "weather:new york", "weather:tokyo", "weather:sydney"],
    () => 0.0,
    now,
  );
  assert.ok(p);
  if (p) {
    assert.notEqual(p.category, "weather");
  }
});

test("pickTopic excludes a category once 3 recent topics in it", () => {
  const now = new Date("2026-04-26T22:00:00Z");
  // 3 music topics recent → music excluded.
  const p = pickTopic(
    ["music:a", "music:b", "music:c"],
    () => 0.99, // high rand → would prefer music if available (it's a high-weight category)
    now,
  );
  assert.ok(p);
  if (p) assert.notEqual(p.category, "music");
});

test("pickTopic returns null when every category is saturated", () => {
  const now = new Date("2026-04-26T22:00:00Z");
  const recent = [
    "weather:lisbon", "weather:london", "weather:new york", "weather:tokyo", "weather:sydney",
    "music:a", "music:b", "music:c",
    "ai-tech:a", "ai-tech:b", "ai-tech:c",
    "on-this-day:a", "on-this-day:b", "on-this-day:c",
    "culture:a", "culture:b", "culture:c",
    "astro:a", "astro:b", "astro:c",
  ];
  const p = pickTopic(recent, () => 0.5, now);
  assert.equal(p, null);
});

test("pickTopic on-this-day formats topic with month-day", () => {
  // Force on-this-day to be picked — recent saturates everything else.
  const now = new Date("2026-04-26T22:00:00Z");
  const recent = [
    "weather:lisbon", "weather:london", "weather:new york", "weather:tokyo", "weather:sydney",
    "music:a", "music:b", "music:c",
    "ai-tech:a", "ai-tech:b", "ai-tech:c",
    "culture:a", "culture:b", "culture:c",
    "astro:a", "astro:b", "astro:c",
  ];
  const p = pickTopic(recent, () => 0.5, now);
  assert.ok(p);
  if (p) {
    assert.equal(p.category, "on-this-day");
    assert.match(p.topic, /on-this-day:\d+-\d+/);
  }
});

// ─── buildPrompt ────────────────────────────────────────────────────

test("buildPrompt includes show + briefing + snippets + today", () => {
  const p = buildPrompt({
    show: "Night Shift",
    briefing: "Tokyo's weather right now",
    results: [
      { title: "Tokyo weather", description: "14°C, light rain" },
      { title: "Tokyo forecast", description: "cloudy through Wednesday" },
    ],
    now: new Date("2026-04-26T22:00:00Z"),
  });
  assert.match(p.user, /Night Shift/);
  assert.match(p.user, /Tokyo's weather right now/);
  assert.match(p.user, /14°C, light rain/);
  assert.match(p.user, /cloudy through Wednesday/);
  // Today's date is on the FIRST line so the model considers it before reading snippets.
  assert.match(p.user, /^Today is .+April .*2026/);
});

test("buildPrompt system prompt has Lena identity + Celsius + staleness rules", () => {
  const p = buildPrompt({ show: "X", briefing: "y", results: [], now: new Date() });
  assert.match(p.system, /Lena/);
  assert.match(p.system, /fine by me/i);
  assert.match(p.system, /NO_GOOD_ANGLE/);
  // Two new rule blocks added for unit + temporal accuracy.
  assert.match(p.system, /Celsius/);
  assert.match(p.system, /already happened|past tense|stale/i);
});

// ─── validateLine ───────────────────────────────────────────────────

test("validateLine accepts a clean Lena line", () => {
  const r = validateLine("Tokyo's seeing rain right now. Quiet kind of weather, fits the hour.");
  assert.equal(r.ok, true);
});

test("validateLine rejects empty + NO_GOOD_ANGLE + too-long", () => {
  assert.equal(validateLine("").ok, false);
  assert.equal(validateLine("NO_GOOD_ANGLE").ok, false);
  assert.equal(validateLine("a".repeat(201)).ok, false);
});

test("validateLine rejects banned aloof phrases", () => {
  const r = validateLine("Tokyo's wet. Fine by me either way.");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "banned_phrase");
});

test("validateLine rejects clock times", () => {
  const r = validateLine("It's 4:13 AM and Tokyo is wet.");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "clock_time");
});

test("validateLine rejects Fahrenheit (°F, F suffix, Fahrenheit word)", () => {
  for (const bad of [
    "Lisbon's 79°F and sunny.",
    "Tokyo at 65 °F right now.",
    "Lisbon hitting 79F today.",
    "Reading 26 in Fahrenheit, comfortable hour.",
  ]) {
    const r = validateLine(bad);
    assert.equal(r.ok, false, `expected ban for: ${bad}`);
    if (!r.ok) assert.equal(r.reason, "fahrenheit");
  }
});

test("validateLine accepts Celsius even when text contains 'F' as artist initial", () => {
  // "John F. Kennedy" / "Mac F" type phrases shouldn't false-trigger.
  const r = validateLine("Lisbon's 26°C, sunny — fits the hour.");
  assert.equal(r.ok, true);
});

test("validateLine rejects fabricated immediacy phrases (the GPT-5.5 hallucination)", () => {
  // These are the phrases MiniMax kept generating to make stale news
  // sound fresh. The original incident: "OpenAI launched GPT-5.5 ...
  // earlier today." All-time staleness sneaking past via punchy timing.
  for (const bad of [
    "OpenAI launched GPT-5.5 earlier today.",
    "Apple announced their new chip this morning.",
    "Spotify dropped a new feature moments ago.",
    "Google released their model minutes ago.",
    "Meta announced VR headset a few minutes ago.",
  ]) {
    const r = validateLine(bad);
    assert.equal(r.ok, false, `expected ban for: ${bad}`);
    if (!r.ok) assert.equal(r.reason, "false_immediacy");
  }
});

test("validateLine still accepts legitimate timing phrases", () => {
  // These should NOT trigger the immediacy ban.
  for (const ok of [
    "Tokyo's at 16°C right now. Soft kind of weather.",
    "Lyrids peak tonight. If you're outside, look up.",
    "Coachella lineup just dropped — Olivia Rodrigo headlining.", // "just" alone is fine
    "Taylor Swift dropped a new single yesterday. Worth a check.",
    "Big tech week — Apple announced their chip on Tuesday.",
    "Lisbon was 30°C this afternoon. Cooled down nicely now.",
  ]) {
    const r = validateLine(ok);
    assert.equal(r.ok, true, `expected pass for: ${ok}`);
  }
});

test("buildPrompt system prompt forbids fabricated immediacy", () => {
  const p = buildPrompt({ show: "X", briefing: "y", results: [], now: new Date() });
  // The system prompt must explicitly tell the model these are off-limits
  // for launches/releases — prompt as advisory layer, validator as enforcer.
  assert.match(p.system, /earlier today|this morning|moments ago|minutes ago/i);
});

// ─── fetchWorldAside (integration) ──────────────────────────────────

const FIXED_NOW = new Date("2026-04-26T22:00:00Z");

function makeFetcher(braveResponse: unknown, status = 200): typeof fetch {
  const r = ((u: string) => {
    if (typeof u === "string" && u.startsWith("https://api.search.brave.com")) {
      return Promise.resolve(
        new Response(JSON.stringify(braveResponse), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return Promise.resolve(new Response("nope", { status: 404 }));
  }) as unknown as typeof fetch;
  return r;
}

const BASE_OPTS: Omit<WorldAsideClientOpts, "fetcher" | "generate"> = {
  braveKey: "k",
  minimaxKey: "m",
  rand: () => 0.0, // first weather city
  now: () => FIXED_NOW,
};

test("fetchWorldAside happy path returns ok with topic + line", async () => {
  const r = await fetchWorldAside(
    { show: "Night Shift", recentTopics: [] },
    {
      ...BASE_OPTS,
      fetcher: makeFetcher({
        web: { results: [{ title: "Lisbon weather", description: "16°C, light rain expected." }] },
      }),
      generate: async () => "Lisbon's seeing rain right now. Glad you're keeping me company.",
    },
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.topic, "weather:lisbon");
    assert.match(r.line, /Lisbon/);
  }
});

test("fetchWorldAside missing brave key returns no_brave_key", async () => {
  const r = await fetchWorldAside(
    { show: "Night Shift", recentTopics: [] },
    { ...BASE_OPTS, braveKey: "", fetcher: makeFetcher({}), generate: async () => "x" },
  );
  assert.deepEqual(r, { ok: false, reason: "no_brave_key" });
});

test("fetchWorldAside Brave 5xx returns brave_search_failed", async () => {
  const r = await fetchWorldAside(
    { show: "Night Shift", recentTopics: [] },
    {
      ...BASE_OPTS,
      fetcher: makeFetcher({}, 503),
      generate: async () => "x",
    },
  );
  assert.deepEqual(r, { ok: false, reason: "brave_search_failed" });
});

test("fetchWorldAside Brave returns no results → brave_search_failed", async () => {
  const r = await fetchWorldAside(
    { show: "Night Shift", recentTopics: [] },
    {
      ...BASE_OPTS,
      fetcher: makeFetcher({ web: { results: [] } }),
      generate: async () => "x",
    },
  );
  assert.deepEqual(r, { ok: false, reason: "brave_search_failed" });
});

test("fetchWorldAside MiniMax returns NO_GOOD_ANGLE → no_good_angle", async () => {
  const r = await fetchWorldAside(
    { show: "Night Shift", recentTopics: [] },
    {
      ...BASE_OPTS,
      fetcher: makeFetcher({
        web: { results: [{ title: "x", description: "y" }] },
      }),
      generate: async () => "NO_GOOD_ANGLE",
    },
  );
  assert.deepEqual(r, { ok: false, reason: "no_good_angle" });
});

test("fetchWorldAside MiniMax returns banned phrase → banned_phrase", async () => {
  const r = await fetchWorldAside(
    { show: "Night Shift", recentTopics: [] },
    {
      ...BASE_OPTS,
      fetcher: makeFetcher({
        web: { results: [{ title: "x", description: "y" }] },
      }),
      generate: async () => "Tokyo's wet. Fine by me either way.",
    },
  );
  assert.deepEqual(r, { ok: false, reason: "banned_phrase" });
});

test("fetchWorldAside MiniMax throws → minimax_failed", async () => {
  const r = await fetchWorldAside(
    { show: "Night Shift", recentTopics: [] },
    {
      ...BASE_OPTS,
      fetcher: makeFetcher({
        web: { results: [{ title: "x", description: "y" }] },
      }),
      generate: async () => { throw new Error("503"); },
    },
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /^minimax_failed:/);
});

test("fetchWorldAside refines topic for music category from first Brave title", async () => {
  // Force music category by saturating weather + others.
  const r = await fetchWorldAside(
    {
      show: "Prime Hours",
      recentTopics: [
        "weather:lisbon", "weather:london", "weather:new york", "weather:tokyo", "weather:sydney",
        "ai-tech:a", "ai-tech:b", "ai-tech:c",
        "on-this-day:a", "on-this-day:b", "on-this-day:c",
        "culture:a", "culture:b", "culture:c",
        "astro:a", "astro:b", "astro:c",
      ],
      // → music must be picked
    },
    {
      ...BASE_OPTS,
      rand: () => 0.5,
      fetcher: makeFetcher({
        web: { results: [{ title: "Taylor Swift announces tour", description: "..." }] },
      }),
      generate: async () => "Taylor's on the move again. Nice to be in the loop.",
    },
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    // refineTopic slugs first 3 words of the title
    assert.equal(r.topic, "music:taylor-swift-announces");
  }
});

test("fetchWorldAside strips HTML from Brave snippets before prompting", async () => {
  let capturedUser: string | null = null;
  const r = await fetchWorldAside(
    { show: "Night Shift", recentTopics: [] },
    {
      ...BASE_OPTS,
      fetcher: makeFetcher({
        web: {
          results: [
            { title: "<b>Lisbon</b> weather", description: "16°C, <em>light rain</em> expected." },
          ],
        },
      }),
      generate: async (p) => {
        capturedUser = p.user;
        return "Lisbon's wet, glad you're with me.";
      },
    },
  );
  assert.equal(r.ok, true);
  assert.ok(capturedUser);
  // HTML tags must be stripped before reaching the model.
  assert.doesNotMatch(capturedUser!, /<b>|<em>/);
  assert.match(capturedUser!, /Lisbon weather/);
});
