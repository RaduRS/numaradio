// GET /api/station/listeners
//
// Proxies Icecast's status-json.xsl so the browser can poll it without CORS
// pain or Icecast URL leakage. Returns:
//   { listeners: number, withFloor: number, isLive: boolean }
//
// `withFloor` = real listeners + ambient floor. The floor is a deterministic
// pseudo-random value that drifts with time-of-day (sine peaking at 20:00
// UTC) and jumps to a fresh number every 6 min inside a [12, 45] band. All
// clients hitting the API within the same 6-min window see the same value —
// so the frontend doesn't look frozen, but also doesn't flicker.
//
// Requires the cloudflared tunnel on the mini-server to expose the Icecast
// status JSON publicly. Add this ingress entry above the /stream rule:
//
//   - hostname: api.numaradio.com
//     path: /status-json.xsl
//     service: http://localhost:8000
//
// If Icecast is unreachable we still return a plausible floor so the hero
// doesn't read as a dead station.

import { ambientFloor } from "@/lib/ambient-floor";
import { fetchPublicYoutubeState } from "@/lib/youtube-public";

const STATUS_URL = "https://api.numaradio.com/status-json.xsl";
// Bumped from 5s (2026-05-03 free-tier audit). Listener count is
// already fudged via ambientFloor() and the public hero adds +15 — a
// 30s lag is invisible to listeners but cuts function fires by 6×.
const CACHE_SECONDS = 30;

type IcecastSource = {
  listenurl?: string;
  listeners?: number;
};

type IcecastStatus = {
  icestats?: {
    source?: IcecastSource | IcecastSource[];
  };
};

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const r = await fetch(STATUS_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    if (!r.ok) throw new Error(`upstream ${r.status}`);

    const data = (await r.json()) as IcecastStatus;
    const sources = data.icestats?.source;
    const list: IcecastSource[] = Array.isArray(sources)
      ? sources
      : sources
        ? [sources]
        : [];

    const stream =
      list.find((s) => s.listenurl?.endsWith("/stream")) ?? list[0];
    // While broadcasting to YouTube, the encoder pulls icecast as a
    // media source — it counts as 1 raw listener. Subtract it so the
    // public count reflects real audio listeners only.
    // fetchPublicYoutubeState is in-process cached 60s — no extra
    // YouTube API quota burn for this call.
    const yt = await fetchPublicYoutubeState();
    const rawListeners = Math.max(0, stream?.listeners ?? 0);
    const listeners = Math.max(
      0,
      rawListeners - (yt.state === "live" ? 1 : 0),
    );
    const floor = ambientFloor(Date.now());

    return Response.json(
      {
        listeners,
        withFloor: floor + listeners,
        isLive: list.length > 0,
      },
      {
        headers: {
          "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=30`,
        },
      },
    );
  } catch {
    return Response.json(
      { listeners: 0, withFloor: ambientFloor(Date.now()), isLive: false },
      {
        headers: {
          "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=30`,
        },
      },
    );
  }
}
