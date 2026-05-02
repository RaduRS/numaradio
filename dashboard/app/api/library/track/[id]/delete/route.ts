// DELETE /api/library/track/:id/delete
//
// Thin proxy to the public site's internal library-delete endpoint.
// The dashboard runs without Prisma — this lives on Vercel where the
// full Track + TrackAsset + B2 cleanup logic does.

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const PUBLIC_SITE = process.env.PUBLIC_SITE_URL ?? "https://numaradio.com";

function operatorEmail(req: NextRequest): string {
  return req.headers.get("cf-access-authenticated-user-email") ?? "operator";
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const secret = process.env.INTERNAL_API_SECRET ?? "";
  if (!secret) {
    return NextResponse.json({ error: "internal_secret_missing" }, { status: 500 });
  }

  const { id } = await params;
  let res: Response;
  try {
    res = await fetch(`${PUBLIC_SITE}/api/internal/library/track/${id}/delete`, {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": secret,
      },
      body: JSON.stringify({ operatorEmail: operatorEmail(req) }),
    });
  } catch (e) {
    return NextResponse.json(
      { error: "upstream_unreachable", detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
  const json = await res.json().catch(() => ({}));
  return NextResponse.json(json, { status: res.status });
}
