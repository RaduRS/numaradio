# numaradio-suno Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Note on shell snippets in this plan.** Many tasks include shell command examples — `npm test`, `git commit`, etc. These are operator commands, not application code. Treat them as runbook lines.

**Goal:** Add per-show tagging to the Numa Radio library and ship a sibling Next.js app (`~/saas/numaradio-suno`) that drives Suno's private API to generate, review, and approve radio-quality tracks straight into the main DB.

**Architecture:** Two repos: shared `lib/ingest.ts` in `numaradio` is the single writer of new Track rows; the new `numaradio-suno` app calls it directly via a `tsconfig` path alias. Suno is driven via cookie-based private-API forge with conservative rate limits. Lyrics writer is provider-swappable (Claude default, MiniMax fallback) via one env var.

**Tech Stack:**
- Existing: Next.js 16, Prisma 6, TypeScript, `node:test --experimental-strip-types`, Tailwind v4, B2/S3, pg.Pool (dashboard), shadcn/sonner (dashboard).
- New (in numaradio-suno): `better-sqlite3`, `@anthropic-ai/sdk`, swappable MiniMax client.

**Spec:** `docs/superpowers/specs/2026-04-25-numaradio-suno-design.md`

---

## Conventions for this plan

- **Test framework:** every `*.test.ts` is run by `node --test --experimental-strip-types`. Imports from another `.ts` file MUST include the `.ts` extension. No param-property shorthand (Node strips types only).
- **Commit cadence:** one commit per task (after the green test run). Solo project, direct-to-main, no PRs unless asked.
- **Frontend implementation (Phase 6):** every UI task delegates the actual visual implementation to the `frontend-design` skill via the Skill tool. The plan specifies the contract; the skill produces the production-grade JSX/Tailwind.
- **All paths absolute from repo root unless prefixed with `~/saas/numaradio-suno/`** (the new sibling repo).

---

## File structure

### `numaradio` — files to create

| Path | Purpose |
|---|---|
| `lib/show-mapping.ts` | `inferShowFromMetadata({ bpm, genre, mood })` heuristic |
| `lib/show-mapping.test.ts` | Unit tests for the heuristic |
| `lib/ingest.ts` | Shared `ingestTrack(input)` writer — single source of truth for Track + TrackAsset rows |
| `lib/ingest.test.ts` | Unit tests for `ingestTrack` (mocked B2 + Prisma) |
| `prisma/migrations/<ts>_track_show/migration.sql` | Adds `ShowBlock` enum + `show` column + index + heuristic backfill SQL |
| `dashboard/app/api/library/track/[id]/route.ts` | `PATCH` endpoint — sets `show` on a Track |

### `numaradio` — files to modify

| Path | Change |
|---|---|
| `prisma/schema.prisma` | Add `ShowBlock` enum + `show ShowBlock?` on `Track` + composite index |
| `scripts/ingest-seed.ts` | Refactor to thin wrapper around `ingestTrack`; parse `#NightShift`/etc. hashtags; `<file>.show` sidecar fallback; loud-fail when neither present |
| `workers/song-worker/pipeline.ts` | At line 218 `prisma.track.create`, add `show: showForHour(now.getHours()).name` |
| `workers/song-worker/pipeline.test.ts` | Pin clock; assert show |
| `dashboard/lib/library.ts` | Add `show` to `LibraryTrack` + SELECT clause |
| `dashboard/app/library/page.tsx` | Add Show column with editable dropdown |

### `~/saas/numaradio-suno` — full new tree

```
~/saas/numaradio-suno/
├── package.json, tsconfig.json, next.config.ts, instrumentation.ts
├── .env.local.example, .gitignore, eslint.config.mjs
├── postcss.config.mjs, tailwind.config.ts
│
├── app/
│   ├── layout.tsx, globals.css, page.tsx
│   ├── components/  (header-bar, cookie-paste-modal, capacity-bar,
│   │                show-card, generate-modal, draft-review,
│   │                inflight-queue, rate-limit-banner,
│   │                pending-review-list, pending-review-card,
│   │                audio-player)
│   └── api/
│       ├── draft/route.ts, generate/route.ts, jobs/route.ts
│       ├── approve/[jobId]/route.ts, reject/[jobId]/route.ts
│       ├── pending/[jobId]/route.ts
│       └── capacity/route.ts, cookies/route.ts, budget/route.ts
│
├── lib/
│   ├── prisma.ts, capacity.ts (+ test)
│   ├── lyrics-writer/  (index, claude, minimax, validate — each + test)
│   ├── suno/  (client, cookies, rate-limit, poller, download — each + test)
│   └── jobs/  (db, repo + test, stream)
│
├── patterns/  (diamond-standard, night-shift, morning-room,
│              daylight-channel, prime-hours)
├── scripts/  (seed-jobs-db, validate-cookies, preview-draft)
├── fixtures/  (suno-generate-v2.req/.res.json, suno-feed-status.res.json)
├── data/  (gitignored)
└── pending/  (gitignored)
```

---

# PHASE 1 — numaradio core changes

## Task 1.1: Add `ShowBlock` enum + `show` column to schema

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the enum, column, and index**

In `prisma/schema.prisma`, add this enum near the existing enums (after `AutoHostMode`):

```prisma
enum ShowBlock {
  night_shift
  morning_room
  daylight_channel
  prime_hours
}
```

In the `Track` model, add the field below `mood`:

```prisma
  show ShowBlock?
```

Add this index alongside the existing one at the bottom of the `Track` model:

```prisma
  @@index([stationId, show, trackStatus, airingPolicy])
```

- [ ] **Step 2: Generate migration (do not apply yet)**

Run:
```bash
cd /home/marku/saas/numaradio && npx prisma migrate dev --name track_show --create-only
```

A new directory `prisma/migrations/<timestamp>_track_show/migration.sql` is created. `--create-only` blocks application so we can append the heuristic backfill in Task 1.2.

- [ ] **Step 3: Verify the generated SQL**

Open the new `migration.sql`. It should contain `CREATE TYPE "ShowBlock" AS ENUM (...)`, `ALTER TABLE "Track" ADD COLUMN "show" "ShowBlock"`, and the new `CREATE INDEX`.

- [ ] **Step 4: Commit (migration not yet applied)**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "schema: add Track.show enum + index (migration not yet applied)"
```

---

## Task 1.2: Add heuristic backfill SQL

**Files:**
- Modify: `prisma/migrations/<timestamp>_track_show/migration.sql`

- [ ] **Step 1: Append the heuristic backfill block**

Append to the end of the migration file. Order matters — earlier UPDATEs win for rows they touch (each guards on `show IS NULL`).

```sql
-- ─── Heuristic backfill ─────────────────────────────────────────────
UPDATE "Track" SET "show" = 'night_shift'
 WHERE "show" IS NULL
   AND ("bpm" IS NULL OR "bpm" < 95)
   AND "mood" IN ('Calm', 'Dreamy', 'Mellow', 'Dark', 'Melancholic');

UPDATE "Track" SET "show" = 'morning_room'
 WHERE "show" IS NULL
   AND ("bpm" IS NULL OR "bpm" BETWEEN 95 AND 115)
   AND "mood" IN ('Bright', 'Summer', 'Uplifting', 'Romantic');

UPDATE "Track" SET "show" = 'prime_hours'
 WHERE "show" IS NULL
   AND ("bpm" IS NULL OR "bpm" > 115)
   AND "mood" IN ('Energetic', 'Hype', 'Groovy');

UPDATE "Track" SET "show" = 'daylight_channel'
 WHERE "show" IS NULL
   AND ("bpm" IS NULL OR "bpm" BETWEEN 105 AND 125)
   AND "genre" ILIKE ANY (ARRAY['NuDisco', 'Disco', 'Funk', 'House', 'FunkyHouse', 'Lofi', 'Lo-fi']);

UPDATE "Track" SET "show" = 'night_shift'
 WHERE "show" IS NULL
   AND "genre" ILIKE ANY (ARRAY['Ambient', 'Lofi', 'Lo-fi', 'Downtempo']);

UPDATE "Track" SET "show" = 'prime_hours'
 WHERE "show" IS NULL
   AND "genre" ILIKE ANY (ARRAY['DnB', 'Drum and Bass', 'Techno', 'Trance']);

UPDATE "Track" SET "show" = 'night_shift'
 WHERE "show" IS NULL AND "bpm" IS NOT NULL AND "bpm" < 90;

UPDATE "Track" SET "show" = 'morning_room'
 WHERE "show" IS NULL AND "bpm" IS NOT NULL AND "bpm" BETWEEN 90 AND 110;

UPDATE "Track" SET "show" = 'prime_hours'
 WHERE "show" IS NULL AND "bpm" IS NOT NULL AND "bpm" > 125;

UPDATE "Track" SET "show" = 'daylight_channel' WHERE "show" IS NULL;
```

- [ ] **Step 2: Apply the migration**

```bash
cd /home/marku/saas/numaradio && npx prisma migrate dev
```

Expected: `Applying migration <ts>_track_show` then `Database is now in sync with your schema`. The Prisma client regenerates automatically.

- [ ] **Step 3: Spot-check the result**

```bash
cd /home/marku/saas/numaradio && npx tsx -e 'import { prisma } from "./lib/db"; (async () => { const c = await prisma.$queryRaw`SELECT show, COUNT(*) FROM "Track" GROUP BY show ORDER BY show`; console.log(c); await prisma.$disconnect(); })();'
```

Expected: every row has a `show` value. Counts roughly distributed across the four shows.

- [ ] **Step 4: Commit**

```bash
git add prisma/migrations/
git commit -m "schema: heuristic backfill of Track.show across existing library"
```

---

## Task 1.3: `lib/show-mapping.ts` — TS heuristic + tests

**Files:**
- Create: `lib/show-mapping.ts`
- Create: `lib/show-mapping.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/show-mapping.test.ts`:

```ts
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { inferShowFromMetadata } from "./show-mapping.ts";

test("ambient mood + slow BPM → night_shift", () => {
  assert.equal(inferShowFromMetadata({ bpm: 75, genre: "Ambient", mood: "Calm" }), "night_shift");
});
test("bright mood + mid BPM → morning_room", () => {
  assert.equal(inferShowFromMetadata({ bpm: 105, genre: "Pop", mood: "Bright" }), "morning_room");
});
test("nu-disco + mid-high BPM → daylight_channel", () => {
  assert.equal(inferShowFromMetadata({ bpm: 118, genre: "NuDisco", mood: null }), "daylight_channel");
});
test("energetic mood + fast BPM → prime_hours", () => {
  assert.equal(inferShowFromMetadata({ bpm: 124, genre: "House", mood: "Energetic" }), "prime_hours");
});
test("all-null fallback → daylight_channel", () => {
  assert.equal(inferShowFromMetadata({ bpm: null, genre: null, mood: null }), "daylight_channel");
});
test("ambient mood at 110 BPM still → night_shift (mood beats BPM)", () => {
  assert.equal(inferShowFromMetadata({ bpm: 110, genre: "Lofi", mood: "Mellow" }), "night_shift");
});
test("DnB → prime_hours via genre", () => {
  assert.equal(inferShowFromMetadata({ bpm: null, genre: "DnB", mood: null }), "prime_hours");
});
test("BPM-only fallback for slow → night_shift", () => {
  assert.equal(inferShowFromMetadata({ bpm: 80, genre: null, mood: null }), "night_shift");
});
test("BPM-only fallback for fast → prime_hours", () => {
  assert.equal(inferShowFromMetadata({ bpm: 130, genre: null, mood: null }), "prime_hours");
});
```

- [ ] **Step 2: Run to confirm fail**

```bash
cd /home/marku/saas/numaradio && npm test -- --test-name-pattern "show-mapping"
```

Expected: FAIL — module `./show-mapping.ts` not found.

- [ ] **Step 3: Implement `lib/show-mapping.ts`**

```ts
import type { ShowBlock } from "@prisma/client";

export type ShowMappingInput = {
  bpm: number | null;
  genre: string | null;
  mood: string | null;
};

const NIGHT_MOODS = new Set(["Calm", "Dreamy", "Mellow", "Dark", "Melancholic"]);
const MORNING_MOODS = new Set(["Bright", "Summer", "Uplifting", "Romantic"]);
const PRIME_MOODS = new Set(["Energetic", "Hype", "Groovy"]);

const DAYLIGHT_GENRES = new Set([
  "nudisco", "disco", "funk", "house", "funkyhouse", "lofi", "lo-fi",
]);
const NIGHT_GENRES = new Set(["ambient", "lofi", "lo-fi", "downtempo"]);
const PRIME_GENRES = new Set(["dnb", "drum and bass", "techno", "trance"]);

function lc(s: string | null): string {
  return (s ?? "").trim().toLowerCase();
}

export function inferShowFromMetadata(input: ShowMappingInput): ShowBlock {
  const { bpm, genre, mood } = input;
  const g = lc(genre);

  if (mood && NIGHT_MOODS.has(mood) && (bpm === null || bpm < 95)) return "night_shift";
  if (mood && MORNING_MOODS.has(mood) && (bpm === null || (bpm >= 95 && bpm <= 115))) return "morning_room";
  if (mood && PRIME_MOODS.has(mood) && (bpm === null || bpm > 115)) return "prime_hours";

  if (g && DAYLIGHT_GENRES.has(g) && (bpm === null || (bpm >= 105 && bpm <= 125))) return "daylight_channel";
  if (g && NIGHT_GENRES.has(g)) return "night_shift";
  if (g && PRIME_GENRES.has(g)) return "prime_hours";

  if (bpm !== null && bpm < 90) return "night_shift";
  if (bpm !== null && bpm >= 90 && bpm <= 110) return "morning_room";
  if (bpm !== null && bpm > 125) return "prime_hours";

  return "daylight_channel";
}
```

- [ ] **Step 4: Run + commit**

```bash
cd /home/marku/saas/numaradio && npm test -- --test-name-pattern "show-mapping"
git add lib/show-mapping.ts lib/show-mapping.test.ts
git commit -m "lib: inferShowFromMetadata heuristic for show-tagging UI"
```

Expected: 9 passing.

---

## Task 1.4: Extract `lib/ingest.ts` from the seed CLI

**Files:**
- Create: `lib/ingest.ts`
- Create: `lib/ingest.test.ts`

The current seed's `ingestFile` (lines 76–238 of `scripts/ingest-seed.ts`) does: idempotency check on Suno ID → create draft Track → upload audio → create audio TrackAsset → upload artwork (if any) → create artwork TrackAsset → mark track ready. We extract the post-parse half (everything that doesn't read fs / parse ID3) into `ingestTrack`, with adapters injectable for tests.

- [ ] **Step 1: Add `deleteObject` to `lib/storage.ts` if not present**

Check `lib/storage.ts`. If `deleteObject` is missing, add:

```ts
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
// ...existing client + BUCKET...
export async function deleteObject(key: string): Promise<void> {
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}
```

- [ ] **Step 2: Write the failing test**

Create `lib/ingest.test.ts`:

```ts
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { _ingestTrackImpl } from "./ingest.ts";

