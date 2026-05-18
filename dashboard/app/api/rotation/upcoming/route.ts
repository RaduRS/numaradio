import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { getDbPool } from "@/lib/db";

export const dynamic = "force-dynamic";

const PLAYLIST_PATH = process.env.NUMA_PLAYLIST_PATH ?? "/etc/numa/playlist.m3u";
const MANUAL_PATH = process.env.NUMA_MANUAL_ROTATION_PATH ?? "/etc/numa/manual-rotation.json";
const CYCLE_ORDER_PATH = process.env.NUMA_CYCLE_ORDER_PATH ?? "/etc/numa/cycle-order.json";
const DEFAULT_LIMIT = 20;
const TRACK_ID_RE = /\/tracks\/([^/]+)\//;

async function readCycleOrderCreatedAt(): Promise<number | null> {
  try {
    const raw = await readFile(CYCLE_ORDER_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Number(parsed?.createdAt) || null;
  } catch {
    return null;
  }
}

export type UpcomingTrack = {
  id: string;
  position: number;
  title: string;
  artist: string | null;
  durationSeconds: number | null;
  artworkUrl: string | null;
  ageDays: number | null;
  genre: string | null;
  show: string | null;
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

  const allIds = raw.split("\n")
    .map((line) => line.match(TRACK_ID_RE)?.[1])
    .filter((x): x is string => !!x);

  // The m3u is now written once per cycle (full cycleOrder), not on
  // every track-started. Strip tracks already aired since the current
  // cycle's createdAt — that's how the dashboard derives "what's next"
  // without making Liquidsoap go out of order. Fall back to showing
  // the raw m3u contents if cycle-order.json is missing (e.g. manual
  // mode + stale state, or pre-deploy).
  const cycleCreatedAt = await readCycleOrderCreatedAt();
  let ids = allIds;
  if (cycleCreatedAt !== null && allIds.length > 0) {
    const pool = getDbPool();
    // Bind the timestamp as an ISO string, NOT a Date object. pg formats
    // Date params as local-time strings for `timestamp without time zone`
    // columns, so on a non-UTC host the comparison is offset by the local
    // tz and matches nothing. The dashboard's read-side type parser
    // (lib/db.ts) only fixes parsing, not binding.
    const playedRes = await pool.query<{ track_id: string }>(
      `SELECT DISTINCT "trackId" AS track_id
       FROM "PlayHistory"
       WHERE "trackId" = ANY($1::text[]) AND "startedAt" >= $2`,
      [allIds, new Date(cycleCreatedAt).toISOString()],
    );
    const played = new Set(playedRes.rows.map((r) => r.track_id));
    ids = allIds.filter((id) => !played.has(id));
  }
  ids = ids.slice(0, limit);

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
    genre: string | null;
    show: string | null;
  }>(
    `SELECT
       t.id,
       t.title,
       t."artistDisplay" AS artist_display,
       t."durationSeconds" AS duration_seconds,
       t."createdAt" AS created_at,
       t.genre,
       t.show,
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
      genre: r?.genre ?? null,
      show: r?.show ?? null,
    };
  });

  const manualMode = await fileExists(MANUAL_PATH);
  return NextResponse.json({ ok: true, manualMode, tracks });
}
