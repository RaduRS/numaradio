import { NextResponse } from "next/server";
import {
  SERVICE_NAMES,
  getServiceState,
  type ServiceState,
} from "@/lib/systemd";
import { fetchIcecastStatus } from "@/lib/icecast";
import { fetchTunnelHealth } from "@/lib/cloudflared";
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

async function probeStreamReachable(url: string, timeoutMs = 2_000): Promise<boolean> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { Range: "bytes=0-1" }, signal: ctl.signal });
    return res.status === 200 || res.status === 206;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function streamSnapshot(): Promise<StreamSnapshot> {
  const publicUrl = process.env.STREAM_PUBLIC_URL ?? "https://api.numaradio.com/stream";
  const icecastUrl = process.env.ICECAST_STATUS_URL ?? "http://localhost:8000/status-json.xsl";
  const [reachable, icecast] = await Promise.allSettled([
    probeStreamReachable(publicUrl),
    fetchIcecastStatus(icecastUrl, "/stream"),
  ]);
  const ok = reachable.status === "fulfilled" ? reachable.value : false;
  if (icecast.status === "fulfilled") {
    const s = icecast.value;
    return {
      publicUrl,
      reachable: ok,
      listeners: s.listeners,
      listenerPeak: s.listenerPeak,
      bitrate: s.bitrate,
      nowPlaying: s.nowPlaying,
    };
  }
  return {
    publicUrl,
    reachable: ok,
    listeners: null,
    listenerPeak: null,
    bitrate: null,
    nowPlaying: null,
    error: icecast.reason instanceof Error ? icecast.reason.message : "icecast probe failed",
  };
}

export async function GET(): Promise<NextResponse> {
  const metricsUrl = process.env.CLOUDFLARED_METRICS_URL ?? "http://127.0.0.1:20241/metrics";
  const [stream, services, neon, b2, tunnel] = await Promise.all([
    streamSnapshot(),
    Promise.all(SERVICE_NAMES.map((n) => getServiceState(n))) as Promise<ServiceState[]>,
    checkNeon(),
    checkB2(),
    fetchTunnelHealth(metricsUrl),
  ]);
  return NextResponse.json(
    {
      ts: new Date().toISOString(),
      stream,
      services,
      health: { neon, b2, tunnel } as { neon: HealthPing; b2: HealthPing; tunnel: unknown },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