function makeFakePrisma(opts: { existingSunoId?: string } = {}) {
  let trackId = "trk_test_1";
  return {
    track: {
      findFirst: async ({ where }: any) => {
        if (opts.existingSunoId && where.sourceReference === opts.existingSunoId) {
          return { id: "trk_existing" };
        }
        return null;
      },
    },
    $transaction: async (fn: any) => fn({
      track: {
        create: async ({ data }: any) => ({ id: trackId, ...data }),
        update: async ({ data }: any) => ({ id: trackId, ...data }),
      },
      trackAsset: {
        create: async ({ data }: any) => ({ id: `asset_${Math.random()}`, ...data }),
      },
    }),
  };
}

test("ingestTrack happy path creates Track + audio asset", async () => {
  const fakePrisma = makeFakePrisma();
  const uploaded: { key: string }[] = [];
  const r = await _ingestTrackImpl({
    prisma: fakePrisma as any,
    putObject: async (key) => { uploaded.push({ key }); },
    deleteObject: async () => {},
    publicUrl: (k) => `https://b2.example/${k}`,
    stationSlug: "numaradio",
    cacheControl: "public",
    input: {
      stationId: "station_1",
      audioBuffer: Buffer.from("fake"),
      show: "morning_room",
      title: "Test Song",
      durationSeconds: 180,
    },
  });
  assert.equal(r.status, "ingested");
  assert.equal(uploaded.length, 1);
  assert.match(uploaded[0].key, /\/audio\/stream\.mp3$/);
});

test("ingestTrack dedupe-by-sunoId returns skipped", async () => {
  const fakePrisma = makeFakePrisma({ existingSunoId: "abc-123" });
  const uploaded: { key: string }[] = [];
  const r = await _ingestTrackImpl({
    prisma: fakePrisma as any,
    putObject: async (key) => { uploaded.push({ key }); },
    deleteObject: async () => {},
    publicUrl: (k) => k,
    stationSlug: "numaradio", cacheControl: "public",
    input: {
      stationId: "station_1",
      audioBuffer: Buffer.from("fake"),
      show: "morning_room",
      title: "Test",
      sunoId: "abc-123",
    },
  });
  assert.equal(r.status, "skipped");
  assert.equal(r.trackId, "trk_existing");
  assert.equal(uploaded.length, 0);
});

test("ingestTrack throws when show missing", async () => {
  const fakePrisma = makeFakePrisma();
  await assert.rejects(
    _ingestTrackImpl({
      prisma: fakePrisma as any,
      putObject: async () => {}, deleteObject: async () => {},
      publicUrl: (k) => k, stationSlug: "numaradio", cacheControl: "public",
      input: {
        stationId: "station_1", audioBuffer: Buffer.from("fake"),
        show: undefined as any, title: "Test",
      },
    }),
    /show is required/i,
  );
});

test("ingestTrack rolls back B2 on tx failure", async () => {
  const deleted: string[] = [];
  const fakePrisma = {
    ...makeFakePrisma(),
    $transaction: async () => { throw new Error("simulated tx failure"); },
  };
  await assert.rejects(
    _ingestTrackImpl({
      prisma: fakePrisma as any,
      putObject: async () => {},
      deleteObject: async (key: string) => { deleted.push(key); },
      publicUrl: (k) => k,
      stationSlug: "numaradio", cacheControl: "public",
      input: {
        stationId: "station_1", audioBuffer: Buffer.from("fake"),
        show: "morning_room", title: "Test",
      },
    }),
    /simulated tx failure/,
  );
  assert.equal(deleted.length, 1);
});

test("ingestTrack uploads artwork when provided", async () => {
  const fakePrisma = makeFakePrisma();
  const uploaded: { key: string }[] = [];
  await _ingestTrackImpl({
    prisma: fakePrisma as any,
    putObject: async (key) => { uploaded.push({ key }); },
    deleteObject: async () => {},
    publicUrl: (k) => k, stationSlug: "numaradio", cacheControl: "public",
    input: {
      stationId: "station_1", audioBuffer: Buffer.from("fake"),
      show: "morning_room", title: "Test",
      artwork: { buffer: Buffer.from("png-bytes"), mimeType: "image/png" },
    },
  });
  assert.equal(uploaded.length, 2);
  assert.ok(uploaded.some((u) => u.key.includes("/artwork/primary.png")));
});
```

- [ ] **Step 3: Run to confirm fail**

```bash
cd /home/marku/saas/numaradio && npm test -- --test-name-pattern "ingestTrack"
```

Expected: FAIL — module `./ingest.ts` not found.

- [ ] **Step 4: Implement `lib/ingest.ts`**

```ts
import { randomUUID } from "node:crypto";
import type { ShowBlock, TrackSourceType } from "@prisma/client";
import { prisma as defaultPrisma } from "./db.ts";
import { putObject as defaultPutObject, deleteObject as defaultDeleteObject, publicUrl as defaultPublicUrl } from "./storage.ts";

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

export type IngestInput = {
  stationId: string;
  audioBuffer: Buffer;
  show: ShowBlock;
  title: string;
  artistDisplay?: string;
  lyrics?: string;
  caption?: string;
  styleTags?: string[];
  styleSummary?: string;
  gender?: "male" | "female" | "duo" | "instrumental";
  weirdness?: number;
  styleInfluence?: number;
  model?: "v5" | "v5.5";
  sunoId?: string;
  bpm?: number;
  musicalKey?: string;
  durationSeconds?: number;
  artwork?: { buffer: Buffer; mimeType: string };
  rawComment?: string;
  sourceType?: TrackSourceType;
  genre?: string;
  mood?: string;
};

export type IngestResult =
  | { status: "ingested"; trackId: string }
  | { status: "skipped"; trackId: string; reason: "duplicate_suno_id" };

export async function ingestTrack(input: IngestInput): Promise<IngestResult> {
  return _ingestTrackImpl({
    prisma: defaultPrisma,
    putObject: defaultPutObject,
    deleteObject: defaultDeleteObject,
    publicUrl: defaultPublicUrl,
    stationSlug: STATION_SLUG,
    cacheControl: IMMUTABLE_CACHE_CONTROL,
    input,
  });
}

export type IngestDeps = {
  prisma: typeof defaultPrisma;
  putObject: (key: string, body: Buffer, mime: string, cacheControl: string) => Promise<unknown>;
  deleteObject: (key: string) => Promise<unknown>;
  publicUrl: (key: string) => string;
  stationSlug: string;
  cacheControl: string;
  input: IngestInput;
};

export async function _ingestTrackImpl(deps: IngestDeps): Promise<IngestResult> {
  const { prisma, putObject, deleteObject, publicUrl, stationSlug, cacheControl, input } = deps;
  if (!input.show) throw new Error("ingestTrack: show is required");

  if (input.sunoId) {
    const existing = await prisma.track.findFirst({
      where: { stationId: input.stationId, sourceReference: input.sunoId },
      select: { id: true },
    });
    if (existing) {
      return { status: "skipped", trackId: existing.id, reason: "duplicate_suno_id" };
    }
  }

  const trackId = randomUUID();
  const audioKey = `stations/${stationSlug}/tracks/${trackId}/audio/stream.mp3`;
  const audioUrl = publicUrl(audioKey);
  await putObject(audioKey, input.audioBuffer, "audio/mpeg", cacheControl);
  const uploadedKeys: string[] = [audioKey];

  let artworkKey: string | undefined;
  let artworkUrl: string | undefined;
  if (input.artwork) {
    const ext = input.artwork.mimeType === "image/png" ? "png" : "jpg";
    artworkKey = `stations/${stationSlug}/tracks/${trackId}/artwork/primary.${ext}`;
    artworkUrl = publicUrl(artworkKey);
    await putObject(artworkKey, input.artwork.buffer, input.artwork.mimeType, cacheControl);
    uploadedKeys.push(artworkKey);
  }

  try {
    await prisma.$transaction(async (tx: any) => {
      const track = await tx.track.create({
        data: {
          id: trackId,
          stationId: input.stationId,
          sourceType: input.sourceType ?? "suno_manual",
          sourceReference: input.sunoId,
          title: input.title,
          artistDisplay: input.artistDisplay,
          show: input.show,
          mood: input.mood,
          genre: input.genre,
          bpm: input.bpm,
          durationSeconds: input.durationSeconds,
          lyricsSummary: input.lyrics?.slice(0, 240),
          promptSummary: (input.caption ?? input.rawComment)?.slice(0, 500),
          provenanceJson: {
            sunoId: input.sunoId,
            sunoUrl: input.sunoId ? `https://suno.com/song/${input.sunoId}` : undefined,
            styleTags: input.styleTags ?? [],
            styleSummary: input.styleSummary,
            caption: input.caption,
            gender: input.gender,
            weirdness: input.weirdness,
            styleInfluence: input.styleInfluence,
            model: input.model,
            musicalKey: input.musicalKey,
            rawComment: input.rawComment,
            ingestedAt: new Date().toISOString(),
            ingestVersion: 3,
          },
          airingPolicy: "library",
          safetyStatus: "approved",
          trackStatus: "processing",
        },
      });

      const audioAsset = await tx.trackAsset.create({
        data: {
          trackId: track.id,
          assetType: "audio_stream",
          storageProvider: "b2",
          storageKey: audioKey,
          publicUrl: audioUrl,
          mimeType: "audio/mpeg",
          byteSize: input.audioBuffer.byteLength,
          durationSeconds: input.durationSeconds,
        },
      });

      let artAssetId: string | undefined;
      if (artworkKey && artworkUrl && input.artwork) {
        const artAsset = await tx.trackAsset.create({
          data: {
            trackId: track.id,
            assetType: "artwork_primary",
            storageProvider: "b2",
            storageKey: artworkKey,
            publicUrl: artworkUrl,
            mimeType: input.artwork.mimeType,
            byteSize: input.artwork.buffer.byteLength,
          },
        });
        artAssetId = artAsset.id;
      }

      await tx.track.update({
        where: { id: track.id },
        data: {
          primaryAudioAssetId: audioAsset.id,
          primaryArtAssetId: artAssetId,
          trackStatus: "ready",
        },
      });
    });
    return { status: "ingested", trackId };
  } catch (err) {
    await Promise.all(uploadedKeys.map((k) => deleteObject(k).catch(() => undefined)));
    throw err;
  }
}
```

- [ ] **Step 5: Run + commit**

```bash
cd /home/marku/saas/numaradio && npm test -- --test-name-pattern "ingestTrack"
git add lib/ingest.ts lib/ingest.test.ts lib/storage.ts
git commit -m "lib: extract ingestTrack — single writer for Track + TrackAsset"
```

Expected: 5 passing.

---

## Task 1.5: Refactor seed CLI to use `ingestTrack` + show parsing

**Files:**
- Create: `scripts/ingest-seed-helpers.ts`
- Create: `scripts/ingest-seed.test.ts`
- Modify: `scripts/ingest-seed.ts`

- [ ] **Step 1: Write helper tests**

Create `scripts/ingest-seed.test.ts`:

```ts
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseShowHashtag, resolveShowFromHashtagOrSidecar } from "./ingest-seed-helpers.ts";

test("parseShowHashtag finds #NightShift", () => {
  assert.equal(parseShowHashtag("Vibes #NightShift #Calm"), "night_shift");
});
test("parseShowHashtag finds #MorningRoom", () => {
  assert.equal(parseShowHashtag("hello #MorningRoom"), "morning_room");
});
test("parseShowHashtag finds #DaylightChannel", () => {
  assert.equal(parseShowHashtag("#DaylightChannel"), "daylight_channel");
});
test("parseShowHashtag finds #PrimeHours", () => {
  assert.equal(parseShowHashtag("late night vibe #PrimeHours"), "prime_hours");
});
test("parseShowHashtag returns null when missing", () => {
  assert.equal(parseShowHashtag("no show tag here #NuDisco #Groovy"), null);
});

test("resolveShowFromHashtagOrSidecar prefers hashtag", async () => {
  const dir = await mkdtemp(join(tmpdir(), "seed-test-"));
  const mp3 = join(dir, "song.mp3");
  await writeFile(mp3, Buffer.from("fake"));
  await writeFile(`${mp3}.show`, "prime_hours");
  const r = await resolveShowFromHashtagOrSidecar({
    mp3Path: mp3, commentText: "comment with #MorningRoom",
  });
  assert.equal(r, "morning_room");
  await rm(dir, { recursive: true });
});

test("resolveShowFromHashtagOrSidecar falls back to sidecar", async () => {
  const dir = await mkdtemp(join(tmpdir(), "seed-test-"));
  const mp3 = join(dir, "song.mp3");
  await writeFile(mp3, Buffer.from("fake"));
  await writeFile(`${mp3}.show`, "night_shift\n");
  const r = await resolveShowFromHashtagOrSidecar({
    mp3Path: mp3, commentText: "no hashtag here",
  });
  assert.equal(r, "night_shift");
  await rm(dir, { recursive: true });
});

test("resolveShowFromHashtagOrSidecar throws when neither present", async () => {
  const dir = await mkdtemp(join(tmpdir(), "seed-test-"));
  const mp3 = join(dir, "song.mp3");
  await writeFile(mp3, Buffer.from("fake"));
  await assert.rejects(
    resolveShowFromHashtagOrSidecar({ mp3Path: mp3, commentText: "no tag" }),
    /must include a show hashtag/i,
  );
  await rm(dir, { recursive: true });
});
```

- [ ] **Step 2: Run to confirm fail, then implement helpers**

Create `scripts/ingest-seed-helpers.ts`:

```ts
import { readFile, access } from "node:fs/promises";
import type { ShowBlock } from "@prisma/client";

const SHOW_HASHTAG_MAP: Record<string, ShowBlock> = {
  nightshift: "night_shift",
  morningroom: "morning_room",
  daylightchannel: "daylight_channel",
  primehours: "prime_hours",
};

