// DELETE /api/internal/library/track/:id/delete
//
// Operator-initiated total wipe of a library track. Distinct from the
// shoutout cleanup path (delete-aired-shoutout) which is restricted to
// shoutout-flagged tracks and triggered by Liquidsoap; this one is the
// dashboard's bin button.
//
// Body: { reason?: string, operatorEmail?: string }
// Auth: x-internal-secret header.

import { NextRequest, NextResponse } from "next/server";
import { deleteLibraryTrack } from "@/lib/delete-library-track";
import { internalAuthOk } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!internalAuthOk(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({})) as { reason?: unknown; operatorEmail?: unknown };
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "operator_dashboard_delete";
  const operatorEmail = typeof body.operatorEmail === "string" ? body.operatorEmail : "operator";

  const { id } = await params;
  const result = await deleteLibraryTrack(id);
  if (!result.deleted) {
    const status = result.reason === "track_not_found" ? 404 : 500;
    return NextResponse.json({ ok: false, error: result.reason }, { status });
  }
  console.log(
    `[library-delete] track ${id} removed by ${operatorEmail} (reason: ${reason}) — B2 deleted ${result.assetsDeletedFromB2}, failed ${result.b2Failures}`,
  );
  return NextResponse.json({
    ok: true,
    assetsDeletedFromB2: result.assetsDeletedFromB2,
    b2Failures: result.b2Failures,
  });
}
