import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// 7 days minus a 12h safety buffer. The actual Google revocation
// happens "approximately 7 days" after token mint while in OAuth
// Testing mode; we render the countdown against a slightly tighter
// expiry so the operator gets a half-day warning before the real
// failure.
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

type Status = "fresh" | "warn" | "urgent" | "expired" | "unset";

interface Payload {
  mintedAt: string | null;
  expiresAt: string | null;
  msUntilExpiry: number | null;
  status: Status;
}

function statusFor(msRemaining: number): Status {
  if (msRemaining <= 0) return "expired";
  if (msRemaining < 12 * 60 * 60 * 1000) return "urgent";
  if (msRemaining < 2 * 24 * 60 * 60 * 1000) return "warn";
  return "fresh";
}

export async function GET() {
  const raw = process.env.YOUTUBE_OAUTH_MINTED_AT?.trim();
  if (!raw) {
    const body: Payload = {
      mintedAt: null,
      expiresAt: null,
      msUntilExpiry: null,
      status: "unset",
    };
    return NextResponse.json(body, {
      headers: { "Cache-Control": "no-store" },
    });
  }
  const minted = new Date(raw);
  if (Number.isNaN(minted.getTime())) {
    const body: Payload = {
      mintedAt: raw,
      expiresAt: null,
      msUntilExpiry: null,
      status: "unset",
    };
    return NextResponse.json(body, {
      headers: { "Cache-Control": "no-store" },
    });
  }
  const expires = new Date(minted.getTime() + TTL_MS);
  const msUntilExpiry = expires.getTime() - Date.now();
  const body: Payload = {
    mintedAt: minted.toISOString(),
    expiresAt: expires.toISOString(),
    msUntilExpiry,
    status: statusFor(msUntilExpiry),
  };
  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" },
  });
}