export function parseShowHashtag(text: string): ShowBlock | null {
  const tags = [...text.matchAll(/#(\w+)/g)].map((m) => m[1].toLowerCase());
  for (const t of tags) {
    const mapped = SHOW_HASHTAG_MAP[t];
    if (mapped) return mapped;
  }
  return null;
}

export async function resolveShowFromHashtagOrSidecar(opts: {
  mp3Path: string;
  commentText: string;
}): Promise<ShowBlock> {
  const fromHashtag = parseShowHashtag(opts.commentText);
  if (fromHashtag) return fromHashtag;

  const sidecarPath = `${opts.mp3Path}.show`;
  try {
    await access(sidecarPath);
  } catch {
    throw new Error(
      `Track at ${opts.mp3Path} must include a show hashtag (e.g. #MorningRoom) ` +
      `in its ID3 comment, or a "${sidecarPath}" sidecar file containing one of: ` +
      `night_shift, morning_room, daylight_channel, prime_hours.`,
    );
  }
  const raw = (await readFile(sidecarPath, "utf-8")).trim();
  const valid: ShowBlock[] = ["night_shift", "morning_room", "daylight_channel", "prime_hours"];
  if (!valid.includes(raw as ShowBlock)) {
    throw new Error(`Sidecar ${sidecarPath} contains "${raw}" — expected one of ${valid.join(", ")}`);
  }
  return raw as ShowBlock;
}
```

- [ ] **Step 3: Refactor `scripts/ingest-seed.ts`**

Replace the existing `ingestFile` function (lines 76–238) with a thin wrapper that calls `ingestTrack`. Add at top:

```ts
import { ingestTrack } from "../lib/ingest.ts";
import { resolveShowFromHashtagOrSidecar } from "./ingest-seed-helpers.ts";
```

New `ingestFile`:

```ts
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
```

Remove now-unused imports (`putObject`, `publicUrl` if no longer referenced; `prisma` stays if `ensureStation` still uses it).

- [ ] **Step 4: Run + smoke + commit**

```bash
cd /home/marku/saas/numaradio && npm test
```

Expected: all tests pass.

Smoke: drop one test MP3 in `seed/` with `#MorningRoom` in the ID3 comment, run `npm run ingest:seed`. Expected: track ingests with `show=morning_room` printed. Drop one without a hashtag and re-run; expect a loud error.

```bash
git add scripts/ingest-seed.ts scripts/ingest-seed-helpers.ts scripts/ingest-seed.test.ts
git commit -m "seed: thin wrapper around ingestTrack + show hashtag/sidecar parsing"
```

---

## Task 1.6: Tag listener-generated songs with current-hour show

**Files:**
- Modify: `workers/song-worker/pipeline.ts`
- Modify: `workers/song-worker/pipeline.test.ts`

- [ ] **Step 1: Write the failing test**

In `workers/song-worker/pipeline.test.ts`, add:

```ts
test("song-worker tags new tracks with current-hour show (UTC 10:00 → daylight_channel)", async () => {
  const realNow = Date.now;
  Date.now = () => new Date("2026-04-25T10:00:00.000Z").getTime();
  // Re-run the test scaffold used by other pipeline tests, capturing
  // the prisma.track.create payload. Replace `<existing scaffold>` with
  // whatever pattern the file already uses to test track creation.
  // Assert: capturedCreatePayload.data.show === "daylight_channel"
  Date.now = realNow;
});
```

Use the file's existing test scaffolding (mocked prisma) to capture the `prisma.track.create` call. The exact wiring depends on what `pipeline.test.ts` already mocks.

- [ ] **Step 2: Implement**

In `workers/song-worker/pipeline.ts`, add at the top:

```ts
import { showForHour } from "../../lib/schedule.ts";
```

Add a helper at the top of the file:

```ts
function showEnumFor(date: Date): "night_shift" | "morning_room" | "daylight_channel" | "prime_hours" {
  switch (showForHour(date.getHours()).name) {
    case "Night Shift": return "night_shift";
    case "Morning Room": return "morning_room";
    case "Daylight Channel": return "daylight_channel";
    case "Prime Hours": return "prime_hours";
  }
}
```

In the `prisma.track.create` data block (around line 219), add:

```ts
show: showEnumFor(new Date()),
```

- [ ] **Step 3: Run + commit**

```bash
cd /home/marku/saas/numaradio && npm test -- --test-name-pattern "song-worker"
git add workers/song-worker/pipeline.ts workers/song-worker/pipeline.test.ts
git commit -m "song-worker: tag listener-generated tracks with current-hour show"
```

---

## Task 1.7: Surface `show` in dashboard library list

**Files:**
- Modify: `dashboard/lib/library.ts`
- Modify: `dashboard/app/library/page.tsx`

- [ ] **Step 1: Add `show` to type + SQL**

In `dashboard/lib/library.ts`:

Add to `LibraryTrack` interface:
```ts
  show: string | null;
```

In `LIBRARY_TRACKS_SQL`, add `t.show,` to the SELECT (after `t.mood,`).

In the row-mapping function, pass `show: row.show,` through.

- [ ] **Step 2: Add Show column to the desktop table**

In `dashboard/app/library/page.tsx`, add a helper near the top:

```ts
function showLabelFor(show: string | null): string {
  if (!show) return "—";
  return show.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}
```

In the desktop `<thead>`, add:
```tsx
<th className="text-left px-2 py-2.5 w-24">Show</th>
```

In the desktop row, add:
```tsx
<td className="px-2 py-2 text-fg-mute text-xs">{showLabelFor(t.show)}</td>
```

In the mobile chip row, append:
```tsx
{t.show && (<><span aria-hidden>·</span><span className="truncate normal-case tracking-normal">{showLabelFor(t.show)}</span></>)}
```

- [ ] **Step 3: Smoke + commit**

```bash
cd /home/marku/saas/numaradio/dashboard && npm run dev
# Visit http://localhost:3001/library — every row shows a Show value
git add dashboard/lib/library.ts dashboard/app/library/page.tsx
git commit -m "dashboard: surface Track.show in library list (read-only)"
```

---

## Task 1.8: Editable Show dropdown + PATCH route

**Files:**
- Create: `dashboard/app/api/library/track/[id]/route.ts`
- Modify: `dashboard/app/library/page.tsx`

- [ ] **Step 1: Implement PATCH**

Create `dashboard/app/api/library/track/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";

export const dynamic = "force-dynamic";

const VALID_SHOWS = new Set([
  "night_shift", "morning_room", "daylight_channel", "prime_hours",
]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const show = (body as { show?: unknown }).show;
  if (typeof show !== "string" || !VALID_SHOWS.has(show)) {
    return NextResponse.json(
      { error: `show must be one of ${[...VALID_SHOWS].join(", ")}` },
      { status: 400 },
    );
  }
  const pool = getDbPool();
  const result = await pool.query(
    'UPDATE "Track" SET "show" = $1::"ShowBlock" WHERE id = $2 RETURNING id, "show"',
    [show, id],
  );
  if (result.rowCount === 0) {
    return NextResponse.json({ error: "track not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, track: result.rows[0] });
}
```

- [ ] **Step 2: Replace read-only Show cell with dropdown**

In `dashboard/app/library/page.tsx`, add helpers + a `<ShowCell>` component:

```tsx
async function setTrackShow(trackId: string, show: string) {
  const res = await fetch(`/api/library/track/${trackId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ show }),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
}

function ShowCell({ track, onChange }: { track: LibraryTrack; onChange: () => void }) {
  const [pending, setPending] = useState(false);
  return (
    <select
      value={track.show ?? ""}
      disabled={pending}
      onChange={async (e) => {
        const next = e.target.value;
        setPending(true);
        try {
          await setTrackShow(track.id, next);
          toast.success(`Show set: ${showLabelFor(next)}`);
          onChange();
        } catch (err) {
          toast.error(`Failed: ${err instanceof Error ? err.message : err}`);
        } finally {
          setPending(false);
        }
      }}
      className="bg-transparent border border-line rounded px-1 py-0.5 text-xs font-mono outline-none focus:border-accent disabled:opacity-50"
    >
      <option value="" disabled>—</option>
      <option value="night_shift">Night Shift</option>
      <option value="morning_room">Morning Room</option>
      <option value="daylight_channel">Daylight Channel</option>
      <option value="prime_hours">Prime Hours</option>
    </select>
  );
}
```

Replace the desktop Show `<td>` content with `<ShowCell track={t} onChange={() => tracksPoll.refresh()} />`.

- [ ] **Step 3: Smoke + commit**

```bash
cd /home/marku/saas/numaradio/dashboard && npm run dev
# Change a track's show via the dropdown — value persists, network shows PATCH 200
git add dashboard/app/api/library/track dashboard/app/library/page.tsx
git commit -m "dashboard: editable Show dropdown + PATCH route for re-tagging"
```

---

# PHASE 2 — numaradio-suno scaffold + jobs DB

## Task 2.1: Bootstrap the new sibling repo

**Files (all in `~/saas/numaradio-suno/`):** `package.json`, `tsconfig.json`, `next.config.ts`, `.gitignore`, `.env.local.example`, `app/layout.tsx`, `app/globals.css`, `app/page.tsx` (placeholder), `tailwind.config.ts`, `postcss.config.mjs`.

- [ ] **Step 1: Create the directory + initialize**

```bash
mkdir -p ~/saas/numaradio-suno && cd ~/saas/numaradio-suno && git init
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "numaradio-suno",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3100",
    "build": "next build",
    "start": "next start -p 3100",
    "lint": "eslint",
    "test": "node --test --experimental-strip-types '{lib,scripts}/**/*.test.ts'",
    "seed-jobs-db": "tsx scripts/seed-jobs-db.ts",
    "validate-cookies": "tsx scripts/validate-cookies.ts",
    "preview-draft": "tsx scripts/preview-draft.ts"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "better-sqlite3": "^11.5.0",
    "dotenv": "^17.4.2",
    "next": "16.2.4",
    "react": "19.2.4",
    "react-dom": "19.2.4",
    "sonner": "^2.0.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "eslint": "^9",
    "eslint-config-next": "16.2.4",
    "tailwindcss": "^4",
    "tsx": "^4.20.0",
    "typescript": "^5"
  }
}
```

- [ ] **Step 3: Write `tsconfig.json`** (with the sibling-repo path alias)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"],
      "@numa/*": ["../numaradio/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Write `next.config.ts`**

```ts
import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  webpack(cfg) {
    cfg.resolve.symlinks = false;
    return cfg;
  },
};

export default config;
```

- [ ] **Step 5: `.gitignore`**

```
node_modules
.next
out
.env.local
.cookies.json
data/
pending/
*.tsbuildinfo
```

- [ ] **Step 6: `.env.local.example`**

```
DATABASE_URL=postgres://...
LYRICS_WRITER_PROVIDER=claude
LYRICS_WRITER_CLAUDE_API_KEY=sk-ant-...
LYRICS_WRITER_CLAUDE_MODEL=claude-sonnet-4-6
LYRICS_WRITER_MINIMAX_API_KEY=
LYRICS_WRITER_MINIMAX_MODEL=
SUNO_MAX_INFLIGHT=3
SUNO_MAX_STARTS_PER_MIN=2
SUNO_MAX_PER_DAY=30
STATION_SLUG=numaradio
```

- [ ] **Step 7: Tailwind + minimal layout**

Write `tailwind.config.ts`, `postcss.config.mjs`, `app/globals.css`, `app/layout.tsx`, `app/page.tsx` mirroring `~/saas/numaradio/dashboard/app/layout.tsx` for visual consistency. The page body is a placeholder; Phase 6 replaces it via the frontend-design skill.

- [ ] **Step 8: Install + verify**

```bash
cd ~/saas/numaradio-suno && npm install && npm run dev
```

Visit `http://localhost:3100` — placeholder renders. Stop with Ctrl-C.

- [ ] **Step 9: Initial commit**

```bash
cd ~/saas/numaradio-suno && git add . && git commit -m "init: numaradio-suno scaffold (Next.js 16 + path alias to numaradio)"
```

---

## Task 2.2: Verify cross-repo Prisma + ingest import

**Files:**
- Create: `~/saas/numaradio-suno/lib/prisma.ts`
- Create: `~/saas/numaradio-suno/scripts/ping-prisma.ts`

- [ ] **Step 1: Re-export prisma**

Create `lib/prisma.ts`:

```ts
export { prisma } from "@numa/lib/db";
```

- [ ] **Step 2: Verification CLI**

Create `scripts/ping-prisma.ts`:

```ts
import "dotenv/config";
import { prisma } from "../lib/prisma.ts";
import { ingestTrack } from "@numa/lib/ingest";

async function main() {
  const counts = await prisma.track.groupBy({
    by: ["show"],
    _count: { _all: true },
  });
  console.log("Track counts by show:");
  for (const row of counts) console.log(`  ${row.show ?? "(null)"}: ${row._count._all}`);
  console.log("\ningestTrack import resolved:", typeof ingestTrack === "function" ? "✓" : "✗");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 3: Run**

```bash
cd ~/saas/numaradio-suno && cp .env.local.example .env.local
# Edit .env.local with DATABASE_URL from ~/saas/numaradio/.env.local
npx tsx scripts/ping-prisma.ts
```

Expected: per-show counts + `ingestTrack import resolved: ✓`. If the path alias doesn't resolve under `tsx`, install `tsconfig-paths` and run with `node --import tsconfig-paths/register --experimental-strip-types`.

- [ ] **Step 4: Commit**

```bash
cd ~/saas/numaradio-suno && git add lib scripts && git commit -m "lib/scripts: prisma re-export + cross-repo import smoke"
```

---

## Task 2.3: Jobs SQLite DB

**Files:**
- Create: `~/saas/numaradio-suno/lib/jobs/db.ts`
- Create: `~/saas/numaradio-suno/scripts/seed-jobs-db.ts`

- [ ] **Step 1: DB module**

```ts
// lib/jobs/db.ts
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DB_PATH = process.env.JOBS_DB_PATH ?? resolve(process.cwd(), "data", "jobs.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  applyMigrations(_db);
  return _db;
}

function applyMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id              TEXT PRIMARY KEY,
      show            TEXT NOT NULL,
      concept         TEXT,
      draft_json      TEXT,
      suno_task_id    TEXT,
      status          TEXT NOT NULL,
      mp3_path        TEXT,
      error_reason    TEXT,
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at);

    CREATE TABLE IF NOT EXISTS rate_limit_state (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

export function closeDb(): void {
  if (_db) { _db.close(); _db = null; }
}
```

- [ ] **Step 2: Seed script**

```ts
// scripts/seed-jobs-db.ts
import "dotenv/config";
import { getDb } from "../lib/jobs/db.ts";

const db = getDb();
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log("✓ jobs.db ready:", tables);
db.close();
```

- [ ] **Step 3: Run + commit**

```bash
cd ~/saas/numaradio-suno && npx tsx scripts/seed-jobs-db.ts
git add lib/jobs scripts/seed-jobs-db.ts
git commit -m "jobs: SQLite schema + seed script"
```

---

## Task 2.4: `JobRepo` + state machine + tests

**Files:**
- Create: `~/saas/numaradio-suno/lib/jobs/repo.ts`
- Create: `~/saas/numaradio-suno/lib/jobs/repo.test.ts`

- [ ] **Step 1: Write the tests**

```ts
// lib/jobs/repo.test.ts
import { test } from "node:test";
import { strict as assert } from "node:assert";
import Database from "better-sqlite3";
import { JobRepo, type JobStatus } from "./repo.ts";

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE jobs (
      id TEXT PRIMARY KEY, show TEXT NOT NULL, concept TEXT,
      draft_json TEXT, suno_task_id TEXT, status TEXT NOT NULL,
      mp3_path TEXT, error_reason TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
  `);
  return db;
}

test("create returns row with status='drafting'", () => {
  const repo = new JobRepo(freshDb());
  const j = repo.create({ show: "morning_room", concept: "rooftop coffee" });
  assert.equal(j.status, "drafting");
  assert.equal(j.show, "morning_room");
});

test("legal transition drafting → drafted", () => {
  const repo = new JobRepo(freshDb());
  const j = repo.create({ show: "morning_room" });
  repo.transition(j.id, "drafted", { draftJson: '{"title":"X"}' });
  assert.equal(repo.get(j.id)!.status, "drafted");
});

test("illegal transition throws", () => {
  const repo = new JobRepo(freshDb());
  const j = repo.create({ show: "morning_room" });
  assert.throws(() => repo.transition(j.id, "approved"), /illegal transition/i);
});

test("listByStatus returns matching rows", () => {
  const repo = new JobRepo(freshDb());
  const a = repo.create({ show: "morning_room" });
  const b = repo.create({ show: "prime_hours" });
  repo.transition(a.id, "drafted");
  repo.transition(a.id, "sending");
  repo.transition(a.id, "inflight", { sunoTaskId: "task-1" });
  assert.equal(repo.listByStatus("inflight").length, 1);
  assert.equal(repo.listByStatus("drafting").length, 1);
});

test("countSubmitsSince counts non-drafting jobs after cutoff", () => {
  const repo = new JobRepo(freshDb());
  const a = repo.create({ show: "morning_room" });
  repo.transition(a.id, "drafted");
  repo.transition(a.id, "sending");
  assert.equal(repo.countSubmitsSince(Date.now() - 60_000), 1);
});

test("recoverStuckApproving reverts old approving rows", () => {
  const db = freshDb();
  const repo = new JobRepo(db);
  const j = repo.create({ show: "morning_room" });
  repo.transition(j.id, "drafted");
  repo.transition(j.id, "sending");
  repo.transition(j.id, "inflight", { sunoTaskId: "t" });
  repo.transition(j.id, "downloading");
  repo.transition(j.id, "pending_review", { mp3Path: "/tmp/x.mp3" });
  repo.transition(j.id, "approving");
  db.prepare("UPDATE jobs SET updated_at = ? WHERE id = ?").run(Date.now() - 70_000, j.id);
  assert.equal(repo.recoverStuckApproving(60_000), 1);
  assert.equal(repo.get(j.id)!.status, "pending_review");
});
```

- [ ] **Step 2: Implement `repo.ts`**

```ts
// lib/jobs/repo.ts
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { broadcast } from "./stream.ts";

export type JobStatus =
  | "drafting" | "drafted" | "sending" | "queued"
  | "inflight" | "downloading" | "pending_review"
  | "approving" | "approved" | "rejected" | "failed" | "download_failed";

export type Job = {
  id: string;
  show: string;
  concept: string | null;
  draftJson: string | null;
  sunoTaskId: string | null;
  status: JobStatus;
  mp3Path: string | null;
  errorReason: string | null;
  createdAt: number;
  updatedAt: number;
};

const ALLOWED: Record<JobStatus, JobStatus[]> = {
  drafting:        ["drafted", "failed"],
  drafted:         ["sending", "rejected"],
  sending:         ["queued", "inflight", "failed"],
  queued:          ["sending", "inflight", "failed"],
  inflight:        ["downloading", "failed"],
  downloading:     ["pending_review", "download_failed"],
  pending_review:  ["approving", "rejected"],
  approving:       ["approved", "pending_review"],
  approved:        [],
  rejected:        [],
  failed:          [],
  download_failed: ["downloading"],
};

type Row = {
  id: string; show: string; concept: string | null;
  draft_json: string | null; suno_task_id: string | null; status: string;
  mp3_path: string | null; error_reason: string | null;
  created_at: number; updated_at: number;
};

function rowToJob(r: Row): Job {
  return {
    id: r.id, show: r.show, concept: r.concept,
    draftJson: r.draft_json, sunoTaskId: r.suno_task_id,
    status: r.status as JobStatus,
    mp3Path: r.mp3_path, errorReason: r.error_reason,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export class JobRepo {
  constructor(private db: Database.Database) {}

  create(input: { show: string; concept?: string }): Job {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(
      `INSERT INTO jobs (id, show, concept, status, created_at, updated_at)
       VALUES (?, ?, ?, 'drafting', ?, ?)`,
    ).run(id, input.show, input.concept ?? null, now, now);
    broadcast({ type: "job-created", payload: { id, status: "drafting" } });
    return this.get(id)!;
  }

  get(id: string): Job | null {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Row | undefined;
    return row ? rowToJob(row) : null;
  }

  listByStatus(status: JobStatus): Job[] {
    return (this.db.prepare("SELECT * FROM jobs WHERE status = ? ORDER BY created_at").all(status) as Row[]).map(rowToJob);
  }

  recent(limit = 50): Job[] {
    return (this.db.prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?").all(limit) as Row[]).map(rowToJob);
  }

  countSubmitsSince(cutoffMs: number): number {
    const row = this.db.prepare(
      `SELECT COUNT(*) AS n FROM jobs WHERE created_at >= ? AND status NOT IN ('drafting')`,
    ).get(cutoffMs) as { n: number };
    return row.n;
  }

  countInflight(): number {
    const row = this.db.prepare(
      `SELECT COUNT(*) AS n FROM jobs WHERE status IN ('sending', 'inflight', 'downloading')`,
    ).get() as { n: number };
    return row.n;
  }

  transition(
    id: string,
    next: JobStatus,
    extras: { draftJson?: string; sunoTaskId?: string; mp3Path?: string; errorReason?: string } = {},
  ): void {
    const job = this.get(id);
    if (!job) throw new Error(`JobRepo.transition: job ${id} not found`);
    if (!ALLOWED[job.status].includes(next)) {
      throw new Error(`JobRepo: illegal transition ${job.status} → ${next} for job ${id}`);
    }
    const sets: string[] = ["status = ?", "updated_at = ?"];
    const values: (string | number | null)[] = [next, Date.now()];
    if (extras.draftJson !== undefined)   { sets.push("draft_json = ?");   values.push(extras.draftJson); }
    if (extras.sunoTaskId !== undefined)  { sets.push("suno_task_id = ?"); values.push(extras.sunoTaskId); }
    if (extras.mp3Path !== undefined)     { sets.push("mp3_path = ?");     values.push(extras.mp3Path); }
    if (extras.errorReason !== undefined) { sets.push("error_reason = ?"); values.push(extras.errorReason); }
    values.push(id);
    this.db.prepare(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    broadcast({ type: "job-transition", payload: { id, status: next } });
  }

  recoverStuckApproving(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    const result = this.db.prepare(
      `UPDATE jobs SET status = 'pending_review', updated_at = ?
         WHERE status = 'approving' AND updated_at < ?`,
    ).run(Date.now(), cutoff);
    return result.changes;
  }
}
```

- [ ] **Step 3: Stream module (referenced above)**

```ts
// lib/jobs/stream.ts
type Subscriber = (event: { type: string; payload: unknown }) => void;
const subscribers = new Set<Subscriber>();

export function subscribe(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function broadcast(event: { type: string; payload: unknown }): void {
  for (const s of subscribers) {
    try { s(event); } catch { /* ignore */ }
  }
}
```

- [ ] **Step 4: Run + commit**

```bash
cd ~/saas/numaradio-suno && npm test -- --test-name-pattern "JobRepo|legal transition|illegal transition|listByStatus|countSubmits|recoverStuck"
git add lib/jobs/
git commit -m "jobs: typed repo + state-machine guard + SSE broadcast on transition"
```

Expected: 6 passing.

---

# PHASE 3 — Lyrics writer

## Task 3.1: Pattern files

**Files:** `~/saas/numaradio-suno/patterns/{diamond-standard,night-shift,morning-room,daylight-channel,prime-hours}.md`

- [ ] **Step 1: Diamond Standard verbatim**

Copy the operator-provided "💎 The Diamond Standard — Full Reference" content (10 hard rules, slider defaults, style-prompt formula, song-structure skeleton, writing rules, caption formula, "Same Mistake" demo) into `patterns/diamond-standard.md`. Keep it byte-identical to the brief.

- [ ] **Step 2: `night-shift.md`**

```markdown
# Night Shift specialization

The Night Shift airs 00–05. Quiet-hours rotation: low-BPM, spacious,
intimate. Vocals never lift to the front of the mix.

## Show defaults (override Diamond Standard where listed)
- BPM range: 70–95
- Vocal character: breathy, hypnotic, intimate, mid-range to falsetto
- Genre tags: ambient, downtempo, lofi, dark RnB, late-night house, nocturnal soul
- Intro ad-lib (overrides Diamond Standard rule 8): `(Ooh...)`
- Mood vocab: hypnotic, hushed, nocturnal, reflective, late, blue, cool

## Lyric theme starters
- Confessional / intimate moments at unusual hours
- Sleep that won't come
- Sending a message at 3am
- Walking home alone
- Driving on an empty road, dashboard glow
- Window watching, neighbor's light
- One person you can't stop thinking about

Avoid energetic chorus drops. Bridge stays stripped, never lifts.
```

- [ ] **Step 3: `morning-room.md`**

```markdown
# Morning Room specialization

The Morning Room airs 05–10. First-coffee energy: warmer tones, field
recordings, the occasional cover of something you'd forgotten.

## Show defaults
- BPM range: 95–115
- Vocal character: warm, honest, conversational, slightly raspy, controlled chest voice
- Genre tags: indie pop, folk, soft house, field-recording-flavoured, acoustic-electronic, gentle deep house
- Intro ad-lib: `(Hmm...)`
- Mood vocab: warm, hopeful, observational, fresh, still, golden

## Lyric theme starters
- The first hour of being awake
- Light through a window you forgot to close
- A small detail in the kitchen
- Texting someone before they're up
- A walk you take every day, today's version of it
- Not wanting to leave
- Catching yourself in a mirror

Choruses can lift but stay open and roomy. No anthemic shouting.
```

- [ ] **Step 4: `daylight-channel.md`**

```markdown
# Daylight Channel specialization

The Daylight Channel airs 10–17. Focus-hours programming: longer
tracks, fewer host breaks, cohesive grooves.

## Show defaults
- BPM range: 105–125
- Vocal character: polished, composed, mid-front of the mix
- Genre tags: deep house, nu-disco, groove pop, focus electronic, tropical house instrumental, jazzy house
- Intro ad-lib: `(Mmm... yeah...)`
- Mood vocab: composed, steady, cohesive, daylit, level, easy
- Track length: lean longer (3:30–4:00)

## Lyric theme starters
- A small task you're absorbed in
- A view from a desk
- The middle of an errand
- A conversation you're half-paying-attention to
- A space (cafe, library, train) at midday
- A familiar route taken slowly

Lyrics serve the groove rather than the headline. Hooks can be
melodic phrases more than full sentences.
```

- [ ] **Step 5: `prime-hours.md`**

```markdown
# Prime Hours specialization

Prime Hours airs 17–24. Dinner to midnight: louder, stranger, more
character.

## Show defaults
- BPM range: 115–130
- Vocal character: full-chested controlled, melodic, polished
- Genre tags: dance pop, tropical house, funky house, euphoric, late-night anthem, indie dance
- Intro ad-lib: `(Hey... uh...)`
- Mood vocab: euphoric, playful, full, charged, late, social, lit

## Lyric theme starters
- A specific scene at a party / bar / late dinner
- Texting someone you shouldn't
- The drive between two places after dark
- A confidence you only have at this hour
- Owning something you're embarrassed about

Hooks should be sharp and self-aware (see "Same Mistake" exemplar in
the Diamond Standard). AABB throughout, single echoes only.
```

- [ ] **Step 6: Commit**

```bash
cd ~/saas/numaradio-suno && git add patterns/
git commit -m "patterns: diamond-standard + 4 show specializations"
```

---

## Task 3.2: Lyrics-writer interface + composeSystemPrompt + validate

**Files:**
- Create: `~/saas/numaradio-suno/lib/lyrics-writer/{index,validate}.ts` + each `.test.ts`

- [ ] **Step 1: Validate tests**

```ts
// lib/lyrics-writer/validate.test.ts
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { validateDraftedSong } from "./validate.ts";

test("style >1000 chars yields a warning", () => {
  const v = validateDraftedSong({
    title: "X", lyrics: "[Intro] (Hmm...)\nA\nB\nC\nD",
    styleTags: "a".repeat(1500), weirdness: 15, styleInfluence: 18,
    model: "v5.5", gender: "male", caption: "x", coverPrompt: "x",
  });
  assert.ok(v.find((w) => w.field === "styleTags"));
});

test("intro ad-lib mismatch yields a warning when show is set", () => {
  const v = validateDraftedSong(
    {
      title: "X", lyrics: "[Intro: Soft Piano] (Ooh...)\n[Verse 1]\nA\nB\nC\nD",
      styleTags: "x", weirdness: 15, styleInfluence: 18, model: "v5.5",
      gender: "male", caption: "x", coverPrompt: "x",
    },
    "morning_room",
  );
  assert.ok(v.find((w) => w.field === "lyrics" && /intro ad-lib/i.test(w.message)));
});

test("clean Morning Room draft yields no warnings", () => {
  const v = validateDraftedSong(
    {
      title: "X", lyrics: "[Intro: Soft Piano] (Hmm...)\n[Verse 1]\nA\nB\nC\nD",
      styleTags: "indie pop, warm vocals", weirdness: 17, styleInfluence: 18,
      model: "v5.5", gender: "male", caption: "x", coverPrompt: "x",
    },
    "morning_room",
  );
  assert.equal(v.length, 0);
});
```

- [ ] **Step 2: Implement `validate.ts`**

```ts
import type { ShowBlock } from "@prisma/client";

export type DraftedSong = {
  title: string;
  lyrics: string;
  styleTags: string;
  weirdness: number;
  styleInfluence: number;
  model: "v5" | "v5.5";
  gender: "male" | "female" | "duo" | "instrumental";
  caption: string;
  coverPrompt: string;
};

export type Validation = {
  field: keyof DraftedSong;
  severity: "warning";
  message: string;
};

const SHOW_INTRO: Record<ShowBlock, string> = {
  night_shift: "(Ooh...)",
  morning_room: "(Hmm...)",
  daylight_channel: "(Mmm... yeah...)",
  prime_hours: "(Hey... uh...)",
};

export function validateDraftedSong(d: DraftedSong, show?: ShowBlock): Validation[] {
  const out: Validation[] = [];
  if (d.styleTags.length > 1000) {
    out.push({ field: "styleTags", severity: "warning", message: `style: ${d.styleTags.length} chars (max 1000)` });
  }
  if (d.weirdness < 0 || d.weirdness > 100) {
    out.push({ field: "weirdness", severity: "warning", message: `weirdness ${d.weirdness} out of range 0–100` });
  }
  if (d.styleInfluence < 0 || d.styleInfluence > 100) {
    out.push({ field: "styleInfluence", severity: "warning", message: `styleInfluence ${d.styleInfluence} out of range 0–100` });
  }
  if (show) {
    const expected = SHOW_INTRO[show];
    if (!d.lyrics.includes(expected)) {
      out.push({
        field: "lyrics", severity: "warning",
        message: `intro ad-lib for ${show} should include "${expected}"`,
      });
    }
  }
  const lyricLines = d.lyrics.split("\n").filter((l) => l.trim() && !l.trim().startsWith("["));
  if (lyricLines.length === 0) {
    out.push({ field: "lyrics", severity: "warning", message: "no body lyrics found" });
  }
  return out;
}
```

- [ ] **Step 3: Index tests**

```ts
// lib/lyrics-writer/index.test.ts
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { composeSystemPrompt } from "./index.ts";

test("composeSystemPrompt includes diamond marker and show file", () => {
  const sys = composeSystemPrompt({ show: "morning_room", concept: "rooftop" });
  assert.match(sys, /Diamond Standard/i);
  assert.match(sys, /Morning Room/i);
  assert.match(sys, /BPM range: 95–115/);
  assert.match(sys, /\(Hmm\.\.\.\)/);
});
test("composeSystemPrompt with no concept omits the concept block", () => {
  const sys = composeSystemPrompt({ show: "prime_hours" });
  assert.match(sys, /Prime Hours/i);
  assert.doesNotMatch(sys, /Operator concept:/);
});
test("composeSystemPrompt with concept includes it verbatim", () => {
  const sys = composeSystemPrompt({ show: "night_shift", concept: "3am text" });
  assert.match(sys, /Operator concept: 3am text/);
});
```

- [ ] **Step 4: Implement `index.ts`**

```ts
// lib/lyrics-writer/index.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ShowBlock } from "@prisma/client";
import type { DraftedSong, Validation } from "./validate.ts";

export type DraftInput = { show: ShowBlock; concept?: string };
export type DraftResult = DraftedSong & { validations: Validation[] };

export interface LyricsWriterAdapter {
  draft(prompts: { system: string; user: string }): Promise<DraftedSong>;
}

const PATTERNS_DIR = resolve(process.cwd(), "patterns");
function loadPatternFile(name: string): string {
  return readFileSync(resolve(PATTERNS_DIR, `${name}.md`), "utf-8");
}

const SHOW_FILE: Record<ShowBlock, string> = {
  night_shift: "night-shift",
  morning_room: "morning-room",
  daylight_channel: "daylight-channel",
  prime_hours: "prime-hours",
};

export function composeSystemPrompt(input: DraftInput): string {
  const diamond = loadPatternFile("diamond-standard");
  const showSpec = loadPatternFile(SHOW_FILE[input.show]);
  const conceptBlock = input.concept ? `\n\nOperator concept: ${input.concept}` : "";
  return `${diamond}\n\n---\n\n${showSpec}${conceptBlock}\n\n---\n\nReturn ONLY a JSON object with these keys: title, lyrics, styleTags (string), weirdness (number 0-100), styleInfluence (number 0-100), model ("v5" | "v5.5"), gender ("male" | "female" | "duo" | "instrumental"), caption, coverPrompt. No prose, no markdown, no code fences.`;
}

const USER_PROMPT = `Draft a track for the show above. Follow the Diamond Standard hard rules and the show specialization. Return only the JSON object.`;

let _adapter: LyricsWriterAdapter | null = null;

async function getAdapter(): Promise<LyricsWriterAdapter> {
  if (_adapter) return _adapter;
  const provider = (process.env.LYRICS_WRITER_PROVIDER ?? "claude").toLowerCase();
  if (provider === "claude") {
    const mod = await import("./claude.ts");
    _adapter = new mod.ClaudeAdapter();
  } else if (provider === "minimax") {
    const mod = await import("./minimax.ts");
    _adapter = new mod.MiniMaxAdapter();
  } else {
    throw new Error(`unknown LYRICS_WRITER_PROVIDER: ${provider}`);
  }
  return _adapter;
}

export async function draftSong(input: DraftInput): Promise<DraftResult> {
  const { validateDraftedSong } = await import("./validate.ts");
  const adapter = await getAdapter();
  const drafted = await adapter.draft({
    system: composeSystemPrompt(input),
    user: USER_PROMPT,
  });
  return { ...drafted, validations: validateDraftedSong(drafted, input.show) };
}
```

- [ ] **Step 5: Run + commit**

```bash
cd ~/saas/numaradio-suno && npm test -- --test-name-pattern "validate|composeSystemPrompt"
git add lib/lyrics-writer/{index,validate}.{ts,test.ts}
git commit -m "lyrics-writer: interface + composeSystemPrompt + soft validation"
```

Expected: 6 passing.

---

## Task 3.3: Claude adapter

**Files:**
- Create: `~/saas/numaradio-suno/lib/lyrics-writer/claude.ts` + `claude.test.ts`

- [ ] **Step 1: Tests**

```ts
// lib/lyrics-writer/claude.test.ts
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { ClaudeAdapter } from "./claude.ts";

test("ClaudeAdapter parses JSON content into DraftedSong", async () => {
  const fakeAnthropic = {
    messages: {
      create: async () => ({
        content: [{
          type: "text",
          text: JSON.stringify({
            title: "T", lyrics: "L", styleTags: "tags",
            weirdness: 18, styleInfluence: 20, model: "v5.5",
            gender: "male", caption: "C", coverPrompt: "P",
          }),
        }],
      }),
    },
  };
  const adapter = new ClaudeAdapter({ client: fakeAnthropic as any, model: "claude-sonnet-4-6" });
  const r = await adapter.draft({ system: "sys", user: "usr" });
  assert.equal(r.title, "T");
  assert.equal(r.weirdness, 18);
});

test("ClaudeAdapter retries once on JSON parse failure", async () => {
  let calls = 0;
  const fakeAnthropic = {
    messages: {
      create: async () => {
        calls++;
        return {
          content: [{
            type: "text",
            text: calls === 1
              ? "not json"
              : JSON.stringify({
                  title: "T", lyrics: "L", styleTags: "tags",
                  weirdness: 18, styleInfluence: 20, model: "v5.5",
                  gender: "male", caption: "C", coverPrompt: "P",
                }),
          }],
        };
      },
    },
  };
  const a = new ClaudeAdapter({ client: fakeAnthropic as any, model: "x" });
  const r = await a.draft({ system: "s", user: "u" });
  assert.equal(r.title, "T");
  assert.equal(calls, 2);
});

test("ClaudeAdapter throws after second parse failure", async () => {
  const fakeAnthropic = {
    messages: { create: async () => ({ content: [{ type: "text", text: "still not json" }] }) },
  };
  const a = new ClaudeAdapter({ client: fakeAnthropic as any, model: "x" });
  await assert.rejects(a.draft({ system: "s", user: "u" }), /failed to parse JSON/i);
});
```

- [ ] **Step 2: Implement**

```ts
// lib/lyrics-writer/claude.ts
import Anthropic from "@anthropic-ai/sdk";
import type { LyricsWriterAdapter } from "./index.ts";
import type { DraftedSong } from "./validate.ts";

type AnthropicLike = {
  messages: { create: (args: any) => Promise<{ content: { type: string; text: string }[] }> };
};

export class ClaudeAdapter implements LyricsWriterAdapter {
  private client: AnthropicLike;
  private model: string;

  constructor(opts?: { client?: AnthropicLike; model?: string }) {
    this.client = opts?.client ?? (new Anthropic({
      apiKey: process.env.LYRICS_WRITER_CLAUDE_API_KEY,
    }) as unknown as AnthropicLike);
    this.model = opts?.model ?? process.env.LYRICS_WRITER_CLAUDE_MODEL ?? "claude-sonnet-4-6";
  }

  async draft(prompts: { system: string; user: string }): Promise<DraftedSong> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: [
          { type: "text", text: prompts.system, cache_control: { type: "ephemeral" } },
        ],
        messages: [{ role: "user", content: prompts.user }],
      });
      const text = res.content.find((c) => c.type === "text")?.text ?? "";
      try { return parseDraftedSong(text); }
      catch (err) { lastErr = err; }
    }
    throw new Error(`ClaudeAdapter: failed to parse JSON response after retry: ${String(lastErr)}`);
  }
}

function parseDraftedSong(text: string): DraftedSong {
  const cleaned = text.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  const obj = JSON.parse(cleaned);
  for (const k of ["title", "lyrics", "styleTags", "weirdness", "styleInfluence", "model", "gender", "caption", "coverPrompt"]) {
    if (!(k in obj)) throw new Error(`missing field "${k}"`);
  }
  return obj as DraftedSong;
}
```

- [ ] **Step 3: Run + commit**

```bash
cd ~/saas/numaradio-suno && npm test -- --test-name-pattern "ClaudeAdapter"
git add lib/lyrics-writer/claude.{ts,test.ts}
git commit -m "lyrics-writer: Claude adapter with prompt caching + JSON retry"
```

Expected: 3 passing.

---

## Task 3.4: MiniMax adapter

**Files:**
- Create: `~/saas/numaradio-suno/lib/lyrics-writer/minimax.ts` + `minimax.test.ts`

- [ ] **Step 1: Tests**

```ts
// lib/lyrics-writer/minimax.test.ts
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { MiniMaxAdapter } from "./minimax.ts";

test("MiniMaxAdapter parses chat-completion JSON", async () => {
  const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      title: "T", lyrics: "L", styleTags: "tags",
      weirdness: 18, styleInfluence: 20, model: "v5.5",
      gender: "male", caption: "C", coverPrompt: "P",
    }) } }],
  }), { status: 200 });
  const a = new MiniMaxAdapter({ fetchImpl: fakeFetch, apiKey: "x", model: "M" });
  assert.equal((await a.draft({ system: "s", user: "u" })).title, "T");
});

test("MiniMaxAdapter throws on non-2xx", async () => {
  const fakeFetch: typeof fetch = async () => new Response("oops", { status: 500 });
  const a = new MiniMaxAdapter({ fetchImpl: fakeFetch, apiKey: "x", model: "M" });
  await assert.rejects(a.draft({ system: "s", user: "u" }), /HTTP 500/);
});
```

- [ ] **Step 2: Implement**

```ts
// lib/lyrics-writer/minimax.ts
import type { LyricsWriterAdapter } from "./index.ts";
import type { DraftedSong } from "./validate.ts";

const ENDPOINT = process.env.LYRICS_WRITER_MINIMAX_ENDPOINT
  ?? "https://api.minimaxi.chat/v1/text/chatcompletion_v2";

export class MiniMaxAdapter implements LyricsWriterAdapter {
  private apiKey: string;
  private model: string;
  private fetchImpl: typeof fetch;

  constructor(opts?: { apiKey?: string; model?: string; fetchImpl?: typeof fetch }) {
    this.apiKey = opts?.apiKey ?? process.env.LYRICS_WRITER_MINIMAX_API_KEY ?? "";
    this.model = opts?.model ?? process.env.LYRICS_WRITER_MINIMAX_MODEL ?? "MiniMax-M2.7";
    this.fetchImpl = opts?.fetchImpl ?? fetch;
  }

  async draft(prompts: { system: string; user: string }): Promise<DraftedSong> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.fetchImpl(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: prompts.system },
            { role: "user", content: prompts.user },
          ],
          temperature: 0.9,
          max_tokens: 4096,
        }),
      });
      if (!res.ok) throw new Error(`MiniMaxAdapter: HTTP ${res.status}`);
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = json.choices?.[0]?.message?.content ?? "";
      try { return parseDraftedSong(text); }
      catch (err) { lastErr = err; }
    }
    throw new Error(`MiniMaxAdapter: failed to parse JSON after retry: ${String(lastErr)}`);
  }
}

function parseDraftedSong(text: string): DraftedSong {
  const cleaned = text.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  const obj = JSON.parse(cleaned);
  for (const k of ["title", "lyrics", "styleTags", "weirdness", "styleInfluence", "model", "gender", "caption", "coverPrompt"]) {
    if (!(k in obj)) throw new Error(`missing field "${k}"`);
  }
  return obj as DraftedSong;
}
```

- [ ] **Step 3: Run + commit**

```bash
cd ~/saas/numaradio-suno && npm test -- --test-name-pattern "MiniMaxAdapter"
git add lib/lyrics-writer/minimax.{ts,test.ts}
git commit -m "lyrics-writer: MiniMax adapter (drop-in alt to Claude)"
```

Expected: 2 passing.

---

# PHASE 4 — Suno client

## Task 4.1: Cookies module

**Files:**
- Create: `~/saas/numaradio-suno/lib/suno/cookies.ts` + `cookies.test.ts`

- [ ] **Step 1: Tests**

```ts
// lib/suno/cookies.test.ts
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CookieStore } from "./cookies.ts";

async function tempPath(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "suno-cookies-"));
  return join(d, ".cookies.json");
}

test("save and load round-trip", async () => {
  const p = await tempPath();
  const s = new CookieStore(p);
  await s.save({
    rawCookieHeader: "session=abc; __client=xyz",
    clerkJwt: "jwt-1",
    expiresAt: Date.now() + 86_400_000,
    capturedAt: Date.now(),
  });
  const loaded = await s.load();
  assert.ok(loaded);
  assert.equal(loaded!.rawCookieHeader, "session=abc; __client=xyz");
});

test("load returns null when file missing", async () => {
  const s = new CookieStore(await tempPath());
  assert.equal(await s.load(), null);
});

test("load returns null on corrupt JSON", async () => {
  const p = await tempPath();
  await writeFile(p, "{not-json");
  assert.equal(await new CookieStore(p).load(), null);
});

test("isExpired flips when expiresAt in past", async () => {
  const p = await tempPath();
  const s = new CookieStore(p);
  await s.save({ rawCookieHeader: "x", clerkJwt: "y", expiresAt: Date.now() - 1000, capturedAt: Date.now() });
  assert.equal(s.isExpired((await s.load())!), true);
});
```

- [ ] **Step 2: Implement**

```ts
// lib/suno/cookies.ts
import { readFile, writeFile, chmod } from "node:fs/promises";

export type CookieRecord = {
  rawCookieHeader: string;
  clerkJwt: string;
  expiresAt: number;
  capturedAt: number;
};

export class CookieStore {
  constructor(private path: string = process.env.SUNO_COOKIE_PATH ?? "./.cookies.json") {}

  async load(): Promise<CookieRecord | null> {
    try {
      const raw = await readFile(this.path, "utf-8");
      const parsed = JSON.parse(raw);
      if (
        typeof parsed.rawCookieHeader === "string" &&
        typeof parsed.clerkJwt === "string" &&
        typeof parsed.expiresAt === "number"
      ) {
        return parsed as CookieRecord;
      }
      return null;
    } catch {
      return null;
    }
  }

  async save(record: CookieRecord): Promise<void> {
    await writeFile(this.path, JSON.stringify(record, null, 2), "utf-8");
    try { await chmod(this.path, 0o600); } catch { /* non-posix */ }
  }

  isExpired(record: CookieRecord): boolean {
    return record.expiresAt <= Date.now();
  }
}
```

- [ ] **Step 3: Run + commit**

```bash
cd ~/saas/numaradio-suno && npm test -- --test-name-pattern "save and load|load returns null|isExpired"
git add lib/suno/cookies.{ts,test.ts}
git commit -m "suno: cookie store (load/save/expiry)"
```

Expected: 4 passing.

---

## Task 4.2: Rate-limit gates

**Files:**
- Create: `~/saas/numaradio-suno/lib/suno/rate-limit.ts` + `rate-limit.test.ts`

- [ ] **Step 1: Tests**

```ts
// lib/suno/rate-limit.test.ts
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { checkAllowed, dailyResetCutoff, type RateLimitConfig, type JobsState } from "./rate-limit.ts";

const CONFIG: RateLimitConfig = {
  maxInflight: 3, maxStartsPerMin: 2, maxPerDay: 30,
  resetHourLocal: 2, timezone: "Europe/London",
};

test("allowed when all counters below caps", () => {
  const r = checkAllowed({ inflight: 1, startsLastMin: 1, submitsToday: 5, rateLimitHaltedUntil: null }, CONFIG, new Date());
  assert.equal(r.allowed, true);
});

test("blocked at concurrency cap", () => {
  const r = checkAllowed({ inflight: 3, startsLastMin: 0, submitsToday: 0, rateLimitHaltedUntil: null }, CONFIG, new Date());
  assert.equal(r.allowed, false);
  assert.equal((r as any).reason, "concurrency");
});

test("blocked at burst cap", () => {
  const r = checkAllowed({ inflight: 0, startsLastMin: 2, submitsToday: 0, rateLimitHaltedUntil: null }, CONFIG, new Date());
  assert.equal((r as any).reason, "burst");
});

test("blocked at daily ceiling", () => {
  const r = checkAllowed({ inflight: 0, startsLastMin: 0, submitsToday: 30, rateLimitHaltedUntil: null }, CONFIG, new Date());
  assert.equal((r as any).reason, "daily");
});

test("blocked while halted, allowed after halt expires", () => {
  const blocked = checkAllowed(
    { inflight: 0, startsLastMin: 0, submitsToday: 0, rateLimitHaltedUntil: Date.now() + 10*60_000 },
    CONFIG, new Date(),
  );
  assert.equal(blocked.allowed, false);
  const ok = checkAllowed(
    { inflight: 0, startsLastMin: 0, submitsToday: 0, rateLimitHaltedUntil: Date.now() - 1000 },
    CONFIG, new Date(),
  );
  assert.equal(ok.allowed, true);
});

test("dailyResetCutoff is in the past, within last 24h", () => {
  const now = new Date();
  const cutoff = dailyResetCutoff(CONFIG, now);
  assert.ok(cutoff < now.getTime());
  assert.ok(cutoff > now.getTime() - 25 * 3600_000);
});
```

- [ ] **Step 2: Implement**

```ts
// lib/suno/rate-limit.ts
export type RateLimitConfig = {
  maxInflight: number;
  maxStartsPerMin: number;
  maxPerDay: number;
  resetHourLocal: number;
  timezone: string;
};

export type JobsState = {
  inflight: number;
  startsLastMin: number;
  submitsToday: number;
  rateLimitHaltedUntil: number | null;
};

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; reason: "concurrency" | "burst" | "daily" | "halted"; resetAt?: Date };

export function checkAllowed(state: JobsState, config: RateLimitConfig, now: Date): RateLimitDecision {
  if (state.rateLimitHaltedUntil && state.rateLimitHaltedUntil > now.getTime()) {
    return { allowed: false, reason: "halted", resetAt: new Date(state.rateLimitHaltedUntil) };
  }
  if (state.inflight >= config.maxInflight) return { allowed: false, reason: "concurrency" };
  if (state.startsLastMin >= config.maxStartsPerMin) return { allowed: false, reason: "burst" };
  if (state.submitsToday >= config.maxPerDay) {
    return { allowed: false, reason: "daily", resetAt: new Date(nextResetCutoff(config, now)) };
  }
  return { allowed: true };
}

export function dailyResetCutoff(config: RateLimitConfig, now: Date): number {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const localY = parseInt(get("year"), 10);
  const localM = parseInt(get("month"), 10);
  const localD = parseInt(get("day"), 10);
  const localH = parseInt(get("hour"), 10);
  let dayY = localY, dayM = localM, dayD = localD;
  if (localH < config.resetHourLocal) {
    const d = new Date(Date.UTC(localY, localM - 1, localD));
    d.setUTCDate(d.getUTCDate() - 1);
    dayY = d.getUTCFullYear(); dayM = d.getUTCMonth() + 1; dayD = d.getUTCDate();
  }
  const iso = `${dayY}-${String(dayM).padStart(2, "0")}-${String(dayD).padStart(2, "0")}T${String(config.resetHourLocal).padStart(2, "0")}:00:00`;
  const asUtc = Date.parse(iso + "Z");
  const offset = tzOffsetMs(asUtc, config.timezone);
  return asUtc - offset;
}

export function nextResetCutoff(config: RateLimitConfig, now: Date): number {
  return dailyResetCutoff(config, now) + 24 * 3600_000;
}

function tzOffsetMs(utcMs: number, timezone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)!.value, 10);
  const localUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return localUtc - utcMs;
}
```

- [ ] **Step 3: Run + commit**

```bash
cd ~/saas/numaradio-suno && npm test -- --test-name-pattern "allowed when|blocked at|halted|dailyResetCutoff"
git add lib/suno/rate-limit.{ts,test.ts}
git commit -m "suno: pure rate-limit gates (concurrency, burst, daily, halt)"
```

Expected: 6 passing.

---

## Task 4.3: Suno client + fixtures

**Files:**
- Create: `~/saas/numaradio-suno/lib/suno/client.ts` + `client.test.ts`
- Create: `~/saas/numaradio-suno/fixtures/suno-generate-v2.{req,res}.json`

- [ ] **Step 1: Capture fixtures (operator step)**

In a Chromium browser logged into Suno: DevTools → Network on `https://suno.com/create`, generate a song, save the request body to `fixtures/suno-generate-v2.req.json` and response to `suno-generate-v2.res.json`. If fixtures aren't available yet, use the placeholder shapes below — the client test then asserts our outgoing shape matches the recorded shape.

```json
// fixtures/suno-generate-v2.req.json
{
  "prompt": "<lyrics here>",
  "title": "Same Mistake",
  "tags": "<style tags here>",
  "make_instrumental": false,
  "mv": "chirp-v5-5",
  "weirdness_constraint": 0.18,
  "style_weight": 0.20,
  "gender": "male"
}
```

```json
// fixtures/suno-generate-v2.res.json
{ "id": "task-uuid-here", "status": "queued", "created_at": "2026-04-25T10:00:00Z" }
```

- [ ] **Step 2: Tests**

```ts
// lib/suno/client.test.ts
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { SunoClient } from "./client.ts";
import expected from "../../fixtures/suno-generate-v2.req.json" with { type: "json" };
import sample from "../../fixtures/suno-generate-v2.res.json" with { type: "json" };

test("SunoClient.generate posts the expected body shape", async () => {
  let captured: any;
  const fakeFetch: typeof fetch = async (_url, init) => {
    captured = JSON.parse(String((init as RequestInit).body));
    return new Response(JSON.stringify(sample), { status: 200 });
  };
  const client = new SunoClient({ fetchImpl: fakeFetch, cookieHeader: "session=abc", clerkJwt: "jwt" });
  const res = await client.generate({
    title: expected.title, lyrics: expected.prompt, tags: expected.tags,
    instrumental: expected.make_instrumental, model: "v5.5",
    weirdness: 18, styleInfluence: 20, gender: "male",
  });
  assert.equal(res.taskId, sample.id);
  assert.deepEqual(Object.keys(captured).sort(), Object.keys(expected).sort());
});

test("SunoClient.generate maps 401 → cookie_expired", async () => {
  const f: typeof fetch = async () => new Response("", { status: 401 });
  const c = new SunoClient({ fetchImpl: f, cookieHeader: "x", clerkJwt: "y" });
  await assert.rejects(
    c.generate({ title: "T", lyrics: "L", tags: "t", instrumental: false, model: "v5.5", weirdness: 18, styleInfluence: 20, gender: "male" }),
    /cookie_expired/,
  );
});

test("SunoClient.generate maps 429 → rate_limited", async () => {
  const f: typeof fetch = async () => new Response("", { status: 429 });
  const c = new SunoClient({ fetchImpl: f, cookieHeader: "x", clerkJwt: "y" });
  await assert.rejects(
    c.generate({ title: "T", lyrics: "L", tags: "t", instrumental: false, model: "v5.5", weirdness: 18, styleInfluence: 20, gender: "male" }),
    /rate_limited/,
  );
});

test("SunoClient.feedStatus parses status='complete'", async () => {
  const sampleFeed = { id: "task", status: "complete", audio_url: "https://cdn/x.mp3", metadata: { duration: 195 } };
  const f: typeof fetch = async () => new Response(JSON.stringify(sampleFeed), { status: 200 });
  const c = new SunoClient({ fetchImpl: f, cookieHeader: "x", clerkJwt: "y" });
  const r = await c.feedStatus("task");
  assert.equal(r.status, "complete");
  assert.equal(r.audioUrl, "https://cdn/x.mp3");
});
```

- [ ] **Step 3: Implement**

```ts
// lib/suno/client.ts
const STUDIO_BASE = process.env.SUNO_BASE_URL ?? "https://studio-api.suno.com";

export type GenerateInput = {
  title: string;
  lyrics: string;
  tags: string;
  instrumental: boolean;
  model: "v5" | "v5.5";
  weirdness: number;
  styleInfluence: number;
  gender: "male" | "female" | "duo" | "instrumental";
};

export type GenerateResponse = { taskId: string; status: string };

export type FeedStatus = {
  taskId: string;
  status: "queued" | "running" | "complete" | "failed";
  audioUrl?: string;
  imageUrl?: string;
  durationSeconds?: number;
  metadataTags?: string;
  modelVersion?: string;
};

export class SunoClient {
  private fetchImpl: typeof fetch;
  private cookieHeader: string;
  private clerkJwt: string;

  constructor(opts: { fetchImpl?: typeof fetch; cookieHeader: string; clerkJwt: string }) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.cookieHeader = opts.cookieHeader;
    this.clerkJwt = opts.clerkJwt;
  }

  async generate(input: GenerateInput): Promise<GenerateResponse> {
    const body = {
      prompt: input.lyrics,
      title: input.title,
      tags: input.tags,
      make_instrumental: input.instrumental,
      mv: input.model === "v5" ? "chirp-v5" : "chirp-v5-5",
      weirdness_constraint: input.weirdness / 100,
      style_weight: input.styleInfluence / 100,
      gender: input.gender,
    };
    const res = await this.fetchImpl(`${STUDIO_BASE}/api/generate/v2`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (res.status === 401) throw new Error("SunoClient: cookie_expired (HTTP 401)");
    if (res.status === 403) throw new Error("SunoClient: cookie_expired (HTTP 403)");
    if (res.status === 429) throw new Error("SunoClient: rate_limited (HTTP 429)");
    if (!res.ok) throw new Error(`SunoClient: HTTP ${res.status}`);
    const data = (await res.json()) as { id: string; status: string };
    return { taskId: data.id, status: data.status };
  }

  async feedStatus(taskId: string): Promise<FeedStatus> {
    const res = await this.fetchImpl(`${STUDIO_BASE}/api/feed/${encodeURIComponent(taskId)}`, {
      method: "GET",
      headers: this.headers(),
    });
    if (res.status === 401) throw new Error("SunoClient: cookie_expired (HTTP 401)");
    if (res.status === 429) throw new Error("SunoClient: rate_limited (HTTP 429)");
    if (!res.ok) throw new Error(`SunoClient: HTTP ${res.status}`);
    const data = (await res.json()) as {
      id: string;
      status: "queued" | "running" | "complete" | "failed";
      audio_url?: string;
      image_url?: string;
      metadata?: { duration?: number; tags?: string; model?: string };
    };
    return {
      taskId: data.id,
      status: data.status,
      audioUrl: data.audio_url,
      imageUrl: data.image_url,
      durationSeconds: data.metadata?.duration ? Math.round(data.metadata.duration) : undefined,
      metadataTags: data.metadata?.tags,
      modelVersion: data.metadata?.model,
    };
  }

  private headers(): HeadersInit {
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${this.clerkJwt}`,
      "Cookie": this.cookieHeader,
      "User-Agent": "numaradio-suno/0.1",
    };
  }
}
```

- [ ] **Step 4: Run + commit**

```bash
cd ~/saas/numaradio-suno && npm test -- --test-name-pattern "SunoClient"
git add lib/suno/client.{ts,test.ts} fixtures/
git commit -m "suno: client (generate + feedStatus) with fixture-pinned shape"
```

Expected: 4 passing.

---

## Task 4.4: MP3 download helper

**Files:**
- Create: `~/saas/numaradio-suno/lib/suno/download.ts`

- [ ] **Step 1: Implement**

```ts
// lib/suno/download.ts
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

