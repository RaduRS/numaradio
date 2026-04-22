const MINIMAX_CHAT_URL = "https://api.minimax.io/anthropic/v1/messages";
const MODEL = process.env.MINIMAX_MODERATION_MODEL ?? "MiniMax-M2.7";

export interface PromptExpansion {
  title: string;
  artworkPrompt: string;
  lyrics?: string;
}

export interface ExpandOptions {
  withLyrics: boolean;
}

const TITLE_MAX = 50;
const ARTWORK_MAX = 280;
// Tight 400-char cap gave us 55-60s songs because MiniMax music-2.6
// sizes the track by lyrics length. 1500 comfortably fits a full
// verse/chorus/verse/chorus/bridge/chorus structure for a 2-3 min song.
const LYRICS_MAX = 1500;

export function buildPromptExpansionSystem(opts: ExpandOptions): string {
  const lines: string[] = [
    "You turn a listener's short song prompt into release metadata for an online radio station.",
    "",
    "Return a SINGLE minified JSON object with these fields:",
    '  "title": a short, evocative song title (<= 50 chars, no quotes, title case)',
    '  "artworkPrompt": a painterly prompt for an album cover image generator (<= 280 chars, no text-on-image, no logos, tasteful)',
  ];
  if (opts.withLyrics) {
    lines.push(
      '  "lyrics": full-length lyrics for a 2-3 minute song. 16-24 lines total, <= 1500 chars. Structure MUST include [verse 1] (4 lines), [chorus] (4 lines), [verse 2] (4 lines), [chorus] (4 lines), [bridge] (2-4 lines), [chorus] (4 lines). Write ALL sections explicitly — do not abbreviate "chorus repeats" or use a single [chorus] tag; MiniMax music-2.6 sizes the song by the lyrics text length, so shorter lyrics = shorter song. The listener did NOT write these; you do, guided by the prompt\'s vibe. Keep it clean — no profanity, slurs, or references to real public figures.',
    );
  }
  lines.push(
    "",
    "Do not include any text outside the JSON object. No code fences.",
  );
  return lines.join("\n");
}

export function parsePromptExpansion(
  raw: string,
  opts: ExpandOptions,
): PromptExpansion | null {
  const stripped = raw
    .replace(/```(?:json)?\s*/gi, "")
    .replace(/```/g, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    parsed = null;
  }
  if (!parsed) {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        parsed = JSON.parse(stripped.slice(start, end + 1));
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }
  const obj = parsed as Record<string, unknown>;
  const title = typeof obj.title === "string" ? obj.title.trim() : "";
  const artworkPrompt =
    typeof obj.artworkPrompt === "string" ? obj.artworkPrompt.trim() : "";
  if (!title || !artworkPrompt) return null;
  const result: PromptExpansion = {
    title: title.slice(0, TITLE_MAX),
    artworkPrompt: artworkPrompt.slice(0, ARTWORK_MAX),
  };
  if (opts.withLyrics && typeof obj.lyrics === "string" && obj.lyrics.trim()) {
    result.lyrics = obj.lyrics.trim().slice(0, LYRICS_MAX);
  }
  return result;
}

function apiKey(): string {
  const k = process.env.MINIMAX_API_KEY;
  if (!k) throw new Error("MINIMAX_API_KEY not set");
  return k;
}

export async function expandPrompt(
  listenerPrompt: string,
  opts: ExpandOptions,
): Promise<PromptExpansion | null> {
  const res = await fetch(MINIMAX_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      // MiniMax-M2.7 is a reasoning model that emits a `thinking` block
      // before `text` (same pattern as Claude extended thinking). 700 was
      // enough for short lyrics but truncates full-song lyrics — bumped so
      // thinking prelude + ~1500 chars of lyrics + title + artworkPrompt
      // all fit.
      max_tokens: 3000,
      system: buildPromptExpansionSystem(opts),
      messages: [{ role: "user", content: listenerPrompt }],
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const textBlock =
    data.content?.find((b) => b.type === "text" && b.text)?.text ?? "";
  return parsePromptExpansion(textBlock, opts);
}
