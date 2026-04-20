import { randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Pool } from "pg";
import { pushToDaemon } from "@/lib/library";
import { stripMarkdown } from "@/lib/strip-markdown";
import { radioHostTransform } from "@/lib/radio-host";
import { humanizeScript } from "@/lib/humanize";

const DEEPGRAM_URL = "https://api.deepgram.com/v1/speak";
// Andromeda — softer, closer to a whisper-ish late-night-radio register.
// Thalia was too "storyteller performance" per Markus, Asteria too
// corporate; Andromeda should land between the two with less projection.
const MODEL_PRIMARY = "aura-2-andromeda-en";
const MODEL_FALLBACK = "aura-asteria-en";
export const SHOUTOUT_MAX_CHARS = 2000;
const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";

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

async function synthesizeMp3(text: string, apiKey: string): Promise<Buffer> {
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

export type ShoutoutSource =
  | { kind: "agent"; sender?: string }
  | { kind: "booth"; shoutoutRowId: string; requesterName?: string };

export interface GenerateShoutoutInput {
  text: string;
  source: ShoutoutSource;
  requestId?: string;
  pool: Pool;
}

export interface GenerateShoutoutResult {
  trackId: string;
  sourceUrl: string;
  queueItemId: string;
  durationHintSeconds?: number;
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

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    throw new ShoutoutError(500, "deepgram_not_configured", "DEEPGRAM_API_KEY not set");
  }

  const stationQ = await input.pool.query<{ id: string }>(
    'SELECT id FROM "Station" WHERE slug = $1 LIMIT 1',
    [STATION_SLUG],
  );
  const station = stationQ.rows[0];
  if (!station) {
    throw new ShoutoutError(500, "station_not_found", `station "${STATION_SLUG}" not found`);
  }

  let mp3: Buffer;
  try {
    // 1. Humanize: MiniMax rewrites the flat text into warm radio-host
    //    cadence. Falls back to the original on any error so this step
    //    can never block a shoutout from airing.
    // 2. radioHostTransform: mechanical polish on whatever we have now
    //    (short phrase splits, contractions, quote emphasis).
    const humanized = await humanizeScript(plain);
    const radioText = radioHostTransform(humanized);
    mp3 = await synthesizeMp3(radioText, apiKey);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "synthesis failed";
    throw new ShoutoutError(502, "deepgram_failed", msg);
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
    model: MODEL_PRIMARY,
    generatedAt: new Date().toISOString(),
  };

  try {
    await getS3().send(
      new PutObjectCommand({
        Bucket: process.env.B2_BUCKET_NAME,
        Key: storageKey,
        Body: mp3,
        ContentType: "audio/mpeg",
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

  return {
    trackId,
    sourceUrl,
    queueItemId: push.queueItemId,
  };
}
