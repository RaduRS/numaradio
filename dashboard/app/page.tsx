"use client";
import { usePolling } from "@/hooks/use-polling";
import { StatusPills } from "@/components/status-pills";
import { ServicesCard } from "@/components/services-card";
import { HealthCard } from "@/components/health-card";
import { LogsCard } from "@/components/logs-card";
import type { StatusSnapshot } from "@/lib/types";

export default function OperatorDashboard() {
  const { data, isStale, refresh } = usePolling<StatusSnapshot>("/api/status", 5_000);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10 flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <span
          className="font-display text-2xl font-extrabold uppercase tracking-wide"
          style={{ fontStretch: "125%" }}
        >
          Numa<span className="text-accent">·</span>Radio
        </span>
        <span className="font-mono text-xs uppercase tracking-[0.2em] text-fg-mute">
          Operator · polling every 5s {isStale ? "· ⚠ stale, retrying" : ""}
        </span>
      </header>

      <StatusPills data={data} isStale={isStale} />
      <ServicesCard data={data} onActionComplete={refresh} />
      <HealthCard data={data} />
      <LogsCard />
    </main>
  );
}
