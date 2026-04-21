import { NextResponse } from "next/server";
import {
  fetchSongRequestPublic,
  queuePositionFor,
} from "@/lib/song-request";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const row = await fetchSongRequestPublic(id);
  if (!row) {
    return NextResponse.json(
      { ok: false, error: "not_found" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  let queuePosition: number | undefined;
  let estWaitSeconds: number | undefined;
  if (row.status === "queued") {
    queuePosition = await queuePositionFor(row.id, row.createdAt);
    estWaitSeconds = queuePosition * 210;
  }

  const audioUrl = row.track?.assets.find((a) => a.assetType === "audio_stream")
    ?.publicUrl;
  const artworkUrl = row.track?.assets.find((a) => a.assetType === "artwork_primary")
    ?.publicUrl;

  return NextResponse.json(
    {
      ok: true,
      status: row.status,
      errorMessage: row.errorMessage,
      finalArtistName: row.artistName,
      artistNameSubstituted: row.originalArtistName !== null,
      title: row.track?.title ?? row.titleGenerated ?? null,
      audioUrl: audioUrl ?? null,
      artworkUrl: artworkUrl ?? null,
      isInstrumental: row.isInstrumental,
      lyricsFallback: row.lyricsFallback,
      trackId: row.trackId,
      durationSeconds: row.track?.durationSeconds ?? null,
      queuePosition,
      estWaitSeconds,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