export async function downloadMp3(opts: {
  url: string;
  jobId: string;
  pendingDir?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ path: string; bytes: number }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const dir = resolve(opts.pendingDir ?? "./pending");
  await mkdir(dir, { recursive: true });
  const path = resolve(dir, `${opts.jobId}.mp3`);

  const res = await fetchImpl(opts.url);
  if (!res.ok) throw new Error(`downloadMp3: HTTP ${res.status} for ${opts.url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength < 200 * 1024) {
    throw new Error(`downloadMp3: implausibly small (${buf.byteLength} bytes)`);
  }
  await writeFile(path, buf);
  return { path, bytes: buf.byteLength };
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/saas/numaradio-suno && git add lib/suno/download.ts
git commit -m "suno: download MP3 helper with sanity-size check"
```

---

## Task 4.5: Background poller

**Files:**
- Create: `~/saas/numaradio-suno/lib/suno/poller.ts` + `poller.test.ts`

- [ ] **Step 1: Tests**

```ts
// lib/suno/poller.test.ts
import { test } from "node:test";
import { strict as assert } from "node:assert";
import Database from "better-sqlite3";
import { JobRepo } from "../jobs/repo.ts";
import { tickOnce } from "./poller.ts";

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE jobs (
      id TEXT PRIMARY KEY, show TEXT NOT NULL, concept TEXT,
      draft_json TEXT, suno_task_id TEXT, status TEXT NOT NULL,
      mp3_path TEXT, error_reason TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
  `);
  return db;
}

