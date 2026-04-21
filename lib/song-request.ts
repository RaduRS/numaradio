import { prisma } from "@/lib/db";

export interface CreateSongRequestInput {
  stationId: string;
  ipHash: string;
  prompt: string;
  artistName: string;
  originalArtistName: string | null;
  isInstrumental: boolean;
  moderationStatus: string;
  moderationReason: string | null;
}

export interface QueueStats {
  queueDepth: number;
  inProgress: boolean;
  estWaitSeconds: number;
}

const AVG_GENERATION_SECONDS = 210;

export async function createSongRequest(input: CreateSongRequestInput) {
  return prisma.songRequest.create({
    data: {
      stationId: input.stationId,
      ipHash: input.ipHash,
      prompt: input.prompt,
      artistName: input.artistName,
      originalArtistName: input.originalArtistName,
      isInstrumental: input.isInstrumental,
      moderationStatus: input.moderationStatus,
      moderationReason: input.moderationReason,
      status: "queued",
    },
    select: { id: true, createdAt: true },
  });
}

export async function queuePositionFor(
  requestId: string,
  createdAt: Date,
): Promise<number> {
  const ahead = await prisma.songRequest.count({
    where: {
      status: "queued",
      createdAt: { lt: createdAt },
    },
  });
  const inFlight = await prisma.songRequest.count({
    where: { status: { in: ["processing", "finalizing"] } },
  });
  return ahead + inFlight;
}

export async function fetchQueueStats(): Promise<QueueStats> {
  const [queueDepth, inProgressCount] = await Promise.all([
    prisma.songRequest.count({ where: { status: "queued" } }),
    prisma.songRequest.count({
      where: { status: { in: ["processing", "finalizing"] } },
    }),
  ]);
  const totalAhead = queueDepth + inProgressCount;
  return {
    queueDepth,
    inProgress: inProgressCount > 0,
    estWaitSeconds: totalAhead * AVG_GENERATION_SECONDS,
  };
}

export async function fetchSongRequestPublic(id: string) {
  return prisma.songRequest.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      errorMessage: true,
      artistName: true,
      originalArtistName: true,
      titleGenerated: true,
      trackId: true,
      isInstrumental: true,
      lyricsFallback: true,
      createdAt: true,
      track: {
        select: {
          id: true,
          title: true,
          artistDisplay: true,
          assets: {
            where: { assetType: { in: ["audio_stream", "artwork_primary"] } },
            select: { assetType: true, publicUrl: true },
          },
        },
      },
    },
  });
}
