"use client";

import { useEffect, useRef, useState } from "react";

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

const POLL_MS = 15_000; // network — track changes are infrequent
const TICK_MS = 1_000; // local clock for elapsed/progress

export type NowPlayingDerived = NowPlaying & {
  /** Seconds since the track started (clamped to [0, duration]). */
  elapsedSeconds: number;
  /** 0..1 ratio for progress UIs. */
  progress: number;
};

export function useNowPlaying(): NowPlayingDerived {
  const [data, setData] = useState<NowPlaying>({ isPlaying: false });
  const [now, setNow] = useState<number>(() => Date.now());
  const lastFetchedRef = useRef<number>(0);

  // Network poll for the canonical track + startedAt.
  useEffect(() => {
    const ctrl = new AbortController();
    async function poll() {
      try {
        const r = await fetch("/api/station/now-playing", {
          signal: ctrl.signal,
          cache: "no-store",
        });
        if (r.ok) {
          const json = (await r.json()) as NowPlaying;
          setData(json);
          lastFetchedRef.current = Date.now();
        }
      } catch {
        // network blip — keep last data
      }
    }
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      clearInterval(id);
      ctrl.abort();
    };
  }, []);

  // Local clock — drives the wave fill without hitting the network.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  let elapsedSeconds = 0;
  let progress = 0;
  if (data.startedAt && data.durationSeconds) {
    const startMs = new Date(data.startedAt).getTime();
    elapsedSeconds = Math.max(0, (now - startMs) / 1000);
    if (data.durationSeconds > 0) {
      progress = Math.min(1, elapsedSeconds / data.durationSeconds);
    }
  }

  return { ...data, elapsedSeconds, progress };
}
