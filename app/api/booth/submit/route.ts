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
import { isLatinScript } from "@/lib/text-script";

export const dynamic = "force-dynamic";

const MIN_CHARS = 4;
const MAX_CHARS = 240;
const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";
const INTERNAL_SHOUTOUT_URL =
  process.env.INTERNAL_SHOUTOUT_URL ??
  "https://api.numaradio.com/api/internal/shoutout";

function publicMessageFor(
  status: "moderating" | "queued" | "held" | "blocked" | "failed",
): string {
  switch (status) {
    case "moderating":
      return "Got it. Just giving it a quick look…";
    case "queued":
      return "Got it. It's on its way to air.";
    case "held":
      return "Got it. A moderator's giving it a quick look.";
    case "blocked":
      return "That one can't go on air.";
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
  // Lena's TTS is English-only — non-Latin script garbles on air.
  if (!isLatinScript(rawText)) {
    return NextResponse.json(
      { ok: false, error: "Shoutouts are English-only right now — sorry about that." },
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

  // Create the row in "moderating" state and return immediately. The
  // listener sees a snappy "submitted" within ~200ms; their browser
  // polls /api/booth/shoutout/[id]/status to learn the outcome a couple
  // seconds later. Moderation + dispatch run in after() so the request
  // doesn't burn Vercel Active CPU waiting on MiniMax (was 2-15s of
  // billable wait per submit). (Moved from synchronous on 2026-05-03.)
  const shoutout = await prisma.shoutout.create({
    data: {
      stationId: station.id,
      rawText,
      requesterName,
      ipHash,
      // moderationStatus defaults to "pending" via the Prisma enum.
      deliveryStatus: "moderating",
    },
    select: { id: true },
  });

  const secret = process.env.INTERNAL_API_SECRET;
  after(() => runModerationPipeline({
    shoutoutId: shoutout.id,
    rawText,
    requesterName,
    secret,
  }));

  return NextResponse.json({
    ok: true,
    status: "moderating",
    message: publicMessageFor("moderating"),
    shoutoutId: shoutout.id,
  });
}

// Background pipeline: runs moderation, updates the Shoutout row, then
// either notifies the held queue, dispatches to internal/shoutout, or
// marks the row failed. Errors are caught + persisted so the listener's
// /status poll always lands on a terminal state.
async function runModerationPipeline(args: {
  shoutoutId: string;
  rawText: string;
  requesterName: string | null;
  secret: string | undefined;
}): Promise<void> {
  const { shoutoutId, rawText, requesterName, secret } = args;
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
      `booth-submit: moderation threw for ${shoutoutId}: ${
        e instanceof Error ? e.message : "unknown"
      }`,
    );
    return;
  }

  const moderationDb = {
    allowed: "allowed" as const,
    rewritten: "rewritten" as const,
    held: "held" as const,
    blocked: "blocked" as const,
  }[moderation.decision];

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
    const notifyUrl =
      process.env.INTERNAL_HELD_NOTIFY_URL ??
      "https://api.numaradio.com/api/internal/shoutouts/held-notify";
    if (!secret) {
      console.warn(
        `booth-submit: INTERNAL_API_SECRET missing; skipping held-notify for ${shoutoutId}`,
      );
      return;
    }
    try {
      const res = await fetch(notifyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": secret,
        },
        body: JSON.stringify({
          id: shoutoutId,
          rawText,
          cleanText: undefined,
          requesterName: requesterName ?? undefined,
          moderationReason: moderation.reason ?? undefined,
        }),
      });
      if (!res.ok) {
        console.warn(
          `booth-submit: held-notify returned ${res.status} for ${shoutoutId}`,
        );
      }
    } catch (e) {
      console.warn(
        `booth-submit: held-notify fetch failed for ${shoutoutId}: ${
          e instanceof Error ? e.message : "unknown"
        }`,
      );
    }
    return;
  }

  // allowed | rewritten — set moderation result + flip to "pending"
  // (= "queued for air"), then dispatch downstream.
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
      data: { deliveryStatus: "failed", moderationReason: "internal_secret_missing" },
    });
    return;
  }

  // Dispatch to the dashboard internal route — it runs the radio-host
  // rewrite + Deepgram TTS + B2 upload + queue push, and marks the row
  // `aired` or `failed` when it's done.
  try {
    const internalRes = await fetch(INTERNAL_SHOUTOUT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": secret,
      },
      body: JSON.stringify({
        shoutoutRowId: shoutoutId,
        text: moderation.text,
        requesterName: requesterName ?? undefined,
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
        `booth-submit: internal forward returned ${internalRes.status} for ${shoutoutId}`,
      );
    }
  } catch (e) {
    // Persist a CONTROLLED reason — not e.message — so a future change
    // that puts auth headers or PII into the error message can't leak
    // into the dashboard's Recent feed via moderationReason.
    const reason =
      e instanceof Error && e.name === "TimeoutError"
        ? "internal_forward_timeout"
        : "internal_forward_network";
    await prisma.shoutout.update({
      where: { id: shoutoutId },
      data: {
        deliveryStatus: "failed",
        moderationReason: reason,
      },
    });
    console.warn(
      `booth-submit: internal forward fetch failed for ${shoutoutId} (${reason}): ${
        e instanceof Error ? e.message : "unknown"
      }`,
    );
  }
}
