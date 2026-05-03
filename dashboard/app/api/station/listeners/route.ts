import { NextResponse } from "next/server";
import { fetchIcecastStatus } from "@/lib/icecast";
import { fetchYoutubeSnapshot } from "@/lib/youtube";

export const dynamic = "force-dynamic";

const STATUS_URL = process.env.ICECAST_STATUS_URL ?? "http://127.0.0.1:8000/status-json.xsl";
const MOUNT = process.env.ICECAST_MOUNT ?? "/stream";
const BOOST = 15;

export async function GET(): Promise<NextResponse> {
  try {
    // While broadcasting, the OBS/encoder pulls icecast as a media
    // source and counts as 1 raw listener. Subtract it so the
    // /shoutouts label matches the dashboard pill.
    // fetchYoutubeSnapshot is in-process cached 30s — no extra
    // YouTube API quota burn.
    const [s, yt] = await Promise.all([
      fetchIcecastStatus(STATUS_URL, MOUNT),
      fetchYoutubeSnapshot().catch(() => null),
    ]);
    const rawListeners =
      typeof s.listeners === "number" ? Math.max(0, s.listeners) : 0;
    // Mirror the daemon's auto-chatter gate exactly:
    //   effective = icecast + (live ? yt_viewers - 1 : 0)
    // The -1 accounts for the OBS/encoder pulling icecast as a media
    // source while broadcasting. Keeps the /shoutouts label honest
    // about why Lena spoke (or didn't).
    const liveBroadcast = yt?.state === "live";
    const ytViewers =
      liveBroadcast && typeof yt?.concurrentViewers === "number"
        ? Math.max(0, yt.concurrentViewers)
        : 0;
    const listeners = Math.max(
      0,
      rawListeners + (liveBroadcast ? ytViewers - 1 : 0),
    );
    return NextResponse.json({
      ok: true,
      listeners,
      withFloor: BOOST + listeners,
      isLive: s.mount !== null,
    });
  } catch {
    return NextResponse.json({
      ok: false,
      listeners: null,
      withFloor: BOOST,
      isLive: false,
    });
  }
}
