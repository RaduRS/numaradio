const DEEPGRAM_URL = "https://api.deepgram.com/v1/speak";
const MODEL_PRIMARY = "aura-2-andromeda-en";
const MODEL_FALLBACK = "aura-asteria-en";

export interface SynthOpts {
  apiKey: string;
  fetcher?: typeof fetch;
}

async function callDeepgram(
  text: string,
  model: string,
  apiKey: string,
  fetcher: typeof fetch,
): Promise<Response> {
  return fetcher(`${DEEPGRAM_URL}?model=${model}&encoding=mp3`, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });
}

export async function synthesizeChatter(
  text: string,
  opts: SynthOpts,
): Promise<Buffer> {
  if (!opts.apiKey) throw new Error("DEEPGRAM_API_KEY is not set");
  if (!text.trim()) throw new Error("empty text");
  const fetcher = opts.fetcher ?? fetch;

  let res = await callDeepgram(text, MODEL_PRIMARY, opts.apiKey, fetcher);
  if (!res.ok && [400, 404, 422].includes(res.status)) {
    res = await callDeepgram(text, MODEL_FALLBACK, opts.apiKey, fetcher);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`deepgram ${res.status}: ${detail.slice(0, 120)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
