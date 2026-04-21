"use client";

import { usePlayer } from "./PlayerProvider";

function VolumeIcon({ muted, level }: { muted: boolean; level: number }) {
  const showWave1 = !muted && level > 0;
  const showWave2 = !muted && level > 0.5;
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      style={{ width: 16, height: 16, opacity: 0.85 }}
    >
      <path d="M3 8v4h3l4 3V5L6 8H3z" />
      {showWave1 && <path d="M12 7.4a3 3 0 010 5.2V7.4z" />}
      {showWave2 && (
        <path d="M14 4.8a6 6 0 010 10.4v-1.6a4.5 4.5 0 000-7.2V4.8z" />
      )}
      {muted && (
        <path
          d="M13 7l5 6M18 7l-5 6"
          stroke="currentColor"
          strokeWidth={1.5}
          fill="none"
        />
      )}
    </svg>
  );
}

export function VolumeControl() {
  const { volume, isMuted, setVolume, toggleMute } = usePlayer();
  const displayed = isMuted ? 0 : volume;
  return (
    <div className="vol">
      <button
        type="button"
        onClick={toggleMute}
        className="vol-icon-btn"
        aria-label={isMuted ? "Unmute" : "Mute"}
      >
        <VolumeIcon muted={isMuted} level={volume} />
      </button>
      <div className="vol-bar">
        <div className="fill" style={{ width: `${displayed * 100}%` }} />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={displayed}
          onChange={(e) => setVolume(parseFloat(e.target.value))}
          aria-label="Volume"
          className="vol-range"
        />
      </div>
    </div>
  );
}
