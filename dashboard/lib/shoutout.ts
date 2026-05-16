import { randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Pool } from "pg";
import { pushToDaemon } from "@/lib/library";
import { stripMarkdown } from "@/lib/strip-markdown";
import { radioHostTransform } from "@/lib/radio-host";
import { humanizeScript } from "@/lib/humanize";
import { synthesizeVertex } from "@/lib/vertex-tts";
import { lenaSpeakShoutout } from "./lena-producer-shoutout";
import { isProducerShoutoutEnabled } from "./lena-producer-shoutout/feature-flag";
import { callMiniMaxJson } from "./lena-producer-shoutout/minimax-llm";

const DEEPGRAM_URL = "https://api.deepgram.com/v1/speak";
// Helena — the canonical Lena voice used across the station (auto-chatter,
// shoutouts, marketing videos). Voice history: Thalia was too "storyteller
// performance", Asteria too corporate, Andromeda too soft, Luna too upbeat.
// Helena is warmer and sits with the brand. Asteria kept as 4xx fallback
// for resilience if Deepgram ever rejects Helena specifically.
const MODEL_PRIMARY = "aura-2-helena-en";
const MODEL_FALLBACK = "aura-asteria-en";

type VoiceProvider = "deepgram" | "vertex";
export const SHOUTOUT_MAX_CHARS = 2000;
const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";

// Shoutout MP3 key embeds the track id → URL contents are immutable. Safe
// to cache aggressively in listener browsers and any future CDN layer.
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

let s3Cache: S3Client | null = null;
function getS3(): S3Client {
  if (s3Cache) return s3Cache;
  s3Cache = new S3Client({
    region: process.env.B2_REGION,
    endpoint: process.env.B2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.B2_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.B2_SECRET_ACCESS_KEY ?? "",
    },
  });
  return s3Cache;
}

function b2PublicUrl(key: string): string {
  const base = process.env.B2_BUCKET_PUBLIC_URL;
  if (!base) throw new Error("B2_BUCKET_PUBLIC_URL not set");
  return `${base}/${key}`;
}

