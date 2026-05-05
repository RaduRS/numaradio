"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "./Skeleton";

// The ambient floor only changes at 6-min bucket boundaries; real listener
// joins aren't urgent to reflect on the hero. 60s is plenty.
const POLL_MS = 60_000;

type Payload = {
  listeners: number;
  withFloor: number;
  isLive: boolean;
};

// Module-level singleton. Multiple <ListenerCount> instances on the same
// page (Hero, Footer, ExpandedPlayerMobile, About, BroadcastStage) used
// to each spin up their own poller + AbortController. Now they all
// subscribe to one shared poller; it starts when the first subscriber
// mounts and stops when the last unmounts.
let cached: Payload | null = null;
const subscribers = new Set<(value: number | null) => void>();
let pollerInterval: ReturnType<typeof setInterval> | null = null;
let pollerCtrl: AbortController | null = null;

async function pollOnce(): Promise<void> {
  if (!pollerCtrl) return;
  if (typeof document !== "undefined" && document.visibilityState !== "visible") {
    return;
  }
  try {
    const r = await fetch("/api/station/listeners", {
      signal: pollerCtrl.signal,
      cache: "no-store",
    });
    if (!r.ok) return;
    const data = (await r.json()) as Payload;
    cached = data;
    for (const cb of subscribers) cb(data.withFloor);
  } catch {
    /* offline / aborted — try again next tick */
  }
}

function onVisibilityChange(): void {
  if (document.visibilityState === "visible") void pollOnce();
}

function startPoller(): void {
  if (pollerInterval !== null) return;
  pollerCtrl = new AbortController();
  void pollOnce();
  pollerInterval = setInterval(() => void pollOnce(), POLL_MS);
  document.addEventListener("visibilitychange", onVisibilityChange);
}

function stopPoller(): void {
  if (pollerInterval !== null) {
    clearInterval(pollerInterval);
    pollerInterval = null;
  }
  pollerCtrl?.abort();
  pollerCtrl = null;
  if (typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", onVisibilityChange);
  }
}

function subscribe(cb: (value: number | null) => void): () => void {
  subscribers.add(cb);
  // Hand the new subscriber the most recent value immediately so a late
  // mount (e.g. ExpandedPlayerMobile after Hero) doesn't flash skeleton.
  if (cached !== null) cb(cached.withFloor);
  startPoller();
  return () => {
    subscribers.delete(cb);
    if (subscribers.size === 0) stopPoller();
  };
}

export function ListenerCount({
  suffix = "",
  className = "",
}: {
  suffix?: string;
  className?: string;
}) {
  // Initial state pulls from the singleton cache when present so a second
  // instance mounting on the same page doesn't re-show the skeleton.
  // First-load is always null on both server and client (cache is empty
  // at module init), so hydration matches.
  const [n, setN] = useState<number | null>(cached?.withFloor ?? null);

  useEffect(() => subscribe(setN), []);

  // Skeleton on first paint reserves a fixed inline width matching the
  // typical 3-digit count so the surrounding text doesn't reflow when
  // the number arrives.
  if (n === null) {
    return (
      <span className={className}>
        <Skeleton width={32} height={12} radius={3} />
        {suffix}
      </span>
    );
  }
  return (
    <span className={className}>
      {n.toLocaleString()}
      {suffix}
    </span>
  );
}
