// GET /api/submissions/:id/audio
//
// Streams a pending submission's audio for the dashboard preview
// player. Public B2 URLs are not handed to the browser — pending
// content shouldn't be reachable without going through this gate.
// Auth is loose for now (any caller); the dashboard sits behind CF
// Access so the surface is reachable only by authorised operators.
//
// Honors HTTP Range requests with 206 Partial Content so the
// browser can scrub mid-track without re-downloading from byte 0.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getObject } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
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
  const total = buf.length;
  const range = req.headers.get("range");

  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : total - 1;
      if (start <= end && end < total) {
        const slice = buf.subarray(start, end + 1);
        return new Response(new Uint8Array(slice), {
          status: 206,
          headers: {
            "Content-Type": "audio/mpeg",
            "Content-Length": String(slice.length),
            "Content-Range": `bytes ${start}-${end}/${total}`,
            "Accept-Ranges": "bytes",
            // 30 min private browser cache — the operator typically
            // approves or rejects within that window. Avoids a fresh B2
            // download on every replay, scrub, or Range follow-up.
            "Cache-Control": "private, max-age=1800",
          },
        });
      }
    }
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${total}` },
    });
  }

  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(total),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
    },
  });
}
