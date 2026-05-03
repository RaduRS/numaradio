// Translates a track's metadata into a vivid visual scene description
// for the Flux artwork generator. The point: pass thematic INTENT to
// the model without ever feeding it the literal title string, which
// Flux sometimes renders as on-image text no matter how aggressively
// the negative prompt forbids typography.
//
// Fail-soft: returns null on any error. Caller falls back to the bare
// mood + genre + show concatenation.

const MINIMAX_URL = "https://api.minimax.io/anthropic/v1/messages";
const MODEL = process.env.MINIMAX_ARTWORK_PROMPT_MODEL ?? "MiniMax-M2.7";
const TIMEOUT_MS = 15_000;

const SYSTEM_PROMPT = `You translate music metadata into a vivid concrete visual scene description for an album cover artwork generator.

OUTPUT: ONE paragraph, 25-60 words, describing a single visual scene for a square 1:1 album cover. Be specific and evocative — concrete objects, lighting, colour palette, composition.

STRICT RULES:
- NO titles, NO lyrics, NO proper nouns, NO band or artist names, NO quoted strings of any kind.
- The cover will have NO typography. Do NOT describe text, letters, signage, watermarks, captions.
- Do NOT name the genre in the scene (avoid "punk-style", "indie aesthetic"); translate the genre into visual feel only.
- Do NOT echo the title back. Use it only as thematic inspiration; render the IDEA, not the WORDS.

Output ONLY the scene description. No labels, no preamble, no explanation, no quotes wrapping the answer.

Example input:
title: My Beautiful Disaster
mood: confessional, raw
genre: Pop Punk, Indie Rock
time-of-day feel: evening, vivid sunset/dusk, electric, celebratory

Example output:
Shattered storefront window at dusk, electric pink glass fragments scattered across rain-soaked pavement reflecting purple sunset sky, lone figure in a leather jacket walking away from frame centre, cinematic deep focus, painterly brush texture, warm coral highlights bleeding into deep violet shadows.`;

export interface ArtworkPromptInput {
  title?: string | null;
  description?: string | null;
  mood?: string | null;
  genre?: string | null;
  showHint?: string | null;
  operatorNote?: string | null;
}

interface MinimaxText { type: "text"; text: string }
interface MinimaxThinking { type: "thinking"; thinking?: string }
interface MinimaxResponse { content?: Array<MinimaxText | MinimaxThinking> }

function buildUserMessage(input: ArtworkPromptInput): string {
  const parts: string[] = [];
  if (input.title) parts.push(`title: ${input.title.slice(0, 120)}`);
  if (input.description) parts.push(`mood: ${input.description.slice(0, 240)}`);
  else if (input.mood) parts.push(`mood: ${input.mood.slice(0, 240)}`);
  if (input.genre) parts.push(`genre: ${input.genre.slice(0, 120)}`);
  if (input.showHint) parts.push(`time-of-day feel: ${input.showHint.slice(0, 200)}`);
  if (input.operatorNote) parts.push(`operator note: ${input.operatorNote.slice(0, 240)}`);
  return parts.join("\n");
}

/** Heuristic: reject responses that look like the model leaked the title
 *  back, contains URLs/markdown/labels, or is too short/long to be useful. */
function looksUsable(scene: string, originalTitle: string | null | undefined): boolean {
  const trimmed = scene.trim();
  if (trimmed.length < 30 || trimmed.length > 600) return false;
  if (/https?:\/\//i.test(trimmed)) return false;
  if (/^scene:|^output:|^description:/i.test(trimmed)) return false;
  // Verbatim title leak — case-insensitive containment of the full title
  // (when long enough to be a meaningful match, ≥4 chars).
  if (originalTitle && originalTitle.trim().length >= 4) {
    const t = originalTitle.trim().toLowerCase();
    if (trimmed.toLowerCase().includes(t)) return false;
  }
  return true;
}

export async function generateArtworkScene(
  input: ArtworkPromptInput,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) return null;

  const userMessage = buildUserMessage(input);
  if (!userMessage) return null;

  let res: Response;
  try {
    res = await fetcher(MINIMAX_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 800,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return null;
  }

  if (!res.ok) return null;

  let json: MinimaxResponse;
  try {
    json = (await res.json()) as MinimaxResponse;
  } catch {
    return null;
  }

  const textBlock = json.content?.find((b): b is MinimaxText => b.type === "text");
  const scene = textBlock?.text?.trim();
  if (!scene) return null;
  if (!looksUsable(scene, input.title)) return null;
  return scene;
}
