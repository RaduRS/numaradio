import "../lib/load-env.ts";
import { randomBytes } from "node:crypto";
import { writeFile, rename, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

export type RotationTrack = { id: string; url: string; title: string };

export type RefreshResult = {
  librarySize: number;
  cyclePlayed: number;
  poolSize: number;
  cycleWrapped: boolean;
  /** True when this refresh wrote the operator's manually-ordered queue
   *  (read from MANUAL_PATH) instead of an auto-shuffled pool. */
  manualMode: boolean;
};

const PLAYLIST_PATH = process.env.NUMA_PLAYLIST_PATH ?? "/etc/numa/playlist.m3u";
const MANUAL_PATH = process.env.NUMA_MANUAL_ROTATION_PATH ?? "/etc/numa/manual-rotation.json";

export type ManualRotation = { trackIds: string[]; setAt: number };

export async function readManualRotation(path: string = MANUAL_PATH): Promise<ManualRotation | null> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.trackIds)) return null;
    return { trackIds: parsed.trackIds.filter((x: unknown): x is string => typeof x === "string"), setAt: Number(parsed.setAt) || Date.now() };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    console.error(`[refresh-rotation] failed to read ${path}:`, err);
    return null;
  }
}

export async function writeManualRotation(trackIds: string[], path: string = MANUAL_PATH): Promise<void> {
  const payload: ManualRotation = { trackIds, setAt: Date.now() };
  const suffix = randomBytes(4).toString("hex");
  const tmpPath = join(tmpdir(), `manual-rotation-${process.pid}-${Date.now()}-${suffix}.json`);
  await writeFile(tmpPath, JSON.stringify(payload), "utf8");
  await rename(tmpPath, path);
}

export async function clearManualRotation(path: string = MANUAL_PATH): Promise<void> {
  try { await unlink(path); }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
}

/**
 * Build the m3u content from a manual track-id list. Drops ids that are no
 * longer in the library (deleted/unready) and ids already in cycleExclude
 * (already aired in current cycle, or currently playing — bridge against
 * immediate repeat). Order is preserved verbatim — no shuffle.
 */
export function buildManualPlaylist(
  library: RotationTrack[],
  manualIds: string[],
  cycleExclude: Set<string>,
): { content: string; remainingIds: string[] } {
  const byId = new Map(library.map((t) => [t.id, t]));
  const remaining: RotationTrack[] = [];
  for (const id of manualIds) {
    if (cycleExclude.has(id)) continue;
    const t = byId.get(id);
    if (t) remaining.push(t);
  }
  const content = remaining.length === 0 ? "" : remaining.map((t) => t.url).join("\n") + "\n";
  return { content, remainingIds: remaining.map((t) => t.id) };
}

/**
 * Walk PlayHistory (most recent first) collecting distinct track ids until
 * we see a duplicate (= entered previous cycle) or until we've seen the
 * whole library (= cycle just completed). The returned set is "what has
 * already aired in the current generational cycle".
 */
export function cyclePlayedFrom(recentIds: string[], librarySize: number): Set<string> {
  const seen = new Set<string>();
  for (const id of recentIds) {
    if (seen.has(id)) break;
    seen.add(id);
    if (seen.size >= librarySize) break;
  }
  return seen;
}

/**
 * Generational rotation: shuffle the not-yet-aired tracks from the current
 * cycle. When the cycle is exhausted, wrap and shuffle the whole library
 * minus the bridge (currently-playing track) so the first track of the new
 * cycle can never be the last track of the old one.
 */
export function buildPlaylist(
  library: RotationTrack[],
  cycleExclude: Set<string>,
  bridgeExclude: Set<string>,
  rng: () => number = Math.random,
): string {
  if (library.length === 0) return "";
  let pool = library.filter((t) => !cycleExclude.has(t.id));
  if (pool.length === 0) {
    // Cycle wrap. Bridge: keep the just-played track out so the seam
    // between cycle N and N+1 can't repeat the same track back-to-back.
    pool = library.filter((t) => !bridgeExclude.has(t.id));
    // Degenerate library of size 1: bridge would empty the pool — accept
    // the immediate repeat rather than write nothing.
    if (pool.length === 0) pool = library;
  }
  // Fisher–Yates
  const a = pool.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.map((t) => t.url).join("\n") + "\n";
}

/**
 * Reads the library, derives the current cycle from PlayHistory, shuffles
 * the remaining tracks, and atomically rewrites the playlist file. Exported
 * so the queue-daemon can fire this on every track-started callback in
 * addition to the safety-net systemd timer. Caller owns the prisma lifecycle.
 */
