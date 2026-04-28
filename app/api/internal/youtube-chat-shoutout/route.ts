// POST /api/internal/youtube-chat-shoutout
//
// Internal-only endpoint for the queue-daemon's YouTube chat poller
// (PR 4). Mirrors /api/booth/submit's moderation + held flow but
// without IP-based rate-limit (the daemon enforces per-author limits
// before calling here).
//
// Auth: x-internal-secret header (timing-safe compare). The daemon
// runs on Orion behind cloudflared and shares INTERNAL_API_SECRET
// with the public site.
//
// Body: {text, displayName, authorChannelId, sourceMessageId}
// Returns: {ok, status: "queued"|"held"|"blocked", shoutoutId, error?}

import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { moderateShoutout } from "@/lib/moderate";
import { classifyShoutoutIntent } from "@/lib/classify-shoutout-intent";
import { internalAuthOk } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

const MIN_CHARS = 4;
const MAX_CHARS = 240;
const MAX_NAME = 60;
const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";
const INTERNAL_SHOUTOUT_URL =
  process.env.INTERNAL_SHOUTOUT_URL ??
  "https://api.numaradio.com/api/internal/shoutout";
const INTERNAL_HELD_NOTIFY_URL =
  process.env.INTERNAL_HELD_NOTIFY_URL ??
  "https://api.numaradio.com/api/internal/shoutouts/held-notify";

