// YouTube Live Chat → shoutout pipeline orchestrator.
//
// Polls the channel's currently-live broadcast for new chat messages and
// dispatches them through the existing booth-shoutout pipeline (MiniMax
// moderator → held flow on Telegram → broadcast). Runs as a background
// loop inside queue-daemon; only active when YouTube reports a live
// broadcast. Idle when off-air → 0 quota burn.
//
// Per-author rate limit (in-memory) protects the broadcast from a
// single chatty user dominating airtime — matches the booth's per-IP
// limit conceptually but uses authorChannelId so it's per-account, not
// per-network.
//
// Owner / moderator messages are skipped entirely. The operator's own
// chat is usually corrections or "checking in" — not what listeners
// want to hear Lena read on air.

import {
  createYoutubeChatClient,
  type YoutubeChatClient,
  type YoutubeChatMessage,
} from "./youtube-chat-client.ts";

// ─── Config ──────────────────────────────────────────────────────────

/** How often the loop wakes up. Long enough that we don't burn quota
 *  while still feeling responsive — listeners on YouTube already see
 *  ~10-15s ingest delay from the encoder, so adding 90s here puts the
 *  air read at ~2 minutes from message-sent. Tunable via env. */
export const DEFAULT_POLL_INTERVAL_MS = 90_000;

/** Per-author rate limit, sliding window. */
const AUTHOR_HOUR_LIMIT = 3;
const AUTHOR_DAY_LIMIT = 8;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Min/max length we'll accept. Matches the booth's bounds so the
 *  moderator sees the same shape of input regardless of source.
 *  Length is measured AFTER stripping the trigger mention. */
const MIN_TEXT = 4;
const MAX_TEXT = 240;

/** Trigger pattern. Listeners who want their message aired type a
 *  mention — it filters out chatter, drops noise, and signals intent.
 *  Configurable via env (`YOUTUBE_CHAT_TRIGGER_PATTERN`) for future
 *  tweaking. Word boundaries around `@lena` so "@lena's" still works
 *  but "calendar" doesn't trigger by accident. */
const DEFAULT_TRIGGER = /@lena\b/i;

// ─── Types ───────────────────────────────────────────────────────────

export type DispatchResult =
  | {
      ok: true;
      status: "queued" | "held" | "blocked" | "filtered";
      shoutoutId?: string;
      reason?: string;
    }
  | { ok: false; reason: string };

export interface YoutubeChatLoopOpts {
  /** OAuth credentials — same env vars as the dashboard PR 3. */
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Vercel internal endpoint — POST {text, displayName, authorChannelId,
   *  authorYoutubeId, sourceMessageId}, expects {ok, status, shoutoutId?}. */
  shoutoutEndpoint: string;
  /** Shared INTERNAL_API_SECRET for the endpoint. */
  internalSecret: string;
  /** Override fetch / clock for tests. */
  fetcher?: typeof fetch;
  now?: () => number;
  /** Override the chat client (mainly for tests). */
  client?: YoutubeChatClient;
  /** Logger hook — defaults to console. */
  log?: (level: "info" | "warn" | "error", msg: string) => void;
  /** Trigger pattern that messages must contain to be considered.
   *  Defaults to `/@lena\b/i`. Set null to disable (every message
   *  becomes a candidate). */
  triggerPattern?: RegExp | null;
  /** Optional callback fired with the cost (in YouTube quota units)
   *  of each underlying API call. Wired to YoutubeQuotaUsage in
   *  production, omitted in tests. */
  recordQuota?: (units: number) => void | Promise<void>;
}

export interface YoutubeChatLoop {
  /** Run a single tick. Returns counts of what happened. */
  tick(): Promise<TickResult>;
  /** Reset internal state — call when you suspect the cached chat ID
   *  has gone stale (e.g. broadcast ended). */
  reset(): void;
  /** Snapshot internal state for /status JSON. */
  snapshot(): LoopSnapshot;
}

