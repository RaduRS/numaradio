import "../lib/load-env";

import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { parseFile } from "music-metadata";
import { prisma } from "../lib/db";
import { fetchSunoMetadata } from "../lib/suno";
import { ingestTrack } from "../lib/ingest.ts";
import { probeDurationSeconds } from "../lib/probe-duration.ts";
import { resolveShowFromHashtagOrSidecar } from "./ingest-seed-helpers.ts";

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
  let bpm = parseBpm(commentText);
  let musicalKey = parseKey(commentText);
  const sunoId = parseSunoId(commentText);
  const hashtags = parseHashtags(commentText);
  let { genre, mood } = deriveGenreAndMood(hashtags);
  const lyrics = tags.lyrics?.[0]?.text;
  // Frame-accurate duration via ffprobe. music-metadata's header-only
  // estimate can be 30+ seconds off on VBR MP3s with bad/missing Xing
  // headers — common on AI-generated tracks. Falling back to the
  // music-metadata estimate only if ffprobe isn't installed.
  const probedDurSec = await probeDurationSeconds(filePath);
  const durationSec = probedDurSec
    ? Math.round(probedDurSec)
    : meta.format.duration
      ? Math.round(meta.format.duration)
      : undefined;

  const show = await resolveShowFromHashtagOrSidecar({ mp3Path: filePath, commentText });

  let sunoModel: string | undefined;
  const needsSunoLookup = sunoId && (!bpm || !musicalKey || !genre);
  if (needsSunoLookup) {
    const result = await fetchSunoMetadata(sunoId!);
    if (result.ok) {
      bpm = bpm ?? result.data.bpm;
      musicalKey = musicalKey ?? result.data.musicalKey;
      sunoModel = result.data.modelVersion;
      if (!genre && result.data.genres.length) genre = result.data.genres[0];
      if (!mood && result.data.moods.length) mood = result.data.moods[0];
    } else {
      console.log(`  ↳ Suno metadata lookup failed: ${result.reason}`);
    }
  }

  const picture = tags.picture?.[0];
  const artwork = picture
    ? { buffer: Buffer.from(picture.data), mimeType: picture.format }
    : undefined;

  const result = await ingestTrack({
    stationId, audioBuffer, show, title,
    artistDisplay: artist, lyrics, caption: commentText,
    styleTags: hashtags, sunoId, bpm, musicalKey, genre, mood,
    durationSeconds: durationSec, artwork, rawComment: commentText,
    sourceType: "suno_manual",
    model: sunoModel as "v5" | "v5.5" | undefined,
  });

  if (result.status === "skipped") {
    console.log(`  ↳ already ingested as ${result.trackId} — skipping`);
    return "skipped";
  }
  console.log(`  ↳ track ${result.trackId} — "${title}" by ${artist} · show=${show}`);
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
