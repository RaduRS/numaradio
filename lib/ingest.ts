import { randomUUID } from "node:crypto";
import type { Prisma, ShowBlock, TrackSourceType } from "@prisma/client";
import { prisma as defaultPrisma } from "./db/index.ts";
import {
  putObject as defaultPutObject,
  deleteObject as defaultDeleteObject,
  publicUrl as defaultPublicUrl,
} from "./storage/index.ts";

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

export type IngestInput = {
  stationId: string;
  audioBuffer: Buffer;
  show: ShowBlock;
  title: string;
  artistDisplay?: string;
  lyrics?: string;
  caption?: string;
  styleTags?: string[];
  styleSummary?: string;
  gender?: "male" | "female" | "duo" | "instrumental";
  weirdness?: number;
  styleInfluence?: number;
  model?: "v5" | "v5.5";
  sunoId?: string;
  bpm?: number;
  musicalKey?: string;
  durationSeconds?: number;
  artwork?: { buffer: Buffer; mimeType: string };
  rawComment?: string;
  sourceType?: TrackSourceType;
  genre?: string;
  mood?: string;
  airingPolicy?: "library" | "request_only" | "priority_request" | "hold";
};

export type IngestResult =
  | { status: "ingested"; trackId: string }
  | { status: "skipped"; trackId: string; reason: "duplicate_suno_id" };

export async function ingestTrack(input: IngestInput): Promise<IngestResult> {
  return _ingestTrackImpl({
    prisma: defaultPrisma,
    putObject: defaultPutObject,
    deleteObject: defaultDeleteObject,
    publicUrl: defaultPublicUrl,
    stationSlug: STATION_SLUG,
    cacheControl: IMMUTABLE_CACHE_CONTROL,
    input,
  });
}

export type IngestDeps = {
  prisma: typeof defaultPrisma;
  putObject: (key: string, body: Buffer, mime: string, cacheControl: string) => Promise<unknown>;
  deleteObject: (key: string) => Promise<unknown>;
  publicUrl: (key: string) => string;
  stationSlug: string;
  cacheControl: string;
  input: IngestInput;
};

export async function _ingestTrackImpl(deps: IngestDeps): Promise<IngestResult> {
  const { prisma, putObject, deleteObject, publicUrl, stationSlug, cacheControl, input } = deps;

  if (!input.show) throw new Error("ingestTrack: show is required");

  // Idempotency: dedupe on Suno ID before uploading anything
  if (input.sunoId) {
    const existing = await prisma.track.findFirst({
      where: { stationId: input.stationId, sourceReference: input.sunoId },
      select: { id: true },
    });
    if (existing) {
      return { status: "skipped", trackId: existing.id, reason: "duplicate_suno_id" };
    }
  }

  const trackId = randomUUID();
  const audioKey = `stations/${stationSlug}/tracks/${trackId}/audio/stream.mp3`;
  const audioUrl = publicUrl(audioKey);

  await putObject(audioKey, input.audioBuffer, "audio/mpeg", cacheControl);
  const uploadedKeys: string[] = [audioKey];

  let artworkKey: string | undefined;
  let artworkUrl: string | undefined;
  if (input.artwork) {
    const ext = input.artwork.mimeType === "image/png" ? "png" : "jpg";
    artworkKey = `stations/${stationSlug}/tracks/${trackId}/artwork/primary.${ext}`;
    artworkUrl = publicUrl(artworkKey);
    await putObject(artworkKey, input.artwork.buffer, input.artwork.mimeType, cacheControl);
    uploadedKeys.push(artworkKey);
  }

  try {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const track = await tx.track.create({
        data: {
          id: trackId,
          stationId: input.stationId,
          sourceType: input.sourceType ?? "suno_manual",
          sourceReference: input.sunoId,
          title: input.title,
          artistDisplay: input.artistDisplay,
          show: input.show,
          mood: input.mood,
          genre: input.genre,
          bpm: input.bpm,
          durationSeconds: input.durationSeconds,
          lyricsSummary: input.lyrics?.slice(0, 240),
          promptSummary: (input.caption ?? input.rawComment)?.slice(0, 500),
          provenanceJson: {
            sunoId: input.sunoId,
            sunoUrl: input.sunoId ? `https://suno.com/song/${input.sunoId}` : undefined,
            styleTags: input.styleTags ?? [],
            styleSummary: input.styleSummary,
            caption: input.caption,
            gender: input.gender,
            weirdness: input.weirdness,
            styleInfluence: input.styleInfluence,
            model: input.model,
            musicalKey: input.musicalKey,
            rawComment: input.rawComment,
            ingestedAt: new Date().toISOString(),
            ingestVersion: 3,
          },
          airingPolicy: input.airingPolicy ?? "library",
          safetyStatus: "approved",
          trackStatus: "processing",
        },
      });

      const audioAsset = await tx.trackAsset.create({
        data: {
          trackId: track.id,
          assetType: "audio_stream",
          storageKey: audioKey,
          publicUrl: audioUrl,
          mimeType: "audio/mpeg",
          byteSize: input.audioBuffer.byteLength,
          durationSeconds: input.durationSeconds,
        },
      });

      let artAssetId: string | undefined;
      if (artworkKey && artworkUrl && input.artwork) {
        const artAsset = await tx.trackAsset.create({
          data: {
            trackId: track.id,
            assetType: "artwork_primary",
            storageKey: artworkKey,
            publicUrl: artworkUrl,
            mimeType: input.artwork.mimeType,
            byteSize: input.artwork.buffer.byteLength,
          },
        });
        artAssetId = artAsset.id;
      }

      await tx.track.update({
        where: { id: track.id },
        data: {
          primaryAudioAssetId: audioAsset.id,
          primaryArtAssetId: artAssetId,
          trackStatus: "ready",
        },
      });
    });

    return { status: "ingested", trackId };
  } catch (err) {
    // Roll back B2 uploads so we don't leave orphaned objects
    await Promise.all(uploadedKeys.map((k) => deleteObject(k).catch(() => undefined)));
    throw err;
  }
}
