import { NextResponse } from "next/server";
import { fetchIcecastStatus } from "@/lib/icecast";

export const dynamic = "force-dynamic";

const STATUS_URL = process.env.ICECAST_STATUS_URL ?? "http://127.0.0.1:8000/status-json.xsl";
const MOUNT = process.env.ICECAST_MOUNT ?? "/stream";
const BOOST = 15;

export async function GET(): Promise<NextResponse> {
  try {
    const s = await fetchIcecastStatus(STATUS_URL, MOUNT);
    const listeners = typeof s.listeners === "number" ? Math.max(0, s.listeners) : 0;
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
