"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export interface UsePollingResult<T> {
  data: T | null;
  error: string | null;
  lastUpdated: number | null;
  isStale: boolean;
  refresh: () => void;
}

export function usePolling<T>(
  url: string,
  intervalMs: number,
  enabled = true,
): UsePollingResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [isStale, setIsStale] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchOnce = useCallback(async () => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      const res = await fetch(url, { signal: ctl.signal, cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as T;
      setData(json);
      setError(null);
      setIsStale(false);
      setLastUpdated(Date.now());
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError(e instanceof Error ? e.message : "fetch failed");
      setIsStale(true);
    }
  }, [url]);

  useEffect(() => {
    if (!enabled) return;
    fetchOnce();
    const id = setInterval(fetchOnce, intervalMs);
    const onVis = () => {
      if (document.visibilityState === "visible") fetchOnce();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      abortRef.current?.abort();
    };
  }, [enabled, fetchOnce, intervalMs]);

  return { data, error, lastUpdated, isStale, refresh: fetchOnce };
}
