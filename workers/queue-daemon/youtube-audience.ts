/**
 * Fetches the dashboard's YouTube broadcast snapshot over loopback.
 * The dashboard already in-process caches the YouTube API call for 30s,
 * so this is effectively free — no extra YouTube API quota burn.
 *
 * Returns null on any failure (network, non-2xx, malformed JSON). Callers
 * MUST treat null as "unknown audience" — the gate then ignores YouTube
 * and uses pure icecast count.
 *
 * Cloudflare Access auth applies at the CF edge, never on loopback, so
 * 127.0.0.1 fetches succeed without credentials.
 */

export type YoutubeAudience = {
  /** "live" | "ready" | "off" | "error" — only "live" triggers the
   *  encoder-subtraction in callers. */
  state: string;
  /** Concurrent YouTube viewers (0 if YouTube doesn't expose it). */
  viewers: number;
};

export interface FetchYoutubeAudienceOpts {
  url: string;
  timeoutMs?: number;
  /** Inject a mock fetch in tests; defaults to global fetch. */
  fetcher?: typeof fetch;
}

/** Pure parser, separated for direct unit testing. */
export function parseYoutubeAudience(raw: unknown): YoutubeAudience | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as { state?: unknown; concurrentViewers?: unknown };
  const state = typeof obj.state === "string" ? obj.state : "off";
  const viewers =
    typeof obj.concurrentViewers === "number" ? obj.concurrentViewers : 0;
  return { state, viewers };
}

export async function fetchYoutubeAudience(
  opts: FetchYoutubeAudienceOpts,
): Promise<YoutubeAudience | null> {
  const fetcher = opts.fetcher ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 2_000;
  try {
    const r = await fetcher(opts.url, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return null;
    const json = await r.json();
    return parseYoutubeAudience(json);
  } catch {
    return null;
  }
}
