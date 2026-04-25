// POST /api/internal/shoutout-ended
//
// Called by Liquidsoap when the overlay_queue source goes idle (Lena
// finished speaking). Two jobs:
//   1. Clear NowSpeaking so the Hero drops its "Lena on air" pill.
//   2. Delete the transient shoutout track (B2 MP3 + Track/TrackAsset/
//      PlayHistory/QueueItem rows). The Shoutout moderation audit row
//      survives — only the generated audio is ephemeral.
//
// Idempotency: Liquidsoap can fire the callback twice (retry on a
// network blip, or a glitch in source.on_end's delay logic). The
// route tolerates a double-fire because:
//   - NowSpeaking delete is wrapped in catch (no-op if already gone)
//   - trackId is resolved from the request body's sourceUrl when
//     present, so cleanup doesn't depend on NowSpeaking state that
//     the first fire already cleared
//   - deleteAiredShoutout returns { deleted: false, reason:
//     "track_not_found" } for an already-cleaned track
//
// Auth: shared secret in `x-internal-secret` header.

import { prisma } from "@/lib/db";
import { deleteAiredShoutout } from "@/lib/delete-aired-shoutout";
import { internalAuthOk } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";

function extractTrackId(url: string): string | null {
  const m = url.match(/\/tracks\/([^/]+)\/audio\//);
  return m?.[1] ?? null;
}

export async function POST(req: Request) {
  if (!internalAuthOk(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { sourceUrl?: unknown; trackId?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // Pre-2026-04-25 Liquidsoap sent `data="{}"` literally — empty
    // body is still a valid call from the legacy config.
  }

  const station = await prisma.station.findUnique({
    where: { slug: STATION_SLUG },
    select: { id: true },
  });
  if (!station) {
    return Response.json({ error: "unknown station" }, { status: 404 });
  }

  // Resolve the trackId, in priority order:
  //   1. body.trackId (future-proof — explicit pass-through)
  //   2. extracted from body.sourceUrl (current Liquidsoap config)
  //   3. NowSpeaking row (legacy fallback for a daemon running pre-fix
  //      config; remove this fallback only after confirming all
  //      Liquidsoap instances are upgraded)
  let trackId: string | null =
    typeof body.trackId === "string" && body.trackId.length > 0
      ? body.trackId
      : null;
  if (!trackId && typeof body.sourceUrl === "string") {
    trackId = extractTrackId(body.sourceUrl);
  }
  let resolvedFrom: "body" | "now-speaking" = trackId ? "body" : "now-speaking";

  if (!trackId) {
    // Legacy path: read from NowSpeaking BEFORE we clear it.
    const ns = await prisma.nowSpeaking.findUnique({
      where: { stationId: station.id },
      select: { trackId: true },
    });
    trackId = ns?.trackId ?? null;
  }

  // Clear the user-visible "Lena on air" pill regardless.
  await prisma.nowSpeaking
    .delete({ where: { stationId: station.id } })
    .catch(() => {
      // Idempotent: already gone is fine.
    });

  let cleanup: Awaited<ReturnType<typeof deleteAiredShoutout>> | null = null;
  if (trackId) {
    try {
      cleanup = await deleteAiredShoutout(trackId);
    } catch (e) {
      console.warn(
        `shoutout-ended: cleanup failed for trackId=${trackId} (resolvedFrom=${resolvedFrom}): ${
          e instanceof Error ? e.message : "unknown"
        }`,
      );
    }
  }

  return Response.json({ ok: true, resolvedFrom, trackId, cleanup });
}
