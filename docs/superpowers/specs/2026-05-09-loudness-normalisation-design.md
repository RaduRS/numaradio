# Catalogue loudness normalisation — design

**Date:** 2026-05-09
**Status:** spec — pending implementation plan
**Replaces:** the parked "Loudness normalisation across the catalogue"
section in `TODO.md` (parked 2026-05-05).

---

## Problem

Numa's catalogue is a blend of three audio sources at incompatible
loudness baselines:

- Suno-generated (`sourceType=suno_manual`): hot, ~-8 to -10 LUFS
- MiniMax listener requests (`sourceType=minimax_request`): ~-12 to -14 LUFS
- Submitter artist tracks (`sourceType=external_import`): -6 (clipping)
  to -20 LUFS — the worst spread

A listener tuning in and getting a Suno banger followed by a quietly-
mastered indie submission has to reach for the volume knob. Bad
listener experience on car / phone speakers especially. The fix is
single-target loudness normalisation across every music ingestion
path, plus a Liquidsoap master safety net.

## Goals

1. Every music track on the catalogue plays at -14 LUFS ± 0.5 (the
   streaming default — matches Spotify, YouTube Music, TikTok, and
   the YouTube simulcast's own loudness algorithm).
2. New tracks ingested through any of three entry points get
   normalised at ingest time. No manual operator step required.
3. Existing ~130 catalogue tracks get backfilled in one operator-run
   off-peak pass.
4. A Liquidsoap master safety net catches any outliers that slip
   past the ingest path so listeners never hear an un-normalised
   level jump or clipped peak.

## Non-goals (v1)

- **Voice content (shoutouts, Lena chatter, world asides) is NOT
  ingest-normalised.** It runs on Vercel (no ffmpeg) and has its own
  broadcast-loudness chain in `numa.liq` (`compress` + `pre_gain=14`
  + `limit`). The new master safety net catches voice outliers.
- **No per-show variance** (daytime hotter, late-night quieter).
  Single -14 LUFS target, document it, don't change it later — re-
  running backfill is cheap but listener-perceived re-mastering is
  jarring.
- **No YouTube simulcast ducker.** Out of scope; YouTube's own
  loudness algorithm matches our -14 target anyway.

## Architecture

### Components

1. **`lib/loudnorm.ts`** — pure helper. Two-pass ffmpeg, JSON-parsed
   measurements. Buffer in → `{ buffer, measurement }` out. Mirrors
   the spawn pattern from `lib/sanitize-mp3-audio-only.ts:79`.

2. **`lib/loudnormalise-existing-track.ts`** — shared helper used by
   both the daemon poller and the backfill script. Looks up the
   Track + audio asset, runs `loudnormalise()`, preserves the
   original at `tracks-original/<id>.mp3`, overwrites the canonical
   B2 key with the normalised version, updates the Track row,
   purges the Cloudflare edge cache for the public URL.

3. **Schema fields** on `Track` (additive migration, three nullable
   `Float?` columns): `loudnessLufs`, `loudnessTruePeakDbtp`,
   `loudnessSourceLufs`. NULL means "not yet normalised" — implicit
   pending signal for the daemon poller.

4. **`scripts/backfill-track-loudness.ts`** — one-shot operator
   script. `--dry-run` by default; `--apply` writes; `--limit N`
   optional cap. Serial (one track at a time so ffmpeg doesn't
   compete with broadcast). Operator runs with `nice -n 19` for
   off-peak deference.

5. **`workers/queue-daemon/loudnorm-poller.ts`** — new daemon module.
   Tick every 60s, picks one row `WHERE loudnessLufs IS NULL` and
   calls the shared helper. Catches anything the inline ingest path
   missed (notably submission approvals, which run on Vercel and
   can't normalise inline).

6. **Liquidsoap edit** (`liquidsoap/numa.liq`) — `normalize` +
   `limit` operators on the master output. Backstop only;
   intentionally tight gain envelope so it doesn't pump on already-
   normalised content.

### Coverage by ingestion path

| Path | Mechanism | Latency to normalised |
|---|---|---|
| Existing ~130 catalogue tracks | One-shot `backfill-track-loudness.ts --apply` | once |
| MiniMax listener requests (`workers/song-worker/pipeline.ts`) | Inline loudnorm before B2 upload | 0s (pre-queue) |
| Operator manual ingest — Suno drops, etc. (`scripts/ingest-seed.ts`) | Inline loudnorm before B2 upload | 0s |
| Artist submission approvals (`app/api/internal/submissions/[id]/approve/route.ts`, Vercel) | Track row created with `loudnessLufs=NULL`; queue daemon polls every 60s | ≤60s |
| Voice content (Lena chatter, shoutouts) | Not ingest-normalised; caught by Liquidsoap master safety net | live |

### Data flow — new music ingest (Orion-side paths)

```
source MP3 buffer (in memory)
  ↓
[optional] sanitizeMp3AudioOnly()  — only for Suno (drops MJPEG video stream)
  ↓
loudnormalise(buffer)  — ffmpeg pass 1 measure → pass 2 apply, linear=true
  ↓
{ normalisedBuffer, measurement }
  ↓
PUT s3://numaradio/tracks-original/<id>.mp3   (original, preservation)
PUT s3://numaradio/stations/<slug>/tracks/<id>/audio/stream.mp3  (normalised, canonical)
  ↓
INSERT Track { ..., loudnessLufs, loudnessTruePeakDbtp, loudnessSourceLufs }
```

### Data flow — submission approve (Vercel + daemon)

```
Vercel approve route:
  ingestTrack() creates Track with loudnessLufs=NULL
    (no ffmpeg available on Vercel; just writes the row)
  returns 200 to dashboard

(within 60s, Orion-side)
queue-daemon loudnorm-poller tick:
  SELECT * FROM Track WHERE loudnessLufs IS NULL
    AND NOT (sourceType='external_import' AND airingPolicy='request_only' AND title LIKE 'Shoutout%')
    ORDER BY createdAt ASC LIMIT 1
  ↓
  loudnormaliseExistingTrack(trackId):
    fetch(asset.publicUrl)  — CDN-cached, fast
    HEAD tracks-original/<id>.mp3 — if missing, PUT original
    loudnormalise(buffer)
    PUT canonical key (overwrite)
    UPDATE Track SET loudnessLufs=..., loudnessTruePeakDbtp=..., loudnessSourceLufs=...
    POST CF /zones/<id>/purge_cache  (best-effort)
```

## Detailed component specs

### `lib/loudnorm.ts`

```ts
export interface LoudnessMeasurement {
  inputI: number;        // pre-correction integrated LUFS
  inputTp: number;       // pre-correction true peak dBTP
  inputLra: number;      // pre-correction loudness range LU
  outputI: number;       // post-correction integrated (target ± 0.5)
  outputTp: number;      // post-correction true peak
}

export interface LoudnormResult {
  buffer: Buffer;
  measurement: LoudnessMeasurement;
}

export interface LoudnormOptions {
  targetI?: number;   // default -14
  targetTp?: number;  // default -1
  targetLra?: number; // default 11
}

export async function loudnormalise(
  input: Buffer,
  opts?: LoudnormOptions,
): Promise<LoudnormResult>;
```

**Pass 1 invocation:**

```
ffmpeg -hide_banner -i pipe:0 \
  -af loudnorm=I=-14:TP=-1:LRA=11:print_format=json \
  -f null -
```

Stderr contains a JSON block (after lots of ffmpeg noise) with
`input_i`, `input_tp`, `input_lra`, `input_thresh`, `target_offset`.
Parser uses a regex to find the last `{...}` JSON object in stderr
and `JSON.parse`s it. Returns `null` on parse failure.

**Pass 2 invocation:**

```
ffmpeg -hide_banner -i pipe:0 \
  -af loudnorm=I=-14:TP=-1:LRA=11:measured_I=...:measured_TP=...:\
       measured_LRA=...:measured_thresh=...:offset=...:linear=true:print_format=json \
  -c:a libmp3lame -b:a 192k \
  -f mp3 pipe:1
```

`linear=true` applies a single linear gain (no dynamic compression)
— truer to source than dynamic mode. Output bitrate 192k matches
Icecast output, no further quality loss.

Both passes stream via stdin/stdout — never touches disk. Stdout
chunks collected into a Buffer, stderr accumulated as a string for
JSON extraction.

### `lib/loudnormalise-existing-track.ts`

```ts
export type LoudnormSkipReason = "voice" | "missing_asset" | "already_done";

export type LoudnormResult =
  | { skipped: LoudnormSkipReason }
  | { ok: true; measurement: LoudnessMeasurement };

export async function loudnormaliseExistingTrack(
  prisma: PrismaClient,
  trackId: string,
): Promise<LoudnormResult>;
```

Logic:
1. Load Track + `audio_stream` asset.
2. Skip if voice (sourceType=external_import + airingPolicy=request_only
   + title startsWith "Shoutout") → `{ skipped: "voice" }`.
3. Skip if `loudnessLufs !== null` → `{ skipped: "already_done" }`.
4. Skip if no audio asset → `{ skipped: "missing_asset" }`.
5. Download audio from `asset.publicUrl` (CDN-cached, fast).
6. HEAD `tracks-original/<id>.mp3` — if 404, upload original.
7. Run `loudnormalise(buffer)`.
8. Overwrite canonical `storageKey` with normalised bytes (S3
   PutObject — same key).
9. Update Track row with measurements.
10. POST Cloudflare `/zones/<zoneId>/purge_cache` for the public URL
    (best-effort — log warning on failure, don't throw).

### Schema migration

`prisma/migrations/<timestamp>_add_track_loudness/migration.sql`:

```sql
ALTER TABLE "Track" ADD COLUMN "loudnessLufs" DOUBLE PRECISION;
ALTER TABLE "Track" ADD COLUMN "loudnessTruePeakDbtp" DOUBLE PRECISION;
ALTER TABLE "Track" ADD COLUMN "loudnessSourceLufs" DOUBLE PRECISION;
```

Pure additive — no enum changes, no column type changes, no risk of
the 2026-05-05 enum/index incident.

`prisma/schema.prisma`:

```prisma
model Track {
  // ... existing fields ...
  loudnessLufs            Float?
  loudnessTruePeakDbtp    Float?
  loudnessSourceLufs      Float?
}
```

### `scripts/backfill-track-loudness.ts`

CLI flags:
- `--dry-run` (default): print every Track that would be processed
  (id, title, sourceType, current `loudnessLufs`, asset URL).
- `--apply`: actually run.
- `--limit N`: cap iterations (useful for testing the first 5).

Behaviour:
- Pulls `WHERE loudnessLufs IS NULL` ordered by `createdAt ASC`.
- Calls `loudnormaliseExistingTrack(trackId)` per row.
- Serial — `for` loop, one at a time. ffmpeg is CPU-heavy and Orion
  shares with broadcast. No `Promise.all`.
- Logs per row: `[backfill] id=<id> "<title>" input=-12.3 → -14.0 LUFS (delta +1.7)`
  or `[backfill skip:<reason>] id=<id>`.
- On `loudnormalise` failure: log warning, continue to next row.
- Operator runs with `nice -n 19` for off-peak deference.

### `workers/queue-daemon/loudnorm-poller.ts`

```ts
export function startLoudnormPoller(
  prisma: PrismaClient,
  opts: { intervalMs?: number } = {},
): { stop: () => void };
```

- Interval: 60s default (configurable for tests).
- Each tick: `WHERE loudnessLufs IS NULL AND <not voice> ORDER BY createdAt ASC LIMIT 1`.
- Calls `loudnormaliseExistingTrack(trackId)`.
- Logs: `[loudnorm-poller] processed <id> "<title>" -12.3 → -14.0` or
  `[loudnorm-poller] skip:<reason> <id>` or `[loudnorm-poller] idle`.
- Wired into `workers/queue-daemon/index.ts` startup alongside the
  existing tick loops.

### Liquidsoap edit (`liquidsoap/numa.liq`)

Insert between line 279 (`source = smooth_add(...)`) and line 297
(`source = mksafe(buffer(...))`):

```liquidsoap
# ─── Master safety net (post-ingest-loudnorm backstop) ─────────────
# Every music track is normalised to -14 LUFS at ingest via
# lib/loudnorm.ts. This is the backstop for outliers (a track that
# slipped past the ingest path, voice content that doesn't go through
# loudnorm, a future audio source). Gain envelope is intentionally
# tight (max +6 / min -12 dB) so we don't pump on already-normalised
# content — only catch real outliers.
source = normalize(target=-14., window=1., gain_max=6., gain_min=-12., source)

# Brick-wall to prevent any clipping reaching Icecast. Voice already
# has its own limit() at line 267; this is the master.
source = limit(threshold=-1., source)
```

## Failure modes

| Failure | Behaviour |
|---|---|
| ffmpeg pass 1 fails / JSON unparseable | log warning; caller falls back to raw audio; Track.loudnessLufs stays NULL; daemon poller picks it up later |
| ffmpeg pass 2 fails | same as above |
| Original upload to `tracks-original/` fails | log warning, proceed with normalised upload — preservation is best-effort |
| Cloudflare purge fails (or creds unset) | log warning, continue — listeners get the new file when CF TTL expires (1mo, but realistically much sooner via rotation) |
| Daemon poller crash mid-track | next tick picks up the same row (loudnessLufs still NULL) — idempotent |
| Schema migration fails on prod | additive only, easy revert: `ALTER TABLE "Track" DROP COLUMN ...` |

## Testing

1. **`lib/loudnorm.test.ts`** — unit tests for the JSON parser.
   Capture real ffmpeg stderr output as fixtures
   (`test-fixtures/loudnorm-pass1.txt`, `loudnorm-pass2.txt`). Test
   the parser handles both passes; malformed JSON returns null;
   missing JSON block returns null.

2. **`lib/loudnorm.integration.test.ts`** — real ffmpeg on a fixture
   MP3 (5s of pink noise + 5s of silence). Confirm `outputI` is
   within ±0.5 of -14. Skips if `ffmpeg` not in PATH (so CI on
   Vercel preview branches doesn't fail; runs locally + on Orion).

3. **`lib/loudnormalise-existing-track.test.ts`** — mock prisma + S3
   + `loudnormalise`. Covers:
   - Skips voice tracks
   - Skips already-done (loudnessLufs !== null)
   - Skips missing-asset
   - Idempotent on re-run
   - Doesn't re-upload original if HEAD returns 200
   - Updates Track row with all three loudness fields
   - Calls CF purge if creds present; skips otherwise

4. **`workers/queue-daemon/loudnorm-poller.test.ts`** — fake interval,
   mock prisma. Confirms:
   - Tick picks one row (oldest first)
   - Idle (returns null) when no pending rows
   - Continues after a failed loudnormalise on a single row

## Operator deploy steps

(Will land in `docs/HANDOFF.md` on merge.)

1. Pull on Orion: `cd /home/marku/saas/numaradio && git pull`
2. Apply schema migration: `npx prisma migrate deploy`
3. (Optional) Add CF purge creds to `/etc/numa/env`:
   ```
   CF_API_TOKEN=<token with Zone.Cache Purge>
   CF_ZONE_ID=<numaradio.com zone>
   sudo chmod 0600 /etc/numa/env
   ```
   Skip → backfilled tracks update without immediate CF purge
   (eventually consistent via CF TTL).
4. Restart song-worker (picks up inline loudnorm):
   `sudo systemctl restart numa-song-worker`
   *(needs password — not in passwordless sudoers)*
5. Restart queue-daemon (picks up new poller):
   `sudo systemctl restart numa-queue-daemon`
   *(passwordless)*
6. Restart Liquidsoap (picks up master safety net):
   `sudo systemctl restart numa-liquidsoap`
   *(passwordless)*
7. Smoke test: approve a submission. Watch
   `journalctl --user -u numa-queue-daemon -f | grep loudnorm`.
   Within 60s: `[loudnorm-poller] processed <id> ...`.
8. Run backfill at off-peak window (≤4 listeners on Icecast):
   ```
   cd ~/saas/numaradio && nice -n 19 npx tsx scripts/backfill-track-loudness.ts --dry-run
   # review (~130 rows expected)
   nice -n 19 npx tsx scripts/backfill-track-loudness.ts --apply
   ```
   ~5s/track × 130 ≈ 11 min.

## Estimated PR size

~600 LOC implementation + ~200 LOC tests. One migration. One
Liquidsoap edit. One new daemon module.

## Open questions

None blocking. Future work (out of scope for v1):

- Operator dashboard widget surfacing outliers (Track rows where
  `loudnessLufs` deviates from target by >1 LUFS — implies an ingest
  bug or missing backfill).
- Voice loudnorm (would require ffmpeg on Vercel — Lambda layer
  feasible but not a v1 priority since the Liquidsoap safety net
  catches voice outliers anyway).
- Per-show variance (slightly hotter daytime, quieter late-night).
  Intentionally deferred — single target is simpler to reason about.

## Resume trigger for the parked TODO entry

Remove the "Loudness normalisation across the catalogue" section
from `TODO.md` once this design is shipped (or update it to
"shipped 2026-05-XX, see commit <sha>").
