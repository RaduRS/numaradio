"use client";
import type { BandwidthToday } from "@/lib/bandwidth";

interface Props {
  data: BandwidthToday | null;
  isStale: boolean;
}

function gib(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1);
}

function barColorClass(frac: number): string {
  if (frac >= 0.9) return "bg-red-500";
  if (frac >= 0.7) return "bg-amber-500";
  return "bg-accent";
}

export function BandwidthPill({ data, isStale }: Props) {
  if (!data) {
    return (
      <div
        className="flex flex-col gap-1 rounded-md border border-line px-3 py-2"
        title="B2 bandwidth today — awaiting data"
      >
        <div className="flex items-center justify-between gap-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-mute">
            B2 today
          </span>
          <span className="font-mono text-xs text-fg-mute">—</span>
        </div>
      </div>
    );
  }

  const pct = Math.round(data.fractionUsed * 100);
  const usedGib = gib(data.bytesToday);
  const capGib = gib(data.capBytes);

  return (
    <div
      className={`flex flex-col gap-1 rounded-md border border-line px-3 py-2 ${
        isStale ? "opacity-70" : ""
      }`}
      title="Estimated from today's plays since midnight UTC. Actual B2 egress may differ by a few percent."
    >
      <div className="flex items-center justify-between gap-4">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-mute">
          B2 est. today
        </span>
        <span className="font-mono text-xs">
          {usedGib} / {capGib} GB · {pct}%
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded bg-[var(--line)]">
        <div
          className={`h-full ${barColorClass(data.fractionUsed)}`}
          style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        />
      </div>
    </div>
  );
}
