
import type { PrismaClient } from "@prisma/client";

export interface ChatTrigger {
  source: "youtube_chat_mention";
  handle: string;
  text: string;
}

export interface ChatContext {
  trigger: ChatTrigger;
  now: { localTime: string; bucket: string };
  recentShoutouts: { id: string; handle: string; originalText: string; minsAgo: number }[];
  recentLenaLines: { text: string; airedAt: number }[];
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
}): ChatContext {
  const now = new Date(args.nowMs);
  return {
    trigger: args.trigger,
    now: { localTime: fmtHHMM(now), bucket: bucketFor(now.getHours()) },
    recentShoutouts: args.recentShoutouts,
    recentLenaLines: args.recentLenaLines,
  };
}

type PrismaSlice = Pick<PrismaClient, "shoutout" | "chatter">;

const THIRTY_MIN_MS = 30 * 60 * 1000;

export async function fetchChatContext(args: {
  prisma: PrismaSlice;
  stationId: string;
  trigger: ChatTrigger;
  nowMs: number;
}): Promise<ChatContext> {
  const cutoff = new Date(args.nowMs - THIRTY_MIN_MS);
  const [shoutouts, lines] = await Promise.all([
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
  });
}
