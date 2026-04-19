import "../lib/load-env";

import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { parseFile } from "music-metadata";
import { prisma } from "../lib/db";
import { putObject, publicUrl } from "../lib/storage";

const SEED_DIR = join(process.cwd(), "seed");
const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";
const STATION_NAME = process.env.STATION_NAME ?? "Numa Radio";

// ─── Field normalization & parsing ──────────────────────────────

const ARTIST_NORMALIZATIONS: Record<string, string> = {
  russellross: "Russell Ross",
  russell_ross: "Russell Ross",
  "russell ross": "Russell Ross",
};

function normalizeArtist(raw: string | undefined): string {
  if (!raw) return "Unknown Artist";
  const key = raw.trim().toLowerCase();
  return ARTIST_NORMALIZATIONS[key] ?? raw.trim();
}

function parseBpm(text: string): number | undefined {
  const m = text.match(/(\d+)\s*BPM\b/i);
  return m ? parseInt(m[1], 10) : undefined;
}

function parseKey(text: string): string | undefined {
  const m = text.match(/\b([A-G][#♭b]?)\s+(Major|Minor|Maj|Min)\b/i);
  return m ? `${m[1]} ${m[2].replace(/^Maj$/i, "Major").replace(/^Min$/i, "Minor")}` : undefined;
}

function parseSunoId(text: string): string | undefined {
  const m =
    text.match(/suno\.com\/song\/([a-f0-9-]{36})/i) ??
    text.match(/\bid=([a-f0-9-]{36})\b/i);
  return m?.[1];
}

function parseHashtags(text: string): string[] {
  return [...text.matchAll(/#(\w+)/g)].map((m) => m[1]);
}

const GENRE_TAGS = /^(NuDisco|Disco|House|FunkyHouse|Funk|Pop|Rock|Jazz|HipHop|Lofi|Lo-?fi|Ambient|Electronic|Indie|Soul|RnB|R&B|Country|Folk|Techno|Trance|DnB|Drum.?and.?Bass)$/i;
const MOOD_TAGS = /^(Groovy|Chill|Energetic|Calm|Dark|Bright|Summer|Romantic|Melancholic|Uplifting|Dreamy|Hype|Mellow)$/i;

function deriveGenreAndMood(tags: string[]): { genre?: string; mood?: string } {
  return {
    genre: tags.find((t) => GENRE_TAGS.test(t)),
    mood: tags.find((t) => MOOD_TAGS.test(t)),
  };
}

// ─── Station bootstrap ──────────────────────────────────────────

async function ensureStation(): Promise<{ id: string; slug: string }> {
  const existing = await prisma.station.findUnique({ where: { slug: STATION_SLUG } });
  if (existing) return existing;
  const created = await prisma.station.create({
    data: { slug: STATION_SLUG, name: STATION_NAME },
  });
  console.log(`✓ Created station "${created.slug}" (${created.id})`);
  return created;
}

// ─── Per-file ingest ────────────────────────────────────────────

type IngestResult = "ingested" | "skipped" | "failed";

async function ingestFile(stationId: string, filePath: string): Promise<IngestResult> {
  const fileName = basename(filePath);
  console.log(`\n── ${fileName}`);

  const meta = await parseFile(filePath);
  const tags = meta.common;
  const audioBuffer = await readFile(filePath);

  const title = tags.title?.trim() ?? basename(fileName, extname(fileName));
  const artist = normalizeArtist(tags.artist);
  const commentText = tags.comment?.[0]?.text ?? tags.comment?.[0]?.toString() ?? "";
  const bpm = parseBpm(commentText);
  const musicalKey = parseKey(commentText);
  const sunoId = parseSunoId(commentText);
  const hashtags = parseHashtags(commentText);
  const { genre, mood } = deriveGenreAndMood(hashtags);
  const lyrics = tags.lyrics?.[0]?.text;
  const durationSec = meta.format.duration ? Math.round(meta.format.duration) : undefined;
  const sunoUrl = sunoId ? `https://suno.com/song/${sunoId}` : undefined;

  // Idempotency: dedupe on Suno ID
  if (sunoId) {
    const existing = await prisma.track.findFirst({
      where: { stationId, sourceReference: sunoId },
    });
    if (existing) {
      console.log(`  ↳ already ingested as ${existing.id} — skipping`);
      return "skipped";
    }
  }

  const track = await prisma.track.create({
    data: {
      stationId,
      sourceType: "suno_manual",
      sourceReference: sunoId,
      title,
      artistDisplay: artist,
      mood,
      genre,
      bpm,
      durationSeconds: durationSec,
      lyricsSummary: lyrics?.slice(0, 240),
      promptSummary: commentText.slice(0, 500),
      provenanceJson: {
        sunoId,
        sunoUrl,
        rawComment: commentText,
        hashtags,
        key: musicalKey,
        bpm,
        sourceFileName: fileName,
        sourceBytes: audioBuffer.byteLength,
        sourceCodec: meta.format.codec,
        sampleRate: meta.format.sampleRate,
        bitrate: meta.format.bitrate,
        channels: meta.format.numberOfChannels,
        ingestedAt: new Date().toISOString(),
        ingestVersion: 1,
      },
      airingPolicy: "library",
      safetyStatus: "approved",
      trackStatus: "processing",
    },
  });
  console.log(`  ↳ track ${track.id} — "${title}" by ${artist}`);
  if (bpm || musicalKey || genre || mood) {
    console.log(
      `      ${[bpm && `${bpm} BPM`, musicalKey, genre, mood].filter(Boolean).join(" · ")}`,
    );
  }

  // Audio asset
  const audioKey = `stations/${STATION_SLUG}/tracks/${track.id}/audio/stream.mp3`;
  await putObject(audioKey, audioBuffer, "audio/mpeg");
  const audioAsset = await prisma.trackAsset.create({
    data: {
      trackId: track.id,
      assetType: "audio_stream",
      storageKey: audioKey,
      publicUrl: publicUrl(audioKey),
      mimeType: "audio/mpeg",
      byteSize: audioBuffer.byteLength,
      durationSeconds: durationSec,
    },
  });
  console.log(
    `  ↳ uploaded audio (${(audioBuffer.byteLength / 1024 / 1024).toFixed(2)} MB) → ${audioKey}`,
  );

  // Artwork asset (if embedded)
  let artAssetId: string | undefined;
  const picture = tags.picture?.[0];
  if (picture) {
    const ext = picture.format === "image/png" ? "png" : "jpg";
    const artKey = `stations/${STATION_SLUG}/tracks/${track.id}/artwork/primary.${ext}`;
    await putObject(artKey, Buffer.from(picture.data), picture.format);
    const artAsset = await prisma.trackAsset.create({
      data: {
        trackId: track.id,
        assetType: "artwork_primary",
        storageKey: artKey,
        publicUrl: publicUrl(artKey),
        mimeType: picture.format,
        byteSize: picture.data.byteLength,
      },
    });
    artAssetId = artAsset.id;
    console.log(
      `  ↳ uploaded artwork (${picture.format}, ${(picture.data.byteLength / 1024).toFixed(0)} KB) → ${artKey}`,
    );
  } else {
    console.log("  ↳ no embedded artwork — placeholder will render client-side");
  }

  await prisma.track.update({
    where: { id: track.id },
    data: {
      primaryAudioAssetId: audioAsset.id,
      primaryArtAssetId: artAssetId,
      trackStatus: "ready",
    },
  });
  console.log(`  ↳ marked ready`);

  return "ingested";
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  const station = await ensureStation();

  const entries = await readdir(SEED_DIR);
  const audioFiles = entries
    .filter((f) => /\.(mp3|wav)$/i.test(f))
    .map((f) => join(SEED_DIR, f))
    .sort();

  if (audioFiles.length === 0) {
    console.log("No audio files in seed/. Drop MP3s and re-run.");
    return;
  }

  console.log(`Found ${audioFiles.length} audio file(s) in seed/`);
  console.log(`Station: ${station.slug} (${station.id})`);

  let ingested = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of audioFiles) {
    try {
      const result = await ingestFile(station.id, file);
      if (result === "ingested") ingested += 1;
      else if (result === "skipped") skipped += 1;
    } catch (err) {
      console.error(`✗ ${basename(file)}:`, err instanceof Error ? err.message : err);
      failed += 1;
    }
  }

  console.log(
    `\nDone. ${ingested} ingested · ${skipped} skipped (already present) · ${failed} failed`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
