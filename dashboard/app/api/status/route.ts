import { NextResponse } from "next/server";
import {
  SERVICE_NAMES,
  getServiceState,
  type ServiceState,
} from "@/lib/systemd";
import { fetchIcecastStatus } from "@/lib/icecast";
import { fetchTunnelHealth, type TunnelHealth } from "@/lib/cloudflared";
import { checkNeon, checkB2, type HealthPing } from "@/lib/health";

export const dynamic = "force-dynamic";

interface StreamSnapshot {
  publicUrl: string;
  reachable: boolean;
  listeners: number | null;
  listenerPeak: number | null;
  bitrate: number | null;
  nowPlaying: { artist: string | null; title: string } | null;
  error?: string;
}

export async function GET(): Promise<NextResponse> {
  const publicUrl = process.env.STREAM_PUBLIC_URL ?? "https://api.numaradio.com/stream";
  const icecastUrl = process.env.ICECAST_STATUS_URL ?? "http://localhost:8000/status-json.xsl";
  const metricsUrl = process.env.CLOUDFLARED_METRICS_URL ?? "http://127.0.0.1:20241/metrics";

  const [icecastResult, servicesResult, neon, b2, tunnel] = await Promise.all([
    fetchIcecastStatus(icecastUrl, "/stream").then(
      (v) => ({ ok: true as const, v }),
      (e) => ({ ok: false as const, e }),
    ),
    Promise.all(SERVICE_NAMES.map((n) => getServiceState(n))) as Promise<ServiceState[]>,
    checkNeon(),
    checkB2(),
    fetchTunnelHealth(metricsUrl),
  ]);

  const stream = buildStreamSnapshot(publicUrl, icecastResult, tunnel);

  return NextResponse.json(
    {
      ts: new Date().toISOString(),
      stream,
      services: servicesResult,
      health: { neon, b2, tunnel } as { neon: HealthPing; b2: HealthPing; tunnel: unknown },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

function buildStreamSnapshot(
  publicUrl: string,
  icecast:
    | { ok: true; v: Awaited<ReturnType<typeof fetchIcecastStatus>> }
    | { ok: false; e: unknown },
  tunnel: TunnelHealth,
): StreamSnapshot {
  if (!icecast.ok) {
    return {
      publicUrl,
      reachable: false,
      listeners: null,
      listenerPeak: null,
      bitrate: null,
      nowPlaying: null,
      error: icecast.e instanceof Error ? icecast.e.message : "icecast probe failed",
    };
  }
  const s = icecast.v;
  // "Reachable" means a real listener could connect: Icecast has our mount AND
  // the tunnel is up. We do NOT probe the public /stream URL from here because
  // Icecast would count every poll as a listener and inflate the count.
  const sourceConnected = s.mount === "/stream";
  return {
    publicUrl,
    reachable: sourceConnected && tunnel.ok,
    listeners: s.listeners,
    listenerPeak: s.listenerPeak,
    bitrate: s.bitrate,
    nowPlaying: s.nowPlaying,
  };
}
