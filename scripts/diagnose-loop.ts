// Deep diagnostic for the priority-queue loop. Dumps:
//   1. All non-terminal priority_request QueueItems (planned/staged/playing)
//   2. Their corresponding Track airingPolicy
//   3. Recent PlayHistory for any track that's been pushed in last 30 min
//   4. Lena ShiftMemory events (queue_pick + accept_request) in last hour
//
// Usage:
//   export $(grep '^DATABASE_URL=' .env.local | xargs)
//   npx tsx scripts/diagnose-loop.ts

import "../lib/load-env.ts";
import { PrismaClient } from "@prisma/client";

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const station = await prisma.station.findUniqueOrThrow({
      where: { slug: process.env.STATION_SLUG ?? "numaradio" },
      select: { id: true },
    });

    console.log("\n=== 1. Non-terminal priority_request QueueItems ===");
    const queue = await prisma.queueItem.findMany({
      where: {
        stationId: station.id,
        priorityBand: "priority_request",
        queueStatus: { in: ["planned", "staged", "playing"] },
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        trackId: true,
        queueStatus: true,
        queueType: true,
        sourceObjectType: true,
        createdAt: true,
        reasonCode: true,
      },
    });
    console.log(`Count: ${queue.length}`);
    for (const q of queue) {
      console.log(`  ${q.queueStatus.padEnd(8)} ${q.queueType.padEnd(10)} src=${q.sourceObjectType ?? "?"} created=${q.createdAt.toISOString()} track=${q.trackId} reason=${q.reasonCode ?? "-"}`);
    }

    console.log("\n=== 2. Tracks with airingPolicy=priority_request or request_only that recently aired ===");
    const recent = await prisma.playHistory.findMany({
      where: {
        stationId: station.id,
        startedAt: { gte: new Date(Date.now() - 30 * 60_000) },
        trackId: { not: null },
      },
      orderBy: { startedAt: "desc" },
      select: { trackId: true, startedAt: true, titleSnapshot: true },
    });
    const trackIds = [...new Set(recent.map((r) => r.trackId!).filter(Boolean))];
    const tracks = await prisma.track.findMany({
      where: { id: { in: trackIds } },
      select: { id: true, title: true, artistDisplay: true, airingPolicy: true, trackStatus: true },
    });
    const byId = new Map(tracks.map((t) => [t.id, t]));
    const counts = new Map<string, number>();
    for (const r of recent) {
      if (r.trackId) counts.set(r.trackId, (counts.get(r.trackId) ?? 0) + 1);
    }
    const repeats = [...counts.entries()].filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]);
    console.log(`Total plays in last 30 min: ${recent.length}, unique tracks: ${counts.size}, repeats: ${repeats.length}`);
    for (const [id, c] of repeats) {
      const t = byId.get(id);
      console.log(`  ${c}× ${t?.artistDisplay ?? "?"} - ${t?.title ?? "?"} (id=${id}, policy=${t?.airingPolicy})`);
    }

    console.log("\n=== 3. Last 15 plays (any track) ===");
    for (const r of recent.slice(0, 15)) {
      const t = r.trackId ? byId.get(r.trackId) : null;
      console.log(`  ${r.startedAt.toISOString()} ${t?.artistDisplay?.padEnd(20) ?? "?".padEnd(20)} ${t?.title ?? r.titleSnapshot ?? "?"} (policy=${t?.airingPolicy ?? "?"})`);
    }

    console.log("\n=== 4. Recent Chatter showing Lena queue_pick decisions ===");
    const chatter = await prisma.chatter.findMany({
      where: {
        stationId: station.id,
        createdAt: { gte: new Date(Date.now() - 60 * 60_000) },
        producerVersion: { not: null },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, createdAt: true, chatterType: true, broadcastText: true },
    });
    for (const c of chatter) {
      console.log(`  ${c.createdAt.toISOString()} type=${c.chatterType} text="${(c.broadcastText ?? "").slice(0, 100)}"`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