interface YoutubeChatBody {
  text?: unknown;
  displayName?: unknown;
  authorChannelId?: unknown;
  sourceMessageId?: unknown;
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!internalAuthOk(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: YoutubeChatBody;
  try {
    body = (await req.json()) as YoutubeChatBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const rawText =
    typeof body.text === "string" ? body.text.trim().replace(/\s+/g, " ") : "";
  const displayName =
    typeof body.displayName === "string"
      ? body.displayName.trim().slice(0, MAX_NAME) || "Anonymous"
      : "Anonymous";
  const authorChannelId =
    typeof body.authorChannelId === "string" ? body.authorChannelId.trim() : "";
  const sourceMessageId =
    typeof body.sourceMessageId === "string" ? body.sourceMessageId.trim() : "";

  if (rawText.length < MIN_CHARS) {
    return NextResponse.json(
      { ok: false, error: "shoutout is too short" },
      { status: 400 },
    );
  }
  if (rawText.length > MAX_CHARS) {
    return NextResponse.json(
      { ok: false, error: `shoutout is too long (max ${MAX_CHARS})` },
      { status: 400 },
    );
  }
  if (!authorChannelId) {
    return NextResponse.json(
      { ok: false, error: "authorChannelId required" },
      { status: 400 },
    );
  }

  // Idempotency: if we already have a shoutout for this YouTube
  // message ID, return the previous result instead of double-firing.
  // The fingerprintHash column already has an index and is otherwise
  // unused for booth shoutouts — perfect place to stash the YT
  // message ID without a migration.
  const ytFingerprint = sourceMessageId ? `yt:${sourceMessageId}` : null;
  if (ytFingerprint) {
    const existing = await prisma.shoutout.findFirst({
      where: { fingerprintHash: ytFingerprint },
      select: { id: true, deliveryStatus: true, moderationStatus: true },
    });
    if (existing) {
      const status =
        existing.moderationStatus === "blocked"
          ? "blocked"
          : existing.deliveryStatus === "held"
            ? "held"
            : "queued";
      return NextResponse.json({
        ok: true,
        status,
        shoutoutId: existing.id,
        idempotent: true,
      });
    }
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

  // YouTube-specific intent filter — separates "real shoutout" from
  // "lol"/"first"/"hi". Booth submissions skip this (the form itself
  // self-selects for intent). Fail-open: if the classifier can't
  // decide, fall through to moderation as if it said worthy.
  const intent = await classifyShoutoutIntent(rawText);
  if (!intent.worthy) {
    return NextResponse.json({
      ok: true,
      status: "filtered",
      reason: intent.reason,
    });
  }

  const moderation = await moderateShoutout(rawText);
  const moderationDb = (
    {
      allowed: "allowed",
      rewritten: "rewritten",
      held: "held",
      blocked: "blocked",
    } as const
  )[moderation.decision];

  const initialDelivery =
    moderation.decision === "allowed" || moderation.decision === "rewritten"
      ? "pending"
      : moderation.decision === "held"
        ? "held"
        : "blocked";

  // requesterName carries the source so the dashboard's Recent feed
  // and held-shoutout cards make the YouTube origin obvious.
  const requesterName = `[YT] ${displayName}`.slice(0, MAX_NAME);

  const shoutout = await prisma.shoutout.create({
    data: {
      stationId: station.id,
      rawText,
      cleanText: moderation.decision === "rewritten" ? moderation.text : null,
      requesterName,
      // Stash the YT message ID for idempotency. authorChannelId is
      // already in requesterName indirectly via displayName + the
      // poller's per-author rate limit.
      fingerprintHash: ytFingerprint,
      moderationStatus: moderationDb,
      moderationReason: moderation.reason,
      deliveryStatus: initialDelivery,
    },
    select: { id: true },
  });

  if (moderation.decision === "blocked") {
    return NextResponse.json({
      ok: true,
      status: "blocked",
      shoutoutId: shoutout.id,
      reason: moderation.reason,
    });
  }

  const secret = process.env.INTERNAL_API_SECRET;

  if (moderation.decision === "held") {
    if (secret) {
      after(async () => {
        try {
          const res = await fetch(INTERNAL_HELD_NOTIFY_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-internal-secret": secret,
            },
            body: JSON.stringify({
              id: shoutout.id,
              rawText,
              cleanText: undefined,
              requesterName,
              moderationReason: moderation.reason ?? undefined,
            }),
          });
          if (!res.ok) {
            console.warn(
              `yt-chat-shoutout: held-notify returned ${res.status} for ${shoutout.id}`,
            );
          }
        } catch (e) {
          console.warn(
            `yt-chat-shoutout: held-notify failed for ${shoutout.id}: ${
              e instanceof Error ? e.message : "unknown"
            }`,
          );
        }
      });
    }
    return NextResponse.json({
      ok: true,
      status: "held",
      shoutoutId: shoutout.id,
    });
  }

  // Allowed / rewritten — forward to the existing internal pipeline
  // for radio-host rewrite + TTS + B2 + queue push.
  if (!secret) {
    await prisma.shoutout.update({
      where: { id: shoutout.id },
      data: {
        deliveryStatus: "failed",
        moderationReason: "internal_secret_missing",
      },
    });
    return NextResponse.json(
      { ok: false, error: "internal secret missing", shoutoutId: shoutout.id },
      { status: 500 },
    );
  }

  const moderatedText = moderation.text;
  after(async () => {
    try {
      const internalRes = await fetch(INTERNAL_SHOUTOUT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": secret,
        },
        body: JSON.stringify({
          shoutoutRowId: shoutout.id,
          text: moderatedText,
          requesterName,
        }),
      });
      if (!internalRes.ok) {
        const detail = await internalRes.text().catch(() => "");
        await prisma.shoutout.update({
          where: { id: shoutout.id },
          data: {
            deliveryStatus: "failed",
            moderationReason: `http_${internalRes.status}: ${detail.slice(0, 160)}`,
          },
        });
        console.warn(
          `yt-chat-shoutout: internal forward returned ${internalRes.status} for ${shoutout.id}`,
        );
      }
    } catch (e) {
      const reason =
        e instanceof Error && e.name === "TimeoutError"
          ? "internal_forward_timeout"
          : "internal_forward_network";
      await prisma.shoutout.update({
        where: { id: shoutout.id },
        data: { deliveryStatus: "failed", moderationReason: reason },
      });
      console.warn(
        `yt-chat-shoutout: internal forward fetch failed for ${shoutout.id} (${reason}): ${
          e instanceof Error ? e.message : "unknown"
        }`,
      );
    }
  });

  return NextResponse.json({
    ok: true,
    status: "queued",
    shoutoutId: shoutout.id,
  });
}
