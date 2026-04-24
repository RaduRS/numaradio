interface IcecastSource {
  listenurl?: string;
  listeners?: number;
}

/**
 * Parse the raw listener count for a specific mount from Icecast's
 * status-json.xsl payload. Returns null if the mount isn't present or
 * the count isn't a number — caller treats null as "unknown" and, in
 * `auto` mode, skips the break (fail-closed).
 *
 * This is the RAW count — never the +15 marketing boost used on the
 * public hero. Operational decisions must be based on real listeners.
 */
export function parseListenerCount(raw: unknown, wantMount: string): number | null {
  if (!raw || typeof raw !== "object") return null;
  const icestats = (raw as { icestats?: { source?: IcecastSource | IcecastSource[] } }).icestats;
  const src = icestats?.source;
  if (!src) return null;
  const sources = Array.isArray(src) ? src : [src];
  const match = sources.find((s) => {
    if (!s.listenurl) return false;
    try {
      return new URL(s.listenurl).pathname === wantMount;
    } catch {
      return false;
    }
  });
  if (!match) return null;
  return typeof match.listeners === "number" ? match.listeners : null;
}

export interface FetchListenersOpts {
  url: string;
  mount: string;
  timeoutMs?: number;
}

/**
 * Fetch the raw listener count from Icecast. Returns null on any error
 * (network, non-2xx, parse failure, missing mount). Callers MUST treat
 * null as "unknown" — in `auto` mode that means skip the break.
 */
export async function fetchListenerCount(opts: FetchListenersOpts): Promise<number | null> {
  const timeoutMs = opts.timeoutMs ?? 2_000;
  try {
    const res = await fetch(opts.url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const json = await res.json();
    return parseListenerCount(json, opts.mount);
  } catch {
    return null;
  }
}
