
import type { PrismaClient } from "@prisma/client";

export interface ChatTrigger {
  source: "youtube_chat_mention";
  handle: string;
  text: string;
  /** Phase 5b: classifier intent — reply (default), request, or shoutout_with_request. */
  intent?: "reply" | "request" | "shoutout_with_request";
}

export interface ChatContext {
  trigger: ChatTrigger;
  now: { localTime: string; bucket: string };
  recentShoutouts: { id: string; handle: string; originalText: string; minsAgo: number }[];
  recentLenaLines: { text: string; airedAt: number }[];
  /** Phase 5b: when trigger.intent is request/shoutout_with_request, the
   *  catalog candidates from fuzzy lookup. Empty for reply intent. */
  catalogCandidates: { id: string; title: string; artist: string | null; genre: string | null; bpm: number | null }[];
  /** Phase 5b: ids of tracks aired in the last 60min (recently_aired guardrail). */
  recentlyAiredTrackIds: string[];
  /** Phase 5b: number of pending priority_request items already in queue
   *  (drives accept_request_deferred). */
  queueDepth: number;
}

function bucketFor(hour: number): string {
  if (hour < 5) return "late night";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 21) return "evening";
  return "night";
}

function fmtHHMM(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function buildChatContext(args: {
  trigger: ChatTrigger;
  nowMs: number;
  recentShoutouts: ChatContext["recentShoutouts"];
  recentLenaLines: ChatContext["recentLenaLines"];
  catalogCandidates?: ChatContext["catalogCandidates"];
  recentlyAiredTrackIds?: ChatContext["recentlyAiredTrackIds"];
  queueDepth?: number;
}): ChatContext {
  const now = new Date(args.nowMs);
  return {
    trigger: args.trigger,
    now: { localTime: fmtHHMM(now), bucket: bucketFor(now.getHours()) },
    recentShoutouts: args.recentShoutouts,
    recentLenaLines: args.recentLenaLines,
    catalogCandidates: args.catalogCandidates ?? [],
    recentlyAiredTrackIds: args.recentlyAiredTrackIds ?? [],
    queueDepth: args.queueDepth ?? 0,
  };
}

type PrismaSlice = Pick<PrismaClient, "shoutout" | "chatter" | "playHistory" | "queueItem">;

const THIRTY_MIN_MS = 30 * 60 * 1000;
const SIXTY_MIN_MS = 60 * 60 * 1000;

export async function fetchChatContext(args: {
  prisma: PrismaSlice;
  stationId: string;
  trigger: ChatTrigger;
  nowMs: number;
  catalogCandidates?: ChatContext["catalogCandidates"];
}): Promise<ChatContext> {
  const cutoff = new Date(args.nowMs - THIRTY_MIN_MS);
  const sixtyMinCutoff = new Date(args.nowMs - SIXTY_MIN_MS);
  const isRequest = args.trigger.intent === "request" || args.trigger.intent === "shoutout_with_request";

  const [shoutouts, lines, recentTracks, queueRows] = await Promise.all([
    args.prisma.shoutout.findMany({
      where: { stationId: args.stationId, createdAt: { gte: cutoff } },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, requesterName: true, cleanText: true, createdAt: true },
    }),
    args.prisma.chatter.findMany({
      where: { stationId: args.stationId, airedAt: { gte: cutoff } },
      orderBy: { airedAt: "desc" },
      take: 5,
      select: { id: true, script: true, airedAt: true },
    }),
    isRequest
      ? args.prisma.playHistory.findMany({
          where: { stationId: args.stationId, startedAt: { gte: sixtyMinCutoff } },
          select: { trackId: true },
        })
      : Promise.resolve([] as { trackId: string | null }[]),
    isRequest
      ? args.prisma.queueItem.findMany({
          where: {
            stationId: args.stationId,
            priorityBand: "priority_request",
            queueStatus: { in: ["planned", "staged"] },
          },
          select: { id: true },
        })
      : Promise.resolve([] as { id: string }[]),
  ]);

  return buildChatContext({
    trigger: args.trigger,
    nowMs: args.nowMs,
    recentShoutouts: shoutouts.map((s) => ({
      id: s.id,
      handle: s.requesterName ?? "anonymous",
      originalText: s.cleanText ?? "",
      minsAgo: Math.floor((args.nowMs - s.createdAt.getTime()) / 60_000),
    })),
    recentLenaLines: lines.map((l) => ({ text: l.script, airedAt: l.airedAt.getTime() })),
    catalogCandidates: args.catalogCandidates,
    recentlyAiredTrackIds: recentTracks.map((t) => t.trackId).filter((id): id is string => id != null),
    queueDepth: queueRows.length,
  });
}
