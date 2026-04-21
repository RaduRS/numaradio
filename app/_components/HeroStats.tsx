"use client";

import { useEffect, useState } from "react";

const POLL_MS = 60_000;

type Payload = {
  tracksThisWeek: number;
  libraryCount: number;
  shoutoutCount: number;
};

function formatNumber(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString();
}

export function HeroStats() {
  const [data, setData] = useState<Payload | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();

    async function poll() {
      try {
        const r = await fetch("/api/station/stats", {
          signal: ctrl.signal,
          cache: "no-store",
        });
        if (!r.ok) return;
        const json = (await r.json()) as Payload;
        setData(json);
      } catch {
        /* network blip — keep previous */
      }
    }

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      clearInterval(id);
      ctrl.abort();
    };
  }, []);

  return (
    <div className="hero-stats">
      <div className="hero-stat">
        <div className="n">{formatNumber(data?.tracksThisWeek ?? null)}</div>
        <div className="l">Tracks this week</div>
      </div>
      <div className="hero-stat">
        <div className="n">{formatNumber(data?.libraryCount ?? null)}</div>
        <div className="l">In rotation</div>
      </div>
      <div className="hero-stat">
        <div className="n">{formatNumber(data?.shoutoutCount ?? null)}</div>
        <div className="l">Shoutouts on air</div>
      </div>
    </div>
  );
}
