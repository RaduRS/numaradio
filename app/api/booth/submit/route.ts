// POST /api/booth/submit
//
// Public listener shoutout submission endpoint.
// Flow: rate-limit (by IP hash) → MiniMax moderation → create Shoutout row →
//       if allowed/rewritten, call api.numaradio.com/api/internal/shoutout
//       to generate TTS and air on the stream.

import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  checkShoutoutRateLimit,
  clientIpFromRequest,
  hashIp,
  SHOUTOUT_LIMITS,
} from "@/lib/rate-limit";
import { moderateShoutout } from "@/lib/moderate";

export const dynamic = "force-dynamic";

const MIN_CHARS = 4;
const MAX_CHARS = 240;
const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";
const INTERNAL_SHOUTOUT_URL =
  process.env.INTERNAL_SHOUTOUT_URL ??
  "https://api.numaradio.com/api/internal/shoutout";

function publicMessageFor(
  status: "queued" | "held" | "blocked" | "failed",
): string {
  switch (status) {
    case "queued":
      return "Shoutout approved — Lena will read it next.";
    case "held":
      return "Got it. A moderator will review your shoutout before it airs.";
    case "blocked":
      return "Sorry, that one doesn't fit what Lena can read on air.";
    case "failed":
      return "Something went wrong airing your shoutout. Try again in a minute.";
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: { text?: unknown; requesterName?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const rawText =
    typeof body.text === "string" ? body.text.trim().replace(/\s+/g, " ") : "";
  const requesterName =
    typeof body.requesterName === "string"
      ? body.requesterName.trim().slice(0, 60) || null
      : null;

  if (rawText.length < MIN_CHARS) {
    return NextResponse.json(
      { ok: false, error: "shoutout is too short" },
      { status: 400 },
    );
  }
  if (rawText.length > MAX_CHARS) {
    return NextResponse.json(
      { ok: false, error: `shoutout is too long (max ${MAX_CHARS} characters)` },
      { status: 400 },
    );
  }

  const station = await prisma.station.findUnique({
    where: { slug: STATION_SLUG },
    select: { id: true },
  });
  if (!station) {
    return NextResponse.json(
      { ok: false, error: "station not configured" },
      { status: 500 },
    );
  }

  const ipHash = hashIp(clientIpFromRequest(req));
  const limit = await checkShoutoutRateLimit(ipHash);
  if (!limit.ok) {
    const msg =
      limit.reason === "hour_limit"
        ? `Slow down — ${SHOUTOUT_LIMITS.HOUR_LIMIT} shoutouts per hour. Try again soon.`
        : `Daily limit reached (${SHOUTOUT_LIMITS.DAY_LIMIT}). Come back tomorrow.`;
    return NextResponse.json(
      { ok: false, error: msg, retryAfterSeconds: limit.retryAfterSeconds },
      {
        status: 429,
        headers: limit.retryAfterSeconds
          ? { "Retry-After": String(limit.retryAfterSeconds) }
          : undefined,
      },
    );
  }

  const moderation = await moderateShoutout(rawText);
  const moderationDb = {
    allowed: "allowed" as const,
    rewritten: "rewritten" as const,
    held: "held" as const,
    blocked: "blocked" as const,
  }[moderation.decision];

  const initialDelivery =
    moderation.decision === "allowed" || moderation.decision === "rewritten"
      ? "pending"
      : moderation.decision === "held"
        ? "held"
        : "blocked";

  const shoutout = await prisma.shoutout.create({
    data: {
      stationId: station.id,
      rawText,
      cleanText: moderation.decision === "rewritten" ? moderation.text : null,
      requesterName,
      ipHash,
      moderationStatus: moderationDb,
      moderationReason: moderation.reason,
      deliveryStatus: initialDelivery,
    },
    select: { id: true },
  });

  if (moderation.decision === "blocked") {
    return NextResponse.json({
      ok: false,
      status: "blocked",
      message: publicMessageFor("blocked"),
      reason: moderation.reason,
      shoutoutId: shoutout.id,
    });
  }
  if (moderation.decision === "held") {
    const notifyUrl =
      process.env.INTERNAL_HELD_NOTIFY_URL ??
      "https://api.numaradio.com/api/internal/shoutouts/held-notify";
    const secret = process.env.INTERNAL_API_SECRET;
    if (secret) {
      after(async () => {
        try {
          const res = await fetch(notifyUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-internal-secret": secret,
            },
            body: JSON.stringify({
              id: shoutout.id,
              rawText,
              cleanText: undefined,
              requesterName: requesterName ?? undefined,
              moderationReason: moderation.reason ?? undefined,
            }),
          });
          if (!res.ok) {
            console.warn(
              `booth-submit: held-notify returned ${res.status} for ${shoutout.id}`,
            );
          }
        } catch (e) {
          console.warn(
            `booth-submit: held-notify fetch failed for ${shoutout.id}: ${
              e instanceof Error ? e.message : "unknown"
            }`,
          );
        }
      });
    } else {
      console.warn(
        `booth-submit: INTERNAL_API_SECRET missing; skipping held-notify for ${shoutout.id}`,
      );
    }

    return NextResponse.json({
      ok: true,
      status: "held",
      message: publicMessageFor("held"),
      shoutoutId: shoutout.id,
    });
  }

  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    await prisma.shoutout.update({
      where: { id: shoutout.id },
      data: { deliveryStatus: "failed", moderationReason: "internal_secret_missing" },
    });
    return NextResponse.json(
      {
        ok: false,
        status: "failed",
        message: publicMessageFor("failed"),
        shoutoutId: shoutout.id,
      },
      { status: 500 },
    );
  }

  let internalRes: Response;
  try {
    internalRes = await fetch(INTERNAL_SHOUTOUT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": secret,
      },
      body: JSON.stringify({
        shoutoutRowId: shoutout.id,
        text: moderation.text,
        requesterName: requesterName ?? undefined,
      }),
    });
  } catch (e) {
    await prisma.shoutout.update({
      where: { id: shoutout.id },
      data: {
        deliveryStatus: "failed",
        moderationReason: e instanceof Error ? e.message.slice(0, 200) : "network",
      },
    });
    return NextResponse.json(
      {
        ok: false,
        status: "failed",
        message: publicMessageFor("failed"),
        shoutoutId: shoutout.id,
      },
      { status: 502 },
    );
  }

  const internalJson = (await internalRes.json().catch(() => ({}))) as {
    ok?: boolean;
    queueItemId?: string;
    error?: string;
  };

  if (!internalRes.ok || !internalJson.ok) {
    await prisma.shoutout.update({
      where: { id: shoutout.id },
      data: {
        deliveryStatus: "failed",
        moderationReason: (internalJson.error ?? `http_${internalRes.status}`).slice(0, 200),
      },
    });
    return NextResponse.json(
      {
        ok: false,
        status: "failed",
        message: publicMessageFor("failed"),
        shoutoutId: shoutout.id,
      },
      { status: 502 },
    );
  }

  // The dashboard's internal route already marked the Shoutout row aired.
  return NextResponse.json({
    ok: true,
    status: "queued",
    message: publicMessageFor("queued"),
    shoutoutId: shoutout.id,
    queueItemId: internalJson.queueItemId,
  });
}
