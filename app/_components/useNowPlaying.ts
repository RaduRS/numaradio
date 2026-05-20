"use client";
// POLLING DISABLED — DB is down, no live data.
// All functions here are no-ops; consumers get empty/static defaults.
// To re-enable for a presentation, replace with static B2 image URLs.

import { useEffect, useState } from "react";

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
  elapsedSeconds: number;
  progress: number;
};

const EMPTY: NowPlaying = { isPlaying: false };

// No-op: no polling, no network calls
function startPolling() {}
function stopPolling() {}

export function useNowPlaying(): NowPlayingDerived {
  const [data] = useState<NowPlaying>(EMPTY);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tickId = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tickId);
  }, []);

  return { ...data, elapsedSeconds: 0, progress: 0 };
}

export function seedNowPlayingCache(_data: NowPlaying) {}
export function setNowPlayingPlaybackActive(_active: boolean) {}