test("tickOnce moves complete jobs to pending_review", async () => {
  const repo = new JobRepo(freshDb());
  const j = repo.create({ show: "morning_room" });
  repo.transition(j.id, "drafted");
  repo.transition(j.id, "sending");
  repo.transition(j.id, "inflight", { sunoTaskId: "task-1" });
  const fakeClient = {
    feedStatus: async () => ({
      taskId: "task-1", status: "complete" as const,
      audioUrl: "https://cdn/x.mp3", durationSeconds: 195,
    }),
  };
  let downloaded = false;
  const fakeDownload = async () => { downloaded = true; return { path: "/tmp/x.mp3", bytes: 3_500_000 }; };
  await tickOnce({ repo, client: fakeClient as any, downloadMp3: fakeDownload, log: () => {} });
  assert.equal(repo.get(j.id)!.status, "pending_review");
  assert.equal(repo.get(j.id)!.mp3Path, "/tmp/x.mp3");
  assert.equal(downloaded, true);
});

test("tickOnce marks suno-failed jobs as 'failed'", async () => {
  const repo = new JobRepo(freshDb());
  const j = repo.create({ show: "morning_room" });
  repo.transition(j.id, "drafted");
  repo.transition(j.id, "sending");
  repo.transition(j.id, "inflight", { sunoTaskId: "task-2" });
  const fakeClient = { feedStatus: async () => ({ taskId: "task-2", status: "failed" as const }) };
  await tickOnce({ repo, client: fakeClient as any, downloadMp3: async () => ({ path: "", bytes: 0 }), log: () => {} });
  assert.equal(repo.get(j.id)!.status, "failed");
});

