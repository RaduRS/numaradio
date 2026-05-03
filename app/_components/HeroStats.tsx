"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "./Skeleton";

const POLL_MS = 60_000;

type Payload = {
  tracksThisWeek: number;
  libraryCount: number;
  shoutoutCount: number;
};

export function HeroStats() {
  const [data, setData] = useState<Payload | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();

    async function poll() {
      // Skip polling while the tab is hidden — listener below re-fires
      // poll() the moment the tab becomes visible.
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
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

  // While `data === null`, render skeletons matching the real number
  // (.n: 32 px display) and label (.l: 10 px mono + 6 px margin-top)
  // dimensions exactly. Once the fetch resolves, the same containers
  // render the real values without shifting any neighbour.
  const tiles: Array<{ value: number | null; label: string }> = [
    { value: data?.tracksThisWeek ?? null, label: "Tracks this week" },
    { value: data?.libraryCount ?? null, label: "In rotation" },
    { value: data?.shoutoutCount ?? null, label: "Shoutouts on air" },
  ];

  return (
    <div className="hero-stats">
      {tiles.map((t) => (
        <div className="hero-stat" key={t.label}>
          <div className="n">
            {t.value === null ? (
              <Skeleton width={86} height={30} radius={4} />
            ) : (
              t.value.toLocaleString()
            )}
          </div>
          <div className="l">{t.label}</div>
        </div>
      ))}
    </div>
  );
}
