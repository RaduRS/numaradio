import "../lib/load-env";
import { prisma } from "../lib/db";

async function main() {
  const sections: Array<[string, () => Promise<unknown>]> = [
    ["Station", () => prisma.station.count()],
    ["Track (all)", () => prisma.track.count()],
    ["Track by status", () =>
      prisma.track.groupBy({ by: ["trackStatus"], _count: true })],
    ["Track by sourceType", () =>
      prisma.track.groupBy({ by: ["sourceType"], _count: true })],
    ["Track by airingPolicy", () =>
      prisma.track.groupBy({ by: ["airingPolicy"], _count: true })],
    ["TrackAsset", () => prisma.trackAsset.count()],
    ["TrackAsset by type", () =>
      prisma.trackAsset.groupBy({ by: ["assetType"], _count: true })],
    ["Request", () => prisma.request.count()],
    ["RequestEvent", () => prisma.requestEvent.count()],
    ["Shoutout", () => prisma.shoutout.count()],
    ["Vote", () => prisma.vote.count()],
    ["TrackVote", () => prisma.trackVote.count()],
    ["QueueItem", () => prisma.queueItem.count()],
    ["QueueItem by status", () =>
      prisma.queueItem.groupBy({ by: ["queueStatus"], _count: true })],
    ["BroadcastSegment", () => prisma.broadcastSegment.count()],
    ["NowPlaying", () => prisma.nowPlaying.count()],
    ["NowSpeaking", () => prisma.nowSpeaking.count()],
    ["PlayHistory (all)", () => prisma.playHistory.count()],
    ["PlayHistory > 30d old", () =>
      prisma.playHistory.count({
        where: { startedAt: { lt: new Date(Date.now() - 30 * 86400_000) } },
      })],
    ["PlayHistory > 90d old", () =>
      prisma.playHistory.count({
        where: { startedAt: { lt: new Date(Date.now() - 90 * 86400_000) } },
      })],
    ["ModerationFlag", () => prisma.moderationFlag.count()],
    ["WorkflowRun", () => prisma.workflowRun.count()],
    ["WorkflowRun by status", () =>
      prisma.workflowRun.groupBy({ by: ["runStatus"], _count: true })],
    ["SystemEvent (total)", () => prisma.systemEvent.count()],
    ["SystemEvent processed", () =>
      prisma.systemEvent.count({ where: { processedAt: { not: null } } })],
    ["SiteVisitor (total)", () => prisma.siteVisitor.count()],
    ["SiteVisitor stale (>5min)", () =>
      prisma.siteVisitor.count({
        where: { lastSeenAt: { lt: new Date(Date.now() - 5 * 60_000) } },
      })],
  ];

  console.log("═══ COUNTS ═══");
  for (const [name, fn] of sections) {
    try {
      const result = await fn();
      console.log(`\n▸ ${name}:`);
      console.log(typeof result === "number" ? `  ${result}` : JSON.stringify(result, null, 2));
    } catch (e) {
      console.log(`  ERROR: ${(e as Error).message}`);
    }
  }

  console.log("\n═══ ORPHAN / ANOMALY CHECKS ═══");

  const orphanAssets = await prisma.$queryRaw<Array<{ id: string; storageKey: string; trackId: string }>>`
    SELECT ta.id, ta."storageKey", ta."trackId"
    FROM "TrackAsset" ta
    LEFT JOIN "Track" t ON t.id = ta."trackId"
    WHERE t.id IS NULL
    LIMIT 50`;
  console.log(`\n▸ TrackAssets with missing Track (orphans): ${orphanAssets.length}`);
  if (orphanAssets.length) console.log(orphanAssets.slice(0, 5));

  const draftTracks = await prisma.track.findMany({
    where: { trackStatus: "draft" },
    select: { id: true, title: true, artistDisplay: true, sourceType: true, createdAt: true },
    take: 20,
  });
  console.log(`\n▸ Draft tracks (up to 20): ${draftTracks.length}`);
  if (draftTracks.length) console.log(draftTracks);

  const failedTracks = await prisma.track.findMany({
    where: { trackStatus: "failed" },
    select: { id: true, title: true, artistDisplay: true, sourceType: true, createdAt: true },
    take: 20,
  });
  console.log(`\n▸ Failed tracks (up to 20): ${failedTracks.length}`);
  if (failedTracks.length) console.log(failedTracks);

  const testTracks = await prisma.track.findMany({
    where: { sourceType: "internal_test" },
    select: { id: true, title: true, artistDisplay: true, trackStatus: true, createdAt: true },
    take: 20,
  });
  console.log(`\n▸ internal_test tracks (up to 20): ${testTracks.length}`);
  if (testTracks.length) console.log(testTracks);

  const oldQueueItems = await prisma.queueItem.count({
    where: {
      queueStatus: { in: ["completed", "skipped", "cancelled", "failed"] },
      createdAt: { lt: new Date(Date.now() - 7 * 86400_000) },
    },
  });
  console.log(`\n▸ Completed/skipped/cancelled/failed QueueItems >7 days old: ${oldQueueItems}`);

  const oldWorkflows = await prisma.workflowRun.count({
    where: {
      runStatus: { in: ["completed", "failed", "aborted"] },
      startedAt: { lt: new Date(Date.now() - 30 * 86400_000) },
    },
  });
  console.log(`▸ Finished WorkflowRuns >30 days old: ${oldWorkflows}`);

  const oldSystemEvents = await prisma.systemEvent.count({
    where: {
      processedAt: { not: null },
      createdAt: { lt: new Date(Date.now() - 30 * 86400_000) },
    },
  });
  console.log(`▸ Processed SystemEvents >30 days old: ${oldSystemEvents}`);

  console.log("\n═══ LIBRARY HEALTH ═══");
  const libraryReady = await prisma.track.count({
    where: { trackStatus: "ready", airingPolicy: "library" },
  });
  console.log(`▸ Library tracks ready to air: ${libraryReady}`);

  const tracksWithoutAssets = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) as count
    FROM "Track" t
    WHERE NOT EXISTS (
      SELECT 1 FROM "TrackAsset" ta WHERE ta."trackId" = t.id AND ta."assetType" = 'audio'
    )`;
  console.log(`▸ Tracks with NO audio asset: ${tracksWithoutAssets[0].count}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