test("tickOnce ignores still-running jobs", async () => {
  const repo = new JobRepo(freshDb());
  const j = repo.create({ show: "morning_room" });
  repo.transition(j.id, "drafted");
  repo.transition(j.id, "sending");
  repo.transition(j.id, "inflight", { sunoTaskId: "task-3" });
  const fakeClient = { feedStatus: async () => ({ taskId: "task-3", status: "running" as const }) };
  await tickOnce({ repo, client: fakeClient as any, downloadMp3: async () => ({ path: "", bytes: 0 }), log: () => {} });
  assert.equal(repo.get(j.id)!.status, "inflight");
});
```

- [ ] **Step 2: Implement**

```ts
// lib/suno/poller.ts
import type { JobRepo } from "../jobs/repo.ts";
import type { SunoClient } from "./client.ts";
import { downloadMp3 as defaultDownload } from "./download.ts";

export type PollerDeps = {
  repo: JobRepo;
  client: Pick<SunoClient, "feedStatus">;
  downloadMp3?: typeof defaultDownload;
  log?: (msg: string) => void;
};

const DOWNLOAD_RETRIES = [30_000, 60_000, 120_000];

export async function tickOnce(deps: PollerDeps): Promise<void> {
  const { repo, client, log = console.log } = deps;
  const downloadFn = deps.downloadMp3 ?? defaultDownload;

  const inflight = repo.listByStatus("inflight");
  for (const job of inflight) {
    if (!job.sunoTaskId) continue;
    let status: Awaited<ReturnType<typeof client.feedStatus>>;
    try { status = await client.feedStatus(job.sunoTaskId); }
    catch (err) {
      log(`poller: feedStatus failed for ${job.id}: ${String(err)}`);
      continue;
    }
    if (status.status === "running" || status.status === "queued") continue;
    if (status.status === "failed") {
      repo.transition(job.id, "failed", { errorReason: "suno_failed" });
      continue;
    }
    if (status.status === "complete" && status.audioUrl) {
      repo.transition(job.id, "downloading");
      let lastErr: unknown;
      for (let i = 0; i < DOWNLOAD_RETRIES.length + 1; i++) {
        try {
          const result = await downloadFn({ url: status.audioUrl, jobId: job.id });
          repo.transition(job.id, "pending_review", { mp3Path: result.path });
          lastErr = undefined;
          break;
        } catch (err) {
          lastErr = err;
          if (i < DOWNLOAD_RETRIES.length) await sleep(DOWNLOAD_RETRIES[i]);
        }
      }
      if (lastErr) {
        repo.transition(job.id, "download_failed", { errorReason: String(lastErr) });
      }
    }
  }
}

let _interval: NodeJS.Timeout | null = null;

