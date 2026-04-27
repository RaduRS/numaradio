// POST /api/internal/submissions/:id/reject
//
// Body: { reason: string, operatorEmail?: string }
//
// Marks the submission rejected with a reason, deletes the audio +
// artwork from B2 (cost saver), keeps the row for audit.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { deleteObject } from "@/lib/storage";
import { internalAuthOk } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!internalAuthOk(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const reason = typeof (body as { reason?: unknown }).reason === "string"
    ? (body as { reason: string }).reason.trim()
    : "";
  if (reason.length < 3 || reason.length > 500) {
    return NextResponse.json(
      { error: "bad_reason", message: "Reason must be between 3 and 500 characters." },
      { status: 400 },
    );
  }
  const operatorEmail =
    typeof (body as { operatorEmail?: unknown }).operatorEmail === "string"
      ? (body as { operatorEmail: string }).operatorEmail
      : "operator";

  const { id } = await params;
  const submission = await prisma.musicSubmission.findUnique({ where: { id } });
  if (!submission) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (submission.status !== "pending") {
    return NextResponse.json(
      { error: "not_pending", status: submission.status },
      { status: 409 },
    );
  }

  await prisma.musicSubmission.update({
    where: { id: submission.id },
    data: {
      status: "rejected",
      rejectReason: reason,
      reviewedAt: new Date(),
      reviewedBy: operatorEmail,
    },
  });

  await deleteObject(submission.audioStorageKey).catch(() => undefined);
  if (submission.artworkStorageKey) {
    await deleteObject(submission.artworkStorageKey).catch(() => undefined);
  }

  return NextResponse.json({ ok: true });
}
