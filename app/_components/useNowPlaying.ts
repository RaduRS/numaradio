"use client";
// Module-level singleton for /api/station/now-playing.
//
// MediaSessionSync (always mounted inside PlayerProvider) calls useNowPlaying
// at layout level, so by the time the user opens the expanded player the
// singleton's cached data is fresh. The expanded player reads it instantly
// instead of waiting for its own first fetch to land — fixes the ~1s
// "artwork missing" gap on first open.
//
// Derived fields (elapsedSeconds / progress) are computed per-render from
// the shared snapshot + each consumer's local 1s clock tick.

import { useEffect, useState } from "react";

// True when this tab is the headless Chromium pulled by the YouTube
// encoder (`/live?broadcast=1`). In that mode we MUST NOT skip polls
// on visibilityState (Xvfb without a compositor reports unreliably)
// and we bypass the edge cache so the encoder shows track changes
// within seconds of the listener actually hearing them.
const BROADCAST_MODE =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("broadcast") === "1";

export type ShoutoutStatus =
  | { active: false }
  | { active: true; startedAt: string; expectedEndAt: string };

export type NowPlaying = {
  isPlaying: boolean;
  trackId?: string;
  title?: string;
  artistDisplay?: string;
  durationSeconds?: number;
  startedAt?: string;
  artworkUrl?: string;
  shoutout?: ShoutoutStatus;
};

export type NowPlayingDerived = NowPlaying & {
  /** Seconds since the track started (clamped to [0, duration]). */
  elapsedSeconds: number;
  /** 0..1 ratio for progress UIs. */
  progress: number;
};

const POLL_MS = 15_000;
const TICK_MS = 1_000;
// Buffer past expectedEndAt before refetching at a track boundary. Liquidsoap
// fires on_track ~instantly when the next track starts on its end, but the
// listener's audio is buffered ~5-10s downstream — flipping artwork right at
// expectedEndAt would update the UI while the listener still hears the outro.
const TRANSITION_BUFFER_MS = 3_000;

const EMPTY: NowPlaying = { isPlaying: false };

type Subscriber = (data: NowPlaying) => void;

const subscribers = new Set<Subscriber>();
let cachedData: NowPlaying = EMPTY;

/**
 * Seed the singleton's cache from an SSR snapshot. Layout calls this on
 * first mount so the hero, mini player, and expanded player all paint
 * with track info on the very first render — no ~500ms flash of "— by —".
 * Subsequent client-side polls replace the cache normally.
 */
export function seedNowPlayingCache(data: NowPlaying): void {
  // Only seed if we haven't started polling yet. If a poll has already
  // landed, the cache has fresher data than the SSR snapshot.
  if (cachedData === EMPTY) {
    cachedData = data;
  }
}
let intervalId: ReturnType<typeof setInterval> | null = null;
let abortCtrl: AbortController | null = null;
let transitionTimeoutId: ReturnType<typeof setTimeout> | null = null;

function clearTransitionRefetch() {
  if (transitionTimeoutId !== null) {
    clearTimeout(transitionTimeoutId);
    transitionTimeoutId = null;
  }
}

// Schedule a one-shot refetch for just after the current track is expected
// to end. With frame-accurate durations (lib/probe-duration.ts), this lands
// the new track's metadata within seconds of the listener actually hearing
// it — instead of waiting up to POLL_MS for the next interval tick.
function scheduleTransitionRefetch(data: NowPlaying) {
  clearTransitionRefetch();
  if (!data.startedAt || !data.durationSeconds) return;
  const startMs = new Date(data.startedAt).getTime();
  const delayMs = startMs + data.durationSeconds * 1000 + TRANSITION_BUFFER_MS - Date.now();
  if (delayMs <= 0) return;
  transitionTimeoutId = setTimeout(() => {
    transitionTimeoutId = null;
    poll();
  }, delayMs);
}

async function poll() {
  if (!abortCtrl) return;
  // Pause polling while the tab is hidden — saves Vercel function fires
  // for every backgrounded tab the user has open. The visibilitychange
  // listener below re-fires poll() the moment the tab becomes visible,
  // so the first thing the user sees on tab focus is fresh data.
  if (!BROADCAST_MODE && typeof document !== "undefined" && document.visibilityState !== "visible") return;
  try {
    const url = BROADCAST_MODE
      ? `/api/station/now-playing?t=${Date.now()}`
      : "/api/station/now-playing";
    const r = await fetch(url, {
      signal: abortCtrl.signal,
      cache: "no-store",
    });
    if (!r.ok) return;
    const json = (await r.json()) as NowPlaying;
    cachedData = json;
    for (const sub of subscribers) sub(json);
    scheduleTransitionRefetch(json);
  } catch {
    /* keep previous */
  }
}

function onVisibilityChange() {
  if (typeof document === "undefined") return;
  if (document.visibilityState === "visible") poll();
}

function startPolling() {
  if (intervalId !== null) return;
  abortCtrl = new AbortController();
  poll();
  intervalId = setInterval(poll, POLL_MS);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }
}

function stopPolling() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (abortCtrl) {
    abortCtrl.abort();
    abortCtrl = null;
  }
  clearTransitionRefetch();
  if (typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", onVisibilityChange);
  }
}

export function useNowPlaying(): NowPlayingDerived {
  const [data, setData] = useState<NowPlaying>(cachedData);
  // null until mounted so SSR and first client render produce identical text.
  // Initialising from Date.now() would make the server's wall clock
  // disagree with the client's by ~ms-to-seconds → React error #418.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    subscribers.add(setData);
    if (subscribers.size === 1) startPolling();
    // Sync late mounts to whatever the shared poll already has.
    setData(cachedData);

    setNow(Date.now());
    const tickId = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => {
      subscribers.delete(setData);
      if (subscribers.size === 0) stopPolling();
      clearInterval(tickId);
    };
  }, []);

  let elapsedSeconds = 0;
  let progress = 0;
  if (now !== null && data.startedAt && data.durationSeconds) {
    const startMs = new Date(data.startedAt).getTime();
    elapsedSeconds = Math.max(0, (now - startMs) / 1000);
    if (data.durationSeconds > 0) {
      progress = Math.min(1, elapsedSeconds / data.durationSeconds);
      // Cap elapsed at the total so the time label never reads "3:40 / 3:20"
      // when Liquidsoap holds a track a few seconds past its expected end
      // (or when the cached duration is short of the actual file length).
      elapsedSeconds = Math.min(elapsedSeconds, data.durationSeconds);
    }
  }

  return { ...data, elapsedSeconds, progress };
}
