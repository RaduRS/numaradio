"use client";

// Module-level singleton for /api/station/lena-line. All four surfaces
// (PlayerCard, ExpandedPlayerDesktop, ExpandedPlayerMobile, About page
// Lena card) subscribe to this so we make one poll per minute regardless
// of how many cards are mounted at once.

import { useEffect, useState } from "react";

export type LenaLineLive = {
  source: "live";
  script: string;
  atIso: string;
  type: string;
  show: string;
};
export type LenaLineContext = {
  source: "context";
  script: string;
  atIso: string;
  show: string;
};
export type LenaLinePool = {
  source: "pool";
  script: string;
  show: string;
};
export type LenaLine = LenaLineLive | LenaLineContext | LenaLinePool | null;

const POLL_MS = 60_000;

const subscribers = new Set<(line: LenaLine) => void>();
let cached: LenaLine = null;
let intervalId: ReturnType<typeof setInterval> | null = null;
let abortCtrl: AbortController | null = null;

async function poll() {
  if (!abortCtrl) return;
  try {
    const r = await fetch("/api/station/lena-line", {
      signal: abortCtrl.signal,
      cache: "no-store",
    });
    if (!r.ok) return;
    const json = (await r.json()) as LenaLine;
    cached = json;
    for (const sub of subscribers) sub(json);
  } catch {
    // Keep previous cached value
  }
}

function startPolling() {
  if (intervalId !== null) return;
  abortCtrl = new AbortController();
  poll();
  intervalId = setInterval(poll, POLL_MS);
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
}

export function useLenaLine(): LenaLine {
  const [line, setLine] = useState<LenaLine>(cached);
  useEffect(() => {
    subscribers.add(setLine);
    if (subscribers.size === 1) startPolling();
    setLine(cached);
    return () => {
      subscribers.delete(setLine);
      if (subscribers.size === 0) stopPolling();
    };
  }, []);
  return line;
}

/** Format a fresh "just now / 2 min ago" timestamp for live lines. */
export function relativeTimeLabel(atIso: string, now: number = Date.now()): string {
  const ageMs = now - new Date(atIso).getTime();
  if (ageMs < 0) return "just now";
  const sec = Math.round(ageMs / 1000);
  if (sec < 30) return "just now";
  if (sec < 90) return "1 min ago";
  const min = Math.round(sec / 60);
  return `${min} min ago`;
}
