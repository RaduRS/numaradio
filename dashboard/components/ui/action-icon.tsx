import React from "react";

export function ActionIcon({
  onClick, disabled, title, tone, children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  tone: "accent" | "muted" | "bad" | "warn";
  children: React.ReactNode;
}) {
  const toneCls =
    tone === "accent"
      ? "text-fg-mute hover:text-accent hover:border-accent/60 hover:bg-[var(--accent-soft)]"
      : tone === "bad"
        ? "text-fg-mute hover:text-[var(--bad)] hover:border-[var(--bad)]/60 hover:bg-[var(--bad)]/10"
        : tone === "warn"
          ? "text-fg-mute hover:text-yellow-500 hover:border-yellow-500/60 hover:bg-yellow-500/10"
          : "text-fg-mute hover:text-fg hover:border-fg-mute hover:bg-bg/60";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`w-8 h-8 inline-flex items-center justify-center border border-line rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${toneCls}`}
    >
      {children}
    </button>
  );
}