export interface TickResult {
  liveChatId: string | null;
  messagesFetched: number;
  dispatched: number;
  skippedOwner: number;
  skippedRateLimit: number;
  skippedLength: number;
  skippedNoTrigger: number;
  failed: number;
}

export interface LoopSnapshot {
  liveChatId: string | null;
  authorWindowSize: number;
  totalDispatched: number;
  lastTickAt: string | null;
  lastError: { at: string; message: string } | null;
}

// ─── Implementation ──────────────────────────────────────────────────

export function createYoutubeChatLoop(
  opts: YoutubeChatLoopOpts,
): YoutubeChatLoop {
  const fetcher = opts.fetcher ?? fetch;
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((level, msg) => console[level === "info" ? "log" : level](`[yt-chat] ${msg}`));
  const triggerPattern =
    opts.triggerPattern === undefined ? DEFAULT_TRIGGER : opts.triggerPattern;
  const client =
    opts.client ??
    createYoutubeChatClient({
      clientId: opts.clientId,
      clientSecret: opts.clientSecret,
      refreshToken: opts.refreshToken,
      fetcher,
      now,
      recordQuota: opts.recordQuota,
    });

  // Per-author timestamps for the sliding-window rate limiter.
  const authorWindow = new Map<string, number[]>();
  let totalDispatched = 0;
  let lastTickAt: string | null = null;
  let lastError: LoopSnapshot["lastError"] = null;
  // Most recently observed liveChatId (or null when off-air). Hoisted out
  // of tick() so /status can show it without waiting for a tick to finish.
  let lastLiveChatId: string | null = null;

  function rateLimitOk(authorChannelId: string): boolean {
    const cutoffDay = now() - DAY_MS;
    const cutoffHour = now() - HOUR_MS;
    let stamps = authorWindow.get(authorChannelId) ?? [];
    // Prune anything older than the day window.
    stamps = stamps.filter((t) => t > cutoffDay);
    authorWindow.set(authorChannelId, stamps);
    if (stamps.length >= AUTHOR_DAY_LIMIT) return false;
    const inLastHour = stamps.filter((t) => t > cutoffHour).length;
    if (inLastHour >= AUTHOR_HOUR_LIMIT) return false;
    return true;
  }

  /**
   * Commit a rate-limit slot only after a dispatch has succeeded.
   * Splitting check (rateLimitOk) from commit (this) avoids burning
   * a slot when the dispatch endpoint fails — otherwise a brief
   * Vercel hiccup could exhaust an author's 3/hr budget on errors
   * the listener never even saw.
   */
  function rateLimitCommit(authorChannelId: string): void {
    const stamps = authorWindow.get(authorChannelId) ?? [];
    stamps.push(now());
    authorWindow.set(authorChannelId, stamps);
  }

  async function dispatch(
    msg: YoutubeChatMessage,
  ): Promise<DispatchResult> {
    try {
      const r = await fetcher(opts.shoutoutEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": opts.internalSecret,
        },
        body: JSON.stringify({
          text: msg.text,
          displayName: msg.authorName,
          authorChannelId: msg.authorChannelId,
          sourceMessageId: msg.id,
        }),
        cache: "no-store",
      });
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        return { ok: false, reason: `HTTP ${r.status}: ${text.slice(0, 120)}` };
      }
      const j = (await r.json()) as {
        ok?: boolean;
        status?: "queued" | "held" | "blocked" | "filtered";
        shoutoutId?: string;
        reason?: string;
        error?: string;
      };
      if (!j.ok) return { ok: false, reason: j.error ?? "endpoint refused" };
      return {
        ok: true,
        status: j.status ?? "queued",
        shoutoutId: j.shoutoutId,
        reason: j.reason,
      };
    } catch (e) {
      return {
        ok: false,
        reason: e instanceof Error ? e.message : String(e),
      };
    }
  }

  async function tick(): Promise<TickResult> {
    lastTickAt = new Date(now()).toISOString();
    const result: TickResult = {
      liveChatId: null,
      messagesFetched: 0,
      dispatched: 0,
      skippedOwner: 0,
      skippedRateLimit: 0,
      skippedLength: 0,
      skippedNoTrigger: 0,
      failed: 0,
    };

    let liveChatId: string | null = null;
    try {
      liveChatId = await client.findActiveLiveChatId();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      lastError = { at: lastTickAt, message: `findLiveChatId: ${msg}` };
      log("error", `findActiveLiveChatId failed: ${msg}`);
      return result;
    }

    if (!liveChatId) {
      // Off-air. Drop any cached messages so we restart cleanly when
      // the broadcast comes back.
      client.reset();
      lastLiveChatId = null;
      return result;
    }
    lastLiveChatId = liveChatId;
    result.liveChatId = liveChatId;

    let fetched: { messages: YoutubeChatMessage[] } = { messages: [] };
    try {
      fetched = await client.fetchNewMessages(liveChatId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      lastError = { at: lastTickAt, message: `fetchNewMessages: ${msg}` };
      log("error", `fetchNewMessages failed: ${msg}`);
      // YouTube revokes liveChatId after the broadcast ends; reset so
      // next tick re-discovers a (hopefully) new active broadcast.
      client.reset();
      return result;
    }

    result.messagesFetched = fetched.messages.length;

    for (const msg of fetched.messages) {
      // Filter 1: owner / moderator — those are usually the operator,
      // not a listener.
      if (msg.isChannelOwner || msg.isModerator) {
        result.skippedOwner += 1;
        continue;
      }
      // Filter 2: trigger word. Listeners signal intent by mentioning
      // Lena (e.g. "@lena shoutout to Marek"). Drops the firehose of
      // chat-as-chat down to a much smaller stream of "I want this
      // aired" messages. Strip the mention before forwarding so the
      // moderator + radio-host rewrite see clean text.
      let trimmed = msg.text.trim();
      if (triggerPattern) {
        if (!triggerPattern.test(trimmed)) {
          result.skippedNoTrigger += 1;
          continue;
        }
        trimmed = trimmed.replace(triggerPattern, "").replace(/\s+/g, " ").trim();
      }
      // Filter 3: length bounds — too short = noise, too long = will
      // get rejected by booth's max anyway. Run AFTER trigger strip so
      // a message that's only "@lena" doesn't sneak through.
      if (trimmed.length < MIN_TEXT || trimmed.length > MAX_TEXT) {
        result.skippedLength += 1;
        continue;
      }
      // Filter 4: per-author rate limit. Done here (not server-side)
      // because YouTube authors don't have an IP, and we don't want
      // every authored message to pay the moderation API cost.
      if (!rateLimitOk(msg.authorChannelId)) {
        result.skippedRateLimit += 1;
        continue;
      }

      // Forward the trigger-stripped text instead of the raw message.
      const cleanedMsg = { ...msg, text: trimmed };
      const dispatchResult = await dispatch(cleanedMsg);
      if (dispatchResult.ok) {
        rateLimitCommit(msg.authorChannelId);
        result.dispatched += 1;
        totalDispatched += 1;
        log(
          "info",
          `dispatched ${dispatchResult.status} from ${msg.authorName} (${msg.authorChannelId.slice(-6)}): "${trimmed.slice(0, 40)}..."`,
        );
      } else {
        result.failed += 1;
        log("warn", `dispatch failed for ${msg.id}: ${dispatchResult.reason}`);
      }
    }

    return result;
  }

  function reset(): void {
    client.reset();
    authorWindow.clear();
    lastLiveChatId = null;
  }

  function snapshot(): LoopSnapshot {
    return {
      liveChatId: lastLiveChatId,
      authorWindowSize: authorWindow.size,
      totalDispatched,
      lastTickAt,
      lastError,
    };
  }

  return { tick, reset, snapshot };
}
