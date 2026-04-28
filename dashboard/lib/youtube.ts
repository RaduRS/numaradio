// YouTube Data API v3 client for the dashboard's broadcast health tile.
//
// Auth: OAuth 2.0 with the youtube.readonly scope. We hold a refresh
// token in env and exchange it for a short-lived access token on demand.
// The refresh token is acquired once (see HANDOFF.md "PR 3 — YouTube
// dashboard health" runbook) and never expires unless the user revokes
// access in Google Account settings.
//
// Quota cost per snapshot:
//   liveBroadcasts.list  → 1 unit (find current active broadcast)
//   liveStreams.list     → 1 unit (stream health: good/ok/bad/noData)
//   videos.list          → 1 unit (concurrent viewers)
// Total: 3 units per refresh. At 60s polling that's 4,320/day — well
// under the 10k default quota.
//
// Caching: in-process 30s TTL so the dashboard's 30s polling doesn't
// also burn API quota (it's a 1:1 already, but if multiple operators
// open the dashboard at once we don't multiply the cost).

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://www.googleapis.com/youtube/v3";
const CACHE_TTL_MS = 30_000;

export interface YoutubeBroadcastSnapshot {
  /** "live" → broadcast is currently airing on YouTube.
   *  "ready" → stream is configured but not started.
   *  "off" → no active or scheduled broadcast.
   *  "error" → API failed; see error field. */
  state: "live" | "ready" | "off" | "error";
  /** Stream-health classification from YouTube ingest:
   *    good   — receiving stream, no problems
   *    ok     — minor problems
   *    bad    — significant problems (likely viewer-visible)
   *    noData — YouTube isn't seeing any frames (encoder offline)
   *  Null when no live broadcast is active. */
  health: "good" | "ok" | "bad" | "noData" | null;
  /** Realtime viewer count. Null when broadcast not live or YouTube
   *  is suppressing the count (it does this for very low values). */
  concurrentViewers: number | null;
  /** YouTube video ID of the active broadcast — usable to build the
   *  watch URL. Null when nothing live. */
  videoId: string | null;
  /** Operator-set title of the broadcast. */
  title: string | null;
  /** ISO timestamp of the snapshot. */
  fetchedAt: string;
  /** Set when state === "error". */
  error?: string;
}

let cached: { snap: YoutubeBroadcastSnapshot; at: number } | null = null;
let accessToken: { token: string; expiresAt: number } | null = null;

function nowMs(): number {
  return Date.now();
}

function snapError(message: string): YoutubeBroadcastSnapshot {
  return {
    state: "error",
    health: null,
    concurrentViewers: null,
    videoId: null,
    title: null,
    fetchedAt: new Date().toISOString(),
    error: message,
  };
}

async function getAccessToken(): Promise<string> {
  if (accessToken && accessToken.expiresAt > nowMs() + 30_000) {
    return accessToken.token;
  }
  const clientId = process.env.YOUTUBE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.YOUTUBE_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "missing YOUTUBE_OAUTH_CLIENT_ID / _SECRET / _REFRESH_TOKEN env",
    );
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
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`oauth refresh failed (${r.status}): ${text.slice(0, 200)}`);
  }
  const j = (await r.json()) as { access_token?: string; expires_in?: number };
  if (!j.access_token) throw new Error("oauth refresh: no access_token in response");
  accessToken = {
    token: j.access_token,
    expiresAt: nowMs() + (j.expires_in ?? 3600) * 1000,
  };
  return accessToken.token;
}

async function api<T>(
  path: string,
  params: Record<string, string>,
  token: string,
): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`youtube api ${path} ${r.status}: ${text.slice(0, 200)}`);
  }
  return (await r.json()) as T;
}

interface BroadcastsListItem {
  id: string;
  snippet?: { title?: string };
  contentDetails?: { boundStreamId?: string };
  status?: {
    lifeCycleStatus?:
      | "created"
      | "ready"
      | "testing"
      | "live"
      | "complete"
      | "revoked"
      | "testStarting"
      | "liveStarting";
  };
}
interface StreamsListItem {
  id: string;
  status?: {
    streamStatus?: "active" | "inactive" | "ready" | "created" | "error";
    healthStatus?: {
      status?: "good" | "ok" | "bad" | "noData";
    };
  };
}
interface VideosListItem {
  id: string;
  liveStreamingDetails?: {
    concurrentViewers?: string;
    actualStartTime?: string;
  };
}

export async function fetchYoutubeSnapshot(
  options: { fresh?: boolean } = {},
): Promise<YoutubeBroadcastSnapshot> {
  if (!options.fresh && cached && nowMs() - cached.at < CACHE_TTL_MS) {
    return cached.snap;
  }
  let snap: YoutubeBroadcastSnapshot;
  try {
    const token = await getAccessToken();

    // 1. Find the active broadcast on this channel. broadcastStatus=active
    //    only returns currently-live broadcasts. The OAuth token already
    //    scopes to the authorized account's channel — and the API
    //    explicitly rejects `mine=true` combined with broadcastStatus.
    const broadcasts = await api<{ items?: BroadcastsListItem[] }>(
      "/liveBroadcasts",
      {
        part: "id,snippet,status,contentDetails",
        broadcastStatus: "active",
        maxResults: "1",
      },
      token,
    );
    const active = broadcasts.items?.[0];

    if (!active) {
      // Nothing live right now. Check for a scheduled (ready) one so we
      // can show "READY" instead of "OFF" when the operator has a
      // broadcast queued up.
      const upcoming = await api<{ items?: BroadcastsListItem[] }>(
        "/liveBroadcasts",
        {
          part: "id,snippet,status",
          broadcastStatus: "upcoming",
          maxResults: "1",
        },
        token,
      );
      const next = upcoming.items?.[0];
      snap = {
        state: next ? "ready" : "off",
        health: null,
        concurrentViewers: null,
        videoId: next?.id ?? null,
        title: next?.snippet?.title ?? null,
        fetchedAt: new Date().toISOString(),
      };
    } else {
      const streamId = active.contentDetails?.boundStreamId;
      const videoId = active.id;
      const title = active.snippet?.title ?? null;

      // 2. Stream health (only when we have a bound stream).
      let health: YoutubeBroadcastSnapshot["health"] = null;
      if (streamId) {
        const streams = await api<{ items?: StreamsListItem[] }>(
          "/liveStreams",
          { part: "id,status", id: streamId },
          token,
        );
        health = streams.items?.[0]?.status?.healthStatus?.status ?? null;
      }

      // 3. Concurrent viewers.
      let concurrentViewers: number | null = null;
      const videos = await api<{ items?: VideosListItem[] }>(
        "/videos",
        { part: "liveStreamingDetails", id: videoId },
        token,
      );
      const viewersRaw = videos.items?.[0]?.liveStreamingDetails?.concurrentViewers;
      if (viewersRaw) {
        const n = parseInt(viewersRaw, 10);
        if (Number.isFinite(n)) concurrentViewers = n;
      }

      snap = {
        state: "live",
        health,
        concurrentViewers,
        videoId,
        title,
        fetchedAt: new Date().toISOString(),
      };
    }
  } catch (e) {
    snap = snapError(e instanceof Error ? e.message : "unknown error");
  }

  cached = { snap, at: nowMs() };
  return snap;
}

export function watchUrlFor(videoId: string | null): string | null {
  return videoId ? `https://www.youtube.com/watch?v=${videoId}` : null;
}
