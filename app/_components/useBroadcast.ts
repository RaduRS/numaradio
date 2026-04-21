"use client";
import { useEffect, useRef, useState } from "react";

const POLL_MS = 6_000;

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

export function useBroadcast() {
  const [data, setData] = useState<BroadcastPayload>(EMPTY);
  const [now, setNow] = useState<number>(() => Date.now());
  const mounted = useRef(true);
  const lastShoutoutActiveRef = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const ctrl = new AbortController();

    async function poll() {
      try {
        const r = await fetch("/api/station/broadcast", {
          signal: ctrl.signal,
          cache: "no-store",
        });
        if (!r.ok) return;
        const json = (await r.json()) as BroadcastPayload;
        if (!mounted.current) return;
        setData(json);

        // Re-emit the shoutout-end signal so ShoutoutWall / OnAirFeed can
        // refresh without running their own duplicate broadcast poll.
        const isActive = json.shoutout.active;
        if (lastShoutoutActiveRef.current && !isActive) {
          window.dispatchEvent(new CustomEvent("numa:shoutout-ended"));
        }
        lastShoutoutActiveRef.current = isActive;
      } catch {
        /* keep previous */
      }
    }

    poll();
    const id = setInterval(poll, POLL_MS);
    const tickId = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      mounted.current = false;
      clearInterval(id);
      clearInterval(tickId);
      ctrl.abort();
    };
  }, []);

  return { ...data, now };
}
