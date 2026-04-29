// YouTube Live Chat poller for queue-daemon.
//
// Owns the low-level YouTube Data API v3 calls needed to read incoming
// chat messages on the channel's currently-live broadcast. The
// orchestrator (youtube-chat-loop.ts) decides what to do with the
// messages — this module is purely "give me new messages since last
// time" with safe failure modes.
//
// Quota cost per poll cycle when LIVE:
//   liveBroadcasts.list (only on cold start / after broadcast ends) → 1u
//   liveChatMessages.list                                            → 5u
// At 90s polling that's ~5u/min × 60 × 24 = 7,200 quota/day. Combined
// with the dashboard's PR 3 health card (~4,300/day at 60s polling),
// we sit at ~11,500/day. Quota bump or backoff to 120s if it hurts.
//
// Auth: same OAuth refresh-token flow as the dashboard. We reuse the
// `youtube.readonly` scope — chat reads don't need write access.
//
// Spec: docs/superpowers/specs/2026-04-28-youtube-live-broadcast-design.md.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://www.googleapis.com/youtube/v3";

export interface YoutubeChatMessage {
  /** Stable message ID — use to dedup across polls. */
  id: string;
  /** Display text the viewer typed. Empty for non-text events. */
  text: string;
  /** Author's display name on YouTube. */
  authorName: string;
  /** Author's YouTube channel ID — stable across renames. Use for
   *  rate-limiting and the owner-skip check. */
  authorChannelId: string;
  /** True if the author is the channel owner. We skip these in the
   *  shoutout flow so the operator's own messages don't get aired. */
  isChannelOwner: boolean;
  /** True if the author is a moderator. Treated like the owner —
   *  skip, since mods are usually operators, not listeners. */
  isModerator: boolean;
  /** ISO timestamp the message was sent on YouTube. */
  publishedAt: string;
}

export interface YoutubeChatClientOpts {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Override fetch for tests. */
  fetcher?: typeof fetch;
  /** Override clock for deterministic tests. */
  now?: () => number;
}

export interface YoutubeChatClient {
  /** Find (and cache) the active broadcast's liveChatId. Returns null
   *  when nothing is currently live. */
  findActiveLiveChatId(): Promise<string | null>;
  /** Fetch new messages since the last call. Returns the messages and
   *  the recommended polling interval YouTube returned (use this if
   *  it's longer than your polling cadence — never poll more often
   *  than YouTube wants). */
  fetchNewMessages(liveChatId: string): Promise<{
    messages: YoutubeChatMessage[];
    pollingIntervalMs: number;
  }>;
  /** Reset internal cursors. Call when the live broadcast ends so we
   *  re-find the chat ID on the next poll. */
  reset(): void;
}

interface AccessToken {
  token: string;
  expiresAt: number;
}

interface BroadcastsListItem {
  id: string;
  snippet?: { liveChatId?: string };
}

interface ChatMessagesListItem {
  id: string;
  snippet?: {
    type?: string;
    publishedAt?: string;
    displayMessage?: string;
    textMessageDetails?: { messageText?: string };
    authorChannelId?: string;
  };
  authorDetails?: {
    displayName?: string;
    channelId?: string;
    isChatOwner?: boolean;
    isChatModerator?: boolean;
  };
}

interface ChatMessagesListResponse {
  items?: ChatMessagesListItem[];
  nextPageToken?: string;
  pollingIntervalMillis?: number;
}

