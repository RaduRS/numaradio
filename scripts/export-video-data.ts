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
import { writeFile, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { prisma } from "../lib/db/index.ts";
import { synthesizeChatter } from "../workers/queue-daemon/deepgram-tts.ts";

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

interface CountsBlock {
  totalTracks: number;
  airedShoutouts: number;
  acceptedArtists: number;
  generatedToday: number;
  shoutoutsToday: number;
  fetchedAt: string;
}

interface Snapshot {
  fetchedAt: string;
  counts: CountsBlock;
  shoutouts: ShoutoutClip[];
  promptedSong: PromptedSongClip | null;
  currentShow: ShowSnapshot;
  afterDark: AfterDarkClip | null;
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

async function exportShoutouts(): Promise<ShoutoutClip[]> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) throw new Error("DEEPGRAM_API_KEY missing — needed to re-synth shoutout audio");

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
        const buf = await synthesizeChatter(row.broadcastText, { apiKey });
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

async function exportPromptedSong(): Promise<PromptedSongClip | null> {
  // Find a recent SongRequest with an actual generated track + audio asset.
  // Skip operator-bypass requests (ipHash starts with "operator:") because
  // those weren't real listener prompts.
  // SongRequest.status ends in "done" once the song-worker pipeline ships
  // the track to B2 + queues it. There's no "played" status; once it's in
  // the queue it'll air on its own rotation.
  const req = await prisma.songRequest.findFirst({
    where: {
      status: "done",
      trackId: { not: null },
      NOT: { ipHash: { startsWith: "operator:" } },
    },
    orderBy: { completedAt: "desc" },
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
  if (!req?.track) {
    console.warn("[export]  ! no listener-prompted song with track found");
    return null;
  }
  const audioAsset = req.track.assets.find((a) => a.assetType === "audio_stream");
  const artAsset = req.track.assets.find((a) => a.assetType === "artwork");
  if (!audioAsset) {
    console.warn("[export]  ! prompted song has no audio_stream asset");
    return null;
  }
  const audioFile = await downloadIfMissing(audioAsset.publicUrl, `songs/prompted.mp3`);
  if (!audioFile) return null;
  const artworkFile = artAsset
    ? await downloadIfMissing(artAsset.publicUrl, `songs/prompted-art.png`)
    : null;
  console.log(`[export]  ✓ prompted song: ${req.track.title}`);
  return {
    trackId: req.track.id,
    prompt: req.prompt,
    artistName: req.artistName,
    title: req.track.title,
    genre: req.track.genre,
    audioFile,
    artworkFile,
    durationSeconds: req.track.durationSeconds,
    airedAt: req.completedAt?.toISOString() ?? null,
  };
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

// ----------------- main -----------------

(async () => {
  console.log(`[export] writing into ${VIDEOS_REPO}/src/data + assets/data`);
  await ensureDir(DATA_DIR);
  await ensureDir(dirname(SNAPSHOT_PATH));

  const [counts, shoutouts, promptedSong, currentShow, afterDark] = await Promise.all([
    exportCounts(),
    exportShoutouts(),
    exportPromptedSong(),
    exportCurrentShow(),
    exportAfterDark(),
  ]);

  const snapshot: Snapshot = {
    fetchedAt: new Date().toISOString(),
    counts,
    shoutouts,
    promptedSong,
    currentShow,
    afterDark,
  };
  await writeFile(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2));
  console.log(`[export] wrote ${SNAPSHOT_PATH}`);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
