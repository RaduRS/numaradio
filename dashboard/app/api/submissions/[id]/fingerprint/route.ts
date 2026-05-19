// POST /api/submissions/:id/fingerprint
//
// Thin proxy: forwards to the public site's submission fingerprint endpoint.
// Adds the INTERNAL_API_SECRET header so the public side can auth.

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const PUBLIC_SITE = process.env.PUBLIC_SITE_URL ?? "https://numaradio.com";

export async function POST(
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
    res = await fetch(`${PUBLIC_SITE}/api/internal/submissions/${id}/fingerprint`, {
      method: "POST",
      headers: { "x-internal-secret": secret },
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