
import type { PrismaClient } from "@prisma/client";

export interface ShoutoutTrigger {
  source: "booth_shoutout" | "agent_shoutout";
  handle: string;
  text: string;
}

export interface ShoutoutContext {
  trigger: ShoutoutTrigger;
  now: { localTime: string; bucket: string };
  recentShoutouts: { id: string; handle: string; text: string; minsAgo: number }[];
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

export function buildShoutoutContext(args: {
  trigger: ShoutoutTrigger;
  nowMs: number;
  recentShoutouts: ShoutoutContext["recentShoutouts"];
  recentLenaLines: ShoutoutContext["recentLenaLines"];
}): ShoutoutContext {
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

export async function fetchShoutoutContext(args: {
  prisma: PrismaSlice;
  stationId: string;
  trigger: ShoutoutTrigger;
  nowMs: number;
}): Promise<ShoutoutContext> {
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
  return buildShoutoutContext({
    trigger: args.trigger,
    nowMs: args.nowMs,
    recentShoutouts: shoutouts.map((s) => ({
      id: s.id,
      handle: s.requesterName ?? "anonymous",
      text: s.cleanText ?? "",
      minsAgo: Math.floor((args.nowMs - s.createdAt.getTime()) / 60_000),
    })),
    recentLenaLines: lines.map((l) => ({ text: l.script, airedAt: l.airedAt.getTime() })),
  });
}
