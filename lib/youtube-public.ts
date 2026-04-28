// Lightweight YouTube broadcast-state probe for the PUBLIC site (this
// is a leaner cousin of the dashboard's lib/youtube.ts — it only
// returns the state + watch URL, not health/title/viewers, since
// homepage visitors don't need the operator-grade detail).
//
// Used by /api/youtube/state to power the "live on YouTube" banner.
// Same OAuth refresh-token flow, in-process cache to keep quota tame
// (~1u per snapshot, 60s cache → 1,440u/day even with constant
// homepage traffic).

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://www.googleapis.com/youtube/v3";
const CACHE_TTL_MS = 60_000;

export interface PublicYoutubeState {
  /** "live" → on YouTube right now (show the banner).
   *  "off" → no banner.
   *  "error" → silent fail, no banner. Errors are logged. */
  state: "live" | "off" | "error";
  /** youtube.com watch URL — only when state === "live". */
  watchUrl: string | null;
  /** ISO timestamp of the snapshot. */
  fetchedAt: string;
}

let cached: { state: PublicYoutubeState; at: number } | null = null;
let accessToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (accessToken && accessToken.expiresAt > Date.now() + 30_000) {
    return accessToken.token;
  }
  const clientId = process.env.YOUTUBE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.YOUTUBE_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("missing YOUTUBE_OAUTH_* env");
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`oauth refresh ${r.status}`);
  const j = (await r.json()) as { access_token?: string; expires_in?: number };
  if (!j.access_token) throw new Error("oauth: no access_token");
  accessToken = {
    token: j.access_token,
    expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000,
  };
  return accessToken.token;
}

interface BroadcastsListItem {
  id: string;
}

export async function fetchPublicYoutubeState(): Promise<PublicYoutubeState> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.state;
  }
  let state: PublicYoutubeState;
  try {
    const token = await getAccessToken();
    const url = new URL(`${API_BASE}/liveBroadcasts`);
    url.searchParams.set("part", "id");
    url.searchParams.set("broadcastStatus", "active");
    url.searchParams.set("maxResults", "1");
    const r = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!r.ok) throw new Error(`youtube ${r.status}`);
    const j = (await r.json()) as { items?: BroadcastsListItem[] };
    const active = j.items?.[0];
    state = {
      state: active ? "live" : "off",
      watchUrl: active ? `https://www.youtube.com/watch?v=${active.id}` : null,
      fetchedAt: new Date().toISOString(),
    };
  } catch (e) {
    // Silent fail — the banner just won't show. We don't want
    // homepage visitors seeing an error state for a nice-to-have.
    console.warn("[yt-public-state]", e instanceof Error ? e.message : "unknown");
    state = {
      state: "error",
      watchUrl: null,
      fetchedAt: new Date().toISOString(),
    };
  }
  cached = { state, at: Date.now() };
  return state;
}
