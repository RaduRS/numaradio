// lib/catalog-lookup.ts

import type { PrismaClient } from "@prisma/client";

export interface CatalogMatch {
  id: string;
  title: string;
  artist: string | null;
  genre: string | null;
  bpm: number | null;
  /** 0..1, higher = better. Simple substring + token-overlap heuristic. */
  score: number;
}

type PrismaSlice = Pick<PrismaClient, "track">;

const STOPWORDS = new Set(["play", "playing", "can", "you", "the", "a", "by", "please", "next", "song", "track", "tune"]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function scoreMatch(query: string, track: { title: string; artistDisplay: string | null }): number {
  const qTokens = new Set(tokenize(query));
  if (qTokens.size === 0) return 0;
  const trackTokens = new Set([...tokenize(track.title), ...tokenize(track.artistDisplay ?? "")]);
  let overlap = 0;
  for (const t of qTokens) if (trackTokens.has(t)) overlap += 1;
  return overlap / qTokens.size;
}

export async function lookupCatalogCandidates(args: {
  prisma: PrismaSlice;
  stationId: string;
  requestText: string;
  /** Maximum candidates to return (sorted by score desc). */
  limit?: number;
}): Promise<CatalogMatch[]> {
  const limit = args.limit ?? 5;
  // Fetch up to 200 library tracks for the station — cheap.
  const tracks = await args.prisma.track.findMany({
    where: { stationId: args.stationId, trackStatus: "ready", airingPolicy: "library" },
    take: 200,
    select: { id: true, title: true, artistDisplay: true, genre: true, bpm: true },
  });
  const scored = tracks
    .map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artistDisplay,
      genre: t.genre,
      bpm: t.bpm,
      score: scoreMatch(args.requestText, t),
    }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored;
}
