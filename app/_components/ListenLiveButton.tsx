"use client";

import { usePlayer } from "./PlayerProvider";
import { LoadingIcon, PauseIcon, PlayIcon } from "./Icons";

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
  const { status, toggle } = usePlayer();
  const cls = `btn btn-${variant} ${className}`.trim();

  const text =
    label ??
    (status === "playing"
      ? "Pause"
      : status === "loading"
        ? "Connecting…"
        : "Listen Live");

  const icon = !showIcon ? null : status === "loading" ? (
    <LoadingIcon className="btn-icon" />
  ) : status === "playing" ? (
    <PauseIcon className="btn-icon" />
  ) : (
    <PlayIcon className="btn-icon" />
  );

  return (
    <button
      onClick={toggle}
      className={cls}
      style={style}
      aria-pressed={status === "playing"}
      aria-busy={status === "loading"}
    >
      {icon}
      <span>{text}</span>
    </button>
  );
}
