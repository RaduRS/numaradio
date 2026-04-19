"use client";

import { usePlayer } from "./PlayerProvider";
import { PauseIcon, PlayIcon } from "./Icons";

type Props = {
  variant?: "primary" | "ghost";
  label?: string;
  showIcon?: boolean;
  className?: string;
  style?: React.CSSProperties;
};

export function ListenLiveButton({
  variant = "primary",
  label,
  showIcon = true,
  className = "",
  style,
}: Props) {
  const { isPlaying, toggle } = usePlayer();
  const cls = `btn btn-${variant} ${className}`.trim();
  const text = label ?? (isPlaying ? "Pause" : "Listen Live");
  return (
    <button onClick={toggle} className={cls} style={style} aria-pressed={isPlaying}>
      {showIcon && (isPlaying ? (
        <PauseIcon className="btn-icon" />
      ) : (
        <PlayIcon className="btn-icon" />
      ))}
      <span>{text}</span>
    </button>
  );
}
