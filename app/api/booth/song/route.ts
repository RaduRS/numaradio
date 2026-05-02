// POST /api/booth/song — listener submits a prompt + artist + optional instrumental toggle.
// Rate-limited by IP hash, moderated by MiniMax, artist name run through
// profanityPrefilter. On success returns {requestId, queuePosition, estWaitSeconds}.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  checkSongRateLimit,
  clientIpFromRequest,
  hashIp,
  SONG_LIMITS,
} from "@/lib/rate-limit";
import { moderateSongPrompt, profanityPrefilter } from "@/lib/moderate";
import { isLatinScript } from "@/lib/text-script";
import {
  createSongRequest,
  queuePositionFor,
} from "@/lib/song-request";

export const dynamic = "force-dynamic";

const PROMPT_MIN = 4;
const PROMPT_MAX = 240;
const ARTIST_MIN = 2;
const ARTIST_MAX = 40;
const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";

export async function POST(req: Request): Promise<NextResponse> {
  let body: {
    prompt?: unknown;
    artistName?: unknown;
    isInstrumental?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const prompt =
    typeof body.prompt === "string" ? body.prompt.trim().replace(/\s+/g, " ") : "";
  const typedArtist =
    typeof body.artistName === "string" ? body.artistName.trim() : "";
  const isInstrumental = body.isInstrumental === true;

  if (prompt.length < PROMPT_MIN) {
    return NextResponse.json(
      { ok: false, error: "prompt_too_short" },
      { status: 400 },
    );
  }
  if (prompt.length > PROMPT_MAX) {
    return NextResponse.json(
      { ok: false, error: "prompt_too_long", max: PROMPT_MAX },
      { status: 400 },
    );
  }
  if (typedArtist.length < ARTIST_MIN) {
    return NextResponse.json(
      { ok: false, error: "artist_name_too_short" },
      { status: 400 },
    );
  }
  if (typedArtist.length > ARTIST_MAX) {
    return NextResponse.json(
      { ok: false, error: "artist_name_too_long", max: ARTIST_MAX },
      { status: 400 },
    );
  }
  // Lena's TTS (and Suno's title generator) handle English best — non-Latin
  // script in either field garbles when announced on air.
  if (!isLatinScript(prompt)) {
    return NextResponse.json(
      { ok: false, error: "english_only_prompt", detail: "Song prompts are English-only right now — sorry about that." },
      { status: 400 },
    );
  }
  if (!isLatinScript(typedArtist)) {
    return NextResponse.json(
      { ok: false, error: "english_only_artist", detail: "Artist name needs to be in Latin characters so Lena can read it." },
      { status: 400 },
    );
  }

  const station = await prisma.station.findUnique({
    where: { slug: STATION_SLUG },
    select: { id: true },
  });
  if (!station) {
    return NextResponse.json(
      { ok: false, error: "station_not_configured" },
      { status: 500 },
    );
  }

  const ipHash = hashIp(clientIpFromRequest(req));

  const limit = await checkSongRateLimit(ipHash);
  if (!limit.ok) {
    const msg =
      limit.reason === "hour_limit"
        ? `Only ${SONG_LIMITS.HOUR_LIMIT} song per hour — come back in a bit.`
        : `Daily limit reached (${SONG_LIMITS.DAY_LIMIT}). Come back tomorrow.`;
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

  const moderation = await moderateSongPrompt(prompt);
  if (moderation.decision === "blocked" || moderation.decision === "held") {
    return NextResponse.json(
      {
        ok: false,
        error: "prompt_not_allowed",
        detail: moderation.reason,
      },
      { status: 422 },
    );
  }
  const finalPrompt =
    moderation.decision === "rewritten" ? moderation.text : prompt;

  const artistPrefilterHit = profanityPrefilter(typedArtist);
  const finalArtist = artistPrefilterHit ? "Numa Radio" : typedArtist;
  const originalArtistName = artistPrefilterHit ? typedArtist : null;

  const created = await createSongRequest({
    stationId: station.id,
    ipHash,
    prompt: finalPrompt,
    artistName: finalArtist,
    originalArtistName,
    isInstrumental,
    moderationStatus: moderation.decision,
    moderationReason: moderation.reason,
  });

  const queuePosition = await queuePositionFor(created.id, created.createdAt);

  return NextResponse.json({
    ok: true,
    requestId: created.id,
    queuePosition,
    estWaitSeconds: queuePosition * 210,
    finalArtistName: finalArtist,
    artistNameSubstituted: Boolean(artistPrefilterHit),
  });
}
