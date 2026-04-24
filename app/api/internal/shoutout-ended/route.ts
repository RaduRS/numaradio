// POST /api/internal/shoutout-ended
//
// Called by Liquidsoap when the overlay_queue source goes idle (Lena
// finished speaking). Two jobs:
//   1. Clear NowSpeaking so the Hero drops its "Lena on air" pill.
//   2. Delete the transient shoutout track (B2 MP3 + Track/TrackAsset/
//      PlayHistory/QueueItem rows). The Shoutout moderation audit row
//      survives — only the generated audio is ephemeral.
//
// Auth: shared secret in `x-internal-secret` header.

import { prisma } from "@/lib/db";
import { deleteAiredShoutout } from "@/lib/delete-aired-shoutout";
import { internalAuthOk } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";

export async function POST(req: Request) {
  if (!internalAuthOk(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const station = await prisma.station.findUnique({
    where: { slug: STATION_SLUG },
    select: { id: true },
  });
  if (!station) {
    return Response.json({ error: "unknown station" }, { status: 404 });
  }

  // Grab the trackId BEFORE clearing NowSpeaking — we need it to know
  // which track's artifacts to clean up.
  const nowSpeaking = await prisma.nowSpeaking.findUnique({
    where: { stationId: station.id },
    select: { trackId: true },
  });

  await prisma.nowSpeaking
    .delete({ where: { stationId: station.id } })
    .catch(() => {
      // Idempotent: nothing to delete is fine.
    });

  let cleanup: Awaited<ReturnType<typeof deleteAiredShoutout>> | null = null;
  if (nowSpeaking?.trackId) {
    try {
      cleanup = await deleteAiredShoutout(nowSpeaking.trackId);
    } catch (e) {
      // Don't fail the request — NowSpeaking is already cleared, which
      // is the user-visible part. Log and move on; an operator can
      // clean the orphan track from the dashboard if needed.
      console.warn(
        `shoutout-ended: cleanup failed for trackId=${nowSpeaking.trackId}: ${
          e instanceof Error ? e.message : "unknown"
        }`,
      );
    }
  }

  return Response.json({ ok: true, cleanup });
}
