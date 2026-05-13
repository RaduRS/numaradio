// Data exporter for ~/saas/numaradio-videos.
//
// Pulls real Numa-owned content from the prod DB and writes:
//   numaradio-videos/src/data/snapshot.json   — metadata index
//   numaradio-videos/src/assets/data/         — mp3 + png artefacts
//
// Run from repo root:
//   npx tsx scripts/export-video-data.ts
//
// Idempotent: re-runs overwrite the snapshot + reuse any already-fetched
// asset files (skips redownload if same byte size).
//
// Audio policy: only Numa-owned audio is exported. Listener-submitted
// artist tracks are EXCLUDED — those are stream-only per submitter
// consent (`app/submit/page.tsx`). Aired-shoutout audio is auto-purged
// by `delete-aired-shoutout.ts` after the broadcast callback fires, so
// we re-synthesise via Deepgram from `broadcastText` to recover a
// faithful Lena reading.

import "../lib/load-env.ts";
import { config as loadDotenv } from "dotenv";
import { writeFile, mkdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { prisma } from "../lib/db/index.ts";
import { synthesizeChatter } from "../workers/queue-daemon/deepgram-tts.ts";
import { synthesizeVertex } from "../workers/queue-daemon/vertex-tts.ts";

// Vertex Leda lives behind GOOGLE_CLOUD_PROJECT — that env var is in
// dashboard/.env.local on Orion (where the dashboard runs), NOT in this
// repo's .env.local. Pull it in so the exporter matches whatever
// Station.voiceProvider is set to (production is on "vertex" /
// gemini-3.1-flash-tts-preview / Leda).
const dashboardEnv = resolve(process.cwd(), "dashboard/.env.local");
if (existsSync(dashboardEnv)) loadDotenv({ path: dashboardEnv, override: false });

const VIDEOS_REPO = resolve("/home/marku/saas/numaradio-videos");
const DATA_DIR = join(VIDEOS_REPO, "src/assets/data");
const SNAPSHOT_PATH = join(VIDEOS_REPO, "src/data/snapshot.json");

interface ShoutoutClip {
  id: string;
  rawText: string;
  broadcastText: string;
  requesterName: string | null;
  airedAt: string;
  audioFile: string; // relative to src/assets, e.g. "data/shoutouts/01.mp3"
}

interface PromptedSongClip {
  trackId: string;
  prompt: string;
  artistName: string;
  title: string;
  genre: string | null;
  audioFile: string;
  artworkFile: string | null;
  durationSeconds: number | null;
  airedAt: string | null;
}

interface ShowSnapshot {
  show: string | null;
  nowPlayingTitle: string | null;
  nowPlayingArtist: string | null;
  artworkFile: string | null;
}

interface AfterDarkClip {
  trackId: string;
  title: string;
  artistDisplay: string | null;
  audioFile: string;
  artworkFile: string | null;
}

interface BedTrack {
  trackId: string;
  title: string;
  artistDisplay: string;
  genre: string | null;
  show: string | null;
  durationSeconds: number | null;
  audioFile: string; // relative to src/assets, e.g. "data/beds/cross-and-loop.mp3"
}

interface CountsBlock {
  totalTracks: number;
  airedShoutouts: number;
  acceptedArtists: number;
  generatedToday: number;
  shoutoutsToday: number;
  fetchedAt: string;
}

interface FreshCounts {
  airedShoutoutsThisMonth: number;
  tracksGeneratedToday: number;
}

interface Snapshot {
  fetchedAt: string;
  counts: CountsBlock;
  shoutouts: ShoutoutClip[];
  promptedSong: PromptedSongClip | null;
  promptedSongs: PromptedSongClip[];
  freshCounts: FreshCounts;
  currentShow: ShowSnapshot;
  afterDark: AfterDarkClip | null;
  beds: BedTrack[];
}

async function ensureDir(p: string): Promise<void> {
  await mkdir(p, { recursive: true });
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function writeBuffer(relPath: string, buf: Buffer): Promise<string> {
  const abs = join(DATA_DIR, relPath);
  await ensureDir(dirname(abs));
  await writeFile(abs, buf);
  return `data/${relPath}`;
}

async function downloadIfMissing(
  url: string,
  relPath: string,
): Promise<string | null> {
  const abs = join(DATA_DIR, relPath);
  if (await fileExists(abs)) return `data/${relPath}`;
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) {
      console.warn(`[export]  ! download failed ${r.status}: ${url}`);
      return null;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    await ensureDir(dirname(abs));
    await writeFile(abs, buf);
    return `data/${relPath}`;
  } catch (e) {
    console.warn(`[export]  ! download error: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

// ----------------- shoutouts -----------------

// Match production's TTS pipeline: Vertex Leda when configured (current
// Station.voiceProvider), with the same Deepgram Helena fallback the live
// dashboard/lib/shoutout.ts uses when Vertex errors. That keeps marketing
// audio acoustically identical to what aired.
async function synthesizeLikeProduction(text: string): Promise<Buffer> {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  if (project) {
    try {
      return await synthesizeVertex(text, { project });
    } catch (err) {
      console.warn(
        `[export]    vertex failed, falling back to deepgram: ${err instanceof Error ? err.message : err}`,
      );
    }
  } else {
    console.warn(
      "[export]    GOOGLE_CLOUD_PROJECT not set — using deepgram fallback",
    );
  }
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) throw new Error("DEEPGRAM_API_KEY not set (and vertex unavailable)");
  return synthesizeChatter(text, { apiKey });
}

async function exportShoutouts(): Promise<ShoutoutClip[]> {
  const provider = process.env.GOOGLE_CLOUD_PROJECT ? "vertex (Leda)" : "deepgram (Helena)";
  console.log(`[export]  using TTS provider: ${provider}`);

  const rows = await prisma.shoutout.findMany({
    where: {
      deliveryStatus: "aired",
      broadcastText: { not: null },
      moderationStatus: { in: ["allowed", "rewritten"] },
    },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: {
      id: true,
      rawText: true,
      broadcastText: true,
      requesterName: true,
      createdAt: true,
    },
  });

  if (rows.length === 0) {
    console.warn("[export]  ! no aired shoutouts found");
    return [];
  }

  const out: ShoutoutClip[] = [];
  let i = 0;
  for (const row of rows) {
    if (!row.broadcastText) continue;
    i += 1;
    const filename = `shoutouts/${String(i).padStart(2, "0")}.mp3`;
    const abs = join(DATA_DIR, filename);
    if (!(await fileExists(abs))) {
      console.log(`[export]  · synth shoutout ${i}/${rows.length} (${row.broadcastText.length} chars)`);
      try {
        const buf = await synthesizeLikeProduction(row.broadcastText);
        await writeBuffer(filename, buf);
      } catch (e) {
        console.warn(`[export]  ! deepgram fail on ${row.id}: ${e instanceof Error ? e.message : e}`);
        continue;
      }
    } else {
      console.log(`[export]  · reuse cached ${filename}`);
    }
    out.push({
      id: row.id,
      rawText: row.rawText,
      broadcastText: row.broadcastText,
      requesterName: row.requesterName,
      airedAt: row.createdAt.toISOString(),
      audioFile: `data/${filename}`,
    });
    if (out.length >= 6) break;
  }
  console.log(`[export]  ✓ shoutouts ready: ${out.length}`);
  return out;
}

// ----------------- listener-prompted song -----------------

async function exportPromptedSongs(): Promise<PromptedSongClip[]> {
  // Find recent SongRequests with an actual generated track + audio asset.
  // Skip operator-bypass requests (ipHash starts with "operator:") because
  // those weren't real listener prompts.
  // SongRequest.status ends in "done" once the song-worker pipeline ships
  // the track to B2 + queues it. There's no "played" status; once it's in
  // the queue it'll air on its own rotation.
  //
  // Overfetch (take: 6) so we can filter by prompt length (20-180 chars,
  // so it fits the on-screen card without truncation) and still have a
  // good chance of two usable records.
  const reqs = await prisma.songRequest.findMany({
    where: {
      status: "done",
      trackId: { not: null },
      NOT: { ipHash: { startsWith: "operator:" } },
    },
    orderBy: { completedAt: "desc" },
    take: 6,
    select: {
      id: true,
      prompt: true,
      artistName: true,
      titleGenerated: true,
      completedAt: true,
      track: {
        select: {
          id: true,
          title: true,
          genre: true,
          durationSeconds: true,
          assets: {
            where: { assetType: { in: ["audio_stream", "artwork"] } },
            select: { assetType: true, publicUrl: true },
          },
        },
      },
    },
  });

  const usable = reqs.filter((r) => {
    const p = r.prompt ?? "";
    return p.length >= 20 && p.length <= 180 && r.track;
  });

  if (usable.length === 0) {
    console.warn("[export]  ! no listener-prompted songs with usable prompt + track found");
    return [];
  }

  const out: PromptedSongClip[] = [];
  for (const req of usable) {
    if (out.length >= 2) break;
    if (!req.track) continue;
    const audioAsset = req.track.assets.find((a) => a.assetType === "audio_stream");
    const artAsset = req.track.assets.find((a) => a.assetType === "artwork");
    if (!audioAsset) {
      console.warn(`[export]  ! prompted song ${req.track.id} has no audio_stream asset, skipping`);
      continue;
    }
    const audioFile = await downloadIfMissing(
      audioAsset.publicUrl,
      `songs/${req.track.id}.mp3`,
    );
    if (!audioFile) continue;
    const artworkFile = artAsset
      ? await downloadIfMissing(artAsset.publicUrl, `songs/${req.track.id}.png`)
      : null;
    console.log(`[export]  ✓ prompted song: ${req.track.title} (prompt ${req.prompt.length} chars)`);
    out.push({
      trackId: req.track.id,
      prompt: req.prompt,
      artistName: req.artistName,
      title: req.track.title,
      genre: req.track.genre,
      audioFile,
      artworkFile,
      durationSeconds: req.track.durationSeconds,
      airedAt: req.completedAt?.toISOString() ?? null,
    });
  }
  console.log(`[export]  ✓ prompted songs ready: ${out.length}`);
  return out;
}

// ----------------- current show / now playing -----------------

async function exportCurrentShow(): Promise<ShowSnapshot> {
  const np = await prisma.nowPlaying.findFirst({
    orderBy: { startedAt: "desc" },
    select: {
      currentTrackId: true,
    },
  });
  if (!np?.currentTrackId) {
    return {
      show: null,
      nowPlayingTitle: null,
      nowPlayingArtist: null,
      artworkFile: null,
    };
  }
  const tr = await prisma.track.findUnique({
    where: { id: np.currentTrackId },
    select: {
      show: true,
      title: true,
      artistDisplay: true,
      assets: {
        where: { assetType: "artwork" },
        select: { publicUrl: true },
        take: 1,
      },
    },
  });
  let artworkFile: string | null = null;
  const art = tr?.assets[0];
  if (art) {
    artworkFile = await downloadIfMissing(art.publicUrl, `now-playing/art.png`);
  }
  console.log(`[export]  ✓ now playing: ${tr?.title ?? "?"} · ${tr?.show ?? "no-show"}`);
  return {
    show: tr?.show ?? null,
    nowPlayingTitle: tr?.title ?? null,
    nowPlayingArtist: tr?.artistDisplay ?? null,
    artworkFile,
  };
}

// ----------------- after dark sample -----------------

async function exportAfterDark(): Promise<AfterDarkClip | null> {
  // Pick from the night_shift show — that's the After Dark equivalent in
  // schema (no "after_dark" enum value; night_shift covers the late hours).
  const candidates = await prisma.track.findMany({
    where: {
      show: "night_shift",
      airingPolicy: { in: ["library", "request_only"] },
      assets: { some: { assetType: "audio_stream" } },
    },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: {
      id: true,
      title: true,
      artistDisplay: true,
      assets: {
        where: { assetType: { in: ["audio_stream", "artwork"] } },
        select: { assetType: true, publicUrl: true },
      },
    },
  });
  if (candidates.length === 0) {
    console.warn("[export]  ! no after_dark tracks found");
    return null;
  }
  // Pick the first one whose audio download succeeds.
  for (const c of candidates) {
    const audioAsset = c.assets.find((a) => a.assetType === "audio_stream");
    if (!audioAsset) continue;
    const audioFile = await downloadIfMissing(audioAsset.publicUrl, `after-dark/track.mp3`);
    if (!audioFile) continue;
    const artAsset = c.assets.find((a) => a.assetType === "artwork");
    const artworkFile = artAsset
      ? await downloadIfMissing(artAsset.publicUrl, `after-dark/art.png`)
      : null;
    console.log(`[export]  ✓ after dark: ${c.title}`);
    return {
      trackId: c.id,
      title: c.title,
      artistDisplay: c.artistDisplay,
      audioFile,
      artworkFile,
    };
  }
  return null;
}

// ----------------- recent Russell Ross beds -----------------

// Pulls the last 7 days of Russell Ross tracks (sourceType=suno_manual,
// Numa-owned via Suno Pro commercial license — safe on TikTok / Reels /
// Shorts). Downloads the audio so the v2 social batch can use a fresh
// Numa catalogue track as the music bed for each shoutout/stat video.
async function exportRussellBeds(): Promise<BedTrack[]> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const tracks = await prisma.track.findMany({
    where: {
      artistDisplay: "Russell Ross",
      sourceType: "suno_manual",
      createdAt: { gte: since },
      airingPolicy: { in: ["library", "request_only"] },
      assets: { some: { assetType: "audio_stream" } },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      title: true,
      artistDisplay: true,
      genre: true,
      show: true,
      durationSeconds: true,
      assets: {
        where: { assetType: "audio_stream" },
        select: { publicUrl: true },
        take: 1,
      },
    },
  });

  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);

  const out: BedTrack[] = [];
  for (const t of tracks) {
    const audioUrl = t.assets[0]?.publicUrl;
    if (!audioUrl) continue;
    const file = `beds/${slug(t.title)}.mp3`;
    const got = await downloadIfMissing(audioUrl, file);
    if (!got) continue;
    out.push({
      trackId: t.id,
      title: t.title,
      artistDisplay: t.artistDisplay ?? "Russell Ross",
      genre: t.genre,
      show: t.show,
      durationSeconds: t.durationSeconds,
      audioFile: got,
    });
  }
  console.log(`[export]  ✓ russell ross beds: ${out.length}`);
  return out;
}

// ----------------- counts -----------------

async function exportCounts(): Promise<CountsBlock> {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [totalTracks, airedShoutouts, acceptedArtists, generatedToday, shoutoutsToday] =
    await Promise.all([
      prisma.track.count(),
      prisma.shoutout.count({ where: { deliveryStatus: "aired" } }),
      prisma.musicSubmission.count({ where: { status: "approved" } }),
      prisma.track.count({ where: { createdAt: { gte: dayAgo } } }),
      prisma.shoutout.count({
        where: { deliveryStatus: "aired", createdAt: { gte: dayAgo } },
      }),
    ]);
  const counts: CountsBlock = {
    totalTracks,
    airedShoutouts,
    acceptedArtists,
    generatedToday,
    shoutoutsToday,
    fetchedAt: new Date().toISOString(),
  };
  console.log(`[export]  ✓ counts: tracks=${totalTracks} shoutouts=${airedShoutouts} artists=${acceptedArtists}`);
  return counts;
}

// ----------------- fresh counts (per-period for launch-10 stat hooks) -----------------

// Distinct from `counts` (which is lifetime/24h totals). `freshCounts`
// drives the StatHook variants in the launch-10 batch — "N shoutouts
// aired this month" and "N tracks generated today" — so the rendered
// numbers track real cadence rather than lifetime drift.
async function exportFreshCounts(): Promise<FreshCounts> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);

  // Track.sourceType="minimax_request" is the listener-prompted song
  // pipeline (workers/song-worker via MiniMax music-2.6). suno_manual
  // is operator manual drops; external_import is artist submissions.
  const [airedShoutoutsThisMonth, tracksGeneratedToday] = await Promise.all([
    prisma.shoutout.count({
      where: { deliveryStatus: "aired", createdAt: { gte: monthStart } },
    }),
    prisma.track.count({
      where: { sourceType: "minimax_request", createdAt: { gte: dayStart } },
    }),
  ]);

  console.log(
    `[export]  ✓ freshCounts: shoutoutsThisMonth=${airedShoutoutsThisMonth} tracksToday=${tracksGeneratedToday}`,
  );
  return { airedShoutoutsThisMonth, tracksGeneratedToday };
}

// ----------------- main -----------------

(async () => {
  console.log(`[export] writing into ${VIDEOS_REPO}/src/data + assets/data`);
  await ensureDir(DATA_DIR);
  await ensureDir(dirname(SNAPSHOT_PATH));

  const [counts, shoutouts, promptedSongs, freshCounts, currentShow, afterDark, beds] =
    await Promise.all([
      exportCounts(),
      exportShoutouts(),
      exportPromptedSongs(),
      exportFreshCounts(),
      exportCurrentShow(),
      exportAfterDark(),
      exportRussellBeds(),
    ]);

  // Keep `promptedSong` (singular) populated identically to before for
  // backwards-compat with render-social-v2-batch.ts. First record of
  // the plural array is the same record the old code would have picked.
  const promptedSong: PromptedSongClip | null = promptedSongs[0] ?? null;

  const snapshot: Snapshot = {
    fetchedAt: new Date().toISOString(),
    counts,
    shoutouts,
    promptedSong,
    promptedSongs,
    freshCounts,
    currentShow,
    afterDark,
    beds,
  };
  await writeFile(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2));
  console.log(`[export] wrote ${SNAPSHOT_PATH}`);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
