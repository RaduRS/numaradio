// GET /api/station/shoutouts/recent
//
// Last N aired shoutouts for the public Requests wall. Joined to the linked
// QueueItem → Track so the card can show what song it landed over.
//
//   {
//     shoutouts: Array<{
//       id: string,
//       text: string,                // broadcastText (what Lena read)
//       requesterName?: string,
//       airedAt: string,             // ISO
//       track?: { title: string, artistDisplay?: string },
//     }>
//   }
//
// Only aired + allowed entries are surfaced. Queued/held/pending rows stay
// private because they haven't been through the full moderation+broadcast
// flow and showing them would risk exposing held content.

import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";
const LIMIT = 6;

const HEADERS = {
  "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
  "Content-Type": "application/json",
};

type ShoutoutCard = {
  id: string;
  text: string;
  requesterName?: string;
  airedAt: string;
  track?: { title: string; artistDisplay?: string };
};

type Payload = { shoutouts: ShoutoutCard[] };

export async function GET() {
  const station = await prisma.station.findUnique({
    where: { slug: STATION_SLUG },
    select: { id: true },
  });
  if (!station) {
    return new Response(JSON.stringify({ shoutouts: [] } satisfies Payload), {
      status: 200,
      headers: HEADERS,
    });
  }

  const rows = await prisma.shoutout.findMany({
    where: {
      stationId: station.id,
      moderationStatus: "allowed",
      deliveryStatus: "aired",
    },
    orderBy: { updatedAt: "desc" },
    take: LIMIT,
    select: {
      id: true,
      broadcastText: true,
      cleanText: true,
      rawText: true,
      requesterName: true,
      updatedAt: true,
      linkedQueueItemId: true,
    },
  });

  // Fetch linked QueueItems in one pass so we can show what song each
  // shoutout landed over. Shoutout doesn't have a Prisma relation to
  // QueueItem (linkedQueueItemId is a plain string column), so we resolve
  // manually.
  const queueIds = rows
    .map((r) => r.linkedQueueItemId)
    .filter((id): id is string => !!id);

  // The shoutout's linked QueueItem carries a placeholder Track for the TTS
  // audio (title starts with "Shoutout:", artist is "Lena"). That's never
  // meaningful to show on the public card — the whole point of the track
  // line is to show what music was playing underneath. Current shoutouts
  // use queueType='shoutout'; legacy ones (pre kind-routing) still use
  // 'music' with a placeholder Track, so we filter by both signals.
  const queueItems = queueIds.length
    ? await prisma.queueItem.findMany({
        where: { id: { in: queueIds }, queueType: { not: "shoutout" } },
        select: {
          id: true,
          track: { select: { title: true, artistDisplay: true } },
        },
      })
    : [];
  const queueMap = new Map(
    queueItems
      .filter((q) => {
        const t = q.track;
        if (!t) return false;
        if (t.artistDisplay === "Lena") return false;
        if (t.title.startsWith("Shoutout:")) return false;
        return true;
      })
      .map((q) => [q.id, q.track]),
  );

  const shoutouts: ShoutoutCard[] = rows.map((r) => {
    const linkedTrack = r.linkedQueueItemId
      ? queueMap.get(r.linkedQueueItemId)
      : null;
    return {
      id: r.id,
      text: r.broadcastText ?? r.cleanText ?? r.rawText,
      requesterName: r.requesterName ?? undefined,
      airedAt: r.updatedAt.toISOString(),
      track: linkedTrack
        ? {
            title: linkedTrack.title,
            artistDisplay: linkedTrack.artistDisplay ?? undefined,
          }
        : undefined,
    };
  });

  return new Response(JSON.stringify({ shoutouts } satisfies Payload), {
    status: 200,
    headers: HEADERS,
  });
}
