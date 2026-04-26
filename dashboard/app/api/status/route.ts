import { NextResponse } from "next/server";
import {
  SERVICE_NAMES,
  getServiceState,
  type ServiceState,
} from "@/lib/systemd";
import { fetchIcecastStatus } from "@/lib/icecast";
import { fetchTunnelHealth, type TunnelHealth } from "@/lib/cloudflared";
import { checkNeon, checkB2, type HealthPing } from "@/lib/health";
import { fetchSiteVisitors } from "@/lib/presence";
import { getDbPool } from "@/lib/db";

export const dynamic = "force-dynamic";

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";

/** Authoritative now-playing from Neon — Icecast metadata is unreliable
 *  because Liquidsoap only pushes title/artist when the source MP3 has
 *  ID3 tags. A track without tags leaves Icecast frozen on the previous
 *  track's metadata, which read as "stuck" on the dashboard. */
async function fetchNowPlayingFromDb(): Promise<{ artist: string | null; title: string } | null> {
  try {
    const { rows } = await getDbPool().query<{ title: string | null; artist: string | null }>(
      `SELECT t.title AS title, t."artistDisplay" AS artist
         FROM "NowPlaying" np
         JOIN "Station" s ON s.id = np."stationId"
         LEFT JOIN "Track" t ON t.id = np."currentTrackId"
        WHERE s.slug = $1
        LIMIT 1`,
      [STATION_SLUG],
    );
    const r = rows[0];
    if (!r?.title) return null;
    return { artist: r.artist, title: r.title };
  } catch {
    return null;
  }
}

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

  const [icecastResult, servicesResult, neon, b2, tunnel, visitors, dbNowPlaying] = await Promise.all([
    fetchIcecastStatus(icecastUrl, "/stream").then(
      (v) => ({ ok: true as const, v }),
      (e) => ({ ok: false as const, e }),
    ),
    Promise.all(SERVICE_NAMES.map((n) => getServiceState(n))) as Promise<ServiceState[]>,
    checkNeon(),
    checkB2(),
    fetchTunnelHealth(metricsUrl),
    fetchSiteVisitors(),
    fetchNowPlayingFromDb(),
  ]);

  const stream = buildStreamSnapshot(publicUrl, icecastResult, tunnel, dbNowPlaying);

  return NextResponse.json(
    {
      ts: new Date().toISOString(),
      stream,
      services: servicesResult,
      health: { neon, b2, tunnel } as { neon: HealthPing; b2: HealthPing; tunnel: unknown },
      site: { visitors },
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
  dbNowPlaying: { artist: string | null; title: string } | null,
): StreamSnapshot {
  if (!icecast.ok) {
    return {
      publicUrl,
      reachable: false,
      listeners: null,
      listenerPeak: null,
      bitrate: null,
      // Even when Icecast is unreachable, Neon still knows what's airing
      // (the daemon writes NowPlaying on the on_track callback path).
      nowPlaying: dbNowPlaying,
      error: icecast.e instanceof Error ? icecast.e.message : "icecast probe failed",
    };
  }
  const s = icecast.v;
  // "Reachable" means a real listener could connect: Icecast has our mount AND
  // the tunnel is up. We do NOT probe the public /stream URL from here because
  // Icecast would count every poll as a listener and inflate the count.
  const sourceConnected = s.mount === "/stream";
  // Prefer the DB now-playing (always fresh, fed by track-started). Fall
  // back to whatever Icecast last reported only if the DB query failed,
  // so the dashboard never shows worse data than before.
  return {
    publicUrl,
    reachable: sourceConnected && tunnel.ok,
    listeners: s.listeners,
    listenerPeak: s.listenerPeak,
    bitrate: s.bitrate,
    nowPlaying: dbNowPlaying ?? s.nowPlaying,
  };
}
