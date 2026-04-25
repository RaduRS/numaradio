import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { PutObjectCommand, DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getDbPool } from "@/lib/db";
import { generateArtwork } from "@/lib/openrouter";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

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

function publicUrl(key: string): string {
  const base = process.env.B2_BUCKET_PUBLIC_URL;
  if (!base) throw new Error("B2_BUCKET_PUBLIC_URL not set");
  return `${base}/${key}`;
}

interface TrackRow {
  id: string;
  title: string | null;
  description: string | null;
  mood: string | null;
  show: string | null;
  genre: string | null;
  primaryArtAssetId: string | null;
}
interface AssetRow { id: string; storageKey: string }

const SHOW_HINT: Record<string, string> = {
  night_shift: "low-light, late-night, cool blues and dim neon, intimate",
  morning_room: "warm soft daylight, golden hour, hopeful, calm",
  daylight_channel: "midday, bright clean composition, polished",
  prime_hours: "evening, vivid sunset/dusk, electric, celebratory",
};

function buildPrompt(track: TrackRow, hint: string | null): string {
  const parts: string[] = [];
  if (track.description) parts.push(`mood: ${track.description.slice(0, 240)}`);
  else if (track.mood) parts.push(`mood: ${track.mood}`);
  if (track.genre) parts.push(`genre: ${track.genre}`);
  if (track.show && SHOW_HINT[track.show]) parts.push(`time-of-day feel: ${SHOW_HINT[track.show]}`);
  if (hint && hint.trim()) parts.push(`operator note: ${hint.trim().slice(0, 240)}`);
  if (track.title) parts.push(`evocative of the title "${track.title}" (do not show the words)`);
  return parts.join(". ");
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  let body: { hint?: string } = {};
  try { body = (await req.json()) as { hint?: string }; }
  catch { /* empty body is fine */ }

  const pool = getDbPool();

  // Look up the track + its current artwork asset (so we can clean up after)
  const trackRes = await pool.query<TrackRow>(
    `SELECT t.id, t.title, t.description, t.mood, t.show::text AS show, t.genre, t."primaryArtAssetId"
       FROM "Track" t WHERE t.id = $1`,
    [id],
  );
  const track = trackRes.rows[0];
  if (!track) return NextResponse.json({ error: "track not found" }, { status: 404 });

  const oldAssetRes = track.primaryArtAssetId
    ? await pool.query<AssetRow>(
        `SELECT id, "storageKey" FROM "TrackAsset" WHERE id = $1`,
        [track.primaryArtAssetId],
      )
    : { rows: [] };
  const oldAsset = oldAssetRes.rows[0];

  // Generate new image
  const prompt = buildPrompt(track, body.hint ?? null);
  let imgBuf: Buffer;
  try { imgBuf = await generateArtwork(prompt); }
  catch (err) {
    return NextResponse.json(
      { error: `image generation failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }

  // Upload to a NEW key (timestamp suffix) so CDN doesn't serve stale,
  // and so we can roll back by leaving the old asset/object in place if
  // the DB swap fails later.
  const ts = Date.now();
  const key = `stations/${STATION_SLUG}/tracks/${id}/artwork/regen-${ts}-${randomUUID().slice(0, 8)}.jpg`;
  try {
    await getS3().send(new PutObjectCommand({
      Bucket: process.env.B2_BUCKET_NAME,
      Key: key,
      Body: imgBuf,
      ContentType: "image/jpeg",
      CacheControl: IMMUTABLE_CACHE,
    }));
  } catch (err) {
    return NextResponse.json(
      { error: `b2 upload failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }

  // Insert new asset, point Track to it, drop the old one
  const url = publicUrl(key);
  const newAssetId = randomUUID();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO "TrackAsset" (id, "trackId", "assetType", "storageProvider", "storageKey",
                                  "publicUrl", "mimeType", "byteSize", "createdAt")
         VALUES ($1, $2, 'artwork_primary', 'b2', $3, $4, 'image/jpeg', $5, NOW())`,
      [newAssetId, id, key, url, imgBuf.byteLength],
    );
    await client.query(
      `UPDATE "Track" SET "primaryArtAssetId" = $1, "updatedAt" = NOW() WHERE id = $2`,
      [newAssetId, id],
    );
    if (oldAsset) {
      await client.query(`DELETE FROM "TrackAsset" WHERE id = $1`, [oldAsset.id]);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    // Best-effort cleanup of the orphan B2 object
    await getS3().send(new DeleteObjectCommand({ Bucket: process.env.B2_BUCKET_NAME, Key: key })).catch(() => undefined);
    return NextResponse.json(
      { error: `db update failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  } finally {
    client.release();
  }

  // After commit, drop the old B2 object
  if (oldAsset?.storageKey) {
    await getS3().send(new DeleteObjectCommand({
      Bucket: process.env.B2_BUCKET_NAME, Key: oldAsset.storageKey,
    })).catch(() => undefined);
  }

  return NextResponse.json({
    ok: true,
    assetId: newAssetId,
    url,
    bytes: imgBuf.byteLength,
    prompt,
  });
}
