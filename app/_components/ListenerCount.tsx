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

async function fetchListeners(signal: AbortSignal): Promise<Payload | null> {
  try {
    const r = await fetch("/api/station/listeners", { signal, cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as Payload;
  } catch {
    return null;
  }
}

export function ListenerCount({
  suffix = "",
  className = "",
}: {
  suffix?: string;
  className?: string;
}) {
  // Render 0 on first SSR/CSR paint to avoid hydration mismatch; the floor
  // takes over after the first poll lands.
  const [n, setN] = useState<number | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();

    async function poll() {
      // Skip while tab is hidden — listener below re-fires on focus.
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      const data = await fetchListeners(ctrl.signal);
      if (data) setN(data.withFloor);
    }

    poll();
    const id = setInterval(poll, POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") poll();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      ctrl.abort();
    };
  }, []);

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
