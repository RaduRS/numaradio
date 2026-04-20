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
  const np = data?.stream.nowPlaying;
  return (
    <section className="flex flex-col md:flex-row gap-4 items-start md:items-center">
      <div
        className={`inline-flex items-center gap-3 rounded-full border px-4 py-2 text-sm font-medium ${
          live
            ? "border-accent text-accent bg-[var(--accent-soft)]"
            : "border-[var(--bad)] text-[var(--bad)]"
        } ${isStale ? "opacity-60" : ""}`}
      >
        <span
          className={`h-2 w-2 rounded-full ${live ? "bg-accent" : "bg-[var(--bad)]"}`}
          style={live ? { animation: "numa-pulse 2.2s ease-in-out infinite" } : undefined}
        />
        {live ? "Stream is live" : "Stream is down"}
      </div>
      <div className="font-mono text-xs uppercase tracking-[0.2em] text-fg-mute">
        {listeners !== null ? `${listeners} listener${listeners === 1 ? "" : "s"}` : "— listeners"}
        {peak !== null ? <span className="ml-2 opacity-60">peak {peak}</span> : null}
      </div>
      <div className="font-mono text-xs uppercase tracking-[0.2em] text-fg-mute">
        {data?.site?.visitors !== null && data?.site?.visitors !== undefined
          ? `${data.site.visitors} on the site`
          : "— on the site"}
      </div>
      <div className="text-sm text-fg-dim">
        {np ? (
          <>
            Now playing:{" "}
            <span className="text-fg">
              {np.artist ? `${np.artist} — ` : ""}
              {np.title}
            </span>
          </>
        ) : (
          <span className="text-fg-mute">No title metadata.</span>
        )}
      </div>
    </section>
  );
}
