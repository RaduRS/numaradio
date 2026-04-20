// POST /api/internal/shoutout-ended
//
// Called by Liquidsoap when the overlay_queue source goes idle (Lena
// finished speaking). Clears NowSpeaking so the Hero drops its pill and
// the music bed is the only thing advertised. The expected-end window on
// NowSpeaking is a backup; this is the authoritative clear.
//
// Auth: shared secret in `x-internal-secret` header.

import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";

export async function POST(req: Request) {
  const secret = req.headers.get("x-internal-secret");
  const expected = process.env.INTERNAL_API_SECRET;
  if (!expected || secret !== expected) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const station = await prisma.station.findUnique({
    where: { slug: STATION_SLUG },
    select: { id: true },
  });
  if (!station) {
    return Response.json({ error: "unknown station" }, { status: 404 });
  }

  await prisma.nowSpeaking
    .delete({ where: { stationId: station.id } })
    .catch(() => {
      // Idempotent: nothing to delete is fine.
    });

  return Response.json({ ok: true });
}
