import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { PrismaClient } from "@prisma/client";
import { probeDurationSeconds } from "../../lib/probe-duration.ts";
import { profanityPrefilter } from "../../lib/moderate.ts";
import { deriveGenreFromText } from "../../lib/derive-genre.ts";
import { showSlugFor, type ShowSlug } from "../../lib/show-slug.ts";
import { loadFallbackArtwork } from "../../lib/fallback-artwork.ts";
import { loudnormalise } from "../../lib/loudnorm.ts";
import {
  startMusicGeneration,
  pollMusicGeneration,
} from "./minimax.ts";
import { generateArtwork } from "./openrouter.ts";
import { expandPrompt } from "./prompt-expand.ts";

// Re-exported here so existing callers keep working; logic lives in
// lib/show-slug.ts so the public site, song-worker and dashboard all
// agree on the date→slug mapping.
export const showEnumFor: (date: Date) => ShowSlug = showSlugFor;

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";
const QUEUE_DAEMON_URL =
  process.env.QUEUE_DAEMON_URL ?? "http://127.0.0.1:4000";

const POLL_INTERVAL_MS = 10_000;
const POLL_TIMEOUT_MS = 360_000; // 6 min

// Key embeds the track id so URL contents are immutable; safe to cache forever
// in listener browsers and any future CDN layer.
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

export interface PipelineJob {
  id: string;
  prompt: string;
  artistName: string;
  isInstrumental: boolean;
}

export function shouldFallbackToInstrumental(lyrics: string | undefined): boolean {
  if (!lyrics || lyrics.trim() === "") return false;
  return profanityPrefilter(lyrics) !== null;
}

let s3Client: S3Client | null = null;
function getS3(): S3Client {
  if (s3Client) return s3Client;
  s3Client = new S3Client({
    region: process.env.B2_REGION,
    endpoint: process.env.B2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.B2_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.B2_SECRET_ACCESS_KEY ?? "",
    },
  });
  return s3Client;
}

function b2PublicUrl(key: string): string {
  const base = process.env.B2_BUCKET_PUBLIC_URL;
  if (!base) throw new Error("B2_BUCKET_PUBLIC_URL not set");
  return `${base}/${key}`;
}

async function uploadToB2(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  const bucket = process.env.B2_BUCKET_NAME;
  if (!bucket) throw new Error("B2_BUCKET_NAME not set");
  await getS3().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: IMMUTABLE_CACHE_CONTROL,
    }),
  );
  return b2PublicUrl(key);
}

// Best-effort cleanup of objects we uploaded before a downstream
// failure. Used in runPipeline's catch path so a mid-pipeline crash
// doesn't strand audio + artwork in B2 forever (no purge script
// matches a key with no Track row).
async function deleteB2Keys(keys: string[]): Promise<void> {
  const bucket = process.env.B2_BUCKET_NAME;
  if (!bucket || keys.length === 0) return;
  await Promise.all(
    keys.map((key) =>
      getS3()
        .send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
        .catch((err) => {
          console.warn(
            `[song-worker] B2 cleanup failed for ${key}: ${String(err)}`,
          );
        }),
    ),
  );
}

// Cloudflare returns 522 on cold-cache fetches when its connection to
// the B2 origin stalls. Liquidsoap retries 3-4 times then drops the
// request — listener's song silently never airs. We HEAD the URL up to
// 3 times before pushing so CF edge cache is populated by the time
// Liquidsoap fetches. Failures here are non-fatal: if CF still 522s
// after our retries we push anyway (best-effort).
async function warmCdnUrl(url: string): Promise<void> {
  const ATTEMPTS = 3;
  const GAP_MS = 1500;
  for (let i = 0; i < ATTEMPTS; i++) {
    try {
      const res = await fetch(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(8_000),
      });
      if (res.ok) return;
      console.warn(
        `[song-worker] cdn warm ${url} attempt ${i + 1}/${ATTEMPTS}: HTTP ${res.status}`,
      );
    } catch (err) {
      console.warn(
        `[song-worker] cdn warm ${url} attempt ${i + 1}/${ATTEMPTS}: ${String(err)}`,
      );
    }
    if (i < ATTEMPTS - 1) await new Promise((r) => setTimeout(r, GAP_MS));
  }
}

