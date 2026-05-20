"use client";
// POLLING DISABLED — DB is down, no live data.

import { useEffect, useState } from "react";

type TrackSummary = {
  trackId: string;
  title: string;
  artistDisplay?: string;
  artworkUrl?: string;
};

type NowPlayingPayload =
  | { isPlaying: false }
  | ({ isPlaying: true; startedAt: string; durationSeconds?: number } & TrackSummary);

type UpNextPayload = (TrackSummary & { reasonCode?: string }) | null;

type JustPlayedItem = TrackSummary & {
  startedAt: string;
  durationSeconds?: number;
};

type ShoutoutPayload =
  | { active: false }
  | { active: true; startedAt: string; expectedEndAt: string };

type BroadcastPayload = {
  nowPlaying: NowPlayingPayload;
  upNext: UpNextPayload;
  justPlayed: JustPlayedItem[];
  shoutout: ShoutoutPayload;
};

const EMPTY: BroadcastPayload = {
  nowPlaying: { isPlaying: false },
  upNext: null,
  justPlayed: [],
  shoutout: { active: false },
};

// No-op: no polling, no network calls
function startPolling() {}
function stopPolling() {}

type Subscriber = (data: BroadcastPayload) => void;
const subscribers = new Set<Subscriber>();
let cachedData: BroadcastPayload = EMPTY;

export function useBroadcast() {
  const [data, setData] = useState<BroadcastPayload>(EMPTY);
  const [now, setNow] = useState<number>(0);

  useEffect(() => {
    setData(cachedData);
    setNow(Date.now());
    const tickId = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tickId);
  }, []);

  return { ...data, now };
}