import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { getDbPool } from "@/lib/db";

export const dynamic = "force-dynamic";

const PLAYLIST_PATH = process.env.NUMA_PLAYLIST_PATH ?? "/etc/numa/playlist.m3u";
const MANUAL_PATH = process.env.NUMA_MANUAL_ROTATION_PATH ?? "/etc/numa/manual-rotation.json";
const DEFAULT_LIMIT = 20;
const TRACK_ID_RE = /\/tracks\/([^/]+)\//;

export type UpcomingTrack = {
  id: string;
  position: number;
  title: string;
  artist: string | null;
  durationSeconds: number | null;
  artworkUrl: string | null;
  ageDays: number | null;
};

async function fileExists(p: string): Promise<boolean> {
  try { await stat(p); return true; }
  catch { return false; }
}

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit")) || DEFAULT_LIMIT));

  let raw = "";
  try { raw = await readFile(PLAYLIST_PATH, "utf8"); }
  catch (e) {
    return NextResponse.json({ ok: false, error: `cannot read ${PLAYLIST_PATH}: ${(e as Error).message}` }, { status: 503 });
  }

  const ids = raw.split("\n")
    .map((line) => line.match(TRACK_ID_RE)?.[1])
    .filter((x): x is string => !!x)
    .slice(0, limit);

  if (ids.length === 0) {
    return NextResponse.json({ ok: true, manualMode: false, tracks: [] });
  }

  // Resolve to titles via Postgres. Order-preserving join — the m3u order
  // is authoritative, so we re-sort the DB result by ids' position.
  const pool = getDbPool();
  const result = await pool.query<{
    id: string;
    title: string;
    artist_display: string | null;
    duration_seconds: number | null;
    artwork_url: string | null;
    created_at: Date;
  }>(
    `SELECT
       t.id,
       t.title,
       t."artistDisplay" AS artist_display,
       t."durationSeconds" AS duration_seconds,
       t."createdAt" AS created_at,
       art."publicUrl" AS artwork_url
     FROM "Track" t
     LEFT JOIN LATERAL (
       SELECT "publicUrl"
       FROM "TrackAsset"
       WHERE "trackId" = t.id AND "assetType" = 'artwork_primary'
       ORDER BY "createdAt" DESC
       LIMIT 1
     ) art ON true
     WHERE t.id = ANY($1::text[])`,
    [ids],
  );
  const byId = new Map(result.rows.map((r) => [r.id, r]));
  const now = Date.now();

  const tracks: UpcomingTrack[] = ids.map((id, i) => {
    const r = byId.get(id);
    return {
      id,
      position: i + 1,
      title: r?.title ?? "(unknown)",
      artist: r?.artist_display ?? null,
      durationSeconds: r?.duration_seconds ?? null,
      artworkUrl: r?.artwork_url ?? null,
      ageDays: r?.created_at ? Math.floor((now - r.created_at.getTime()) / 86400000) : null,
    };
  });

  const manualMode = await fileExists(MANUAL_PATH);
  return NextResponse.json({ ok: true, manualMode, tracks });
}
