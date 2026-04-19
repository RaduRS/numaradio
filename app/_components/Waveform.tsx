"use client";

import { useEffect, useMemo, useState } from "react";
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

export function Waveform() {
  const { isPlaying } = usePlayer();
  const heights = useMemo(buildHeights, []);
  const [progress, setProgress] = useState(40);

  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => {
      setProgress((p) => (p + 0.3 > BAR_COUNT ? 0 : p + 0.3));
    }, 200);
    return () => clearInterval(id);
  }, [isPlaying]);

  return (
    <div className="wave">
      {heights.map((h, i) => (
        <div
          key={i}
          className={`wave-bar ${i < progress ? "active" : ""}`}
          style={{ height: `${h}%` }}
        />
      ))}
    </div>
  );
}
