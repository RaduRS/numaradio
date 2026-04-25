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

function apiKey(): string {
  const k = process.env.OPEN_ROUTER_API;
  if (!k) throw new Error("OPEN_ROUTER_API not set");
  return k;
}

const DATA_URI_RE = /^data:image\/\w+;base64,(.+)$/;

// Reject URLs whose hostname resolves to localhost or an RFC 1918 /
// link-local range. Defense-in-depth against a compromised or rogue
// upstream serving an internal URL that would otherwise be fetched
// from inside the mini-server's network.
function isPrivateOrLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]") return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true; // link-local
  if (/^(fc|fd)/.test(h)) return true; // IPv6 ULA
  if (h.startsWith("fe80:")) return true; // IPv6 link-local
  return false;
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

export async function generateArtwork(prompt: string): Promise<Buffer> {
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://numaradio.com",
      "X-Title": "Numa Radio",
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
              text: `Album cover artwork, 1024x1024, no text, no logos, tasteful, painterly. Prompt: ${prompt}`,
            },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
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
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("openrouter remote image: invalid URL");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error(`openrouter remote image: unsupported protocol ${parsed.protocol}`);
    }
    if (isPrivateOrLocalHost(parsed.hostname)) {
      throw new Error(`openrouter remote image: refusing private host ${parsed.hostname}`);
    }
    const imgRes = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!imgRes.ok) {
      throw new Error(`openrouter remote image fetch ${imgRes.status}`);
    }
    return Buffer.from(await imgRes.arrayBuffer());
  }
  return Buffer.from(extracted, "base64");
}
