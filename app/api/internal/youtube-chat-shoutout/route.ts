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
import { generateLenaReply } from "@/lib/lena-reply";
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

  // YouTube-specific intent filter. Tri-state:
  //   shoutout — listener wants a dedication aired (existing flow:
  //     moderate → host-rewrite → TTS → on air)
  //   reply    — listener addressed Lena directly (new flow:
  //     moderate → generate Lena reply → TTS direct, skipHumanize)
  //   noise    — skip (lol / first / hi / emoji-only)
  // Fail-open: if the classifier can't decide it returns shoutout.
  const intent = await classifyShoutoutIntent(rawText);
  if (intent.category === "noise") {
    return NextResponse.json({
      ok: true,
      status: "filtered",
      reason: intent.reason,
    });
  }

  // requesterName carries the source so the dashboard's Recent feed
  // and held-shoutout cards make the YouTube origin obvious.
  const requesterName = `[YT] ${displayName}`.slice(0, MAX_NAME);

  // Create the row in "moderating" state and return immediately.
  // Moderation + dispatch run in after() so we don't burn Vercel CPU
  // waiting on MiniMax (was 2-5s of billable wait per chat message).
  // The daemon doesn't poll for the outcome — it just logs the
  // dispatch — so no /status surface is needed here. (Moved from
  // synchronous on 2026-05-03.)
  const shoutout = await prisma.shoutout.create({
    data: {
      stationId: station.id,
      rawText,
      requesterName,
      // Stash the YT message ID for idempotency. authorChannelId is
      // already in requesterName indirectly via displayName + the
      // poller's per-author rate limit.
      fingerprintHash: ytFingerprint,
      // moderationStatus defaults to "pending" via the Prisma enum.
      deliveryStatus: "moderating",
    },
    select: { id: true },
  });

  const secret = process.env.INTERNAL_API_SECRET;
  const isReply = intent.category === "reply";

  after(() => runYoutubeChatPipeline({
    shoutoutId: shoutout.id,
    rawText,
    displayName,
    requesterName,
    isReply,
    secret,
  }));

  return NextResponse.json({
    ok: true,
    status: "moderating",
    shoutoutId: shoutout.id,
  });
}

// Background: moderate the message, then either notify the held queue
// or dispatch to the internal shoutout pipeline. For "reply" intent
// we also generate Lena's conversational response inline before
// dispatching (skipHumanize=true to bypass the booth-style rewrite).
// Errors persist a CONTROLLED moderationReason on the row.
async function runYoutubeChatPipeline(args: {
  shoutoutId: string;
  rawText: string;
  displayName: string;
  requesterName: string;
  isReply: boolean;
  secret: string | undefined;
}): Promise<void> {
  const { shoutoutId, rawText, displayName, requesterName, isReply, secret } = args;

  let moderation: Awaited<ReturnType<typeof moderateShoutout>>;
  try {
    moderation = await moderateShoutout(rawText);
  } catch (e) {
    await prisma.shoutout
      .update({
        where: { id: shoutoutId },
        data: { deliveryStatus: "failed", moderationReason: "moderation_threw" },
      })
      .catch(() => {});
    console.warn(
      `yt-chat-shoutout: moderation threw for ${shoutoutId}: ${
        e instanceof Error ? e.message : "unknown"
      }`,
    );
    return;
  }

  const moderationDb = (
    {
      allowed: "allowed",
      rewritten: "rewritten",
      held: "held",
      blocked: "blocked",
    } as const
  )[moderation.decision];

  if (moderation.decision === "blocked") {
    await prisma.shoutout.update({
      where: { id: shoutoutId },
      data: {
        moderationStatus: moderationDb,
        moderationReason: moderation.reason,
        deliveryStatus: "blocked",
      },
    });
    return;
  }

  if (moderation.decision === "held") {
    await prisma.shoutout.update({
      where: { id: shoutoutId },
      data: {
        moderationStatus: moderationDb,
        moderationReason: moderation.reason,
        deliveryStatus: "held",
      },
    });
    if (!secret) return;
    try {
      const res = await fetch(INTERNAL_HELD_NOTIFY_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": secret,
        },
        body: JSON.stringify({
          id: shoutoutId,
          rawText,
          cleanText: undefined,
          requesterName,
          moderationReason: moderation.reason ?? undefined,
        }),
      });
      if (!res.ok) {
        console.warn(
          `yt-chat-shoutout: held-notify returned ${res.status} for ${shoutoutId}`,
        );
      }
    } catch (e) {
      console.warn(
        `yt-chat-shoutout: held-notify failed for ${shoutoutId}: ${
          e instanceof Error ? e.message : "unknown"
        }`,
      );
    }
    return;
  }

  // allowed | rewritten — set moderation result + flip to "pending",
  // then either generate Lena's reply (for "reply" intent) or dispatch
  // straight to the host-rewrite pipeline (for "shoutout" intent).
  await prisma.shoutout.update({
    where: { id: shoutoutId },
    data: {
      moderationStatus: moderationDb,
      moderationReason: moderation.reason,
      cleanText: moderation.decision === "rewritten" ? moderation.text : null,
      deliveryStatus: "pending",
    },
  });

  if (!secret) {
    await prisma.shoutout.update({
      where: { id: shoutoutId },
      data: {
        deliveryStatus: "failed",
        moderationReason: "internal_secret_missing",
      },
    });
    return;
  }

  let textToAir = moderation.text;
  let skipHumanize = false;

  if (isReply) {
    // Generate Lena's conversational response. Failure here means we
    // can't air anything sensible — drop quietly rather than falling
    // back to the host-rewrite of the listener's words (which sounded
    // wrong: "inRhino said big thank you" is awkward when the listener
    // was thanking Lena, not the audience).
    const reply = await generateLenaReply(moderation.text, { displayName });
    if (!reply.text) {
      await prisma.shoutout.update({
        where: { id: shoutoutId },
        data: {
          deliveryStatus: "failed",
          moderationReason: `reply_gen_${reply.reason}`,
        },
      });
      console.warn(
        `yt-chat-shoutout: reply generation failed for ${shoutoutId} (${reply.reason})`,
      );
      return;
    }
    textToAir = reply.text;
    skipHumanize = true;
    // Persist what Lena will actually say so the dashboard's Recent
    // feed shows the reply, not the listener's question.
    await prisma.shoutout.update({
      where: { id: shoutoutId },
      data: { cleanText: textToAir },
    });
  }

  try {
    const internalRes = await fetch(INTERNAL_SHOUTOUT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": secret,
      },
      body: JSON.stringify({
        shoutoutRowId: shoutoutId,
        text: textToAir,
        requesterName,
        skipHumanize,
      }),
    });
    if (!internalRes.ok) {
      const detail = await internalRes.text().catch(() => "");
      await prisma.shoutout.update({
        where: { id: shoutoutId },
        data: {
          deliveryStatus: "failed",
          moderationReason: `http_${internalRes.status}: ${detail.slice(0, 160)}`,
        },
      });
      console.warn(
        `yt-chat-shoutout: internal forward returned ${internalRes.status} for ${shoutoutId}`,
      );
    }
  } catch (e) {
    const reason =
      e instanceof Error && e.name === "TimeoutError"
        ? "internal_forward_timeout"
        : "internal_forward_network";
    await prisma.shoutout.update({
      where: { id: shoutoutId },
      data: { deliveryStatus: "failed", moderationReason: reason },
    });
    console.warn(
      `yt-chat-shoutout: internal forward fetch failed for ${shoutoutId} (${reason}): ${
        e instanceof Error ? e.message : "unknown"
      }`,
    );
  }
}
