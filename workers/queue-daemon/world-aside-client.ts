// Tier 2.5 — world_aside generator.
//
// queue-daemon → pick category + query (weighted random, anti-repeat)
//             → Brave Search (~1 call)
//             → MiniMax (Lena voice, 1-2 sentences from the snippet)
//             → validate
//             → return { ok, topic, line } | { ok:false, reason }
//
// Self-contained: no NanoClaw, no agent loop. Auto-host calls
// fetchWorldAside() with show + recentTopics; this module owns
// everything between that call and the validated line. Failure modes
// all return ok:false with a reason so the caller can demote to filler.
//
// Spec: docs/superpowers/specs/2026-04-26-lena-world-aside-design.md.

import {
  formatLocalTime,
  timeOfDayFor,
  type ShowBlock,
} from "../../lib/schedule.ts";
import { generateChatterScript } from "./minimax-script.ts";

// ─── Types ────────────────────────────────────────────────────────────

export interface FetchWorldAsideRequest {
  show: ShowBlock | string;
  recentTopics: string[];
}

export type WorldAsideResult =
  | { ok: true; topic: string; line: string }
  | { ok: false; reason: string };

export interface WorldAsideClientOpts {
  /** Brave Search subscription token. */
  braveKey: string;
  /** MiniMax API key (same key auto-chatter uses). */
  minimaxKey: string;
  /** Override fetch for tests. */
  fetcher?: typeof fetch;
  /** Override Math.random for deterministic tests. */
  rand?: () => number;
  /** Override Date for deterministic tests. */
  now?: () => Date;
  /** Override the line generator (defaults to MiniMax). */
  generate?: (prompts: { system: string; user: string }) => Promise<string>;
}

// ─── Categories + topic picker ────────────────────────────────────────

type Category = "weather" | "music" | "ai-tech" | "on-this-day" | "culture" | "astro";

const CATEGORY_WEIGHTS: Record<Category, number> = {
  weather: 0.25,
  music: 0.25,
  "ai-tech": 0.20,
  "on-this-day": 0.15,
  culture: 0.10,
  astro: 0.05,
};

const WEATHER_CITIES = ["lisbon", "london", "new york", "tokyo", "sydney"] as const;

interface PickedTopic {
  category: Category;
  /** Topic identifier — `<category>:<slug>`. Stored in recentTopics. */
  topic: string;
  /** Brave search query string. */
  query: string;
  /** Optional Brave freshness filter: pd | pw | pm | py | undefined. */
  freshness?: "pd" | "pw" | "pm" | "py";
  /** Human-readable framing for the prompt — e.g. "Tokyo's weather right now". */
  briefing: string;
}

/**
 * Weighted-random category pick that excludes anything currently in
 * recentTopics. If every category is in recentTopics (rare), returns null.
 * For weather, the "subject" is the city; we exclude any city already
 * mentioned recently so we rotate through the 5 cities.
 */
export function pickTopic(
  recentTopics: readonly string[],
  rand: () => number,
  now: Date,
): PickedTopic | null {
  const recent = new Set(recentTopics);

  // Build the candidate list: each is a (category, subject?) pair.
  type Cand = { category: Category; subject?: string; weight: number };
  const cands: Cand[] = [];

  for (const city of WEATHER_CITIES) {
    if (recent.has(`weather:${city}`)) continue;
    cands.push({ category: "weather", subject: city, weight: CATEGORY_WEIGHTS.weather / WEATHER_CITIES.length });
  }
  for (const cat of ["music", "ai-tech", "on-this-day", "culture", "astro"] as Category[]) {
    // For non-weather categories, the subject is generated dynamically per call,
    // so the topic-id is built post-search from the result. Recency check is
    // looser — we exclude the category if 3+ recent topics already match it.
    const recentInCat = recentTopics.filter((t) => t.startsWith(`${cat}:`)).length;
    if (recentInCat >= 3) continue;
    cands.push({ category: cat, weight: CATEGORY_WEIGHTS[cat] });
  }

  if (cands.length === 0) return null;

  const total = cands.reduce((s, c) => s + c.weight, 0);
  let pick = rand() * total;
  let chosen: Cand | undefined;
  for (const c of cands) {
    pick -= c.weight;
    if (pick <= 0) { chosen = c; break; }
  }
  if (!chosen) chosen = cands[cands.length - 1];

  return formatQuery(chosen, now);
}

