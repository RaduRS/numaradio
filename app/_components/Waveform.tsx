"use client";

import { useMemo } from "react";
import { useNowPlaying } from "./useNowPlaying";

const BAR_COUNT = 64;

// Deterministic pseudo-random based on bar index — must match between SSR
// and client to avoid hydration warnings. Minimum height bumped from 20
// to 38 so even the "valley" bars are visually present — at 20% the
// shortest bars rendered at ~8 px next to ~40 px neighbours and read as
// gaps in the teal fill ("patches of grey" inside the active region).
function buildHeights(): number[] {
  const arr: number[] = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    const h =
      38 +
      Math.abs(Math.sin(i * 0.38) * 40 + Math.sin(i * 0.15) * 18) +
      Math.abs(Math.sin(i * 1.7) * 12);
    arr.push(Math.min(100, h));
  }
  return arr;
}

// Wave fills as the current track progresses (truthful — driven by
// startedAt + durationSeconds from /api/station/now-playing). When the API
// has no track info, all bars stay grey — never lit blue dishonestly.
export function Waveform() {
  const { progress, isPlaying: hasTrack } = useNowPlaying();
  const heights = useMemo(buildHeights, []);

  const filledThrough = hasTrack ? Math.floor(progress * BAR_COUNT) : 0;

  return (
    <div className="wave">
      {heights.map((h, i) => (
        <div
          key={i}
          className={`wave-bar ${hasTrack && i < filledThrough ? "active" : ""}`}
          style={{ height: `${h}%` }}
        />
      ))}
    </div>
  );
}
