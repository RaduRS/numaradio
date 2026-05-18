import "../lib/load-env.ts";
import { randomBytes } from "node:crypto";
import { writeFile, rename, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

export type RotationTrack = { id: string; url: string; title: string; artist: string | null };

/**
 * Maximum consecutive tracks by the same artist in auto rotation.
 * 2 = at most 2 in a row → 3-in-a-row is banned. Achievable as long
 * as the dominant artist is at most ~2/3 of the catalog; if it ever
 * exceeds that (e.g. operator is the only artist), the spacer degrades
 * gracefully (falls back to first remaining track) rather than
 * refusing to write a playlist.
 *
 * Tighter alternative: 1 = no back-to-back. Requires the dominant
 * artist to be ≤50% of catalog. Currently infeasible here (Russell
 * Ross is ~63%), so we'd just be degrading constantly.
 */
const MAX_ARTIST_RUN = 2;

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
const CYCLE_ORDER_PATH = process.env.NUMA_CYCLE_ORDER_PATH ?? "/etc/numa/cycle-order.json";

export type CycleOrder = { trackIds: string[]; createdAt: number };

export async function readCycleOrder(path: string = CYCLE_ORDER_PATH): Promise<CycleOrder | null> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.trackIds)) return null;
    return {
      trackIds: parsed.trackIds.filter((x: unknown): x is string => typeof x === "string"),
      createdAt: Number(parsed.createdAt) || Date.now(),
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    console.error(`[refresh-rotation] failed to read ${path}:`, err);
    return null;
  }
}

export async function writeCycleOrder(trackIds: string[], path: string = CYCLE_ORDER_PATH): Promise<void> {
  const payload: CycleOrder = { trackIds, createdAt: Date.now() };
  const suffix = randomBytes(4).toString("hex");
  const tmpPath = join(tmpdir(), `cycle-order-${process.pid}-${Date.now()}-${suffix}.json`);
  await writeFile(tmpPath, JSON.stringify(payload), "utf8");
  await rename(tmpPath, path);
}

export async function clearCycleOrder(path: string = CYCLE_ORDER_PATH): Promise<void> {
  try { await unlink(path); }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
}

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
 * Reorder a shuffled pool so no same-artist run exceeds `maxRun`
 * consecutive tracks. Greedy: at each step, if the current trailing
 * run is already at maxRun, exclude that artist from the next pick;
 * otherwise pick the first remaining track. Falls back to the first
 * remaining track if no non-excluded candidate exists (operator-is-
 * the-only-artist degenerate case).
 *
 * Artist match is case-insensitive on artistDisplay. Tracks with null
 * artist count as a unique "no-artist" group that breaks runs.
 */