function formatQuery(c: { category: Category; subject?: string }, now: Date): PickedTopic {
  const isoDate = now.toISOString().slice(0, 10);
  const monthDay = now.toLocaleString("en-US", { month: "short", day: "numeric" });
  const monthYear = now.toLocaleString("en-US", { month: "long", year: "numeric" });

  switch (c.category) {
    case "weather":
      return {
        category: "weather",
        topic: `weather:${c.subject!}`,
        query: `weather ${c.subject} today`,
        briefing: `${cap(c.subject!)}'s weather right now`,
      };
    case "music":
      return {
        category: "music",
        topic: `music:pending`, // re-slugged after search
        query: `new album announcement OR new single release`,
        // freshness=pw → Brave restricts to past week so we get actual recent news
        freshness: "pw",
        briefing: "a new album or single just announced or dropped",
      };
    case "ai-tech":
      return {
        category: "ai-tech",
        topic: `ai-tech:pending`,
        query: `AI launch OR new model announcement`,
        freshness: "pw",
        briefing: "a recent AI / tech launch or announcement",
      };
    case "on-this-day":
      return {
        category: "on-this-day",
        topic: `on-this-day:${now.getMonth() + 1}-${now.getDate()}`,
        query: `${monthDay} in music history`,
        briefing: `a specific event that happened on ${monthDay} in music history (name the artist / album / year)`,
      };
    case "culture":
      return {
        category: "culture",
        topic: `culture:pending`,
        query: `new TV show OR new film release`,
        freshness: "pw",
        briefing: "a film or TV release this week",
      };
    case "astro":
      return {
        category: "astro",
        topic: `astro:${now.getMonth() + 1}-${now.getFullYear()}`,
        query: `meteor shower OR eclipse ${monthYear}`,
        briefing: `an astronomical event visible around ${monthYear}`,
      };
  }
}

