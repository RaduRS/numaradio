// GET /api/submissions/:id/audio
//
// Streams a pending submission's audio for the dashboard preview
// player. Public B2 URLs are not handed to the browser — pending
// content shouldn't be reachable without going through this gate.
// Auth is loose for now (any caller); the dashboard sits behind CF
// Access so the surface is reachable only by authorised operators.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getObject } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const submission = await prisma.musicSubmission.findUnique({
    where: { id },
    select: { audioStorageKey: true, status: true },
  });
  if (!submission || submission.status !== "pending" || !submission.audioStorageKey) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const buf = await getObject(submission.audioStorageKey);
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "private, no-store",
    },
  });
}
