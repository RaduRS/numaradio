// GET /api/presence/current
//
// Returns { count } — number of SiteVisitor rows whose lastSeenAt is
// within the active-window. Used by the operator dashboard to display
// "people on the site" next to the real listener count.

import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// Heartbeat fires every 30 s; we count anyone seen in the last 60 s so
// a single missed beat (e.g. brief network blip) doesn't drop them from
// the count immediately.
const ACTIVE_WINDOW_SECONDS = 60;

export async function GET() {
  const cutoff = new Date(Date.now() - ACTIVE_WINDOW_SECONDS * 1000);
  const count = await prisma.siteVisitor.count({
    where: { lastSeenAt: { gte: cutoff } },
  });
  return Response.json(
    { count },
    { headers: { "Cache-Control": "public, s-maxage=3, stale-while-revalidate=5" } },
  );
}
