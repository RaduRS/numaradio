"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { StatusSnapshot } from "@/lib/types";

interface Props {
  data: StatusSnapshot | null;
}

function Row({
  label,
  ok,
  detail,
  error,
}: {
  label: string;
  ok: boolean | undefined;
  detail?: string;
  error?: string;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-line last:border-0">
      <span className="font-mono text-sm">{label}</span>
      <span className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${ok ? "bg-accent" : ok === false ? "bg-[var(--bad)]" : "bg-fg-mute"}`}
        />
        <span className="text-xs text-fg-dim" title={error ?? undefined}>
          {ok === undefined ? "—" : ok ? (detail ?? "OK") : (error ?? "fail")}
        </span>
      </span>
    </div>
  );
}

export function HealthCard({ data }: Props) {
  const h = data?.health;
  return (
    <Card className="bg-bg-1 border-line">
      <CardHeader>
        <CardTitle className="font-mono text-xs uppercase tracking-[0.2em] text-fg-mute">
          Health
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Row
          label="Neon Postgres"
          ok={h?.neon.ok}
          detail={h?.neon.latencyMs !== undefined ? `${h.neon.latencyMs} ms` : undefined}
          error={h?.neon.error}
        />
        <Row
          label="Backblaze B2"
          ok={h?.b2.ok}
          detail={h?.b2.latencyMs !== undefined ? `${h.b2.latencyMs} ms` : undefined}
          error={h?.b2.error}
        />
        <Row
          label="Cloudflare Tunnel"
          ok={h?.tunnel.ok}
          detail={h ? `${h.tunnel.connections} conn` : undefined}
          error={h?.tunnel.error}
        />
      </CardContent>
    </Card>
  );
}
