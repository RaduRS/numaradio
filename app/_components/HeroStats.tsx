"use client";
// POLLING DISABLED — DB is down, no live data.

import { useState } from "react";
import { Skeleton } from "./Skeleton";

// Static placeholder data for presentation mode
const STATIC_DATA = {
  tracksThisWeek: 0,
  libraryCount: 0,
  shoutoutCount: 0,
};

export function HeroStats() {
  const [data] = useState<typeof STATIC_DATA | null>(STATIC_DATA);

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