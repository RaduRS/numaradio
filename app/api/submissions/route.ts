// POST /api/submissions
//
// DEPRECATED. The submission flow now uses the three-step
// init → direct-to-B2 PUT → finalize pattern (see /api/submissions/init
// and /api/submissions/finalize). Multipart uploads through this route
// were capped at 4.5 MB by Vercel's serverless body limit, which silently
// returned 413 to anyone uploading a real-size MP3. The stale-page client
// would see "413" and either retry (which only worked if the user had
// since refreshed onto the new code) or give up.
//
// This stub is kept to give those stale clients a clear error. Tell them
// to refresh; the new client uses the bigger-file-friendly path. Returns
// 410 Gone for clarity. (For requests over 4.5 MB Vercel still returns
// its own 413 before this handler runs — but that's only legacy stale
// clients, which the refresh fixes.)

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MESSAGE =
  "The submission flow has been updated. Please refresh the page (Ctrl+R or Cmd+R) and try again — the new flow handles larger MP3s reliably.";

export async function POST(): Promise<NextResponse> {
  return NextResponse.json(
    { ok: false, error: "endpoint_deprecated", message: MESSAGE },
    { status: 410 },
  );
}