export async function runRefresh(
  prisma: Pick<PrismaClient, "station" | "track" | "playHistory" | "nowPlaying">,
): Promise<RefreshResult> {
  const station = await prisma.station.findUniqueOrThrow({
    where: { slug: process.env.STATION_SLUG ?? "numaradio" },
    select: { id: true },
  });

  const tracks = await prisma.track.findMany({
    where: {
      stationId: station.id,
      trackStatus: "ready",
      airingPolicy: "library",
    },
    select: {
      id: true,
      title: true,
      assets: {
        where: { assetType: "audio_stream" },
        take: 1,
        select: { publicUrl: true },
      },
    },
  });

  const library: RotationTrack[] = tracks.flatMap((t) => {
    const asset = t.assets[0];
    return asset?.publicUrl ? [{ id: t.id, url: asset.publicUrl, title: t.title }] : [];
  });

  // Read enough history to detect a cycle wrap (one full library + slack).
  const historyTake = Math.max(library.length * 2, 8);

  const readState = async (): Promise<{ cyclePlayed: Set<string>; nowPlayingId: string | null }> => {
    const [recent, nowPlaying] = await Promise.all([
      prisma.playHistory.findMany({
        where: { stationId: station.id, trackId: { not: null } },
        orderBy: { startedAt: "desc" },
        take: historyTake,
        select: { trackId: true },
      }),
      prisma.nowPlaying.findUnique({
        where: { stationId: station.id },
        select: { currentTrackId: true },
      }),
    ]);
    return {
      cyclePlayed: cyclePlayedFrom(
        recent.map((r) => r.trackId!).filter(Boolean),
        library.length,
      ),
      nowPlayingId: nowPlaying?.currentTrackId ?? null,
    };
  };

  // Race-guard: a `track-started` transaction (Liquidsoap → Vercel →
  // Neon: NowPlaying upsert + PlayHistory insert) takes ~100-500 ms to
  // commit. If we read in that window the just-started track is invisible
  // to both reads. Reading twice with a 300 ms gap and unioning closes
  // the window — same pattern that protected the old sliding-window
  // implementation against back-to-back airings.
  const before = await readState();
  await new Promise((r) => setTimeout(r, 300));
  const after = await readState();

  const cycleExclude = new Set<string>([...before.cyclePlayed, ...after.cyclePlayed]);
  const bridgeExclude = new Set<string>();
  const nowPlayingId = after.nowPlayingId ?? before.nowPlayingId;
  if (nowPlayingId) {
    cycleExclude.add(nowPlayingId);
    bridgeExclude.add(nowPlayingId);
  }

  // Manual rotation override: if the operator has dropped a manual order
  // from the dashboard, write THAT (verbatim, no shuffle) instead of the
  // auto-shuffled cycle. The "exhausted" check is tied to PlayHistory
  // since the manual order's setAt — NOT to cycleExclude — so the manual
  // queue can't be prematurely cleared by an unrelated priority-queue
  // push or a concurrent runRefresh seeing a slightly fresher cycle.
  // Bridge: the currently-playing track is always dropped from the
  // upcoming list to prevent immediate repeats.
  const manual = await readManualRotation();
  if (manual && manual.trackIds.length > 0) {
    const playedSince = await prisma.playHistory.findMany({
      where: {
        stationId: station.id,
        trackId: { in: manual.trackIds },
        startedAt: { gte: new Date(manual.setAt) },
      },
      select: { trackId: true },
    });
    const consumed = new Set<string>(
      playedSince.map((p) => p.trackId).filter((x): x is string => !!x),
    );
    if (nowPlayingId) consumed.add(nowPlayingId);

    const { content: manualContent, remainingIds } = buildManualPlaylist(library, manual.trackIds, consumed);
    if (remainingIds.length > 0) {
      const suffix = randomBytes(4).toString("hex");
      const tmpPath = join(tmpdir(), `playlist-${process.pid}-${Date.now()}-${suffix}.m3u`);
      await writeFile(tmpPath, manualContent, "utf8");
      await rename(tmpPath, PLAYLIST_PATH);
      return {
        librarySize: library.length,
        cyclePlayed: cycleExclude.size,
        poolSize: remainingIds.length,
        cycleWrapped: false,
        manualMode: true,
      };
    }
    // Manual list exhausted — clear the sentinel and fall through to
    // normal generational refresh. The bridge in buildPlaylist excludes
    // nowPlaying, so the seam between the last manual track and the
    // first auto track can't repeat.
    await clearManualRotation();
  } else if (manual) {
    // Empty trackIds list — dashboard rejects this but the daemon's
    // raw POST /manual-rotation accepts it. Self-clear and fall through.
    await clearManualRotation();
  }

  const cycleWrapped = library.length > 0 && library.every((t) => cycleExclude.has(t.id));
  const content = buildPlaylist(library, cycleExclude, bridgeExclude);

  const suffix = randomBytes(4).toString("hex");
  const tmpPath = join(tmpdir(), `playlist-${process.pid}-${Date.now()}-${suffix}.m3u`);
  await writeFile(tmpPath, content, "utf8");
  await rename(tmpPath, PLAYLIST_PATH);

  return {
    librarySize: library.length,
    cyclePlayed: cycleExclude.size,
    poolSize: cycleWrapped
      ? Math.max(library.length - bridgeExclude.size, 0)
      : Math.max(library.length - cycleExclude.size, 0),
    cycleWrapped,
    manualMode: false,
  };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await runRefresh(prisma);
    const tracks = await prisma.track.findMany({
      where: {
        stationId: (
          await prisma.station.findUniqueOrThrow({
            where: { slug: process.env.STATION_SLUG ?? "numaradio" },
            select: { id: true },
          })
        ).id,
        trackStatus: "ready",
        airingPolicy: "library",
      },
      select: { title: true },
      take: 3,
    });
    const sample = tracks.map((t) => t.title).join(", ");
    console.log(
      `[refresh-rotation] library=${result.librarySize} cyclePlayed=${result.cyclePlayed} poolSize=${result.poolSize} wrapped=${result.cycleWrapped} manual=${result.manualMode} wrote=${PLAYLIST_PATH} sample=[${sample}]`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("[refresh-rotation] failed", err);
    process.exit(1);
  });
}
