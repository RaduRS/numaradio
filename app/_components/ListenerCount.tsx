"use client";

import { useEffect, useState } from "react";

const POLL_MS = 10_000;

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
      const data = await fetchListeners(ctrl.signal);
      if (data) setN(data.withFloor);
    }

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      clearInterval(id);
      ctrl.abort();
    };
  }, []);

  // Until the first response, render an em-dash placeholder rather than 0,
  // so a connection problem reads as "unknown" not "no listeners".
  const display = n === null ? "—" : n.toLocaleString();
  return (
    <span className={className}>
      {display}
      {suffix}
    </span>
  );
}