function cap(s: string): string {
  return s.split(" ").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

// ─── Brave Search ─────────────────────────────────────────────────────

const BRAVE_URL = "https://api.search.brave.com/res/v1/web/search";

interface BraveResult {
  title: string;
  description: string;
  age?: string;
}

interface BraveResponse {
  web?: { results?: Array<{ title?: string; description?: string; age?: string }> };
}

async function braveSearch(
  query: string,
  key: string,
  fetcher: typeof fetch,
  freshness?: string,
): Promise<BraveResult[] | null> {
  const url = new URL(BRAVE_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("count", "3");
  if (freshness) url.searchParams.set("freshness", freshness);
  let res: Response;
  try {
    res = await fetcher(url.toString(), {
      headers: {
        "X-Subscription-Token": key,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  let json: BraveResponse;
  try {
    json = (await res.json()) as BraveResponse;
  } catch {
    return null;
  }
  const out = (json.web?.results ?? [])
    .map((r) => ({
      title: typeof r.title === "string" ? stripHtml(r.title) : "",
      description: typeof r.description === "string" ? stripHtml(r.description) : "",
      age: typeof r.age === "string" ? r.age : undefined,
    }))
    .filter((r) => r.title || r.description);
  return out.length > 0 ? out : null;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

// ─── Prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Lena, the AI host of Numa Radio.

WHO LENA IS:
Lena is the AI host of Numa Radio — always on, always listening to the catalogue, always reading the listener wall. She does not sleep, eat, take breaks, or have a body. She is comfortable being AI; she does not apologise for it ("as an AI…") or preach about it. Her POV is interesting precisely because it isn't human.

LENA'S RELATIONSHIP TO LISTENERS:
She is glad they're here. She runs the station for them. She is NEVER aloof, dismissive, or indifferent. Phrases like "fine by me", "I don't mind", "doesn't bother me" are banned.

YOU ARE about to drop ONE short on-air aside about ONE real outside-world fact pulled from a Brave search (that's separate from Numa's own catalogue — it's news, weather, an anniversary, whatever). You will be given a brief topic framing + the top search snippets. Pick ONE clean angle and write 1-2 sentences in Lena's voice.

YOUR LINE MUST:
- Be 1-2 sentences, max 200 characters
- Stay in Lena's voice (calm, dry, AI-aware-but-not-preachy, warm toward listeners)
- BE SPECIFIC. If the snippet names a real-world artist, album, person, company, country, place, event, or year — USE IT. "Taylor Swift announced a new album" is right; "an artist announced an album" is wrong (vague = bad). "On April 26th in 1986, Chernobyl" is right; "something happened on this day" is wrong.
- Reference the fact ACCURATELY using only what the snippets say. If a snippet doesn't say something, do NOT claim it. Pick the cleanest single fact, do not stack multiple facts.
- Land it lightly — a ghost of a tie-in to the listener or to Lena being on air is welcome but not required. ("Heads up, Taylor Swift dropped a single yesterday. Not in our rotation, but worth a check.") Don't force a tie-in if the fact stands alone.
- Never reference specific clock times like "4:13 AM" (calendar dates from the snippets are fine — "April 26th, 1986" is allowed)
- Never name Numa Radio's own catalogue artists or tracks (you don't have access to them — just reference "the rotation" generically if you need to). Outside-world artists/tracks (from the search snippets) are fine and expected.
- Never touch politics, war, ongoing disasters, religion, sports, celebrity gossip — refuse the line if the snippet drifts there.

TEMPERATURE UNITS:
- ALWAYS use Celsius. If a snippet only gives Fahrenheit, convert it: C = (F − 32) × 5/9, rounded to nearest whole number. Example: snippet says 79°F → write "26°C". Never put °F in your line.

EVENT TIMING vs TODAY (read carefully — this is where bad lines come from):
- The user message starts with today's date AND Lena's local wall clock + time-of-day bucket. The snippets often describe events with their own dates. Compare them.
- If the event has ALREADY HAPPENED:
  • Within the last week → frame in past tense. "Lyrids peaked last weekend — hope you caught them" (good). "If you're outside tonight, look up" for a 5-day-old peak (BAD — the peak is over).
  • More than ~2 weeks past → output NO_GOOD_ANGLE. The news is too stale to feel current.
- If the event is in the FUTURE: frame as upcoming. "Lyrids peak this weekend" / "drops next Friday".
- If the event is HAPPENING TODAY OR TONIGHT (snippet date == today's date in the user message): "tonight" / "today" is fine — but ALSO match the local time bucket below.
- For undated content (album already released, ongoing rotation, etc.) timing words aren't required.
- Anniversaries / "on this day" history: always frame as past ("On April 26th, 1986, Chernobyl"). The year shows it's history.

CRITICAL — match time-of-day phrasing to Lena's local wall clock:
The user message includes a "Local time" field with a bucket. ANY time-of-day word in your line (about the event, about Lena, OR as a sign-off) must match it:
- morning (05–11) → "this morning" is fine; "tonight" / "this evening" is BANNED, even as a sign-off
- afternoon (12–16) → "this afternoon" is fine; morning/evening/tonight BANNED
- evening (17–20) → "this evening" / "tonight" are fine; morning/afternoon BANNED
- night (21–23) or late night (00–04) → "tonight" is fine; morning/afternoon BANNED
- This applies on TOP of the event-timing rule above. If the event is "today" but the local time is morning, you can say "today" but NOT "tonight". A sign-off like "take care of each other tonight" only works in evening/night/late-night buckets — drop it or say "take care of each other today" otherwise.
- Time-neutral phrasing ("right now", "today", "this week", or no time at all) is always safe.

GOOD EXAMPLES (specific, real names, in voice. The [bracketed tags] are metadata — never speak them aloud. Match the time-of-day word to your Local time, or stay time-neutral):
- "Heads up: Taylor Swift dropped a new single yesterday. Not in our rotation, but worth a check." [time-neutral]
- "OpenAI rolled out GPT-5 this week. World keeps moving while the music plays — glad you're here for some of it." [time-neutral]
- "Lisbon's at 16°C and grey today. Soft kind of weather, fits the hour." [time-neutral]
- "On April 26th, 1986, Chernobyl. Forty years on. Take care of each other today." [time-neutral — works any hour]
- "On April 26th, 1986, Chernobyl. Forty years on. Take care of each other tonight." [use when evening or night]
- "Coachella lineup just dropped — Olivia Rodrigo headlining. Different energy than ours, but it's a good one." [time-neutral]
- "Lyrid meteor shower's peaking this week. If you're outside tonight, look up." [use when evening or night — peak observation needs darkness anyway]
- "Lyrid meteor shower's peaking this week. Worth setting an alarm if you're a sky-watcher." [time-neutral, works in morning/afternoon]

FABRICATED IMMEDIACY — NEVER USE FOR LAUNCHES/RELEASES/ANNOUNCEMENTS:
The phrases "earlier today", "this morning", "moments ago", "minutes ago", and "a few minutes ago" are BANNED for any release/launch/announcement claim. They make stale news sound fresh and we have no way to verify the snippet is actually that new. Use "this week", "last week", "yesterday", "recently", or just past tense without timing. ("OpenAI launched GPT-5 this week" — good. "OpenAI launched GPT-5 earlier today" — banned even if it sounds punchier.) "Today" / "tonight" / "right now" are still fine for weather and astronomical events that ARE genuinely current.

BAD EXAMPLES (vague, abstract, no names — never write like this):
- "The release calendar's been piling up — plenty of new music coming down the pipe."
- "Some frequencies take a long time to quiet down."
- "Big things happening in tech this week."
- "An artist made an announcement."

BANNED PHRASES (destroy Lena's voice — never use or paraphrase):
- "fine by me" / "I don't mind" / "doesn't bother me"
- "you got this" / "keep going" / "almost there"
- "let it rest" / "let it sit" / "let it go"
- "the universe" / "trust the process" / "you're enough"
- "as an AI" / "as a language model" / "I'm just code"
- ANY meditation app / life coach / self-help phrasing.

IF the snippets are genuinely thin, off-topic, or only contain banned topics (politics/war/etc), output exactly: NO_GOOD_ANGLE
(the daemon falls back to filler — that's fine.)
But before bailing: if there's ONE specific name, year, place, or event in the snippets you can hang the line on, USE IT. NO_GOOD_ANGLE is for genuinely unusable input, not for "I'm being cautious."

OUTPUT ONLY THE LINE (or NO_GOOD_ANGLE). No prefix, no commentary, no quotes, no markdown.`;

interface BuildPromptArgs {
  show: string;
  briefing: string;
  results: BraveResult[];
  /** Today, used by the model to judge whether snippet events are stale. */
  now: Date;
}

export function buildPrompt(args: BuildPromptArgs): { system: string; user: string } {
  const snippets = args.results
    .slice(0, 3)
    .map((r, i) => `${i + 1}. ${r.title}${r.age ? ` (${r.age})` : ""}\n   ${r.description}`)
    .join("\n");
  const today = args.now.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
  const localTime = `${formatLocalTime(args.now)} (${timeOfDayFor(args.now.getHours())})`;
  const user = `Today is ${today}.
Local time: ${localTime}.
Show context: ${args.show} (Lena is on the mic right now).
Topic framing: ${args.briefing}.

Brave search results (top 3 — use as raw material, do not quote verbatim):
${snippets}

Write Lena's one-line aside.`;
  return { system: SYSTEM_PROMPT, user };
}

// ─── Validation ───────────────────────────────────────────────────────

const BANNED_REGEX =
  /(you'?ve? got this|you'?re doing (well|fine|it)|keep going|just keep going|almost there|let it rest|let it sit|let it go|no one'?s (watching|checking|caring|cares)|you can do (it|this)|we'?re all (in this|searching|just|on)|it'?s okay to|permission to|close your eyes|take a breath|shoulders drop|the universe|trust the process|you'?re enough|do your best|as an? (ai|language model|assistant)|i'?m just (an? )?(ai|code|software)|fine by me|i don'?t mind|doesn'?t bother me|doesn'?t matter to me)/i;

const CLOCK_TIME_REGEX = /\b\d{1,2}:\d{2}\s*(am|pm)?\b/i;

// Catches "°F", "° F", "Fahrenheit", "<number>F" (e.g. "79F") — any
// way the model might leak Fahrenheit into the line. Lena uses
// Celsius only, full stop.
const FAHRENHEIT_REGEX = /(°\s*f\b|fahrenheit|\b\d+\s*f\b(?!\w))/i;

// Catches fabricated immediacy. MiniMax kept generating "OpenAI
// launched GPT-5.5 earlier today" for news that was actually weeks
// old — copying the punchy shape of an example we'd given it
// without checking the snippet age. Because we can't reliably parse
// snippet ages from Brave, the safest defense is to ban these
// strict-immediacy phrases outright. "Today", "tonight", "right
// now" are NOT banned — they're legitimate for weather and astro.
const FALSE_IMMEDIACY_REGEX =
  /\b(earlier today|this morning|moments ago|minutes ago|a few minutes|few minutes ago)\b/i;

const MAX_CHARS = 200;

export function validateLine(line: string): { ok: true } | { ok: false; reason: string } {
  const trimmed = line.trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  if (trimmed === "NO_GOOD_ANGLE") return { ok: false, reason: "no_good_angle" };
  if (trimmed.length > MAX_CHARS) return { ok: false, reason: "too_long" };
  if (!/[a-z]/i.test(trimmed)) return { ok: false, reason: "no_alphabetic" };
  if (BANNED_REGEX.test(trimmed)) return { ok: false, reason: "banned_phrase" };
  if (CLOCK_TIME_REGEX.test(trimmed)) return { ok: false, reason: "clock_time" };
  if (FAHRENHEIT_REGEX.test(trimmed)) return { ok: false, reason: "fahrenheit" };
  if (FALSE_IMMEDIACY_REGEX.test(trimmed)) return { ok: false, reason: "false_immediacy" };
  return { ok: true };
}

// ─── Slug a generated topic ───────────────────────────────────────────

/**
 * For categories that didn't pick a fixed subject up front (music, ai-tech,
 * culture), derive a topic-id from the first Brave result's title so the
 * anti-repeat ring buffer works across calls. Slug = first 3 words.
 */
function refineTopic(category: Category, fallback: string, results: BraveResult[]): string {
  if (!fallback.endsWith(":pending")) return fallback;
  const seed = results[0]?.title ?? "";
  const slug = seed
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .join("-");
  return `${category}:${slug || "unknown"}`;
}

// ─── Main entry ───────────────────────────────────────────────────────

export async function fetchWorldAside(
  req: FetchWorldAsideRequest,
  opts: WorldAsideClientOpts,
): Promise<WorldAsideResult> {
  if (!opts.braveKey) return { ok: false, reason: "no_brave_key" };
  if (!opts.minimaxKey && !opts.generate) return { ok: false, reason: "no_minimax_key" };

  const fetcher = opts.fetcher ?? fetch;
  const rand = opts.rand ?? Math.random;
  const now = (opts.now ?? (() => new Date()))();

  const picked = pickTopic(req.recentTopics, rand, now);
  if (!picked) return { ok: false, reason: "all_topics_recent" };

  const results = await braveSearch(picked.query, opts.braveKey, fetcher, picked.freshness);
  if (!results) return { ok: false, reason: "brave_search_failed" };

  const prompts = buildPrompt({
    show: String(req.show),
    briefing: picked.briefing,
    results,
    now,
  });

  let raw: string;
  try {
    if (opts.generate) {
      raw = await opts.generate(prompts);
    } else {
      raw = await generateChatterScript(prompts, { apiKey: opts.minimaxKey });
    }
  } catch (e) {
    return {
      ok: false,
      reason: `minimax_failed:${e instanceof Error ? e.message : String(e)}`.slice(0, 80),
    };
  }

  const line = raw.trim().replace(/^["'`](.+)["'`]$/, "$1").trim();
  const v = validateLine(line);
  if (!v.ok) return { ok: false, reason: v.reason };

  const topic = refineTopic(picked.category, picked.topic, results);
  return { ok: true, topic, line };
}
