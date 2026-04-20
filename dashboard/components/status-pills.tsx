"use client";
import type { StatusSnapshot } from "@/lib/types";

interface Props {
  data: StatusSnapshot | null;
  isStale: boolean;
}

export function StatusPills({ data, isStale }: Props) {
  const live = data?.stream.reachable ?? false;
  const listeners = data?.stream.listeners ?? null;
  const peak = data?.stream.listenerPeak ?? null;
  const bitrate = data?.stream.bitrate ?? null;
  const visitors = data?.site?.visitors ?? null;
  const np = data?.stream.nowPlaying;

  return (
    <section className={`flex flex-col gap-4 ${isStale ? "opacity-70" : ""}`}>
      {/* Row 1 — live status + now playing */}
      <div className="grid gap-4 md:grid-cols-[auto_1fr] md:items-center">
        <div
          className={`inline-flex items-center gap-3 justify-self-start self-center rounded-full border px-5 py-2.5 text-sm font-medium ${
            live
              ? "border-accent text-accent bg-[var(--accent-soft)]"
              : "border-[var(--bad)] text-[var(--bad)]"
          }`}
        >
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              live ? "bg-accent" : "bg-[var(--bad)]"
            }`}
            style={
              live
                ? { animation: "numa-pulse 2.2s ease-in-out infinite" }
                : undefined
            }
          />
          {live ? "Stream is live" : "Stream is down"}
        </div>

        <div className="flex min-w-0 flex-col gap-0.5 rounded-xl border border-[var(--line)] bg-[var(--bg-1)] px-5 py-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-fg-mute">
            Now playing
          </span>
          {np ? (
            <div className="flex min-w-0 items-baseline gap-3">
              <span className="truncate text-lg font-medium text-fg">
                {np.title}
              </span>
              {np.artist ? (
                <span className="truncate text-sm text-fg-dim">
                  {np.artist}
                </span>
              ) : null}
            </div>
          ) : (
            <span className="text-sm text-fg-mute">No title metadata.</span>
          )}
        </div>
      </div>

      {/* Row 2 — metric tiles */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetricTile
          label="Listening now"
          value={listeners}
          sub={peak !== null ? `peak ${peak}` : undefined}
          accent
        />
        <MetricTile
          label="On the site"
          value={visitors}
          sub="people with the page open"
        />
        <MetricTile
          label="Stream bitrate"
          value={bitrate !== null ? `${bitrate}` : null}
          sub={bitrate !== null ? "kbps · mp3 / stereo" : undefined}
        />
      </div>
    </section>
  );
}

interface MetricTileProps {
  label: string;
  value: number | string | null;
  sub?: string;
  accent?: boolean;
}

function MetricTile({ label, value, sub, accent }: MetricTileProps) {
  const display =
    value === null || value === undefined
      ? "—"
      : typeof value === "number"
        ? value.toLocaleString()
        : value;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[var(--line)] bg-[var(--bg-1)] px-5 py-4">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-fg-mute">
        {label}
      </span>
      <span
        className={`font-display text-5xl font-extrabold leading-none tracking-tight ${
          accent ? "text-accent" : "text-fg"
        }`}
        style={{ fontStretch: "125%" }}
      >
        {display}
      </span>
      {sub ? (
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-mute">
          {sub}
        </span>
      ) : null}
    </div>
  );
}
