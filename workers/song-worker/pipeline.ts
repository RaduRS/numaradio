import { randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { PrismaClient } from "@prisma/client";
import { parseBuffer } from "music-metadata";
import { profanityPrefilter } from "../../lib/moderate.ts";
import { showSlugFor, type ShowSlug } from "../../lib/show-slug.ts";
import { loadFallbackArtwork } from "../../lib/fallback-artwork.ts";
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
  const audioBytes = Buffer.from(await audioRes.arrayBuffer());

  // MiniMax's sync-mode response skips extra_info.duration, so fall back to
  // probing the downloaded MP3 (same approach as scripts/ingest-seed.ts).
  let durationSeconds = durationMs > 0 ? Math.round(durationMs / 1000) : null;
  if (durationSeconds === null) {
    try {
      const probed = await parseBuffer(audioBytes, { mimeType: "audio/mpeg" });
      if (probed.format.duration && probed.format.duration > 0) {
        durationSeconds = Math.round(probed.format.duration);
      }
    } catch (err) {
      console.warn(`[song-worker] duration probe failed for ${job.id}: ${String(err)}`);
    }
  }

  const trackId = randomUUID();
  const show = showEnumFor(new Date());
  const audioKey = `stations/${STATION_SLUG}/tracks/${trackId}/audio/stream.mp3`;
  const artworkKey = `stations/${STATION_SLUG}/tracks/${trackId}/artwork/primary.png`;
  const audioUrl = await uploadToB2(audioKey, audioBytes, "audio/mpeg");

  let artworkBuf: Buffer;
  if (artworkBytesOrNull) {
    artworkBuf = artworkBytesOrNull;
  } else {
    console.warn(`[song-worker] using fallback artwork for ${job.id} (show=${show})`);
    artworkBuf = await loadFallbackArtwork(show);
  }
  const artworkUrl = await uploadToB2(artworkKey, artworkBuf, "image/png");

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
      trackStatus: "ready",
      durationSeconds,
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
