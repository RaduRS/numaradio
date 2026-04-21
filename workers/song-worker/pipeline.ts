import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { PrismaClient } from "@prisma/client";
import { profanityPrefilter } from "../../lib/moderate.ts";
import {
  startMusicGeneration,
  pollMusicGeneration,
} from "./minimax.ts";
import { generateArtwork } from "./openrouter.ts";
import { expandPrompt } from "./prompt-expand.ts";

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";
const QUEUE_DAEMON_URL =
  process.env.QUEUE_DAEMON_URL ?? "http://127.0.0.1:4000";

const POLL_INTERVAL_MS = 10_000;
const POLL_TIMEOUT_MS = 360_000; // 6 min

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
    }),
  );
  return b2PublicUrl(key);
}

async function loadDefaultArtwork(): Promise<Buffer> {
  const here = path.dirname(new URL(import.meta.url).pathname);
  return fs.readFile(path.join(here, "assets", "default-artwork.png"));
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
}): Promise<void> {
  const res = await fetch(`${QUEUE_DAEMON_URL}/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
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

  // Step 4: download MiniMax audio + upload both assets to B2.
  const audioRes = await fetch(remoteAudioUrl);
  if (!audioRes.ok) throw new Error(`minimax audio download ${audioRes.status}`);
  const audioBytes = Buffer.from(await audioRes.arrayBuffer());

  const trackId = randomUUID();
  const audioKey = `stations/${STATION_SLUG}/tracks/${trackId}/audio/stream.mp3`;
  const artworkKey = `stations/${STATION_SLUG}/tracks/${trackId}/artwork/primary.png`;
  const audioUrl = await uploadToB2(audioKey, audioBytes, "audio/mpeg");

  const artworkBuf = artworkBytesOrNull ?? (await loadDefaultArtwork());
  const artworkUrl = await uploadToB2(artworkKey, artworkBuf, "image/png");

  // Step 5: create Track + TrackAssets.
  const track = await prisma.track.create({
    data: {
      id: trackId,
      stationId: station.id,
      title,
      artistDisplay: job.artistName,
      sourceType: "minimax_request",
      airingPolicy: "library",
      safetyStatus: "approved",
      trackStatus: "ready",
      durationSeconds: durationMs > 0 ? Math.round(durationMs / 1000) : null,
      assets: {
        create: [
          {
            assetType: "audio_stream",
            storageProvider: "b2",
            storageKey: audioKey,
            publicUrl: audioUrl,
            mimeType: "audio/mpeg",
            byteSize: audioBytes.length,
            durationSeconds: durationMs > 0 ? Math.round(durationMs / 1000) : null,
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

  // Step 6: push to queue daemon so Lena airs it next.
  try {
    await pushToQueueDaemon({
      trackId: track.id,
      sourceUrl: audioUrl,
      reason: `song_request:${job.id}`,
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
