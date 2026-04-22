import "../lib/load-env";

import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { parseFile } from "music-metadata";
import { prisma } from "../lib/db";
import { putObject, publicUrl } from "../lib/storage";
import { fetchSunoMetadata } from "../lib/suno";

const SEED_DIR = join(process.cwd(), "seed");
const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";
const STATION_NAME = process.env.STATION_NAME ?? "Numa Radio";
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

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
  let bpm = parseBpm(commentText);
  let musicalKey = parseKey(commentText);
  const sunoId = parseSunoId(commentText);
  const hashtags = parseHashtags(commentText);
  let { genre, mood } = deriveGenreAndMood(hashtags);
  const lyrics = tags.lyrics?.[0]?.text;
  const durationSec = meta.format.duration ? Math.round(meta.format.duration) : undefined;
  const sunoUrl = sunoId ? `https://suno.com/song/${sunoId}` : undefined;

  // Suno stopped including BPM/key/structured-genre in ID3 comments around
  // late 2025. If we have a Suno UUID but ID3 didn't give us those, scrape
  // the public song page for the server-rendered metadata blob.
  let sunoRawTags: string | undefined;
  let sunoModel: string | undefined;
  let sunoGenres: string[] = [];
  let sunoMoods: string[] = [];
  const needsSunoLookup = sunoId && (!bpm || !musicalKey || !genre);
  if (needsSunoLookup) {
    const result = await fetchSunoMetadata(sunoId!);
    if (result.ok) {
      bpm = bpm ?? result.data.bpm;
      musicalKey = musicalKey ?? result.data.musicalKey;
      sunoGenres = result.data.genres;
      sunoMoods = result.data.moods;
      sunoRawTags = result.data.rawTags;
      sunoModel = result.data.modelVersion;
      // Promote the first Suno genre/mood into our single-field slots if the
      // hashtag whitelist didn't already pick something.
      if (!genre && sunoGenres.length) genre = sunoGenres[0];
      if (!mood && sunoMoods.length) mood = sunoMoods[0];
    } else {
      console.log(`  ↳ Suno metadata lookup failed: ${result.reason}`);
    }
  }

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
        sunoRawTags,
        sunoModel,
        sunoGenres,
        sunoMoods,
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
        ingestVersion: 2,
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

  // Audio asset. Cache-Control: immutable — the key embeds the track id,
  // so a given URL's bytes never change. Long max-age lets listener browsers
  // and any future CDN layer avoid re-fetching.
  const audioKey = `stations/${STATION_SLUG}/tracks/${track.id}/audio/stream.mp3`;
  await putObject(audioKey, audioBuffer, "audio/mpeg", IMMUTABLE_CACHE_CONTROL);
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
    await putObject(
      artKey,
      Buffer.from(picture.data),
      picture.format,
      IMMUTABLE_CACHE_CONTROL,
    );
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
