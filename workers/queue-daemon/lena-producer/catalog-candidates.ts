// workers/queue-daemon/lena-producer/catalog-candidates.ts

import type { PrismaClient } from "@prisma/client";
import { genreFitsShow, type ShowBlockName } from "../../../lib/show-genre-fit.ts";

export interface CatalogCandidate {
  id: string;
  title: string;
  artist: string | null;
  genre: string | null;
  bpm: number | null;
}

type PrismaSlice = Pick<PrismaClient, "track" | "playHistory">;

const SIXTY_MIN_MS = 60 * 60 * 1000;
const CANDIDATE_CAP = 10;

export async function fetchCatalogCandidates(args: {
  prisma: PrismaSlice;
  stationId: string;
  currentShow: ShowBlockName;
  nowMs: number;
}): Promise<CatalogCandidate[]> {
  // 1. Find tracks aired in the last 60 min — exclude these
  const recent = await args.prisma.playHistory.findMany({
    where: {
      stationId: args.stationId,
      startedAt: { gte: new Date(args.nowMs - SIXTY_MIN_MS) },
    },
    select: { trackId: true },
  });
  const excludeIds = recent.map((r) => r.trackId).filter((id): id is string => id != null);

  // 2. Fetch up to 30 station-eligible library tracks NOT in the excluded set
  const tracks = await args.prisma.track.findMany({
    where: {
      stationId: args.stationId,
      trackStatus: "ready",
      airingPolicy: "library",
      id: { notIn: excludeIds.length > 0 ? excludeIds : ["__never__"] },
    },
    take: 30,
    select: { id: true, title: true, artistDisplay: true, genre: true, bpm: true },
  });

  // 3. Filter by show-block genre fit, cap at CANDIDATE_CAP
  const eligible = tracks
    .filter((t) => genreFitsShow(t.genre, args.currentShow))
    .slice(0, CANDIDATE_CAP)
    .map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artistDisplay,
      genre: t.genre,
      bpm: t.bpm,
    }));

  return eligible;
}
