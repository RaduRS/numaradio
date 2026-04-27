// POST /api/submissions/:id/reject
//
// Body: { reason: string }
//
// Thin proxy to the public-site internal reject endpoint. Forwards
// the reason + the operator's CF Access email.

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const PUBLIC_SITE = process.env.PUBLIC_SITE_URL ?? "https://numaradio.com";

function operatorEmail(req: NextRequest): string {
  return req.headers.get("cf-access-authenticated-user-email") ?? "operator";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const secret = process.env.INTERNAL_API_SECRET ?? "";
  if (!secret) {
    return NextResponse.json({ error: "internal_secret_missing" }, { status: 500 });
  }

  const inBody = (await req.json().catch(() => ({}))) as { reason?: unknown };
  const reason = typeof inBody.reason === "string" ? inBody.reason : "";

  const { id } = await params;

  let res: Response;
  try {
    res = await fetch(`${PUBLIC_SITE}/api/internal/submissions/${id}/reject`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": secret,
      },
      body: JSON.stringify({ reason, operatorEmail: operatorEmail(req) }),
    });
  } catch (e) {
    return NextResponse.json(
      { error: "upstream_unreachable", detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return NextResponse.json(json, { status: res.status });
}