export function createYoutubeChatClient(
  opts: YoutubeChatClientOpts,
): YoutubeChatClient {
  const fetcher = opts.fetcher ?? fetch;
  const now = opts.now ?? Date.now;

  let accessToken: AccessToken | null = null;
  let cachedLiveChatId: string | null = null;
  // Page token for incremental polling — YouTube's API returns only
  // messages NEWER than the token. First call uses no token.
  let nextPageToken: string | null = null;
  // Set the first time we successfully fetch a page so we throw away
  // the initial backlog (everything that was posted before the daemon
  // came online). After the first fetch, we forward all messages.
  let primed = false;

  async function getAccessToken(): Promise<string> {
    if (accessToken && accessToken.expiresAt > now() + 30_000) {
      return accessToken.token;
    }
    const body = new URLSearchParams({
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      refresh_token: opts.refreshToken,
      grant_type: "refresh_token",
    });
    const r = await fetcher(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      cache: "no-store",
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new Error(`oauth refresh ${r.status}: ${text.slice(0, 200)}`);
    }
    const j = (await r.json()) as { access_token?: string; expires_in?: number };
    if (!j.access_token) throw new Error("oauth: no access_token");
    accessToken = {
      token: j.access_token,
      expiresAt: now() + (j.expires_in ?? 3600) * 1000,
    };
    return accessToken.token;
  }

  async function api<T>(
    path: string,
    params: Record<string, string>,
  ): Promise<T> {
    const token = await getAccessToken();
    const url = new URL(`${API_BASE}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const r = await fetcher(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new Error(`youtube ${path} ${r.status}: ${text.slice(0, 200)}`);
    }
    return (await r.json()) as T;
  }

  async function findActiveLiveChatId(): Promise<string | null> {
    if (cachedLiveChatId) return cachedLiveChatId;
    // YouTube API rejects `mine=true` combined with `broadcastStatus`
    // — they're mutually exclusive filter params. broadcastStatus
    // alone returns broadcasts in that state for the OAuth user, which
    // is what we want.
    const j = await api<{ items?: BroadcastsListItem[] }>("/liveBroadcasts", {
      part: "id,snippet",
      broadcastStatus: "active",
      maxResults: "1",
    });
    const id = j.items?.[0]?.snippet?.liveChatId ?? null;
    cachedLiveChatId = id;
    // Reset the message cursor so we don't replay old messages from a
    // previous live session that happened to share a chat ID with
    // this one (rare with auto-regenerated IDs but cheap to be safe).
    nextPageToken = null;
    primed = false;
    return id;
  }

  async function fetchNewMessages(
    liveChatId: string,
  ): Promise<{
    messages: YoutubeChatMessage[];
    pollingIntervalMs: number;
  }> {
    const params: Record<string, string> = {
      liveChatId,
      part: "id,snippet,authorDetails",
      maxResults: "200",
    };
    if (nextPageToken) params.pageToken = nextPageToken;

    // YouTube's URL is "/liveChat/messages" (with a slash), NOT
    // "/liveChatMessages" — the latter returns the edge router's
    // empty-body 404 because the path doesn't exist. Easy typo: the
    // resource name in the docs ("liveChatMessages.list") looks like
    // it should be the path, but the path uses a slash.
    const j = await api<ChatMessagesListResponse>(
      "/liveChat/messages",
      params,
    );

    nextPageToken = j.nextPageToken ?? null;
    const pollingIntervalMs = Math.max(
      j.pollingIntervalMillis ?? 0,
      // Floor — never poll faster than 5s even if YouTube says we can.
      // Quota-friendly default; the loop's own 90s cadence usually wins.
      5_000,
    );

    if (!primed) {
      // First successful fetch — throw away the backlog. Anything that
      // was posted before the daemon started is irrelevant; we only
      // want messages going forward.
      primed = true;
      return { messages: [], pollingIntervalMs };
    }

    const messages: YoutubeChatMessage[] = [];
    for (const item of j.items ?? []) {
      const snippet = item.snippet;
      const author = item.authorDetails;
      if (!snippet || !author) continue;
      // Only forward textMessageEvent — YouTube also emits join/leave/
      // superchat/membership events on the same stream and we don't
      // want a "[YT] Marek joined" shoutout.
      if (snippet.type !== "textMessageEvent") continue;
      const text =
        snippet.textMessageDetails?.messageText ??
        snippet.displayMessage ??
        "";
      if (!text.trim()) continue;
      messages.push({
        id: item.id,
        text: text.trim(),
        authorName: (author.displayName ?? "").trim() || "Anonymous",
        authorChannelId: author.channelId ?? "",
        isChannelOwner: Boolean(author.isChatOwner),
        isModerator: Boolean(author.isChatModerator),
        publishedAt: snippet.publishedAt ?? new Date(now()).toISOString(),
      });
    }

    return { messages, pollingIntervalMs };
  }

  function reset(): void {
    cachedLiveChatId = null;
    nextPageToken = null;
    primed = false;
  }

  return { findActiveLiveChatId, fetchNewMessages, reset };
}
