// GET /api/booth/shoutout/[id]/status
//
// Read-only safety net for the optimistic submit flow. The client stashes
// its shoutout ID in localStorage on submit; on next page focus it pings
// here to find out whether the background pipeline actually aired it. If
// `deliveryStatus === "failed"` we surface a recovery line. Otherwise the
// stash gets cleared quietly.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  if (!id || typeof id !== "string" || id.length > 64) {
    return NextResponse.json(
      { ok: false, error: "bad_id" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const row = await prisma.shoutout.findUnique({
    where: { id },
    select: {
      deliveryStatus: true,
      moderationStatus: true,
    },
  });

  if (!row) {
    return NextResponse.json(
      { ok: false, error: "not_found" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      status: row.deliveryStatus,
      // Echoed for the booth's spinner so it can distinguish "still
      // moderating" from "moderated, now airing" without adding a
      // separate state to deliveryStatus.
      moderationStatus: row.moderationStatus,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
