// POST /api/internal/submissions/:id/fingerprint
//
// Runs an AcoustID fingerprint check on a pending submission's audio.
// The audio lives in B2 under MusicSubmission.audioStorageKey (not a Track yet).
//
// Auth: x-internal-secret header.

import { NextRequest, NextResponse } from "next/server";
import { internalAuthOk } from "@/lib/internal-auth";
import { runSubmissionFingerprintCheck } from "@/lib/fingerprint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!internalAuthOk(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  console.info(`[fingerprint:submission] submission=${id}`);

  try {
    const { result, meta } = await runSubmissionFingerprintCheck(id);
    console.info(`[fingerprint:submission] submission=${id} result=${result}`);
    return NextResponse.json({ result, meta });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[fingerprint:submission] submission=${id} error=${msg}`);
    return NextResponse.json(
      { result: "error", meta: { matchedRecordings: [], errorMsg: msg } },
      { status: 200 },
    );
  }
}