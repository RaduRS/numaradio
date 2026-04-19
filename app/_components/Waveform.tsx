"use client";

import { useMemo } from "react";
import { usePlayer } from "./PlayerProvider";
import { useNowPlaying } from "./useNowPlaying";

const BAR_COUNT = 64;

// Deterministic pseudo-random based on bar index — must match between SSR
// and client to avoid hydration warnings.
function buildHeights(): number[] {
  const arr: number[] = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    const h =
      20 +
      Math.abs(Math.sin(i * 0.38) * 60 + Math.sin(i * 0.15) * 30) +
      Math.abs(Math.sin(i * 1.7) * 20);
    arr.push(Math.min(100, h));
  }
  return arr;
}

// Wave fills as the current track progresses (truthful — driven by
// startedAt + durationSeconds from the now-playing API). When the API
// has no track info yet, we fall back to the gentler "audio is live"
// animation instead of pretending to know progress.
export function Waveform() {
  const { isPlaying } = usePlayer();
  const { progress, isPlaying: hasTrack } = useNowPlaying();
  const heights = useMemo(buildHeights, []);

  const filledThrough = hasTrack ? Math.floor(progress * BAR_COUNT) : 0;
  const useFakeAnimation = isPlaying && !hasTrack;

  return (
    <div className="wave">
      {heights.map((h, i) => {
        const filled = hasTrack ? i < filledThrough : isPlaying;
        return (
          <div
            key={i}
            className={`wave-bar ${filled ? "active" : ""}`}
            style={{
              height: `${h}%`,
              animation: useFakeAnimation
                ? `eqBar ${1.2 + (i % 5) * 0.15}s ease-in-out ${(i % 8) * 0.1}s infinite`
                : "none",
            }}
          />
        );
      })}
    </div>
  );
}
