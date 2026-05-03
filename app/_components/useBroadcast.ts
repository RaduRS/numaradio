"use client";
// Module-level singleton for the `/api/station/broadcast` feed.
//
// Multiple components (ExpandedPlayerDesktop, ExpandedPlayerMobile, OnAirFeed)
// call useBroadcast() concurrently when the expanded player is open.
// Previously each fired its own 6s interval → 3 concurrent hits on the same
// endpoint. Now they share one poll: refcounted subscribers start the poll
// on the first mount, stop it when the last consumer unmounts. Each hook
// instance still gets reactive state via its own useState, updated whenever
// the shared fetch lands.
//
// Broadcast.tsx (the homepage hero) keeps its own useBroadcastFeed — it
// uses richer dynamic-cadence polling (tighter 1s boundary window) that's
// too specific to merge here. The homepage-expanded case ends up with 2
// pollers (its richer one + our singleton) instead of 4+, which is the
// measurable win we wanted.
import { useEffect, useState } from "react";

// Encoder-tab guard — see useNowPlaying.ts for the rationale.
const BROADCAST_MODE =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("broadcast") === "1";

// Expanded-player singleton — slower than Broadcast.tsx's homepage
// poller because the expanded player is opt-in surface and doesn't
// need sub-10s freshness. Bumped from 6_000 in the 2026-05-03
// free-tier audit. The "Lena on air" pill may appear up to ~15s late
// here; homepage Broadcast.tsx still picks it up faster.
const POLL_MS = 15_000;

type TrackSummary = {
  trackId: string;
  title: string;
  artistDisplay?: string;
  artworkUrl?: string;
};

type NowPlayingPayload =
  | { isPlaying: false }
  | ({
      isPlaying: true;
      startedAt: string;
      durationSeconds?: number;
    } & TrackSummary);

type JustPlayedItem = TrackSummary & {
  startedAt: string;
  durationSeconds?: number;
};

type BroadcastPayload = {
  nowPlaying: NowPlayingPayload;
  upNext: (TrackSummary & { reasonCode?: string }) | null;
  justPlayed: JustPlayedItem[];
  shoutout:
    | { active: false }
    | { active: true; startedAt: string; expectedEndAt: string };
};

const EMPTY: BroadcastPayload = {
  nowPlaying: { isPlaying: false },
  upNext: null,
  justPlayed: [],
  shoutout: { active: false },
};

type Subscriber = (data: BroadcastPayload) => void;

const subscribers = new Set<Subscriber>();
let cachedData: BroadcastPayload = EMPTY;
let intervalId: ReturnType<typeof setInterval> | null = null;
let abortCtrl: AbortController | null = null;
let lastShoutoutActive = false;

async function poll() {
  if (!abortCtrl) return;
  // Skip polling while the tab is hidden; the visibilitychange listener
  // below re-fires poll() the moment the tab becomes visible.
  // Encoder tab (?broadcast=1) is exempt — see useNowPlaying for why.
  if (!BROADCAST_MODE && typeof document !== "undefined" && document.visibilityState !== "visible") return;
  try {
    const url = BROADCAST_MODE
      ? `/api/station/broadcast?t=${Date.now()}`
      : "/api/station/broadcast";
    const r = await fetch(url, {
      signal: abortCtrl.signal,
      cache: "no-store",
    });
    if (!r.ok) return;
    const json = (await r.json()) as BroadcastPayload;
    cachedData = json;
    for (const sub of subscribers) sub(json);

    const isActive = json.shoutout.active;
    if (lastShoutoutActive && !isActive) {
      window.dispatchEvent(new CustomEvent("numa:shoutout-ended"));
    }
    lastShoutoutActive = isActive;
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
  if (typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", onVisibilityChange);
  }
}

export function useBroadcast() {
  const [data, setData] = useState<BroadcastPayload>(cachedData);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    subscribers.add(setData);
    if (subscribers.size === 1) startPolling();
    // If the shared poll already has cached data, sync this mount to it.
    setData(cachedData);

    const tickId = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      subscribers.delete(setData);
      if (subscribers.size === 0) stopPolling();
      clearInterval(tickId);
    };
  }, []);

  return { ...data, now };
}
