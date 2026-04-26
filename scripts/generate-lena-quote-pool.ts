import "../lib/load-env";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { ShowBlock } from "@prisma/client";

// Generates the public-site Lena quote pool. ~150 evergreen lines per
// show, one MiniMax call per show using a batched-output prompt (one
// quote per line) rather than 150 single-line calls. Idempotent —
// shows whose JSON already has >= 150 entries are skipped.
//
// Output: patterns/lena-quotes/<show>.json   (string[])
//
// Run:
//   npx tsx scripts/generate-lena-quote-pool.ts            # all 4 shows
//   npx tsx scripts/generate-lena-quote-pool.ts night_shift  # one show

const MINIMAX_URL = "https://api.minimax.io/anthropic/v1/messages";
const MODEL = process.env.MINIMAX_HUMANIZE_MODEL ?? "MiniMax-M2.7";
const QUOTES_PER_SHOW = 150;
const POOL_DIR = resolve(process.cwd(), "patterns", "lena-quotes");

const SHOW_VOICES: Record<ShowBlock, { name: string; window: string; vibe: string; tone: string; examples: string }> = {
  night_shift: {
    name: "Night Shift",
    window: "midnight to 5 AM",
    vibe: "intimate, hypnotic, breathy. Late-night confidant. Speaks softly to whoever is still awake.",
    tone: "Reflective. Often a little melancholy. Doesn't try to lift the room — leans into the hour.",
    examples: `"It's quiet here, the way I like it."
"Whoever's still up — hi. Glad you're with me."
"Three AM has its own gravity. We're just floating in it."
"This is the part of the day where the city hums to itself."`,
  },
  morning_room: {
    name: "Morning Room",
    window: "5 AM to 10 AM",
    vibe: "warm, observational, gentle. First-coffee energy. Like talking to someone over their kitchen window.",
    tone: "Hopeful but unhurried. Notices small things — light through curtains, the kettle settling.",
    examples: `"Pour something warm. Let's start slow."
"Light's good today. I'm noticing it for both of us."
"Some songs feel like they were written for the first hour of being awake."
"Whatever you've got planned — sit with one more song first."`,
  },
  daylight_channel: {
    name: "Daylight Channel",
    window: "10 AM to 5 PM",
    vibe: "composed, cohesive, calm. Steady focus companion. Like a friend at the next desk who only talks when needed.",
    tone: "Settled, level, easy. Stays out of the listener's way most of the time. When she speaks, it's grounded.",
    examples: `"Working through it with you."
"This stretch is for finishing something. Take it as long as you need."
"Found a groove I didn't want to interrupt. Keeping it going."
"You're doing fine. Keep moving."`,
  },
  prime_hours: {
    name: "Prime Hours",
    window: "5 PM to midnight",
    vibe: "charged, playful, sharper. Dinner-to-late energy. Sees the room.",
    tone: "Confident, a little knowing. Self-aware without trying too hard. Calls the moment out.",
    examples: `"Something's about to happen tonight. Stick around."
"Wherever you are right now — I see you. The wall is open."
"The good stuff plays at this hour. You'll know."
"Tonight feels like it has shoulders. Let it."`,
  },
};

interface AnthropicContent { type: string; text?: string }
interface AnthropicResponse { content?: AnthropicContent[] }

function buildSystem(show: ShowBlock): string {
  const v = SHOW_VOICES[show];
  return `You are Lena, the AI host of Numa Radio's ${v.name} (${v.window}).

Voice: ${v.vibe}

Tone: ${v.tone}

Examples of the vibe:
${v.examples}

You're writing evergreen one-line "host moments" — short asides Lena might drop on the air to a single listener tuned in. They will be displayed as text on numaradio.com between tracks, replacing a static host quote.

HARD RULES:
- 1 to 3 sentences per quote, max ~280 characters
- No real artist names, no band names, no specific track titles
- No specific track or song references — these are evergreen
- No specific clock times ("4:13 AM" — bad). Soft references to time-of-day are OK ("the late hour", "the first hour").
- Direct address to the listener ("you", "we") is encouraged
- Conversational, broadcast-style — never read like marketing copy
- No hashtags, no emoji, no quotation marks, no numbering
- Each line stands on its own — no continuation between lines
- Mood matches the show's vibe at all times — never break character

OUTPUT FORMAT:
- Exactly ${QUOTES_PER_SHOW} lines
- One quote per line, blank lines between them
- No prefix, no numbering, no commentary
- Just the ${QUOTES_PER_SHOW} quotes, separated by blank lines`;
}

