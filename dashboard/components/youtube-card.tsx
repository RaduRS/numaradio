"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { YoutubeBroadcastSnapshot } from "@/lib/youtube";

interface Props {
  data: YoutubeBroadcastSnapshot | null;
  isStale: boolean;
}

interface PillStyle {
  label: string;
  bg: string;
  border: string;
  text: string;
  pulse: boolean;
}

function statusPill(snap: YoutubeBroadcastSnapshot | null): PillStyle {
  if (!snap || snap.state === "error") {
    return {
      label: snap?.state === "error" ? "API ERROR" : "—",
      bg: "bg-fg-mute/10",
      border: "border-fg-mute/30",
      text: "text-fg-mute",
      pulse: false,
    };
  }
  if (snap.state === "off") {
    return {
      label: "OFF AIR",
      bg: "bg-fg-mute/10",
      border: "border-fg-mute/30",
      text: "text-fg-mute",
      pulse: false,
    };
  }
  if (snap.state === "ready") {
    return {
      label: "READY",
      bg: "bg-amber-500/10",
      border: "border-amber-500/40",
      text: "text-amber-400",
      pulse: false,
    };
  }
  // state === "live" — colour by stream health.
  if (snap.health === "good") {
    return {
      label: "LIVE · GOOD",
      bg: "bg-accent/10",
      border: "border-accent/40",
      text: "text-accent",
      pulse: true,
    };
  }
  if (snap.health === "ok") {
    return {
      label: "LIVE · OK",
      bg: "bg-accent/8",
      border: "border-accent/30",
      text: "text-accent",
      pulse: true,
    };
  }
  if (snap.health === "bad") {
    return {
      label: "LIVE · DEGRADED",
      bg: "bg-amber-500/10",
      border: "border-amber-500/40",
      text: "text-amber-400",
      pulse: true,
    };
  }
  if (snap.health === "noData") {
    return {
      label: "LIVE · NO INGEST",
      bg: "bg-red-500/10",
      border: "border-red-500/40",
      text: "text-red-400",
      pulse: true,
    };
  }
  return {
    label: "LIVE",
    bg: "bg-accent/10",
    border: "border-accent/40",
    text: "text-accent",
    pulse: true,
  };
}

function fmtViewers(n: number | null): string {
  if (n === null) return "—";
  if (n < 1000) return n.toString();
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

export function YoutubeCard({ data, isStale }: Props) {
  const pill = statusPill(data);
  const watchUrl = data?.videoId
    ? `https://www.youtube.com/watch?v=${data.videoId}`
    : null;
  const studioUrl = "https://studio.youtube.com/channel/UC/livestreaming";

  return (
    <Card className={`bg-bg-1 border-line ${isStale ? "opacity-70" : ""}`}>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="font-mono text-xs uppercase tracking-[0.2em] text-fg-mute">
          YouTube · 24/7 Broadcast
        </CardTitle>
        <a
          href={studioUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-mute transition-colors hover:text-accent"
          title="Open YouTube Studio live dashboard"
        >
          Studio →
        </a>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 ${pill.bg} ${pill.border} ${pill.text}`}
          >
            <span className="relative inline-flex h-2 w-2">
              {pill.pulse && (
                <span
                  aria-hidden
                  className="absolute inset-0 animate-ping rounded-full bg-current opacity-60"
                />
              )}
              <span
                aria-hidden
                className="absolute inset-0 rounded-full bg-current"
              />
            </span>
            <span className="font-mono text-xs uppercase tracking-[0.2em]">
              {pill.label}
            </span>
          </div>
          <div className="flex flex-col items-end">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-mute">
              Concurrent
            </span>
            <span className="font-display text-xl font-extrabold tabular-nums text-fg">
              {fmtViewers(data?.concurrentViewers ?? null)}
            </span>
          </div>
        </div>

        <div className="flex items-start justify-between gap-3 border-t border-line pt-3">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-mute">
              Title
            </div>
            <div className="truncate text-sm text-fg" title={data?.title ?? ""}>
              {data?.title ?? "—"}
            </div>
          </div>
          {watchUrl && (
            <a
              href={watchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 self-end rounded-md border border-line px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-fg-dim transition-colors hover:border-accent/50 hover:text-accent"
            >
              Watch →
            </a>
          )}
        </div>

        {data?.state === "error" && data.error && (
          <div
            className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 font-mono text-[11px] text-red-300"
            title={data.error}
          >
            {data.error.slice(0, 200)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
