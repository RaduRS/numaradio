"use client";
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
    <main className="mx-auto w-full max-w-6xl px-4 py-6 flex flex-col gap-6 sm:gap-8 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-1">
        <h1
          className="font-display text-3xl font-extrabold uppercase tracking-wide text-fg"
          style={{ fontStretch: "115%" }}
        >
          Console
        </h1>
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