export function spaceByArtist<T extends { artist: string | null }>(
  pool: readonly T[],
  maxRun: number,
  /** Artists of tracks aired immediately before this build, oldest first.
   *  Lets the spacer see across refresh boundaries — without this, a fresh
   *  build always starts with an empty trailing context and the heuristic
   *  picks the dominant artist at position 0, extending runs that already
   *  spanned the previous m3u. */
  recentArtists: readonly (string | null)[] = [],
): T[] {
  if (maxRun <= 0 || pool.length <= 1) return pool.slice();
  const remaining = pool.slice();
  const out: T[] = [];
  const NULL_KEY = "__null__";
  const normalize = (t: T) => t.artist?.trim().toLowerCase() ?? NULL_KEY;
  const normalizeArtist = (a: string | null) => a?.trim().toLowerCase() ?? NULL_KEY;
  const recent = recentArtists.map(normalizeArtist);

  while (remaining.length > 0) {
    // Live counts per artist of what's still in the pool.
    const counts = new Map<string, number>();
    for (const t of remaining) {
      const k = normalize(t);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    // Measure trailing same-artist run on the output, continuing into
    // recent history if every element of out matches the same artist
    // (or out is empty).
    let trailingArtist: string | null = null;
    let trailingRun = 0;
    let continuedIntoRecent = out.length === 0;
    for (let i = out.length - 1; i >= 0; i--) {
      const a = normalize(out[i]);
      if (trailingArtist === null) {
        trailingArtist = a;
        trailingRun = 1;
      } else if (a === trailingArtist && a !== NULL_KEY) {
        trailingRun++;
      } else {
        break;
      }
      if (i === 0) continuedIntoRecent = true;
    }
    if (continuedIntoRecent) {
      for (let i = recent.length - 1; i >= 0; i--) {
        const a = recent[i];
        if (trailingArtist === null) {
          trailingArtist = a;
          trailingRun = 1;
        } else if (a === trailingArtist && a !== NULL_KEY) {
          trailingRun++;
        } else {
          break;
        }
      }
    }
    const blocked =
      trailingArtist !== null && trailingArtist !== NULL_KEY && trailingRun >= maxRun
        ? trailingArtist
        : null;
    // Pick the remaining track whose artist has the highest remaining
    // count, skipping the blocked artist. This is the classic
    // task-scheduler heuristic and keeps a dominant artist evenly
    // spread instead of clustering them at the tail.
    let bestIdx = -1;
    let bestScore = -1;
    for (let i = 0; i < remaining.length; i++) {
      const k = normalize(remaining[i]);
      if (blocked !== null && k === blocked) continue;
      const c = counts.get(k) ?? 0;
      if (c > bestScore) {
        bestScore = c;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) bestIdx = 0; // graceful degrade — every remaining is blocked
    out.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }
  return out;
}

/**
 * Filter a persisted cycleOrder down to what's actually playable:
 * tracks still in the library, not yet aired in this cycle. Order is
 * preserved verbatim — no reshuffle. Bridge applies on wrap, dropping
 * the just-played track from position 0 of the next cycle.
 */
export function applyCycleOrder(args: {
  library: readonly RotationTrack[];
  cycleOrder: readonly string[];
  played: ReadonlySet<string>;
  bridge: ReadonlySet<string>;
}): RotationTrack[] {
  const byId = new Map(args.library.map((t) => [t.id, t] as const));
  const out: RotationTrack[] = [];
  for (const id of args.cycleOrder) {
    if (args.played.has(id)) continue;
    if (args.bridge.has(id)) continue;
    const t = byId.get(id);
    if (t) out.push(t);
  }
  return out;
}

/**
 * Authoritative hint about the track that just started playing. Passed
 * from the on-track callback (which knows the true latest from the
 * Liquidsoap payload) so we don't lose to the race between Vercel's
 * track-started transaction and the daemon's runRefresh call.
 */
export interface LatestTrackHint {
  trackId: string;
  artist: string | null;
}

/**
 * Compose the "last 2 aired artists" list for spaceByArtist.
 *
 * Combines DB PlayHistory (most-recent-first, by `recentTrackIds`) with
 * an optional `latest` hint from the on-track callback. When the hint's
 * trackId isn't already at the head of `recentTrackIds` (i.e. PlayHistory
 * hasn't caught up yet), we prepend it so the trailing context reflects
 * reality. Returns oldest-first to match spaceByArtist's contract.
 */
export function computeRecentArtists(
  recentTrackIds: readonly string[],
  artistById: Map<string, string | null>,
  latest?: LatestTrackHint,
): (string | null)[] {
  const sequence: { trackId: string; artist: string | null }[] = recentTrackIds.map((id) => ({
    trackId: id,
    artist: artistById.get(id) ?? null,
  }));
  if (latest && (sequence.length === 0 || sequence[0].trackId !== latest.trackId)) {
    sequence.unshift({ trackId: latest.trackId, artist: latest.artist });
  }
  return sequence.slice(0, 2).map((s) => s.artist).reverse();
}

/**
 * Generational rotation: shuffle the not-yet-aired tracks from the current
 * cycle. When the cycle is exhausted, wrap and shuffle the whole library
 * minus the bridge (currently-playing track) so the first track of the new
 * cycle can never be the last track of the old one.
 *
 * Post-shuffle, an artist-spacing pass keeps same-artist tracks at least
 * MIN_ARTIST_GAP apart so a Russell-Ross-heavy catalog doesn't produce
 * "3 Russell Ross in a row" stretches.
 */
export function buildPlaylist(
  library: RotationTrack[],
  cycleExclude: Set<string>,
  bridgeExclude: Set<string>,
  rng: () => number = Math.random,
  recentArtists: readonly (string | null)[] = [],
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
  const spaced = spaceByArtist(a, MAX_ARTIST_RUN, recentArtists);
  return spaced.map((t) => t.url).join("\n") + "\n";
}

/**
 * Reads the library, derives the current cycle from PlayHistory, shuffles
 * the remaining tracks, and atomically rewrites the playlist file. Exported
 * so the queue-daemon can fire this on every track-started callback in
 * addition to the safety-net systemd timer. Caller owns the prisma lifecycle.
 */
export async function runRefresh(
  prisma: Pick<PrismaClient, "station" | "track" | "playHistory" | "nowPlaying">,
  latest?: LatestTrackHint,
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
      artistDisplay: true,
      assets: {
        where: { assetType: "audio_stream" },
        take: 1,
        select: { publicUrl: true },
      },
    },
  });

  const library: RotationTrack[] = tracks.flatMap((t) => {
    const asset = t.assets[0];
    return asset?.publicUrl
      ? [{ id: t.id, url: asset.publicUrl, title: t.title, artist: t.artistDisplay ?? null }]
      : [];
  });
  const libraryIds = library.map((t) => t.id);

  // Read enough history to detect a cycle wrap (one full library + slack).
  const historyTake = Math.max(library.length * 2, 8);

  const readState = async (): Promise<{
    nowPlayingId: string | null;
    recentTrackIds: string[];
  }> => {
    const [recent, nowPlaying] = await Promise.all([
      // Filter PlayHistory to library tracks only — voice chatter /
      // shoutouts / song-request airings live in PlayHistory too but
      // aren't relevant to library rotation order or recent-artist
      // trailing context.
      prisma.playHistory.findMany({
        where: libraryIds.length > 0
          ? { stationId: station.id, trackId: { in: libraryIds } }
          : { stationId: station.id, trackId: { not: null } },
        orderBy: { startedAt: "desc" },
        take: historyTake,
        select: { trackId: true },
      }),
      prisma.nowPlaying.findUnique({
        where: { stationId: station.id },
        select: { currentTrackId: true },
      }),
    ]);
    const recentTrackIds = recent.map((r) => r.trackId!).filter(Boolean);
    return {
      nowPlayingId: nowPlaying?.currentTrackId ?? null,
      recentTrackIds,
    };
  };

  // Race-guard: a `track-started` transaction (Liquidsoap → Vercel →
  // Neon: NowPlaying upsert + PlayHistory insert) takes ~100-500 ms to
  // commit. Reading twice with a 300 ms gap closes most of that window;
  // the `latest` hint from the on-track callback closes the rest.
  const before = await readState();
  await new Promise((r) => setTimeout(r, 300));
  const after = await readState();

  const bridgeExclude = new Set<string>();
  const nowPlayingId = latest?.trackId ?? after.nowPlayingId ?? before.nowPlayingId;
  if (nowPlayingId) {
    bridgeExclude.add(nowPlayingId);
  }

  // Trailing-artist context for spaceByArtist on fresh-cycle builds —
  // last 2 library tracks aired, oldest first. Folded in with the
  // `latest` hint so the daemon's race against Vercel's track-started
  // transaction can't leave us computing trailing context from stale
  // state.
  const artistById = new Map(library.map((t) => [t.id, t.artist] as const));
  const recentTrackIds = after.recentTrackIds.length >= before.recentTrackIds.length
    ? after.recentTrackIds
    : before.recentTrackIds;
  const recentArtists = computeRecentArtists(recentTrackIds, artistById, latest);

  // Build the planned order for this cycle, in the same shape as
  // manualRotation. Persists to /etc/numa/cycle-order.json so refreshes
  // don't reshuffle — they only strip already-played tracks. Wraps
  // automatically when the cycle is exhausted; an operator-driven
  // Reshuffle clears the file via forceReshuffle().
  const buildFresh = (): string[] => {
    let pool = library.filter((t) => !bridgeExclude.has(t.id));
    if (pool.length === 0) pool = library.slice(); // degenerate single-track lib
    const a = pool.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return spaceByArtist(a, MAX_ARTIST_RUN, recentArtists).map((t) => t.id);
  };
  let cycle = await readCycleOrder();
  let cycleJustBuilt = false;
  if (!cycle || cycle.trackIds.length === 0) {
    const ids = buildFresh();
    await writeCycleOrder(ids);
    cycle = { trackIds: ids, createdAt: Date.now() };
    cycleJustBuilt = true;
  }
  // played = tracks from cycleOrder that have aired since cycleOrder
  // was written. Tying "played" to createdAt instead of cyclePlayedFrom
  // keeps the cycle ledger insulated from priority pushes / chatter /
  // any non-library airings that PlayHistory also records.
  const cyclePlayedRows = await prisma.playHistory.findMany({
    where: {
      stationId: station.id,
      trackId: { in: cycle.trackIds },
      startedAt: { gte: new Date(cycle.createdAt) },
    },
    select: { trackId: true },
  });
  let played = new Set<string>(
    cyclePlayedRows.map((r) => r.trackId).filter((x): x is string => !!x),
  );
  if (nowPlayingId) played.add(nowPlayingId);

  // Manual rotation override sits between cycleOrder and the m3u. The
  // operator's verbatim list plays first; the auto tail is derived from
  // the SAME stable cycleOrder (just with the manual remainder filtered
  // out) so the operator never sees the auto upcoming list reshuffle
  // beneath them either.
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
      const tailPlayed = new Set<string>([...played, ...remainingIds]);
      const tailUpcoming = applyCycleOrder({
        library,
        cycleOrder: cycle.trackIds,
        played: tailPlayed,
        bridge: new Set(),
      });
      const tailContent = tailUpcoming.length === 0
        ? ""
        : tailUpcoming.map((t) => t.url).join("\n") + "\n";
      const combined = manualContent + tailContent;

      const suffix = randomBytes(4).toString("hex");
      const tmpPath = join(tmpdir(), `playlist-${process.pid}-${Date.now()}-${suffix}.m3u`);
      await writeFile(tmpPath, combined, "utf8");
      await rename(tmpPath, PLAYLIST_PATH);
      return {
        librarySize: library.length,
        cyclePlayed: played.size,
        poolSize: remainingIds.length,
        cycleWrapped: false,
        manualMode: true,
      };
    }
    await clearManualRotation();
  } else if (manual) {
    await clearManualRotation();
  }

  let upcoming = applyCycleOrder({ library, cycleOrder: cycle.trackIds, played, bridge: new Set() });
  let cycleWrapped = false;
  if (upcoming.length === 0) {
    // Cycle wrap: every track in cycleOrder has aired. Reshuffle for
    // the next cycle, excluding nowPlaying as the seam bridge.
    const ids = buildFresh();
    await writeCycleOrder(ids);
    cycle = { trackIds: ids, createdAt: Date.now() };
    const playedAfterWrap = new Set<string>();
    if (nowPlayingId) playedAfterWrap.add(nowPlayingId);
    upcoming = applyCycleOrder({
      library,
      cycleOrder: ids,
      played: playedAfterWrap,
      bridge: bridgeExclude,
    });
    played = playedAfterWrap;
    cycleWrapped = true;
    cycleJustBuilt = true;
  }

  // Only write the m3u when cycleOrder changed (first build, wrap, or
  // operator Reshuffle via forceReshuffle). Rewriting on every refresh
  // makes Liquidsoap's `mode=normal` + `reload=120` go out of order:
  // its in-memory position counter goes stale against a shrinking file
  // and it skips tracks (then sometimes comes back to skipped ones).
  // With m3u stable for the whole cycle, Liquidsoap plays through
  // positions 0..N-1 linearly. The dashboard's Up Next API derives
  // "upcoming" by reading PlayHistory against cycle.createdAt itself —
  // see dashboard/app/api/rotation/upcoming/route.ts.
  if (cycleJustBuilt) {
    // m3u = full cycleOrder, in order. Liquidsoap reads this once per
    // cycle, plays through it, then reloads when we rebuild on wrap.
    const fullUpcoming = applyCycleOrder({
      library,
      cycleOrder: cycle.trackIds,
      played: new Set(),
      bridge: new Set(),
    });
    const content = fullUpcoming.length === 0 ? "" : fullUpcoming.map((t) => t.url).join("\n") + "\n";

    const suffix = randomBytes(4).toString("hex");
    const tmpPath = join(tmpdir(), `playlist-${process.pid}-${Date.now()}-${suffix}.m3u`);
    await writeFile(tmpPath, content, "utf8");
    await rename(tmpPath, PLAYLIST_PATH);
  }

  return {
    librarySize: library.length,
    cyclePlayed: played.size,
    poolSize: upcoming.length,
    cycleWrapped,
    manualMode: false,
  };
}

/**
 * Operator-driven reshuffle: clear the persisted cycleOrder so the next
 * runRefresh rebuilds it from scratch (including any newly-approved
 * tracks). Wired to the dashboard's Reshuffle button via the daemon's
 * /refresh-rotation endpoint.
 */
export async function forceReshuffle(
  prisma: Pick<PrismaClient, "station" | "track" | "playHistory" | "nowPlaying">,
): Promise<RefreshResult> {
  await clearCycleOrder();
  return runRefresh(prisma);
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
