// Fingerprint check via AcoustID + MusicBrainz.
//
// Flow:
//   1. Download MP3 from track's primary audio asset URL
//   2. Run `fpcalc` (Chromaprint) to generate a fingerprint
//   3. Submit fingerprint + duration to AcoustID web API
//   4. For each AcoustID recording MBID, query MusicBrainz for title/artist
//   5. Persist result on the Track row
//   6. Return { result: 'clean' | 'match' | 'error', meta: {...} }
//
// fpcalc is part of the `chromaprint` / `libchromaprint-tools` package.
// Install on Orion:  sudo apt-get install libchromaprint-tools

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import os from "node:os";
import { prisma } from "./db";

const ACOUSTID_API = "https://api.acoustid.org/v2/lookup";
// Hardcoded app key — the acoustid package distributes one for open-source use.
const ACOUSTID_APP_KEY = "IWjxGeGQ";
const MUSIC_BRAINZ_API = "https://musicbrainz.org/ws/2/recording";
// MusicBrainz requires a User-Agent. Use the station name + a contact URL.
const MB_HEADERS = {
  "User-Agent": "NumaRadio/1.0 (https://numaradio.com; mailto:hello@numaradio.com)",
  Accept: "application/json",
};
const FPCALC_MAX_LENGTH = 120; // seconds — first 2 min is enough for fingerprint
const MATCH_THRESHOLD = 0.9; // AcoustID score ≥ this = match

// ─── Types ────────────────────────────────────────────────────────────────────

export type FingerprintResult = "clean" | "match" | "error";

export interface MatchedRecording {
  mbid: string;
  title: string;
  artist: string;
  score: number;
}

