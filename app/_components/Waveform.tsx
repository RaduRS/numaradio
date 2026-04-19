"use client";

import { useMemo } from "react";
import { usePlayer } from "./PlayerProvider";

const BAR_COUNT = 64;

function buildHeights(): number[] {
  const arr: number[] = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    const h =
      20 +
      Math.abs(Math.sin(i * 0.38) * 60 + Math.sin(i * 0.15) * 30) +
      Math.random() * 20;
    arr.push(Math.min(100, h));
  }
  return arr;
}

// Live audio indicator. NOT a song-progress bar — the browser's <audio>
// element receiving a continuous stream has no idea what's playing or where
// in the song we are. When Phase 4 lands and we have a now-playing API
// (track + startedAt + duration), turn this back into a real progress fill.
export function Waveform() {
  const { isPlaying } = usePlayer();
  const heights = useMemo(buildHeights, []);

  return (
    <div className="wave" data-playing={isPlaying ? "true" : "false"}>
      {heights.map((h, i) => (
        <div
          key={i}
          className={`wave-bar ${isPlaying ? "active" : ""}`}
          style={{
            height: `${h}%`,
            // Stagger a subtle scaleY pulse across all bars when live.
            animation: isPlaying
              ? `eqBar ${1.2 + (i % 5) * 0.15}s ease-in-out ${(i % 8) * 0.1}s infinite`
              : "none",
          }}
        />
      ))}
    </div>
  );
}