export function startPoller(deps: PollerDeps, periodMs = 30_000): () => void {
  if (_interval) clearInterval(_interval);
  const tick = async () => { try { await tickOnce(deps); } catch (e) { console.error(e); } };
  tick();
  _interval = setInterval(tick, periodMs);
  return () => { if (_interval) clearInterval(_interval); _interval = null; };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
```

- [ ] **Step 3: Run + commit**

```bash
cd ~/saas/numaradio-suno && npm test -- --test-name-pattern "tickOnce"
git add lib/suno/poller.{ts,test.ts}
git commit -m "suno: background poller — inflight → pending_review with retries"
```

Expected: 3 passing.

---

# PHASE 5 — API routes + capacity + boot

## Task 5.1: `lib/capacity.ts`

**Files:**
- Create: `~/saas/numaradio-suno/lib/capacity.ts` + `capacity.test.ts`

- [ ] **Step 1: Tests**

```ts
// lib/capacity.test.ts
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { computeCapacity, SHOW_TARGETS } from "./capacity.ts";

test("computeCapacity reports zero deficit at target", () => {
  const r = computeCapacity([{ show: "morning_room", airedSeconds: 18000, tracks: 60 }]);
  const mr = r.find((s) => s.show === "morning_room")!;
  assert.equal(mr.targetSeconds, SHOW_TARGETS.morning_room);
  assert.equal(mr.deficitSeconds, 0);
});

test("computeCapacity computes deficit by avg track duration", () => {
  const r = computeCapacity([{ show: "morning_room", airedSeconds: 9000, tracks: 30 }]);
  const mr = r.find((s) => s.show === "morning_room")!;
  assert.equal(mr.deficitSeconds, 9000);
  assert.equal(mr.deficitTracks, 30);
});

test("computeCapacity fills missing shows with zeros", () => {
  const r = computeCapacity([]);
  assert.equal(r.length, 4);
  for (const s of r) {
    assert.equal(s.airedSeconds, 0);
    assert.equal(s.deficitSeconds, s.targetSeconds);
  }
});
```

- [ ] **Step 2: Implement**

```ts
// lib/capacity.ts
import type { ShowBlock } from "@prisma/client";
import { prisma } from "./prisma.ts";

export const SHOW_TARGETS: Record<ShowBlock, number> = {
  night_shift: 5 * 3600,
  morning_room: 5 * 3600,
  daylight_channel: 7 * 3600,
  prime_hours: 7 * 3600,
};

export type CapacityRow = {
  show: ShowBlock;
  airedSeconds: number;
  tracks: number;
  targetSeconds: number;
  deficitSeconds: number;
  deficitTracks: number;
  pct: number;
};

export function computeCapacity(input: { show: ShowBlock; airedSeconds: number; tracks: number }[]): CapacityRow[] {
  const byShow = new Map(input.map((r) => [r.show, r]));
  const out: CapacityRow[] = [];
  for (const show of Object.keys(SHOW_TARGETS) as ShowBlock[]) {
    const row = byShow.get(show) ?? { show, airedSeconds: 0, tracks: 0 };
    const target = SHOW_TARGETS[show];
    const deficit = Math.max(0, target - row.airedSeconds);
    const avg = row.tracks > 0 ? row.airedSeconds / row.tracks : 210;
    const deficitTracks = avg > 0 ? Math.ceil(deficit / avg) : 0;
    out.push({
      show,
      airedSeconds: row.airedSeconds,
      tracks: row.tracks,
      targetSeconds: target,
      deficitSeconds: deficit,
      deficitTracks,
      pct: target > 0 ? row.airedSeconds / target : 0,
    });
  }
  return out;
}

export async function fetchCapacity(stationSlug = process.env.STATION_SLUG ?? "numaradio"): Promise<CapacityRow[]> {
  const station = await prisma.station.findUniqueOrThrow({
    where: { slug: stationSlug }, select: { id: true },
  });
  const rows = await prisma.$queryRaw<Array<{ show: ShowBlock; aired: bigint; tracks: bigint }>>`
    SELECT "show",
           COALESCE(SUM("durationSeconds"), 0)::bigint AS aired,
           COUNT(*)::bigint AS tracks
    FROM "Track"
    WHERE "stationId" = ${station.id}
      AND "trackStatus" = 'ready'
      AND "airingPolicy" = 'library'
      AND "show" IS NOT NULL
    GROUP BY "show"
  `;
  return computeCapacity(rows.map((r) => ({
    show: r.show, airedSeconds: Number(r.aired), tracks: Number(r.tracks),
  })));
}
```

- [ ] **Step 3: Run + commit**

```bash
cd ~/saas/numaradio-suno && npm test -- --test-name-pattern "computeCapacity"
git add lib/capacity.{ts,test.ts}
git commit -m "lib/capacity: per-show fill computation"
```

---

## Task 5.2: API routes — capacity, budget, cookies

**Files:**
- Create: `app/api/capacity/route.ts`, `app/api/budget/route.ts`, `app/api/cookies/route.ts`

- [ ] **Step 1: `capacity/route.ts`**

```ts
import { NextResponse } from "next/server";
import { fetchCapacity } from "@/lib/capacity";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const rows = await fetchCapacity();
    return NextResponse.json({ shows: rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ shows: [], error: String(e) }, { status: 500 });
  }
}
```

- [ ] **Step 2: `budget/route.ts`**

```ts
import { NextResponse } from "next/server";
import { JobRepo } from "@/lib/jobs/repo";
import { getDb } from "@/lib/jobs/db";
import { dailyResetCutoff } from "@/lib/suno/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const repo = new JobRepo(getDb());
  const max = parseInt(process.env.SUNO_MAX_PER_DAY ?? "30", 10);
  const cutoff = dailyResetCutoff(
    { maxInflight: 3, maxStartsPerMin: 2, maxPerDay: max, resetHourLocal: 2, timezone: "Europe/London" },
    new Date(),
  );
  const used = repo.countSubmitsSince(cutoff);
  const resetAt = new Date(cutoff + 24 * 3600_000);
  return NextResponse.json(
    { used, max, resetAt: resetAt.toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
```

- [ ] **Step 3: `cookies/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { CookieStore } from "@/lib/suno/cookies";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const store = new CookieStore();
  const rec = await store.load();
  if (!rec) return NextResponse.json({ status: "missing" });
  if (store.isExpired(rec)) {
    return NextResponse.json({ status: "expired", expiresAt: rec.expiresAt });
  }
  const daysLeft = Math.max(0, Math.ceil((rec.expiresAt - Date.now()) / 86400000));
  return NextResponse.json({ status: "valid", daysLeft, expiresAt: rec.expiresAt });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}));
  const { rawCookieHeader, clerkJwt, expiresAt } = body as Partial<{
    rawCookieHeader: string; clerkJwt: string; expiresAt: number;
  }>;
  if (!rawCookieHeader || !clerkJwt || !expiresAt) {
    return NextResponse.json({ error: "rawCookieHeader, clerkJwt, expiresAt required" }, { status: 400 });
  }
  await new CookieStore().save({
    rawCookieHeader, clerkJwt, expiresAt, capturedAt: Date.now(),
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Commit**

```bash
cd ~/saas/numaradio-suno && git add app/api/{capacity,budget,cookies}
git commit -m "api: capacity, budget, cookies routes"
```

---

## Task 5.3: API routes — draft, generate, jobs (SSE)

**Files:**
- Create: `app/api/{draft,generate,jobs}/route.ts`

- [ ] **Step 1: `draft/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { JobRepo } from "@/lib/jobs/repo";
import { getDb } from "@/lib/jobs/db";
import { draftSong } from "@/lib/lyrics-writer/index";
import type { ShowBlock } from "@prisma/client";

export const dynamic = "force-dynamic";

const SHOWS: ShowBlock[] = ["night_shift", "morning_room", "daylight_channel", "prime_hours"];

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}));
  const show = (body as { show?: string }).show;
  const concept = (body as { concept?: string }).concept;
  if (!show || !SHOWS.includes(show as ShowBlock)) {
    return NextResponse.json({ error: `show must be one of ${SHOWS.join(", ")}` }, { status: 400 });
  }
  const repo = new JobRepo(getDb());
  const job = repo.create({ show, concept: concept ?? undefined });
  try {
    const draft = await draftSong({ show: show as ShowBlock, concept });
    repo.transition(job.id, "drafted", { draftJson: JSON.stringify(draft) });
    return NextResponse.json({ jobId: job.id, draft });
  } catch (err) {
    repo.transition(job.id, "failed", { errorReason: String(err) });
    return NextResponse.json({ jobId: job.id, error: String(err) }, { status: 502 });
  }
}
```

- [ ] **Step 2: `generate/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { JobRepo } from "@/lib/jobs/repo";
import { getDb } from "@/lib/jobs/db";
import { CookieStore } from "@/lib/suno/cookies";
import { SunoClient } from "@/lib/suno/client";
import { checkAllowed, dailyResetCutoff, type RateLimitConfig } from "@/lib/suno/rate-limit";

export const dynamic = "force-dynamic";

const config: RateLimitConfig = {
  maxInflight: parseInt(process.env.SUNO_MAX_INFLIGHT ?? "3", 10),
  maxStartsPerMin: parseInt(process.env.SUNO_MAX_STARTS_PER_MIN ?? "2", 10),
  maxPerDay: parseInt(process.env.SUNO_MAX_PER_DAY ?? "30", 10),
  resetHourLocal: 2,
  timezone: "Europe/London",
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}));
  const jobId = (body as { jobId?: string }).jobId;
  const editedDraft = (body as { draft?: any }).draft;
  if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });

  const repo = new JobRepo(getDb());
  const job = repo.get(jobId);
  if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });
  if (job.status !== "drafted") {
    return NextResponse.json({ error: `job is ${job.status}, expected drafted` }, { status: 409 });
  }

  const draft = editedDraft ?? JSON.parse(job.draftJson ?? "{}");
  const cookieStore = new CookieStore();
  const cookie = await cookieStore.load();
  if (!cookie) return NextResponse.json({ error: "cookies-required" }, { status: 412 });
  if (cookieStore.isExpired(cookie)) return NextResponse.json({ error: "cookie-expired" }, { status: 412 });

  const cutoff = dailyResetCutoff(config, new Date());
  const decision = checkAllowed(
    {
      inflight: repo.countInflight(),
      startsLastMin: repo.countSubmitsSince(Date.now() - 60_000),
      submitsToday: repo.countSubmitsSince(cutoff),
      rateLimitHaltedUntil: null,
    },
    config,
    new Date(),
  );
  if (!decision.allowed) {
    if (decision.reason === "concurrency" || decision.reason === "burst") {
      repo.transition(jobId, "sending");
      repo.transition(jobId, "queued");
      return NextResponse.json({ status: "queued", reason: decision.reason });
    }
    return NextResponse.json({ error: `rate-limited: ${decision.reason}` }, { status: 429 });
  }

  repo.transition(jobId, "sending");
  const client = new SunoClient({ cookieHeader: cookie.rawCookieHeader, clerkJwt: cookie.clerkJwt });
  try {
    const res = await client.generate({
      title: draft.title, lyrics: draft.lyrics, tags: draft.styleTags,
      instrumental: draft.gender === "instrumental",
      model: draft.model, weirdness: draft.weirdness,
      styleInfluence: draft.styleInfluence, gender: draft.gender,
    });
    repo.transition(jobId, "inflight", { sunoTaskId: res.taskId });
    return NextResponse.json({ status: "inflight", sunoTaskId: res.taskId });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("rate_limited")) {
      repo.transition(jobId, "failed", { errorReason: "suno_rate_limited" });
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }
    if (msg.includes("cookie_expired")) {
      repo.transition(jobId, "failed", { errorReason: "cookie_expired" });
      return NextResponse.json({ error: "cookie_expired" }, { status: 412 });
    }
    repo.transition(jobId, "failed", { errorReason: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 3: `jobs/route.ts` (SSE)**

```ts
import { NextRequest } from "next/server";
import { subscribe } from "@/lib/jobs/stream";
import { JobRepo } from "@/lib/jobs/repo";
import { getDb } from "@/lib/jobs/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const repo = new JobRepo(getDb());
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (event: { type: string; payload: unknown }) => {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      send({ type: "snapshot", payload: { jobs: repo.recent(50) } });
      const unsub = subscribe(send);
      const ka = setInterval(() => controller.enqueue(enc.encode(`: ka\n\n`)), 15_000);
      req.signal.addEventListener("abort", () => {
        clearInterval(ka);
        unsub();
        try { controller.close(); } catch { /* */ }
      });
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "Connection": "keep-alive",
    },
  });
}
```

- [ ] **Step 4: Commit**

```bash
cd ~/saas/numaradio-suno && git add app/api/{draft,generate,jobs}
git commit -m "api: draft + generate + jobs (SSE) routes"
```

---

## Task 5.4: API routes — approve, reject, pending mp3

**Files:**
- Create: `app/api/{approve,reject,pending}/[jobId]/route.ts`

- [ ] **Step 1: `approve/[jobId]/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { JobRepo } from "@/lib/jobs/repo";
import { getDb } from "@/lib/jobs/db";
import { ingestTrack } from "@numa/lib/ingest";
import { prisma } from "@/lib/prisma";
import { readFile, unlink } from "node:fs/promises";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }): Promise<NextResponse> {
  const { jobId } = await params;
  const repo = new JobRepo(getDb());
  const job = repo.get(jobId);
  if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });
  if (job.status !== "pending_review") {
    return NextResponse.json({ error: `job is ${job.status}, expected pending_review` }, { status: 409 });
  }
  if (!job.mp3Path) return NextResponse.json({ error: "mp3Path missing" }, { status: 500 });

  let buf: Buffer;
  try { buf = await readFile(job.mp3Path); }
  catch { return NextResponse.json({ error: "mp3_missing" }, { status: 410 }); }

  const station = await prisma.station.findUniqueOrThrow({
    where: { slug: process.env.STATION_SLUG ?? "numaradio" }, select: { id: true },
  });

  const draft = JSON.parse(job.draftJson ?? "{}");
  repo.transition(jobId, "approving");
  try {
    const result = await ingestTrack({
      stationId: station.id, audioBuffer: buf, show: job.show as any,
      title: draft.title, lyrics: draft.lyrics, caption: draft.caption,
      styleTags: typeof draft.styleTags === "string" ? draft.styleTags.split(",").map((t: string) => t.trim()) : [],
      styleSummary: draft.styleTags, gender: draft.gender,
      weirdness: draft.weirdness, styleInfluence: draft.styleInfluence,
      model: draft.model, sunoId: job.sunoTaskId ?? undefined,
      sourceType: "suno_manual",
    });
    repo.transition(jobId, "approved");
    await unlink(job.mp3Path).catch(() => undefined);
    return NextResponse.json({ ok: true, ingestStatus: result.status, trackId: result.trackId });
  } catch (err) {
    repo.transition(jobId, "pending_review");
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 2: `reject/[jobId]/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { JobRepo } from "@/lib/jobs/repo";
import { getDb } from "@/lib/jobs/db";
import { unlink } from "node:fs/promises";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }): Promise<NextResponse> {
  const { jobId } = await params;
  const repo = new JobRepo(getDb());
  const job = repo.get(jobId);
  if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });

  if (job.mp3Path) await unlink(job.mp3Path).catch(() => undefined);

  if (job.status === "pending_review" || job.status === "drafted") {
    repo.transition(jobId, "rejected");
  } else if (["failed", "download_failed", "rejected", "approved"].includes(job.status)) {
    /* terminal — no-op */
  } else {
    return NextResponse.json({ error: `cannot reject from ${job.status}` }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: `pending/[jobId]/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { JobRepo } from "@/lib/jobs/repo";
import { getDb } from "@/lib/jobs/db";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }): Promise<Response> {
  const { jobId } = await params;
  const repo = new JobRepo(getDb());
  const job = repo.get(jobId);
  if (!job?.mp3Path) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    const s = await stat(job.mp3Path);
    const stream = createReadStream(job.mp3Path);
    return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(s.size),
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
```

- [ ] **Step 4: Commit**

```bash
cd ~/saas/numaradio-suno && git add app/api/{approve,reject,pending}
git commit -m "api: approve / reject / pending-mp3 routes"
```

---

## Task 5.5: `instrumentation.ts` — boot poller + recover

**Files:**
- Create: `~/saas/numaradio-suno/instrumentation.ts`

- [ ] **Step 1: Implement**

```ts
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { JobRepo } = await import("./lib/jobs/repo.ts");
  const { getDb } = await import("./lib/jobs/db.ts");
  const { startPoller } = await import("./lib/suno/poller.ts");
  const { SunoClient } = await import("./lib/suno/client.ts");
  const { CookieStore } = await import("./lib/suno/cookies.ts");

  const repo = new JobRepo(getDb());
  const recovered = repo.recoverStuckApproving(60_000);
  if (recovered > 0) console.log(`[boot] recovered ${recovered} stuck 'approving' jobs`);

  const cookieStore = new CookieStore();
  const cookie = await cookieStore.load();
  if (!cookie) {
    console.log("[boot] no cookies — poller idle until /api/cookies POST");
    return;
  }
  if (cookieStore.isExpired(cookie)) {
    console.log("[boot] cookies expired — poller idle until refresh");
    return;
  }
  const client = new SunoClient({ cookieHeader: cookie.rawCookieHeader, clerkJwt: cookie.clerkJwt });
  startPoller({ repo, client });
  console.log("[boot] poller started — period 30s");
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/saas/numaradio-suno && git add instrumentation.ts
git commit -m "boot: instrumentation hook starts poller + recovers stuck approving"
```

---

# PHASE 6 — UI (frontend-design skill)

## Task 6.1: Numa Studio dashboard

**Files:**
- Replace placeholder content in `~/saas/numaradio-suno/app/page.tsx`, `app/layout.tsx`, `app/globals.css`
- Create all `app/components/*.tsx` files

- [ ] **Step 1: Invoke the frontend-design skill**

Use the `Skill` tool to launch `frontend-design`. Brief:

> Build the single-page Numa Studio dashboard at `~/saas/numaradio-suno`. Visual brief: the ASCII mockup in `docs/superpowers/specs/2026-04-25-numaradio-suno-design.md` under "UI layout (single page)". Components needed:
>
> - `header-bar`: cookie status (`✓ valid · Nd left` / `✗ missing` / `✗ expired`) + daily budget meter (`today: 12 / 30 · resets 02:14` with progress bar; amber at 80%, red at 95%).
> - `capacity-bar` + `show-card`: one card per show with title, time label, target hours, fill bar, deficit hint, and an always-clickable "Generate for X" button. Capacity bar is informational only.
> - `generate-modal`: opens on Generate click. Concept input (optional, single line). Pre-filled show pattern preview from `patterns/<show>.md`. After `POST /api/draft` returns, shows draft fields (title, lyrics, styleTags, weirdness, styleInfluence, model, gender, caption, coverPrompt) all editable in place. Soft validation warnings render inline next to the offending field. "Send to Suno" button calls `POST /api/generate` with optional edited draft.
> - `inflight-queue`: "In flight (N of M)" header + a row per `inflight | sending | queued | downloading` job. Show concept text, show-name, status, elapsed time.
> - `rate-limit-banner`: red banner at the top when rate-limited (Suno 429 / cookie expired). Includes `[Resume now]` button when applicable.
> - `pending-review-list` + `pending-review-card`: list of `pending_review` jobs. Each card has show-name, title, audio player (`<audio src="/api/pending/<jobId>">`), and Approve / Reject buttons.
> - `audio-player`: small inline player with play/pause + scrub bar.
> - `cookie-paste-modal`: opens automatically when `/api/cookies` returns missing/expired. Three text fields: rawCookieHeader, clerkJwt, expiresAt. POSTs to `/api/cookies`.
>
> Match the visual language of `~/saas/numaradio/dashboard/app/library/page.tsx`: Tailwind v4, font-mono uppercase tracking, `var(--accent)`, `border-line`, `bg-bg-1`. Use `sonner` for toasts.
>
> Wire data via these endpoints, polling at 30s for capacity/budget/cookies, SSE for jobs:
> - `GET /api/capacity` — returns `{ shows: CapacityRow[] }`
> - `GET /api/budget` — returns `{ used, max, resetAt }`
> - `GET /api/cookies` — returns `{ status, daysLeft?, expiresAt? }`
> - `POST /api/cookies` — body `{ rawCookieHeader, clerkJwt, expiresAt }`
> - `POST /api/draft` — body `{ show, concept? }` → `{ jobId, draft }`
> - `POST /api/generate` — body `{ jobId, draft? }` → `{ status, sunoTaskId? }`
> - `POST /api/approve/[jobId]`, `POST /api/reject/[jobId]`
> - `GET /api/pending/[jobId]` — audio source
> - `GET /api/jobs` — SSE stream of `{ type, payload }` events: `snapshot`, `job-created`, `job-transition`

Review the skill's output, accept the components, and let it wire `app/page.tsx` to compose them.

- [ ] **Step 2: Smoke-test**

```bash
cd ~/saas/numaradio-suno && npm run dev
```

Visit `http://localhost:3100`. Confirm: capacity bars render with real numbers from your DB; cookies status shows "missing" (since `.cookies.json` doesn't exist yet); SSE EventSource opens (Network tab).

- [ ] **Step 3: Commit**

```bash
cd ~/saas/numaradio-suno && git add app/
git commit -m "ui: numa studio dashboard — capacity, generate modal, pending review"
```

---

# PHASE 7 — End-to-end smoke

## Task 7.1: Cookie-paste-and-go

- [ ] **Step 1: Capture Suno cookies**

In a Chromium-based browser logged into Suno:

1. DevTools → Application → Cookies → `https://suno.com`. Or DevTools → Network → any `studio-api.suno.com` request → Headers tab → copy the full `cookie:` header value.
2. Find the Clerk session JWT — search Network for `/v1/client?...` and copy the JWT from the response. Often also visible at `localStorage.__clerk_db_jwt`.
3. Decode the JWT at jwt.io to read its `exp` claim (epoch seconds). Multiply by 1000 for `expiresAt` (epoch ms).

POST it to the local app:

```bash
curl -X POST http://localhost:3100/api/cookies \
  -H "Content-Type: application/json" \
  -d '{"rawCookieHeader":"<paste>","clerkJwt":"<paste>","expiresAt":<epoch ms>}'
```

Expected: `{"ok":true}`. Header in UI flips to `cookies: ✓ valid · Nd left`.

- [ ] **Step 2: Generate one Morning Room track**

Click `Generate for Morning Room`. Concept (optional): "first coffee at the kitchen counter". Submit. Modal shows draft. Tweak if you like. Click `Send to Suno`. Job moves to `inflight` in the queue.

After ~3–5 minutes, the card moves to "Pending review". Click play, listen.

- [ ] **Step 3: Approve**

Click `Approve`. The track row appears at `dashboard.numaradio.com/library` with `show=Morning Room` (refresh to see it).

- [ ] **Step 4: (Optional) Reject one**

Generate another, but on the pending card click `Reject`. The MP3 is removed from `~/saas/numaradio-suno/pending/`, no Track row is written.

- [ ] **Step 5: Update HANDOFF**

Edit `docs/HANDOFF.md` adding a "numaradio-suno — LIVE" section with the commit hashes and the `:3100` port. Rotate older entries to `docs/HANDOFF-archive.md` per project convention.

```bash
cd /home/marku/saas/numaradio && git add docs/HANDOFF.md docs/HANDOFF-archive.md
git commit -m "handoff: numaradio-suno landed; per-show airing rule (refresh-rotation) is the natural next step"
```

---

## Self-review

Spec coverage check:

- ✓ Schema migration + heuristic backfill — Tasks 1.1, 1.2
- ✓ `lib/show-mapping.ts` — Task 1.3
- ✓ `lib/ingest.ts` extraction — Task 1.4
- ✓ Seed CLI refactor with hashtag/sidecar — Task 1.5
- ✓ song-worker show tagging — Task 1.6
- ✓ Dashboard show editor + PATCH route — Tasks 1.7, 1.8
- ✓ numaradio-suno scaffold + Prisma re-export — Tasks 2.1, 2.2
- ✓ Jobs SQLite + repo + state machine + SSE — Tasks 2.3, 2.4
- ✓ Pattern files (Diamond Standard + 4 shows) — Task 3.1
- ✓ Lyrics-writer interface + Claude + MiniMax + soft validation — Tasks 3.2–3.4
- ✓ Cookies module — Task 4.1
- ✓ Rate-limit gates — Task 4.2
- ✓ Suno client + fixtures — Task 4.3
- ✓ Download helper + poller — Tasks 4.4, 4.5
- ✓ Capacity computation — Task 5.1
- ✓ All API routes — Tasks 5.2–5.4
- ✓ Boot recovery — Task 5.5
- ✓ UI via frontend-design skill — Task 6.1
- ✓ End-to-end smoke — Task 7.1

Type consistency: `JobStatus`, `JobRepo`, `ShowBlock`, `DraftedSong`, `IngestInput`, `RateLimitConfig`, `CookieRecord`, `SunoClient`, `LyricsWriterAdapter` — all referenced consistently across tasks.

Operator prerequisites (call out before first run):
1. Capture Suno cookies (Task 7.1 step 1) — the app is dead until this happens.
2. Set `LYRICS_WRITER_CLAUDE_API_KEY` in `.env.local` (Task 2.1 step 6).
3. Drop one `#NightShift`/`#MorningRoom`/etc. MP3 to confirm the seed-side flow (Task 1.5 step 4).

---

## Natural follow-up

The per-show **airing rule in `refresh-rotation.ts`** is the payoff of all this work — without it the `show` column is unused. It's a separable change with its own design questions (cross-show fade rules at boundary, empty-show fallback to the no-show pool) and gets its own spec/plan in a follow-up session.