const USER = `Generate ${QUOTES_PER_SHOW} evergreen Lena quotes following the rules. Output one per line, blank lines between them. No commentary. Begin now.`;

interface BatchResult {
  quotes: string[];
  rawLength: number;
}

async function callMiniMax(system: string, apiKey: string): Promise<string> {
  const res = await fetch(MINIMAX_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 32_000,
      temperature: 1.0,
      system,
      messages: [{ role: "user", content: USER }],
    }),
  });
  if (!res.ok) throw new Error(`minimax http ${res.status}: ${await res.text().catch(() => "")}`.slice(0, 400));
  const data = (await res.json()) as AnthropicResponse;
  const raw = data.content?.find((b) => b.type === "text" && b.text)?.text ?? "";
  return raw;
}

function parseBatch(raw: string): BatchResult {
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  // Strip leading numbering ("1.", "2)", "- ") and surrounding quotes/dashes
  const cleaned = lines
    .map((l) => l.replace(/^\s*(?:[-–—•]|\d+[.)])\s*/, ""))
    .map((l) => l.replace(/^["'“]+|["'”]+$/g, ""))
    .filter((l) => l.length > 0);
  // Drop "Here are…" preambles or any line that looks like commentary
  const quotes = cleaned.filter(
    (l) =>
      !/^(here|sure|okay|ok|generated|output)/i.test(l) &&
      l.length > 8 &&
      l.length <= 320,
  );
  return { quotes, rawLength: raw.length };
}

async function generateForShow(show: ShowBlock, apiKey: string): Promise<string[]> {
  if (!existsSync(POOL_DIR)) mkdirSync(POOL_DIR, { recursive: true });
  const out = resolve(POOL_DIR, `${show.replace(/_/g, "-")}.json`);
  if (existsSync(out)) {
    try {
      const existing = JSON.parse(readFileSync(out, "utf-8")) as string[];
      if (Array.isArray(existing) && existing.length >= QUOTES_PER_SHOW) {
        console.log(`  ✓ ${show} already has ${existing.length} quotes, skipping`);
        return existing;
      }
    } catch { /* fall through to regenerate */ }
  }

  const collected: string[] = [];
  let attempt = 0;
  while (collected.length < QUOTES_PER_SHOW && attempt < 4) {
    attempt++;
    process.stdout.write(`  ${show} attempt ${attempt} (have ${collected.length}/${QUOTES_PER_SHOW})... `);
    try {
      const raw = await callMiniMax(buildSystem(show), apiKey);
      const { quotes, rawLength } = parseBatch(raw);
      console.log(`raw ${rawLength}b → ${quotes.length} quotes`);
      // Dedupe across attempts (case-insensitive prefix match)
      const seen = new Set(collected.map((q) => q.toLowerCase().slice(0, 40)));
      for (const q of quotes) {
        const key = q.toLowerCase().slice(0, 40);
        if (!seen.has(key)) {
          collected.push(q);
          seen.add(key);
        }
        if (collected.length >= QUOTES_PER_SHOW) break;
      }
    } catch (e) {
      console.log(`fail: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (collected.length < QUOTES_PER_SHOW) {
    console.warn(`  ⚠ ${show}: stopped at ${collected.length}/${QUOTES_PER_SHOW} after ${attempt} attempts`);
  }
  writeFileSync(out, JSON.stringify(collected, null, 2));
  console.log(`  ✓ wrote ${out} (${collected.length} quotes)`);
  return collected;
}

async function main() {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) throw new Error("MINIMAX_API_KEY not set in .env.local");

  const arg = process.argv[2] as ShowBlock | undefined;
  const shows: ShowBlock[] = arg
    ? [arg]
    : ["night_shift", "morning_room", "daylight_channel", "prime_hours"];

  console.log(`Generating ${QUOTES_PER_SHOW} quotes per show for: ${shows.join(", ")}\n`);
  for (const show of shows) {
    await generateForShow(show, apiKey);
  }
  console.log("\n✓ All pools written to patterns/lena-quotes/");
}

main().catch((e) => { console.error(e); process.exit(1); });