export interface FingerprintMeta {
  matchedRecordings: MatchedRecording[];
  errorMsg?: string;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run a full fingerprint check on the given track.
 * Downloads audio, runs fpcalc, queries AcoustID + MusicBrainz, persists result.
 * Returns the computed result (never throws — errors are stored as `error` result).
 */
export async function runFingerprintCheck(trackId: string): Promise<{
  result: FingerprintResult;
  meta: FingerprintMeta;
}> {
  // 1. Load track + audio URL
  const track = await prisma.track.findUnique({
    where: { id: trackId },
    include: { assets: { where: { assetType: "audio" } } },
  });
  if (!track) throw new Error(`Track ${trackId} not found`);
  const audioAsset = track.assets[0];
  if (!audioAsset) throw new Error(`No audio asset for track ${trackId}`);

  const audioUrl = audioAsset.publicUrl;

  let tmpDir: string | undefined;
  let tmpFile: string | undefined;

  try {
    // 2. Download to temp file
    tmpDir = await mkdir(join(os.tmpdir(), `numa-fp-${trackId.slice(0, 8)}-${Date.now()}`), {
      recursive: true,
    });
    // tmpDir is definitely set here (await above); use ! to satisfy TS
    tmpFile = join(tmpDir!, "audio.mp3");
    await downloadToFile(audioUrl, tmpFile);

    // 3. Run fpcalc
    const fpResult = await runFpcalc(tmpFile);
    if (!fpResult) {
      return storeResult(trackId, "error", { matchedRecordings: [], errorMsg: "fpcalc produced no output" });
    }

    // 4. AcoustID lookup
    const recordings = await lookupAcoustId(fpResult.fingerprint, fpResult.duration);
    if (recordings.length === 0) {
      return storeResult(trackId, "clean", { matchedRecordings: [] });
    }

    // 5. MusicBrainz enrich for each MBID (rate-limited to 1 req/s)
    const matched: MatchedRecording[] = [];
    for (const rec of recordings) {
      try {
        const mb = await lookupMusicBrainz(rec.id);
        if (mb) {
          matched.push({ mbid: rec.id, title: mb.title, artist: mb.artist, score: rec.score });
        }
      } catch {
        // MB lookup failed — skip this result but continue
      }
      // MusicBrainz rate limit: 1 req/s
      await sleep(1100);
    }

    const result: FingerprintResult = matched.length > 0 ? "match" : "clean";
    return storeResult(trackId, result, { matchedRecordings: matched });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return storeResult(trackId, "error", { matchedRecordings: [], errorMsg: msg });
  } finally {
    // Cleanup temp dir
    if (tmpDir) {
      try { await rm(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}

// ─── Step 1: Download ─────────────────────────────────────────────────────────

async function downloadToFile(url: string, destPath: string): Promise<void> {
  // Convert Backblaze B2 public URL to authenticated download if needed.
  // The publicUrl stored on TrackAsset is already a full public URL (f003.backblazeb2.com).
  const res = await fetch(url, {
    signal: AbortSignal.timeout(60_000),
    // Range the first 50 MB max — that's more than enough for fpcalc
    headers: { Range: "bytes=0-52428799" },
  });
  if (!res.body) throw new Error(`fetch returned no body for ${url}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await pipeline(Readable.fromWeb(res.body as any), createWriteStream(destPath));
}

// ─── Step 2: fpcalc ───────────────────────────────────────────────────────────

interface FpcalcResult {
  fingerprint: string;
  duration: number;
}

function findFpcalc(): string {
  // Try PATH first, then common install locations
  const pathLocations = [
    "/usr/bin/fpcalc",
    "/usr/local/bin/fpcalc",
    "/usr/bin/local/fpcalc",
  ];
  const envPath = process.env.PATH?.split(":") ?? [];
  for (const dir of [...envPath, ...pathLocations]) {
    const candidate = join(dir, "fpcalc");
    try {
      // Sync stat is fine here — it's a startup check, not hot path
      stat(candidate);
      return candidate;
    } catch {
      // not found
    }
  }
  return "fpcalc"; // let spawn fail with a clear error
}

async function runFpcalc(audioPath: string): Promise<FpcalcResult | null> {
  return new Promise((resolve, reject) => {
    const fp = spawn(findFpcalc(), [
      "-length", String(FPCALC_MAX_LENGTH),
      audioPath,
    ]);

    let stdout = "";
    let stderr = "";
    fp.stdout.on("data", (c) => { stdout += c.toString("utf8"); });
    fp.stderr.on("data", (c) => { stderr += c.toString("utf8"); });
    fp.on("error", (err) => reject(new Error(`fpcalc spawn failed: ${err.message}`)));
    fp.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`fpcalc exited ${code}: ${stderr.slice(-200)}`));
        return;
      }
      // fpcalc outputs: FINGERPRINT=<base64> DURATION=<seconds>
      const fpMatch = stdout.match(/FINGERPRINT=(\S+)/);
      const durMatch = stdout.match(/DURATION=(\d+\.?\d*)/);
      if (!fpMatch || !durMatch) {
        resolve(null);
        return;
      }
      resolve({ fingerprint: fpMatch[1], duration: parseFloat(durMatch[1]) });
    });
  });
}

// ─── Step 3: AcoustID ──────────────────────────────────────────────────────────

interface AcoustIdRecording {
  id: string; // MBID
  score: number;
}

async function lookupAcoustId(fingerprint: string, duration: number): Promise<AcoustIdRecording[]> {
  const body = new URLSearchParams({
    format: "json",
    client: ACOUSTID_APP_KEY,
    duration: String(Math.round(duration)),
    fingerprint,
  });

  const res = await fetch(ACOUSTID_API, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`AcoustID API ${res.status}`);

  const json = await res.json() as {
    results?: Array<{
      recordings?: Array<{ id: string; sources?: Array<{ score?: number }> }>;
    }>;
  };

  const results: AcoustIdRecording[] = [];
  for (const result of json.results ?? []) {
    for (const rec of result.recordings ?? []) {
      // Find the highest source score for this recording
      const maxScore = rec.sources?.reduce((best, s) => Math.max(best, s.score ?? 0), 0) ?? 0;
      if (maxScore >= MATCH_THRESHOLD) {
        results.push({ id: rec.id, score: maxScore });
      }
    }
  }
  return results;
}

// ─── Step 4: MusicBrainz ───────────────────────────────────────────────────────

interface MbRecording {
  title: string;
  "artist-credit": Array<{ name: string; artist?: { name: string; disambiguation?: string } }>;
}

interface MbLookupResult {
  title: string;
  artist: string;
}

async function lookupMusicBrainz(mbid: string): Promise<MbLookupResult | null> {
  const url = `${MUSIC_BRAINZ_API}/${mbid}?fmt=json&inc=artist-credits`;
  const res = await fetch(url, {
    headers: MB_HEADERS,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const json = await res.json() as MbRecording;
  const credit = json["artist-credit"] ?? [];
  const artistName =
    credit.map((c) => c.name).join(", ") ||
    credit[0]?.artist?.name ||
    "Unknown Artist";
  return { title: json.title ?? "Unknown Title", artist: artistName };
}

// ─── Step 5: Persist ───────────────────────────────────────────────────────────

async function storeResult(
  trackId: string,
  result: FingerprintResult,
  meta: FingerprintMeta,
): Promise<{ result: FingerprintResult; meta: FingerprintMeta }> {
  await prisma.track.update({
    where: { id: trackId },
    data: {
      fingerprintResult: result,
      fingerprintMeta: meta as unknown as object,
      fingerprintedAt: new Date(),
    },
  });
  return { result, meta };
}

// ─── Misc ─────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}