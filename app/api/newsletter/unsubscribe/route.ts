// GET/POST /api/newsletter/unsubscribe?email=<x>&exp=<unix>&sig=<hex>
//
// One-click newsletter unsubscribe. Verifies the HMAC token minted by
// `lib/newsletter-unsubscribe-token.ts` and flips `newsletterOptIn` to
// false on every MusicSubmission row matching the email (an artist
// may have submitted several times — they only opt in/out once).
//
// Both GET and POST are supported:
//   - GET: browser navigation from the link in the newsletter body.
//          Returns a small confirmation HTML page.
//   - POST: RFC 8058 one-click from mail clients (List-Unsubscribe-Post:
//          List-Unsubscribe=One-Click). Returns 200 plain text.
//
// Idempotent: re-clicking the link just sets the column to false again.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyUnsubscribeToken } from "@/lib/newsletter-unsubscribe-token";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest, isPost: boolean): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const email = searchParams.get("email")?.trim().toLowerCase() ?? "";
  const exp = searchParams.get("exp");
  const sig = searchParams.get("sig");

  if (!verifyUnsubscribeToken(email, exp, sig)) {
    if (isPost) return new NextResponse("invalid_or_expired", { status: 400 });
    return new NextResponse(renderPage({
      title: "Link invalid or expired",
      message:
        "This unsubscribe link couldn't be verified. If you keep getting newsletters you don't want, reply to the email and we'll remove you by hand.",
      ok: false,
    }), { status: 400, headers: { "content-type": "text/html; charset=utf-8" } });
  }

  await prisma.musicSubmission.updateMany({
    where: { email },
    data: { newsletterOptIn: false },
  });

  if (isPost) return new NextResponse("ok", { status: 200 });
  return new NextResponse(renderPage({
    title: "You're unsubscribed",
    message:
      "We've taken you off the Numa Radio newsletter list. You'll still get transactional emails (submission decisions) — those aren't marketing.",
    ok: true,
  }), { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return handle(req, false);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handle(req, true);
}

function renderPage(args: { title: string; message: string; ok: boolean }): string {
  const accent = args.ok ? "#0f7d7a" : "#b8423a";
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${args.title} — Numa Radio</title>
<style>
  html, body { background: #0d1716; color: #e8d9b0; margin: 0; min-height: 100vh; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; }
  main { max-width: 520px; margin: 0 auto; padding: 80px 24px; }
  .eyebrow { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: ${accent}; margin: 0 0 14px; }
  h1 { font-size: 28px; font-weight: 700; line-height: 1.25; margin: 0 0 16px; }
  p { font-size: 15px; line-height: 1.6; opacity: 0.85; margin: 0 0 18px; }
  a { color: ${accent}; }
</style>
</head><body>
<main>
  <p class="eyebrow">${args.ok ? "Done" : "Hmm"}</p>
  <h1>${args.title}</h1>
  <p>${args.message}</p>
  <p><a href="https://numaradio.com">← Back to Numa Radio</a></p>
</main>
</body></html>`;
}
