// POST /api/internal/tracks/:id/fingerprint
//
// Runs an AcoustID fingerprint check on the track's audio and persists
// the result (clean | match | error) to the Track row.
//
// Auth: x-internal-secret header.

import { NextRequest, NextResponse } from "next/server";
import { internalAuthOk } from "@/lib/internal-auth";
import { runFingerprintCheck } from "@/lib/fingerprint";

// Must run on Node.js runtime — fpcalc spawn requires child_process.
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
  console.info(`[fingerprint] track=${id}`);

  try {
    const { result, meta } = await runFingerprintCheck(id);
    console.info(`[fingerprint] track=${id} result=${result}`);
    return NextResponse.json({ result, meta });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[fingerprint] track=${id} error=${msg}`);
    return NextResponse.json(
      { result: "error", meta: { matchedRecordings: [], errorMsg: msg } },
      { status: 200 },
    );
  }
}