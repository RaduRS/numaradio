/**
 * OpenRouter image generation — adapted from workers/song-worker/openrouter.ts
 * but kept local so the dashboard doesn't import from the workers dir (which
 * carries its own runtime + deps). Same wire format, same parser.
 */
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const IMAGE_MODEL =
  process.env.OPENROUTER_IMAGE_MODEL ?? "black-forest-labs/flux.2-pro";

export interface OpenRouterImageResponse {
  choices?: Array<{
    message?: {
      content?: string;
      images?: Array<{
        image_url?: { url?: string };
      }>;
    };
  }>;
}

const DATA_URI_RE = /^data:image\/\w+;base64,(.+)$/;

function apiKey(): string {
  const k = process.env.OPEN_ROUTER_API;
  if (!k) throw new Error("OPEN_ROUTER_API not set");
  return k;
}

export function extractPngBase64(resp: OpenRouterImageResponse): string | null {
  const choice = resp.choices?.[0];
  const images = choice?.message?.images ?? [];
  for (const img of images) {
    const url = img.image_url?.url;
    if (!url) continue;
    const m = url.match(DATA_URI_RE);
    if (m) return m[1];
    if (url.startsWith("http")) {
      return `__REMOTE__:${url}`;
    }
  }
  const content = choice?.message?.content?.trim();
  if (content && /^[A-Za-z0-9+/=\n\r]+$/.test(content) && content.length > 200) {
    return content.replace(/\s+/g, "");
  }
  return null;
}

/**
 * Generate album cover art via FLUX Pro on OpenRouter.
 * Returns the raw image buffer (PNG/JPEG depending on model output).
 *
 * Prompt strategy: the original wrapper led with "Album cover artwork"
 * which is itself a typography trigger — Flux's training set heavily
 * associates "album cover" with written titles + band names, so even
 * "no text whatsoever" downstream got under-weighted. The new wrapper:
 *   1. Avoids the "album cover" phrase entirely
 *   2. Front-loads the no-text constraint AND repeats it at the end
 *   3. Spells out specific forbidden surfaces (signage, license plates,
 *      tattoos, books, posters, screens) where Flux often sneaks text in
 */
export async function generateArtwork(prompt: string): Promise<Buffer> {
  const wrapped = [
    "Wordless painterly square 1:1 illustration, full bleed, edge to edge.",
    "ABSOLUTELY NO TEXT — no letters, no words, no numbers, no captions, no titles, no band names, no song names, no signage, no logos, no watermarks, no typography, no calligraphy, no writing of any kind anywhere in the image.",
    "NO BORDERS — no white frame, no black frame, no coloured matte, no margins, no album-cover-style packaging. The artwork fills the entire square canvas to all four edges.",
    "Avoid surfaces that typically carry text: no readable book covers, no license plates, no shop signs, no posters, no phone screens, no t-shirts with print, no graffiti, no street signs.",
    `Scene: ${prompt}`,
    "Cinematic, atmospheric, rich painterly brushwork.",
    "FINAL CHECK: the rendered image must contain ZERO written language or symbols, and ZERO border/frame/matte. If you start to draw any letter shape, stop and replace it with abstract texture. If you start to draw a frame, extend the scene to the canvas edge instead.",
  ].join(" ");

  console.log(`[artwork-flux] prompt (${wrapped.length} chars): ${wrapped.slice(0, 600)}${wrapped.length > 600 ? "…" : ""}`);

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://numaradio.com",
      "X-Title": "Numa Radio Dashboard",
    },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      modalities: ["image"],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: wrapped,
            },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`openrouter ${res.status}: ${detail.slice(0, 400)}`);
  }

  const data = (await res.json()) as OpenRouterImageResponse;
  const extracted = extractPngBase64(data);
  if (!extracted) {
    throw new Error("openrouter: no image in response");
  }
  if (extracted.startsWith("__REMOTE__:")) {
    const url = extracted.slice("__REMOTE__:".length);
    const imgRes = await fetch(url);
    if (!imgRes.ok) {
      throw new Error(`openrouter remote image fetch ${imgRes.status}`);
    }
    return Buffer.from(await imgRes.arrayBuffer());
  }
  return Buffer.from(extracted, "base64");
}
