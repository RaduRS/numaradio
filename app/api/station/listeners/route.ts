// GET /api/station/listeners
//
// Proxies Icecast's status-json.xsl so the browser can poll it without CORS
// pain or Icecast URL leakage. Returns:
//   { listeners: number, withFloor: number, isLive: boolean }
//
// Requires the cloudflared tunnel on the mini-server to expose the Icecast
// status JSON publicly. Add this ingress entry above the /stream rule:
//
//   - hostname: api.numaradio.com
//     path: /status-json.xsl
//     service: http://localhost:8000
//
// If unreachable, this route falls back to {listeners: 0, withFloor: FLOOR}.

const STATUS_URL = "https://api.numaradio.com/status-json.xsl";
const FLOOR = 15; // never show fewer than this — radio feels dead at zero
const CACHE_SECONDS = 5;

type IcecastSource = {
  listenurl?: string;
  listeners?: number;
};

type IcecastStatus = {
  icestats?: {
    source?: IcecastSource | IcecastSource[];
  };
};

// Always re-evaluate per request; let the CDN handle caching via Cache-Control.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const r = await fetch(STATUS_URL, {
      cache: "no-store",
      // Icecast can be slow under load; bound the wait.
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

    // We only care about our /stream mount, but if there's just one source
    // that's the one regardless of mount path.
    const stream =
      list.find((s) => s.listenurl?.endsWith("/stream")) ?? list[0];
    const listeners = Math.max(0, stream?.listeners ?? 0);

    return Response.json(
      {
        listeners,
        withFloor: Math.max(FLOOR, listeners),
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
      { listeners: 0, withFloor: FLOOR, isLive: false },
      {
        headers: {
          "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=30`,
        },
      },
    );
  }
}
