// POST /api/presence/heartbeat
//
// Anonymous presence beacon. The client sends a random sessionId it
// generated in memory (no cookie, no localStorage) every ~30 seconds
// while the tab is visible. We upsert a SiteVisitor row keyed by that
// sessionId and update lastSeenAt; the dashboard reads that table to
// show a live "people on the site" count.
//
// Also sweeps rows older than the stale-window so the table can't
// grow unbounded. Doesn't need a cron.

import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// Aligned with the dashboard's 60 s "active visitor" count window
// (see lib/presence on the dashboard). 2 min gives a 2× grace so a
// heartbeat that was a few seconds late doesn't cause a row to flip
// out of the count and back in.
const SWEEP_MINUTES = 2;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  let body: { sessionId?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  if (!UUID_RE.test(sessionId)) {
    return Response.json({ error: "bad sessionId" }, { status: 400 });
  }

  const now = new Date();
  const sweepCutoff = new Date(now.getTime() - SWEEP_MINUTES * 60_000);

  await Promise.all([
    prisma.siteVisitor.upsert({
      where: { sessionId },
      create: { sessionId, lastSeenAt: now },
      update: { lastSeenAt: now },
    }),
    // Opportunistic cleanup — stale rows never do anything useful. Runs
    // on every heartbeat but typically deletes zero rows, so it's cheap.
    prisma.siteVisitor.deleteMany({
      where: { lastSeenAt: { lt: sweepCutoff } },
    }),
  ]);

  return new Response(null, { status: 204 });
}
