export interface IcecastStatus {
  mount: string | null;
  listeners: number | null;
  listenerPeak: number | null;
  bitrate: number | null;
  nowPlaying: { artist: string | null; title: string } | null;
}

interface IcecastSource {
  listenurl?: string;
  listeners?: number;
  listener_peak?: number;
  bitrate?: number;
  title?: string;
}

function mountFromListenUrl(listenurl: string | undefined): string | null {
  if (!listenurl) return null;
  try {
    const u = new URL(listenurl);
    return u.pathname || null;
  } catch {
    return null;
  }
}

function splitTitle(title: string): { artist: string | null; title: string } | null {
  const t = (title || "").trim();
  if (!t) return null;
  const dashIdx = t.indexOf(" - ");
  if (dashIdx > 0) {
    return { artist: t.slice(0, dashIdx).trim(), title: t.slice(dashIdx + 3).trim() };
  }
  return { artist: null, title: t };
}

export function parseIcecastStatus(raw: unknown, wantMount: string): IcecastStatus {
  const empty: IcecastStatus = {
    mount: null,
    listeners: null,
    listenerPeak: null,
    bitrate: null,
    nowPlaying: null,
  };
  if (!raw || typeof raw !== "object") return empty;
  const icestats = (raw as { icestats?: { source?: IcecastSource | IcecastSource[] } }).icestats;
  const src = icestats?.source;
  if (!src) return empty;
  const sources = Array.isArray(src) ? src : [src];
  const match = sources.find((s) => mountFromListenUrl(s.listenurl) === wantMount);
  if (!match) return empty;
  return {
    mount: wantMount,
    listeners: typeof match.listeners === "number" ? match.listeners : null,
    listenerPeak: typeof match.listener_peak === "number" ? match.listener_peak : null,
    bitrate: typeof match.bitrate === "number" ? match.bitrate : null,
    nowPlaying: splitTitle(match.title ?? ""),
  };
}

export async function fetchIcecastStatus(
  url: string,
  mount: string,
  timeoutMs = 2_000,
): Promise<IcecastStatus> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return parseIcecastStatus(json, mount);
  } finally {
    clearTimeout(t);
  }
}
