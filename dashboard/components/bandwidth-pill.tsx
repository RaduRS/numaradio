"use client";
import type { BandwidthToday } from "@/lib/bandwidth";

interface Props {
  data: BandwidthToday | null;
  isStale: boolean;
}

const ONE_GIB = 1024 ** 3;
const ONE_MIB = 1024 ** 2;

function formatBytes(bytes: number): { value: string; unit: "MB" | "GB" } {
  // Show MB below 1 GiB (typical for a quiet early-morning hour on a small
  // station), flip to GB once we're into serious egress territory.
  if (bytes < ONE_GIB) {
    const mb = bytes / ONE_MIB;
    // Under 100 MB show one decimal; above, round to integer — the
    // precision beyond that is meaningless.
    return { value: mb < 100 ? mb.toFixed(1) : Math.round(mb).toString(), unit: "MB" };
  }
  return { value: (bytes / ONE_GIB).toFixed(1), unit: "GB" };
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
  const used = formatBytes(data.bytesToday);
  const cap = formatBytes(data.capBytes);
  // Render "used / cap" naturally — if both are in the same unit we
  // elide the first unit, otherwise keep both so it always reads right
  // (e.g. "240 MB / 10 GB", "1.3 / 10 GB").
  const display =
    used.unit === cap.unit
      ? `${used.value} / ${cap.value} ${cap.unit}`
      : `${used.value} ${used.unit} / ${cap.value} ${cap.unit}`;

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
          {display} · {pct}%
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
