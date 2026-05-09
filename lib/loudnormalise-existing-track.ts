// Shared helper used by both:
//   - workers/queue-daemon/loudnorm-poller.ts (60s tick)
//   - scripts/backfill-track-loudness.ts (operator one-shot)
//
// Loads a Track + its audio_stream asset, runs lib/loudnorm, preserves
// the original at tracks-original/<id>.mp3, overwrites the canonical
// B2 key with the normalised buffer, updates the Track row, and best-
// effort purges Cloudflare cache for the public URL.
//
// All side-effecting calls are injectable (fetch / S3 head / S3 put /
// loudnorm / CF purge) so unit tests don't touch the network.

import type { PrismaClient } from "@prisma/client";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { loudnormalise as defaultLoudnormalise, type LoudnessMeasurement } from "./loudnorm.ts";
import { purgeCloudflareCache, type CfPurgeResult } from "./cf-purge.ts";

export type SkipReason = "voice" | "already_done" | "missing_asset" | "not_found";

export type LoudnormaliseTrackResult =
  | { skipped: SkipReason }
  | { ok: true; measurement: LoudnessMeasurement }
  | { error: string };

export interface LoudnormaliseTrackDeps {
  fetchImpl?: (url: string) => Promise<Response>;
  headImpl?: (key: string) => Promise<boolean>;
  putOriginalImpl?: (key: string, body: Buffer) => Promise<void>;
  putCanonicalImpl?: (key: string, body: Buffer) => Promise<void>;
  loudnormImpl?: typeof defaultLoudnormalise;
  cfPurgeImpl?: (urls: string[]) => Promise<CfPurgeResult>;
}

const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

let _s3: S3Client | null = null;
function s3(): S3Client {
  if (_s3) return _s3;
  _s3 = new S3Client({
    region: process.env.B2_REGION,
    endpoint: process.env.B2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.B2_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.B2_SECRET_ACCESS_KEY ?? "",
    },
  });
  return _s3;
}

function bucket(): string {
  const b = process.env.B2_BUCKET_NAME;
  if (!b) throw new Error("B2_BUCKET_NAME not set");
  return b;
}

async function defaultHead(key: string): Promise<boolean> {
  try {
    await s3().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function defaultPut(key: string, body: Buffer): Promise<void> {
  await s3().send(new PutObjectCommand({
    Bucket: bucket(),
    Key: key,
    Body: body,
    ContentType: "audio/mpeg",
    CacheControl: IMMUTABLE_CACHE_CONTROL,
  }));
}

function isVoiceTrack(t: { sourceType: string; airingPolicy: string; title: string }): boolean {
  return t.sourceType === "external_import"
    && t.airingPolicy === "request_only"
    && t.title.startsWith("Shoutout");
}

export async function loudnormaliseExistingTrack(
  prisma: PrismaClient,
  trackId: string,
  deps: LoudnormaliseTrackDeps = {},
): Promise<LoudnormaliseTrackResult> {
  const fetchImpl = deps.fetchImpl ?? ((u: string) => fetch(u, { signal: AbortSignal.timeout(30_000) }));
  const headImpl = deps.headImpl ?? defaultHead;
  const putOriginalImpl = deps.putOriginalImpl ?? defaultPut;
  const putCanonicalImpl = deps.putCanonicalImpl ?? defaultPut;
  const loudnormImpl = deps.loudnormImpl ?? defaultLoudnormalise;
  const cfPurgeImpl = deps.cfPurgeImpl ?? purgeCloudflareCache;

  const track = await prisma.track.findUnique({
    where: { id: trackId },
    include: { assets: true },
  }) as unknown as {
    id: string;
    title: string;
    sourceType: string;
    airingPolicy: string;
    loudnessLufs: number | null;
    assets: { assetType: string; storageKey: string; publicUrl: string }[];
  } | null;

  if (!track) return { skipped: "not_found" };
  if (track.loudnessLufs !== null) return { skipped: "already_done" };
  if (isVoiceTrack(track)) return { skipped: "voice" };

  const audioAsset = track.assets.find((a) => a.assetType === "audio_stream");
  if (!audioAsset) return { skipped: "missing_asset" };

  // Download canonical audio (CDN-cached path, fast).
  const res = await fetchImpl(audioAsset.publicUrl);
  if (!res.ok) return { error: `audio fetch HTTP ${res.status}` };
  const buf = Buffer.from(await res.arrayBuffer());

  // Preserve original (idempotent — HEAD first).
  const originalKey = `tracks-original/${track.id}.mp3`;
  const originalPresent = await headImpl(originalKey);
  if (!originalPresent) {
    try { await putOriginalImpl(originalKey, buf); }
    catch (err) {
      // Best-effort: log and continue. Better to ship the normalisation
      // than to block the whole pipeline on a backup-copy upload error.
      console.warn(`[loudnorm-track] original preserve failed for ${track.id}: ${String(err)}`);
    }
  }

  // Run loudnorm.
  let result: { buffer: Buffer; measurement: LoudnessMeasurement };
  try {
    result = await loudnormImpl(buf);
  } catch (err) {
    return { error: String(err instanceof Error ? err.message : err) };
  }

  // Overwrite canonical key.
  try {
    await putCanonicalImpl(audioAsset.storageKey, result.buffer);
  } catch (err) {
    return { error: `canonical upload failed: ${String(err instanceof Error ? err.message : err)}` };
  }

  // Update Track row.
  await prisma.track.update({
    where: { id: track.id },
    data: {
      loudnessLufs: result.measurement.outputI,
      loudnessTruePeakDbtp: result.measurement.outputTp,
      loudnessSourceLufs: result.measurement.inputI,
    },
  });

  // Best-effort CF purge.
  const purge = await cfPurgeImpl([audioAsset.publicUrl]);
  if ("error" in purge) {
    console.warn(`[loudnorm-track] CF purge failed for ${audioAsset.publicUrl}: ${purge.error}`);
  }

  return { ok: true, measurement: result.measurement };
}
