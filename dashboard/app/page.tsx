"use client";
import Link from "next/link";
import { usePolling } from "@/hooks/use-polling";
import { StatusPills } from "@/components/status-pills";
import { ServicesCard } from "@/components/services-card";
import { HealthCard } from "@/components/health-card";
import { LogsCard } from "@/components/logs-card";
import { HeldShoutoutsCard } from "@/components/held-shoutouts-card";
import { BandwidthPill } from "@/components/bandwidth-pill";
import type { StatusSnapshot } from "@/lib/types";
import type { ShoutoutRow } from "@/lib/shoutouts";
import type { BandwidthToday } from "@/lib/bandwidth";

interface ShoutoutsListResponse {
  held: ShoutoutRow[];
  recent: ShoutoutRow[];
}

type BandwidthResponse = BandwidthToday & { ok: boolean };

export default function OperatorDashboard() {
  const { data, isStale, refresh } = usePolling<StatusSnapshot>("/api/status", 5_000);
  const shoutoutsPoll = usePolling<ShoutoutsListResponse>(
    "/api/shoutouts/list",
    5_000,
  );
  const bandwidthPoll = usePolling<BandwidthResponse>(
    "/api/bandwidth/today",
    30_000,
  );
  const bandwidthData =
    bandwidthPoll.data && bandwidthPoll.data.ok
      ? (bandwidthPoll.data as BandwidthToday)
      : null;

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10 flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span
            className="font-display text-2xl font-extrabold uppercase tracking-wide"
            style={{ fontStretch: "125%" }}
          >
            Numa<span className="text-accent">·</span>Radio
          </span>
          <nav className="flex items-center gap-4">
            <Link
              href="/chat"
              className="font-mono text-xs uppercase tracking-[0.2em] text-fg-mute hover:text-fg"
            >
              Talkback →
            </Link>
            <Link
              href="/shoutouts"
              className="font-mono text-xs uppercase tracking-[0.2em] text-fg-mute hover:text-fg"
            >
              Shoutouts →
            </Link>
            <Link
              href="/library"
              className="font-mono text-xs uppercase tracking-[0.2em] text-fg-mute hover:text-fg"
            >
              Library →
            </Link>
          </nav>
        </div>
        <span className="font-mono text-xs uppercase tracking-[0.2em] text-fg-mute">
          Operator · polling every 5s {isStale ? "· ⚠ stale, retrying" : ""}
        </span>
      </header>

      <StatusPills data={data} isStale={isStale} />
      <BandwidthPill data={bandwidthData} isStale={bandwidthPoll.isStale} />
      <HeldShoutoutsCard
        held={shoutoutsPoll.data?.held ?? []}
        onAction={shoutoutsPoll.refresh}
        hideWhenEmpty
      />
      <ServicesCard data={data} onActionComplete={refresh} />
      <HealthCard data={data} />
      <LogsCard />
    </main>
  );
}