async function synthesizeDeepgram(text: string, apiKey: string): Promise<Buffer> {
  const tryModel = async (model: string): Promise<Response> =>
    fetch(`${DEEPGRAM_URL}?model=${model}&encoding=mp3`, {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });

  let res = await tryModel(MODEL_PRIMARY);
  if (!res.ok && [400, 404, 422].includes(res.status)) {
    res = await tryModel(MODEL_FALLBACK);
  }
  if (!res.ok) {
    throw new Error(`deepgram ${res.status}: ${await res.text()}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Picks the active TTS backend based on the Station.voiceProvider
 *  column. Vertex failures auto-fall-back to Deepgram so a transient
 *  GCP outage never silences Lena. */
async function synthesizeMp3(
  text: string,
  provider: VoiceProvider,
): Promise<Buffer> {
  if (provider === "vertex") {
    const project = process.env.GOOGLE_CLOUD_PROJECT;
    if (project) {
      try {
        return await synthesizeVertex(text, { project });
      } catch (err) {
        console.warn(
          "[shoutout] vertex failed, falling back to deepgram:",
          err instanceof Error ? err.message : err,
        );
      }
    } else {
      console.warn(
        "[shoutout] vertex selected but GOOGLE_CLOUD_PROJECT not set — falling back to deepgram",
      );
    }
  }
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) throw new Error("DEEPGRAM_API_KEY not set");
  return synthesizeDeepgram(text, apiKey);
}

export type ShoutoutSource =
  | { kind: "agent"; sender?: string }
  | { kind: "booth"; shoutoutRowId: string; requesterName?: string };

export interface GenerateShoutoutInput {
  text: string;
  source: ShoutoutSource;
  requestId?: string;
  pool: Pool;
  /** When true, skip the humanize+radio-host rewrite pass and feed
   *  `text` straight to Deepgram. Used for Lena conversational replies
   *  to YouTube chat where the text is already in her voice and a
   *  rewrite would mangle it ("you're welcome inRhino" should air
   *  as-is, not get re-narrated as "a listener said you're welcome"). */
  skipHumanize?: boolean;
}

export interface GenerateShoutoutResult {
  trackId: string;
  sourceUrl: string;
  queueItemId: string;
  durationHintSeconds?: number;
  /**
   * The final text Deepgram actually spoke — post-humanize, post-radioHost
   * transform. Callers persisting an audit row should store this as
   * broadcastText so the operator log reflects what listeners actually
   * heard, not the pre-rewrite listener input.
   */
  spokenText: string;
}

export class ShoutoutError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Core shoutout pipeline: TTS → B2 → Neon Track + TrackAsset → queue push.
 * Callers must have already validated input, rate-limited, and moderated.
 * Callers are responsible for updating the Shoutout audit row if they keep one.
 */
export async function generateShoutout(
  input: GenerateShoutoutInput,
): Promise<GenerateShoutoutResult> {
  const plain = stripMarkdown(input.text).trim();
  if (!plain) {
    throw new ShoutoutError(400, "empty_text", "text must contain speakable content");
  }
  if (plain.length > SHOUTOUT_MAX_CHARS) {
    throw new ShoutoutError(
      400,
      "text_too_long",
      `text too long (${plain.length} > ${SHOUTOUT_MAX_CHARS})`,
    );
  }

  const stationQ = await input.pool.query<{
    id: string;
    voiceProvider: VoiceProvider;
  }>(
    'SELECT id, "voiceProvider" FROM "Station" WHERE slug = $1 LIMIT 1',
    [STATION_SLUG],
  );
  const station = stationQ.rows[0];
  if (!station) {
    throw new ShoutoutError(500, "station_not_found", `station "${STATION_SLUG}" not found`);
  }
  const voiceProvider: VoiceProvider = station.voiceProvider ?? "deepgram";

  // Deepgram is the always-available fallback. Require its key
  // regardless of provider — synthesizeMp3 falls back to it whenever
  // vertex is misconfigured or fails.
  if (!process.env.DEEPGRAM_API_KEY) {
    throw new ShoutoutError(500, "deepgram_not_configured", "DEEPGRAM_API_KEY not set");
  }

  let mp3: Buffer;
  let radioText: string;
  try {
    // 1. Humanize: MiniMax rewrites the flat text into Lena NARRATING
    //    the shoutout — perspective shift from listener-to-recipient
    //    into Lena-to-everyone. Sender name (when from the booth)
    //    flows in so Lena can say "Sophie said …" instead of leaking
    //    the listener's own "I" / "you". Falls back to the original
    //    on any error so this step can never block a shoutout.
    // 2. radioHostTransform: mechanical polish on whatever we have now
    //    (short phrase splits, contractions, quote emphasis).
    if (input.skipHumanize) {
      // Reply path: text is already in Lena's voice (generated by
      // lib/lena-reply.ts). Run mechanical polish only — radioHost
      // does contractions, quote handling, line splits, no
      // perspective shift.
      radioText = radioHostTransform(plain);
    } else {
      const requesterName =
        input.source.kind === "booth" ? input.source.requesterName : undefined;

      let producerText: string | null = null;
      if (isProducerShoutoutEnabled(process.env)) {
        try {
          // Resolve station id via pg pool
          const stationRes = await input.pool.query<{ id: string }>(
            `SELECT id FROM "Station" WHERE slug = $1 LIMIT 1`,
            [process.env.STATION_SLUG ?? "numaradio"],
          );
          const stationId = stationRes.rows[0]?.id;

          if (stationId) {
            // For agent (operator/dashboard) sources, the "sender" field is the
            // OPERATOR's CF Access email — NEVER expose that to the LLM, which would
            // embed it in Lena's spoken text and air it. Operator-composed shoutouts
            // are from "the booth" (no listener attribution applicable).
            const handle =
              input.source.kind === "agent"
                ? "the booth"
                : input.source.requesterName ?? "anonymous";

            // Build a Prisma-shaped shim around the pg.Pool so lenaSpeakShoutout
            // can fetch recent shoutouts + chatter without depending on @prisma/client
            // (which isn't in this app's dependencies).
            const prismaShim = {
              shoutout: {
                findMany: async (args: {
                  where: { stationId: string; createdAt: { gte: Date } };
                  orderBy: { createdAt: "desc" };
                  take: number;
                  select: { id: true; requesterName: true; cleanText: true; createdAt: true };
                }) => {
                  const res = await input.pool.query<{
                    id: string;
                    requesterName: string | null;
                    cleanText: string | null;
                    createdAt: Date;
                  }>(
                    `SELECT id, "requesterName", "cleanText", "createdAt"
                     FROM "Shoutout"
                     WHERE "stationId" = $1 AND "createdAt" >= $2
                     ORDER BY "createdAt" DESC
                     LIMIT $3`,
                    [args.where.stationId, args.where.createdAt.gte, args.take],
                  );
                  return res.rows;
                },
              },
              chatter: {
                findMany: async (args: {
                  where: { stationId: string; airedAt: { gte: Date } };
                  orderBy: { airedAt: "desc" };
                  take: number;
                  select: { id: true; script: true; airedAt: true };
                }) => {
                  const res = await input.pool.query<{
                    id: string;
                    script: string;
                    airedAt: Date;
                  }>(
                    `SELECT id, script, "airedAt"
                     FROM "Chatter"
                     WHERE "stationId" = $1 AND "airedAt" >= $2
                     ORDER BY "airedAt" DESC
                     LIMIT $3`,
                    [args.where.stationId, args.where.airedAt.gte, args.take],
                  );
                  return res.rows;
                },
              },
            };

            const r = await lenaSpeakShoutout({
              trigger: {
                source: input.source.kind === "agent" ? "agent_shoutout" : "booth_shoutout",
                handle,
                text: plain,
              },
              prisma: prismaShim,
              stationId,
              nowMs: Date.now(),
              llm: (prompts) => callMiniMaxJson(prompts, { apiKey: process.env.MINIMAX_API_KEY ?? "" }),
            });
            if (r) producerText = r.text;
          }
        } catch (err) {
          console.warn("[lena-producer-shoutout] failed, falling back to humanize:", err);
        }
      }

      const humanized = producerText ?? await humanizeScript(plain, { requesterName });
      radioText = radioHostTransform(humanized);
    }
    mp3 = await synthesizeMp3(radioText, voiceProvider);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "synthesis failed";
    throw new ShoutoutError(502, "tts_failed", msg);
  }

  const trackId = randomUUID();
  const assetId = randomUUID();
  const storageKey = `stations/${STATION_SLUG}/tracks/${trackId}/audio/stream.mp3`;
  const sourceUrl = b2PublicUrl(storageKey);
  const titleSnippet = plain.slice(0, 40).replace(/\s+/g, " ").trim();
  const title = titleSnippet
    ? `Shoutout: ${titleSnippet}${plain.length > 40 ? "…" : ""}`
    : "Shoutout";
  const provenance = {
    kind: input.source.kind,
    sender: input.source.kind === "agent" ? input.source.sender ?? null : null,
    requesterName:
      input.source.kind === "booth" ? input.source.requesterName ?? null : null,
    shoutoutRowId:
      input.source.kind === "booth" ? input.source.shoutoutRowId : null,
    requestId: input.requestId ?? null,
    model: voiceProvider === "vertex" ? "gemini-3.1-flash-tts-preview" : MODEL_PRIMARY,
    voiceProvider,
    generatedAt: new Date().toISOString(),
  };

  try {
    await getS3().send(
      new PutObjectCommand({
        Bucket: process.env.B2_BUCKET_NAME,
        Key: storageKey,
        Body: mp3,
        ContentType: "audio/mpeg",
        CacheControl: IMMUTABLE_CACHE_CONTROL,
      }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "b2 upload failed";
    throw new ShoutoutError(502, "b2_failed", `b2: ${msg}`);
  }

  try {
    const client = await input.pool.connect();
    try {
      await client.query("BEGIN");
      const now = new Date();
      await client.query(
        `INSERT INTO "Track" (
           id, "stationId", "sourceType", title, "artistDisplay",
           "promptSummary", "provenanceJson",
           "airingPolicy", "safetyStatus", "trackStatus",
           "primaryAudioAssetId", "createdAt", "updatedAt"
         ) VALUES (
           $1, $2, 'external_import'::"TrackSourceType", $3, $4,
           $5, $6::jsonb,
           'request_only'::"AiringPolicy", 'approved'::"SafetyStatus", 'ready'::"TrackStatus",
           $7, $8, $8
         )`,
        [
          trackId,
          station.id,
          title,
          "Lena",
          plain.slice(0, 500),
          JSON.stringify(provenance),
          assetId,
          now,
        ],
      );
      await client.query(
        `INSERT INTO "TrackAsset" (
           id, "trackId", "assetType", "storageProvider", "storageKey",
           "publicUrl", "mimeType", "byteSize", "createdAt"
         ) VALUES (
           $1, $2, 'audio_stream', 'b2', $3,
           $4, 'audio/mpeg', $5, $6
         )`,
        [assetId, trackId, storageKey, sourceUrl, mp3.byteLength, now],
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "db insert failed";
    throw new ShoutoutError(500, "db_failed", `db: ${msg}`);
  }

  const reasonPrefix =
    input.source.kind === "agent"
      ? `shoutout:${input.source.sender ?? "-"}`
      : `booth:${input.source.requesterName ?? "-"}`;
  const push = await pushToDaemon({
    trackId,
    sourceUrl,
    reason: reasonPrefix,
    kind: "shoutout",
  });
  if (!push.ok) {
    throw new ShoutoutError(push.status, "queue_push_failed", push.error);
  }

  // Phase 1 (Lena Producer): notify the daemon's ShiftMemory.
  // Emitting at queue-time (not air-time) for Phase 1 — Phase 2 may
  // switch to track-started for true air-time fidelity. The few-minute
  // delta is acceptable for callback-pool purposes.
  try {
    // Same sanitisation as the Phase 4b handle above — the ShiftMemory
    // handle ends up in the callback-summarizer prompt (LLM input) and
    // could be quoted back on air via a future callback. Never leak the
    // operator's CF Access email through this path either.
    const handle =
      input.source.kind === "agent"
        ? "the booth"
        : input.source.requesterName ?? "anonymous";
    const payload = JSON.stringify({
      type: "shoutout_aired",
      id: trackId, // Track id is unique and lets Phase 2 JOIN through to Shoutout row if needed
      handle,
      originalText: input.text,
      airedAt: Date.now(),
    });
    await input.pool.query(`SELECT pg_notify('lena_event', $1)`, [payload]);
  } catch (err) {
    console.warn("[lena-shift-memory] shoutout_aired NOTIFY failed:", err);
  }

  return {
    trackId,
    sourceUrl,
    queueItemId: push.queueItemId,
    spokenText: radioText,
  };
}
