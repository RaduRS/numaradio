"use client";

import { useMemo } from "react";

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

function formatMinSec(totalSeconds: number): string {
  const t = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export interface WaveformProps {
  /** Whether a track is currently airing — drives the fill colour. */
  hasTrack: boolean;
  /** 0..1 progress through the current track. */
  progress: number;
  /** Seconds elapsed in the current track (for the time label). */
  elapsedSeconds: number;
  /** Total seconds of the current track (for the time label). */
  durationSeconds?: number | null;
  /** Render a `mm:ss / mm:ss` line below the bars. */
  showTime?: boolean;
}

// Wave fills as the current track progresses (truthful — driven by
// startedAt + durationSeconds from /api/station/now-playing). When the API
// has no track info, all bars stay grey — never lit blue dishonestly.
//
// Controlled by props so each surface (hero, booth, expanded player) can
// pass its own derived progress without a second hook subscription.
export function Waveform({
  hasTrack,
  progress,
  elapsedSeconds,
  durationSeconds,
  showTime = false,
}: WaveformProps) {
  const heights = useMemo(buildHeights, []);

  const filledThrough = hasTrack ? Math.floor(progress * BAR_COUNT) : 0;

  return (
    <div className="wave-wrap">
      <div className="wave">
        {heights.map((h, i) => (
          <div
            key={i}
            className={`wave-bar ${hasTrack && i < filledThrough ? "active" : ""}`}
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
      {showTime && (
        <div className="wave-time">
          <span>{formatMinSec(elapsedSeconds)}</span>
          <span>{durationSeconds ? formatMinSec(durationSeconds) : "—"}</span>
        </div>
      )}
    </div>
  );
}
