// POST /api/submissions/:id/approve
//
// Thin proxy: forwards to the public site's internal approve endpoint
// (which is where lib/ingest lives). Adds the INTERNAL_API_SECRET header
// + the operator's CF Access email so the public side can record who
// approved it.

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
    return NextResponse.json(
      { error: "internal_secret_missing" },
      { status: 500 },
    );
  }

  const { id } = await params;

  const requestBody = (await req.json().catch(() => ({}))) as { show?: unknown };
  const show = typeof requestBody.show === "string" ? requestBody.show : undefined;

  let res: Response;
  try {
    res = await fetch(`${PUBLIC_SITE}/api/internal/submissions/${id}/approve`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": secret,
      },
      body: JSON.stringify({ operatorEmail: operatorEmail(req), show }),
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
