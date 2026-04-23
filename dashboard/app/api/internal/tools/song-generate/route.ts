import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getDbPool } from "@/lib/db";
import { internalAuthOk } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";

const PROMPT_MIN = 4;
const PROMPT_MAX = 240;
const ARTIST_MIN = 2;
const ARTIST_MAX = 40;

interface Body {
  prompt?: unknown;
  artistName?: unknown;
  isInstrumental?: unknown;
  operator?: unknown;
}

/**
 * Operator-initiated song request. Bypasses the listener rate limit
 * (CF Access already gates the dashboard) and the booth moderator
 * (operator trust is established). Inserts a SongRequest row with
 * `ipHash = "operator:<email>"` so the worker's per-IP limit never
 * sees it, and the audit log can trace which operator asked. The
 * song-worker polls every 3s — on success the track airs on the
 * stream within 1–4 min, same pipeline as listener songs.
 */
export async function POST(req: Request): Promise<NextResponse> {
  if (!internalAuthOk(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const prompt =
    typeof body.prompt === "string"
      ? body.prompt.trim().replace(/\s+/g, " ")
      : "";
  const artistName =
    typeof body.artistName === "string" ? body.artistName.trim() : "";
  const isInstrumental = body.isInstrumental === true;
  const operator =
    typeof body.operator === "string" ? body.operator : "chat:unknown";

  if (prompt.length < PROMPT_MIN || prompt.length > PROMPT_MAX) {
    return NextResponse.json(
      { ok: false, error: `prompt must be ${PROMPT_MIN}-${PROMPT_MAX} chars` },
      { status: 400 },
    );
  }
  if (artistName.length < ARTIST_MIN || artistName.length > ARTIST_MAX) {
    return NextResponse.json(
      {
        ok: false,
        error: `artistName must be ${ARTIST_MIN}-${ARTIST_MAX} chars`,
      },
      { status: 400 },
    );
  }

  const pool = getDbPool();

  const stationRes = await pool.query<{ id: string }>(
    `SELECT id FROM "Station" WHERE slug = $1 LIMIT 1`,
    [STATION_SLUG],
  );
  if (stationRes.rowCount === 0) {
    return NextResponse.json(
      { ok: false, error: "station not found" },
      { status: 404 },
    );
  }
  const stationId = stationRes.rows[0].id;

  // cuid-ish: we don't need collision-grade uniqueness since SongRequest.id
  // is any string. Prefix tells the worker (and us) it came from operator chat.
  const id = `cmo_chat_${randomUUID().replace(/-/g, "").slice(0, 20)}`;

  const inserted = await pool.query<{ id: string; createdAt: string }>(
    `INSERT INTO "SongRequest"
       (id, "stationId", "ipHash", prompt, "artistName", "originalArtistName",
        "isInstrumental", "moderationStatus", "moderationReason", status, "createdAt")
     VALUES ($1, $2, $3, $4, $5, $5, $6, 'allowed', $7, 'queued', NOW())
     RETURNING id, "createdAt"`,
    [
      id,
      stationId,
      `operator:${operator}`,
      prompt,
      artistName,
      isInstrumental,
      `operator-bypass:${operator}`,
    ],
  );

  console.info(
    `action=song-generate source=chat operator=${operator} request=${id} instrumental=${isInstrumental}`,
  );

  return NextResponse.json({
    ok: true,
    requestId: inserted.rows[0].id,
    status: "queued",
    message:
      "Song queued for the operator bypass pipeline. It'll air within 1–4 min (MiniMax music-2.6 + artwork + upload + queue).",
  });
}