async function pollUntilDone(taskId: string): Promise<{ audioUrl: string; durationMs: number }> {
  const started = Date.now();
  while (Date.now() - started < POLL_TIMEOUT_MS) {
    const poll = await pollMusicGeneration(taskId);
    if (poll.status === "done" && poll.audioUrl) {
      return { audioUrl: poll.audioUrl, durationMs: poll.durationMs ?? 0 };
    }
    if (poll.status === "failed") {
      throw new Error(`minimax music failed: ${poll.failureReason ?? "unknown"}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error("minimax music timed out after 6 minutes");
}

async function pushToQueueDaemon(input: {
  trackId: string;
  sourceUrl: string;
  reason: string;
  announce?: {
    listenerName: string;
    userPrompt: string;
    title: string;
  };
}): Promise<void> {
  const res = await fetch(`${QUEUE_DAEMON_URL}/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    // The daemon is on loopback and the payload is small. If it's not
    // answering within 5s the process is wedged — fail fast so the
    // surrounding pipeline can mark the job failed instead of hanging
    // the single-worker queue indefinitely.
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`queue-daemon push ${res.status}: ${detail.slice(0, 200)}`);
  }
}

export async function runPipeline(prisma: PrismaClient, job: PipelineJob): Promise<void> {
  // Track every B2 key we successfully uploaded so a downstream
  // failure (Track.create, queue-daemon push, etc.) can release the
  // bytes back. Without this the only cleanup path was via
  // delete-aired-shoutout, which doesn't run for tracks that never
  // got a Track row.
  const uploadedB2Keys: string[] = [];
  try {
    await runPipelineInner(prisma, job, uploadedB2Keys);
  } catch (err) {
    if (uploadedB2Keys.length > 0) {
      await deleteB2Keys(uploadedB2Keys);
    }
    throw err;
  }
}

async function runPipelineInner(
  prisma: PrismaClient,
  job: PipelineJob,
  uploadedB2Keys: string[],
): Promise<void> {
  const station = await prisma.station.findUnique({
    where: { slug: STATION_SLUG },
    select: { id: true },
  });
  if (!station) throw new Error(`station '${STATION_SLUG}' not found`);

  // Step 1: LLM expansion.
  const expansion = await expandPrompt(job.prompt, {
    withLyrics: !job.isInstrumental,
  });
  const title = expansion?.title ?? job.prompt.slice(0, 50);
  const artworkPrompt = expansion?.artworkPrompt ?? job.prompt;
  const rawLyrics = expansion?.lyrics;
  const lyricsFallback =
    !job.isInstrumental &&
    (rawLyrics === undefined || shouldFallbackToInstrumental(rawLyrics));
  const finalInstrumental = job.isInstrumental || lyricsFallback;
  const finalLyrics = finalInstrumental ? undefined : rawLyrics;

  await prisma.songRequest.update({
    where: { id: job.id },
    data: {
      titleGenerated: title,
      artworkPrompt,
      lyricsGenerated: finalLyrics,
      lyricsFallback,
      status: "processing",
    },
  });

  // Step 2: kick off music + artwork in parallel.
  const musicStartPromise = startMusicGeneration({
    prompt: job.prompt,
    isInstrumental: finalInstrumental,
    lyrics: finalLyrics,
  });
  const artworkPromise = generateArtwork(artworkPrompt).catch(
    (err) => {
      console.warn(`[song-worker] artwork failed for ${job.id}: ${String(err)}`);
      return null;
    },
  );

  const musicStart = await musicStartPromise;
  await prisma.songRequest.update({
    where: { id: job.id },
    data: { miniMaxTaskId: musicStart.taskId },
  });

  // Step 3: poll music until done, while artwork finishes in background.
  const { audioUrl: remoteAudioUrl, durationMs } =
    musicStart.immediateAudioUrl
      ? { audioUrl: musicStart.immediateAudioUrl, durationMs: musicStart.durationMs ?? 0 }
      : await pollUntilDone(musicStart.taskId);
  const artworkBytesOrNull = await artworkPromise;

  await prisma.songRequest.update({
    where: { id: job.id },
    data: { status: "finalizing" },
  });

  // Step 4: download MiniMax audio + upload both assets to B2. A
  // stalled MP3 transfer here would block every subsequent song
  // request since song-worker processes one job at a time; 30s is
  // generous for a multi-megabyte download from a CDN.
  const audioRes = await fetch(remoteAudioUrl, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!audioRes.ok) throw new Error(`minimax audio download ${audioRes.status}`);
  const rawAudioBytes = Buffer.from(await audioRes.arrayBuffer());

  // Loudness-normalise to -14 LUFS at ingest. Falls back to raw audio
  // on any ffmpeg / parse failure — Track.loudnessLufs stays NULL and
  // the queue-daemon poller picks it up later. Listener never blocked.
  let audioBytes = rawAudioBytes;
  let loudness: { inputI: number; outputI: number; outputTp: number } | null = null;
  try {
    const ln = await loudnormalise(rawAudioBytes);
    audioBytes = ln.buffer;
    loudness = {
      inputI: ln.measurement.inputI,
      outputI: ln.measurement.outputI,
      outputTp: ln.measurement.outputTp,
    };
    console.log(`[song-worker] loudnorm ${job.id}: ${ln.measurement.inputI.toFixed(1)} → ${ln.measurement.outputI.toFixed(1)} LUFS`);
  } catch (err) {
    console.warn(`[song-worker] loudnorm failed for ${job.id}, using raw audio: ${String(err)}`);
  }

  // Frame-accurate probe via lib/probe-duration.ts — runs music-metadata
  // with `{ duration: true }` so it counts every audio frame instead of
  // trusting the (often-wrong) Xing/VBRI header. Falls back to MiniMax's
  // own durationMs only if the probe fails entirely (corrupt MP3 etc.).
  let durationSeconds: number | null = null;
  const probed = await probeDurationSeconds(audioBytes);
  if (probed) {
    durationSeconds = Math.round(probed);
  } else if (durationMs > 0) {
    durationSeconds = Math.round(durationMs / 1000);
    console.warn(`[song-worker] frame probe failed for ${job.id}; using MiniMax durationMs=${durationMs}`);
  } else {
    console.warn(`[song-worker] could not determine duration for ${job.id}`);
  }

  const trackId = randomUUID();
  const show = showEnumFor(new Date());
  const audioKey = `stations/${STATION_SLUG}/tracks/${trackId}/audio/stream.mp3`;
  const artworkKey = `stations/${STATION_SLUG}/tracks/${trackId}/artwork/primary.png`;

  // Preserve the original (pre-loudnorm) bytes. Best-effort — log on
  // failure but don't block the canonical ingest. Skipped if we
  // fell back to raw above (loudness === null).
  if (loudness) {
    const originalKey = `tracks-original/${trackId}.mp3`;
    try {
      await uploadToB2(originalKey, rawAudioBytes, "audio/mpeg");
    } catch (err) {
      console.warn(`[song-worker] original preserve failed for ${trackId}: ${String(err)}`);
    }
  }

  const audioUrl = await uploadToB2(audioKey, audioBytes, "audio/mpeg");
  uploadedB2Keys.push(audioKey);

  let artworkBuf: Buffer;
  if (artworkBytesOrNull) {
    artworkBuf = artworkBytesOrNull;
  } else {
    console.warn(`[song-worker] using fallback artwork for ${job.id} (show=${show})`);
    artworkBuf = await loadFallbackArtwork(show);
  }
  const artworkUrl = await uploadToB2(artworkKey, artworkBuf, "image/png");
  uploadedB2Keys.push(artworkKey);

  // Mine a genre from the listener's prompt so the dashboard /library
  // Genre column has something meaningful instead of a dash. Falls back
  // to "Listener Pick" when no recognised genre word appears.
  const derivedGenre = deriveGenreFromText(job.prompt) ?? "Listener Pick";

  // Step 5: create Track + TrackAssets.
  const track = await prisma.track.create({
    data: {
      id: trackId,
      stationId: station.id,
      title,
      artistDisplay: job.artistName,
      sourceType: "minimax_request",
      // Start as priority_request so the rotation refresher can't pick the
      // track up before it has its first PlayHistory entry. track-started
      // flips it to 'library' after the first on-air, by which point the
      // 'last 20 played' filter pins it out of rotation until it ages out.
      airingPolicy: "priority_request",
      safetyStatus: "approved",
      show,
      genre: derivedGenre,
      trackStatus: "ready",
      durationSeconds,
      loudnessLufs: loudness?.outputI ?? null,
      loudnessTruePeakDbtp: loudness?.outputTp ?? null,
      loudnessSourceLufs: loudness?.inputI ?? null,
      assets: {
        create: [
          {
            assetType: "audio_stream",
            storageProvider: "b2",
            storageKey: audioKey,
            publicUrl: audioUrl,
            mimeType: "audio/mpeg",
            byteSize: audioBytes.length,
            durationSeconds,
          },
          {
            assetType: "artwork_primary",
            storageProvider: "b2",
            storageKey: artworkKey,
            publicUrl: artworkUrl,
            mimeType: "image/png",
            byteSize: artworkBuf.length,
          },
        ],
      },
    },
    select: { id: true },
  });
  // From this point the B2 keys are owned by the Track row — any
  // failure cleanup must go through the Track-aware delete path, not
  // a blind B2 delete that would orphan the DB row instead.
  uploadedB2Keys.length = 0;

  // Pre-warm the Cloudflare edge cache before pushing. Without this,
  // Liquidsoap is the first client to hit a brand-new URL — on cache
  // miss CF tries to pull from B2, sometimes returns 522 (origin
  // stall) and Liquidsoap drops the request after a few retries.
  // Listener's song never airs. See incident 2026-05-05 (Veggie Prism).
  await warmCdnUrl(audioUrl);

  // Step 6: push to queue daemon so Lena airs it next. The `announce`
  // field triggers a Lena-voice intro over the first seconds of this
  // song on its FIRST air ("Here's a fresh one from <listener>…").
  // Generation happens in the daemon's background while we wait for
  // the song to bubble up the priority queue.
  try {
    await pushToQueueDaemon({
      trackId: track.id,
      sourceUrl: audioUrl,
      reason: `song_request:${job.id}`,
      announce: {
        listenerName: job.artistName,
        userPrompt: job.prompt,
        title,
      },
    });
  } catch (err) {
    console.warn(
      `[song-worker] queue-daemon push failed for ${job.id} (track is in library, will air in rotation): ${String(err)}`,
    );
  }

  await prisma.songRequest.update({
    where: { id: job.id },
    data: {
      status: "done",
      trackId: track.id,
      completedAt: new Date(),
    },
  });
}
