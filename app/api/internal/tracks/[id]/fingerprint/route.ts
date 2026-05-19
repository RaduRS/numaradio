// POST /api/internal/tracks/:id/fingerprint
//
// Runs an AcoustID fingerprint check on the track's audio and persists
// the result (clean | match | error) to the Track row.
//
// Auth: x-internal-secret header.

import { NextRequest, NextResponse } from "next/server";
import { internalAuthOk } from "@/lib/internal-auth";
import { runFingerprintCheck } from "@/lib/fingerprint";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!internalAuthOk(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { result, meta } = await runFingerprintCheck(id);

  return NextResponse.json({ result, meta });
}