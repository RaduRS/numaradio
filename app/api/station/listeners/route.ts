// GET /api/station/listeners
//
// Proxies Icecast's status-json.xsl so the browser can poll it without CORS
// pain or Icecast URL leakage. Returns:
//   { listeners: number, withFloor: number, isLive: boolean }
//
// Note on the name: `withFloor` is kept for backwards compatibility with the
// ListenerCount component. Semantically it's now "real listeners + BOOST" —
// the ambient number is added, not capped — so the count always moves when
// a real listener joins, while still presenting a non-dead station on day 0.
//
// Requires the cloudflared tunnel on the mini-server to expose the Icecast
// status JSON publicly. Add this ingress entry above the /stream rule:
//
//   - hostname: api.numaradio.com
//     path: /status-json.xsl
//     service: http://localhost:8000
//
// If unreachable, this route falls back to {listeners: 0, withFloor: BOOST}.

const STATUS_URL = "https://api.numaradio.com/status-json.xsl";
const BOOST = 15; // ambient listeners added on top of the real count
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
    const listeners = Math.max(0, stream?.listeners ?? 0);

    return Response.json(
      {
        listeners,
        withFloor: BOOST + listeners,
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
      { listeners: 0, withFloor: BOOST, isLive: false },
      {
        headers: {
          "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=30`,
        },
      },
    );
  }
}
