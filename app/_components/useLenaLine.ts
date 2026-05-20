"use client";
// POLLING DISABLED — DB is down, no live data.

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

// Static placeholder for presentation mode
const PLACEHOLDER: LenaLinePool = {
  source: "pool",
  script: "Welcome to Numa Radio — AI-powered radio, 24/7.",
  show: "Night Shift",
};

// No-op: no polling, no network calls
function startPolling() {}
function stopPolling() {}

export function useLenaLine(): LenaLine {
  const [line, setLine] = useState<LenaLine>(PLACEHOLDER);
  useEffect(() => {
    setLine(PLACEHOLDER);
    return () => {};
  }, []);
  return line;
}

export function relativeTimeLabel(_atIso: string, _now: number = Date.now()): string {
  return "just now";
}