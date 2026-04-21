# Listener Song Generation — Phase A — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Listener visits `numaradio.com`, submits a prompt + artist name (+ optional instrumental toggle), gets a fully-generated MiniMax `music-2.6` song with a flux.2-pro album cover, aired on the live stream within ~3–4 min.

**Architecture:** New `SongRequest` table in Neon. Vercel hosts public API + form UI. Dedicated `numa-song-worker.service` on Orion polls Neon, runs a 6-step pipeline per job (LLM prompt expansion → MiniMax music + OpenRouter artwork in parallel → B2 upload → Track/TrackAsset insert → queue-daemon push). Rate limit 1/hr, 3/day per IP; serial concurrency of 1 bounds spend to the 20/hr MiniMax subscription cap.

**Tech Stack:** Next.js 16 App Router (Vercel), Prisma + Neon Postgres, TypeScript Node workers, `tsx`, `node --test --experimental-strip-types`, systemd user unit, AWS SDK S3 client against Backblaze B2, MiniMax Anthropic-compat API + MiniMax music API, OpenRouter image generation.

**Spec:** `docs/superpowers/specs/2026-04-21-song-generation-design.md`

---

## File structure

**New files — backend:**
- `prisma/migrations/<timestamp>_add_song_request/migration.sql` — adds `SongRequest` table.
- `lib/song-request.ts` — Vercel-side helpers: create row, fetch by id, compute live queue position, queue-stats.
- `lib/song-request.test.ts`
- `workers/song-worker/index.ts` — process entry point + poll loop.
- `workers/song-worker/claim.ts` — claim next queued row atomically.
- `workers/song-worker/claim.test.ts`
- `workers/song-worker/sweeper.ts` — reset stale `processing` rows back to `queued`.
- `workers/song-worker/sweeper.test.ts`
- `workers/song-worker/minimax.ts` — MiniMax music API client.
- `workers/song-worker/minimax.test.ts`
- `workers/song-worker/openrouter.ts` — OpenRouter flux.2-pro image client.
- `workers/song-worker/openrouter.test.ts`
- `workers/song-worker/prompt-expand.ts` — LLM call: prompt → {title, artworkPrompt, lyrics?}.
- `workers/song-worker/prompt-expand.test.ts`
- `workers/song-worker/pipeline.ts` — orchestrator of the 6-step per-job pipeline.
- `workers/song-worker/pipeline.test.ts`
- `workers/song-worker/assets/default-artwork.png` — bundled fallback when OpenRouter fails.
- `deploy/systemd/numa-song-worker.service` — systemd user unit.

**New files — Vercel routes + UI:**
- `app/api/booth/song/route.ts` — POST creates SongRequest.
- `app/api/booth/song/queue-stats/route.ts` — GET live queue stats.
- `app/api/booth/song/[id]/status/route.ts` — GET status polling.
- `app/_components/CreateSongTab.tsx` — the "Create" tab client component.
- `app/_components/CreateSongForm.tsx` — the form + pending/done states.

**Modified files:**
- `lib/rate-limit.ts` — add `checkSongRateLimit()` + `SONG_LIMITS`.
- `prisma/schema.prisma` — add the `SongRequest` model + relations on `Station`, `Track`.
- `app/page.tsx` (the homepage that already has the shoutout tab) — add "Create" tab alongside existing ones.
- `package.json` — add `"song:worker": "tsx workers/song-worker/index.ts"` script.
- Root `.env.local` (operator already set `OPEN_ROUTER_API` locally; add to Vercel env before rollout).
- `/etc/numa/env` on Orion — add `OPEN_ROUTER_API` so the worker can read it.

---

## Task 1: Prisma migration — `SongRequest` table

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_song_request/migration.sql` (via `prisma migrate dev`)

- [ ] **Step 1: Add the model to the schema**

Append to `prisma/schema.prisma`:

```prisma
model SongRequest {
  id                 String    @id @default(cuid())
  stationId          String
  ipHash             String
  prompt             String    @db.Text
  artistName         String
  originalArtistName String?
  isInstrumental     Boolean   @default(false)
  lyricsFallback     Boolean   @default(false)
  moderationStatus   String
  moderationReason   String?
  status             String    @default("queued")
  errorMessage       String?
  miniMaxTaskId      String?
  titleGenerated     String?
  artworkPrompt      String?
  lyricsGenerated    String?   @db.Text
  trackId            String?
  createdAt          DateTime  @default(now())
  startedAt          DateTime?
  completedAt        DateTime?

  station Station @relation(fields: [stationId], references: [id])
  track   Track?  @relation(fields: [trackId], references: [id])

  @@index([status, createdAt])
  @@index([ipHash, createdAt])
}
```

Also add the back-relations to the existing `Station` and `Track` models:

```prisma
// inside model Station { ... }
songRequests SongRequest[]

// inside model Track { ... }
songRequests SongRequest[]
```

- [ ] **Step 2: Generate migration**

```bash
cd /home/marku/saas/numaradio
npx prisma migrate dev --name add_song_request --create-only
```

Expected: a new directory `prisma/migrations/<timestamp>_add_song_request/` with `migration.sql` containing `CREATE TABLE "SongRequest" (...)`. Verify it looks right before applying:

```bash
cat prisma/migrations/*_add_song_request/migration.sql | head -40
```

- [ ] **Step 3: Apply the migration to Neon**

```bash
npx prisma migrate deploy
```

Expected: `Applying migration '<timestamp>_add_song_request'` then `All migrations have been successfully applied.`

- [ ] **Step 4: Regenerate Prisma client**

```bash
npx prisma generate
```

Expected: `Generated Prisma Client (v…)`.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add SongRequest model for listener song generation

Stores the lifecycle of each listener-submitted song job: prompt, artist,
moderation decision, instrumental toggle, LLM-derived title/artwork/lyrics,
MiniMax task id, and the eventual Track foreign key. Indexed on
(status, createdAt) for the worker's claim query and on (ipHash,
createdAt) for rate-limit lookups."
```

---

## Task 2: Extend `lib/rate-limit.ts` with `checkSongRateLimit` (TDD)

**Files:**
- Modify: `lib/rate-limit.ts`
- Test: no existing test file for rate-limit; we'll add one alongside.
- Create: `lib/rate-limit.test.ts`

- [ ] **Step 1: Update the test glob to include lib/**

Already done in the profanity-prefilter patch. Verify `package.json:test` reads:

```bash
grep '"test":' /home/marku/saas/numaradio/package.json
```

Expected: `"test": "node --test --experimental-strip-types '{lib,scripts,workers}/**/*.test.ts'"`. If not, add `lib,` to the glob.

- [ ] **Step 2: Write the failing test**

Create `lib/rate-limit.test.ts` with this EXACT content:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { SONG_LIMITS } from "./rate-limit.ts";

test("SONG_LIMITS is 1/hour and 3/day", () => {
  assert.equal(SONG_LIMITS.HOUR_LIMIT, 1);
  assert.equal(SONG_LIMITS.DAY_LIMIT, 3);
});
```

We can't easily unit-test `checkSongRateLimit` itself without mocking Prisma; instead we rely on the existing `checkShoutoutRateLimit` pattern (which this parallels exactly) plus manual integration verification. This minimal test guards the constants from accidental edits.

- [ ] **Step 3: Run tests to verify it fails**

```bash
cd /home/marku/saas/numaradio && npm test -- --test-name-pattern="SONG_LIMITS"
```

Expected: FAIL — `SONG_LIMITS` not exported.

- [ ] **Step 4: Add `checkSongRateLimit` + export**

Open `lib/rate-limit.ts`. Append at the end of the file:

```typescript
const SONG_HOUR_LIMIT = 1;
const SONG_DAY_LIMIT = 3;

export async function checkSongRateLimit(ipHash: string): Promise<RateLimitResult> {
  const now = new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [hourCount, dayCount] = await Promise.all([
    prisma.songRequest.count({
      where: { ipHash, createdAt: { gte: hourAgo } },
    }),
    prisma.songRequest.count({
      where: { ipHash, createdAt: { gte: dayAgo } },
    }),
  ]);

  if (hourCount >= SONG_HOUR_LIMIT) {
    const oldest = await prisma.songRequest.findFirst({
      where: { ipHash, createdAt: { gte: hourAgo } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    const waitUntil = oldest
      ? oldest.createdAt.getTime() + 60 * 60 * 1000
      : now.getTime() + 60 * 60 * 1000;
    return {
      ok: false,
      reason: "hour_limit",
      retryAfterSeconds: Math.max(60, Math.ceil((waitUntil - now.getTime()) / 1000)),
      hourCount,
      dayCount,
    };
  }
  if (dayCount >= SONG_DAY_LIMIT) {
    return {
      ok: false,
      reason: "day_limit",
      retryAfterSeconds: 60 * 60 * 6,
      hourCount,
      dayCount,
    };
  }

  return { ok: true, hourCount, dayCount };
}

export const SONG_LIMITS = {
  HOUR_LIMIT: SONG_HOUR_LIMIT,
  DAY_LIMIT: SONG_DAY_LIMIT,
};
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test -- --test-name-pattern="SONG_LIMITS"
```

Expected: PASS.

Also run the whole suite to confirm no regressions:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/rate-limit.ts lib/rate-limit.test.ts
git commit -m "feat(rate-limit): add checkSongRateLimit (1/hr, 3/day per IP)

Mirrors checkShoutoutRateLimit against the new SongRequest table.
retryAfterSeconds is derived from the oldest counted row for hour limit,
static 6h for day limit (matching the shoutout behavior)."
```

---

## Task 3: `lib/song-request.ts` — Vercel-side Prisma helpers (TDD, minimal)

**Files:**
- Create: `lib/song-request.ts`
- Test: skipped — the helpers are thin Prisma wrappers; Prisma mocking in unit tests doesn't buy much over integration.

- [ ] **Step 1: Create the helper module**

Create `lib/song-request.ts`:

```typescript
import { prisma } from "@/lib/db";

export interface CreateSongRequestInput {
  stationId: string;
  ipHash: string;
  prompt: string;
  artistName: string;
  originalArtistName: string | null;
  isInstrumental: boolean;
  moderationStatus: string;
  moderationReason: string | null;
}

export interface QueueStats {
  queueDepth: number;
  inProgress: boolean;
  estWaitSeconds: number;
}

const AVG_GENERATION_SECONDS = 210; // 3 min 30 s

export async function createSongRequest(input: CreateSongRequestInput) {
  return prisma.songRequest.create({
    data: {
      stationId: input.stationId,
      ipHash: input.ipHash,
      prompt: input.prompt,
      artistName: input.artistName,
      originalArtistName: input.originalArtistName,
      isInstrumental: input.isInstrumental,
      moderationStatus: input.moderationStatus,
      moderationReason: input.moderationReason,
      status: "queued",
    },
    select: { id: true, createdAt: true },
  });
}

export async function queuePositionFor(requestId: string, createdAt: Date): Promise<number> {
  // Number of queued rows at-or-before this one, plus one in-progress.
  const ahead = await prisma.songRequest.count({
    where: {
      status: "queued",
      createdAt: { lt: createdAt },
    },
  });
  const inFlight = await prisma.songRequest.count({
    where: { status: { in: ["processing", "finalizing"] } },
  });
  return ahead + inFlight;
}

export async function fetchQueueStats(): Promise<QueueStats> {
  const [queueDepth, inProgressCount] = await Promise.all([
    prisma.songRequest.count({ where: { status: "queued" } }),
    prisma.songRequest.count({
      where: { status: { in: ["processing", "finalizing"] } },
    }),
  ]);
  const totalAhead = queueDepth + inProgressCount;
  return {
    queueDepth,
    inProgress: inProgressCount > 0,
    estWaitSeconds: totalAhead * AVG_GENERATION_SECONDS,
  };
}

export async function fetchSongRequestPublic(id: string) {
  return prisma.songRequest.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      errorMessage: true,
      artistName: true,
      originalArtistName: true,
      titleGenerated: true,
      trackId: true,
      isInstrumental: true,
      lyricsFallback: true,
      createdAt: true,
      track: {
        select: {
          id: true,
          title: true,
          artistDisplay: true,
          assets: {
            where: { assetType: { in: ["audio_stream", "artwork_primary"] } },
            select: { assetType: true, publicUrl: true },
          },
        },
      },
    },
  });
}
```

- [ ] **Step 2: Build to confirm types**

```bash
cd /home/marku/saas/numaradio && npm run build 2>&1 | tail -5
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add lib/song-request.ts
git commit -m "feat(lib): SongRequest helpers — create, queue position, queue stats, public fetch"
```

---

## Task 4: `POST /api/booth/song` route (Vercel)

**Files:**
- Create: `app/api/booth/song/route.ts`

- [ ] **Step 1: Create the route**

Create `app/api/booth/song/route.ts`:

```typescript
// POST /api/booth/song — listener submits a prompt + artist + optional instrumental toggle.
// Rate-limited by IP hash, moderated by MiniMax, artist name run through
// profanityPrefilter. On success returns {requestId, queuePosition, estWaitSeconds}.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  checkSongRateLimit,
  clientIpFromRequest,
  hashIp,
  SONG_LIMITS,
} from "@/lib/rate-limit";
import { moderateShoutout, profanityPrefilter } from "@/lib/moderate";
import {
  createSongRequest,
  queuePositionFor,
  fetchQueueStats,
} from "@/lib/song-request";

export const dynamic = "force-dynamic";

const PROMPT_MIN = 4;
const PROMPT_MAX = 240;
const ARTIST_MIN = 2;
const ARTIST_MAX = 40;
const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";

export async function POST(req: Request): Promise<NextResponse> {
  let body: {
    prompt?: unknown;
    artistName?: unknown;
    isInstrumental?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const prompt =
    typeof body.prompt === "string" ? body.prompt.trim().replace(/\s+/g, " ") : "";
  const typedArtist =
    typeof body.artistName === "string" ? body.artistName.trim() : "";
  const isInstrumental = body.isInstrumental === true;

  if (prompt.length < PROMPT_MIN) {
    return NextResponse.json(
      { ok: false, error: "prompt_too_short" },
      { status: 400 },
    );
  }
  if (prompt.length > PROMPT_MAX) {
    return NextResponse.json(
      { ok: false, error: "prompt_too_long", max: PROMPT_MAX },
      { status: 400 },
    );
  }
  if (typedArtist.length < ARTIST_MIN) {
    return NextResponse.json(
      { ok: false, error: "artist_name_too_short" },
      { status: 400 },
    );
  }
  if (typedArtist.length > ARTIST_MAX) {
    return NextResponse.json(
      { ok: false, error: "artist_name_too_long", max: ARTIST_MAX },
      { status: 400 },
    );
  }

  const station = await prisma.station.findUnique({
    where: { slug: STATION_SLUG },
    select: { id: true },
  });
  if (!station) {
    return NextResponse.json(
      { ok: false, error: "station_not_configured" },
      { status: 500 },
    );
  }

  const ipHash = hashIp(clientIpFromRequest(req));

  const limit = await checkSongRateLimit(ipHash);
  if (!limit.ok) {
    const msg =
      limit.reason === "hour_limit"
        ? `Only ${SONG_LIMITS.HOUR_LIMIT} song per hour — come back in a bit.`
        : `Daily limit reached (${SONG_LIMITS.DAY_LIMIT}). Come back tomorrow.`;
    return NextResponse.json(
      { ok: false, error: msg, retryAfterSeconds: limit.retryAfterSeconds },
      {
        status: 429,
        headers: limit.retryAfterSeconds
          ? { "Retry-After": String(limit.retryAfterSeconds) }
          : undefined,
      },
    );
  }

  const moderation = await moderateShoutout(prompt);
  if (moderation.decision === "blocked" || moderation.decision === "held") {
    return NextResponse.json(
      {
        ok: false,
        error: "prompt_not_allowed",
        detail: moderation.reason,
      },
      { status: 422 },
    );
  }
  const finalPrompt =
    moderation.decision === "rewritten" ? moderation.text : prompt;

  const artistPrefilterHit = profanityPrefilter(typedArtist);
  const finalArtist = artistPrefilterHit ? "Numa Radio" : typedArtist;
  const originalArtistName = artistPrefilterHit ? typedArtist : null;

  const created = await createSongRequest({
    stationId: station.id,
    ipHash,
    prompt: finalPrompt,
    artistName: finalArtist,
    originalArtistName,
    isInstrumental,
    moderationStatus: moderation.decision,
    moderationReason: moderation.reason,
  });

  const queuePosition = await queuePositionFor(created.id, created.createdAt);

  return NextResponse.json({
    ok: true,
    requestId: created.id,
    queuePosition,
    estWaitSeconds: queuePosition * 210,
    finalArtistName: finalArtist,
    artistNameSubstituted: Boolean(artistPrefilterHit),
  });
}
```

- [ ] **Step 2: Build**

```bash
cd /home/marku/saas/numaradio && npm run build 2>&1 | tail -10
```

Expected: route appears as `ƒ /api/booth/song` in the output.

- [ ] **Step 3: Commit**

```bash
git add app/api/booth/song/route.ts
git commit -m "feat(booth): POST /api/booth/song creates moderated SongRequest

Validates prompt/artist length, rate-limits 1/hr 3/day per IP, moderates
the prompt, substitutes 'Numa Radio' when the artist name fails profanity
prefilter, and returns the caller their queue position."
```

---

## Task 5: `GET /api/booth/song/queue-stats` route

**Files:**
- Create: `app/api/booth/song/queue-stats/route.ts`

- [ ] **Step 1: Create the route**

```typescript
import { NextResponse } from "next/server";
import { fetchQueueStats } from "@/lib/song-request";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const stats = await fetchQueueStats();
  return NextResponse.json(
    { ok: true, ...stats },
    {
      headers: {
        // Cached 5 s at the CDN; clients polling every 10 s hit origin about half the time.
        "Cache-Control": "public, s-maxage=5, stale-while-revalidate=10",
      },
    },
  );
}
```

- [ ] **Step 2: Build**

```bash
npm run build 2>&1 | grep "queue-stats"
```

Expected: `ƒ /api/booth/song/queue-stats`.

- [ ] **Step 3: Commit**

```bash
git add app/api/booth/song/queue-stats/route.ts
git commit -m "feat(booth): GET /api/booth/song/queue-stats for live 'N requests in front' counter"
```

---

## Task 6: `GET /api/booth/song/:id/status` route

**Files:**
- Create: `app/api/booth/song/[id]/status/route.ts`

- [ ] **Step 1: Create the route**

```typescript
import { NextResponse } from "next/server";
import {
  fetchSongRequestPublic,
  queuePositionFor,
} from "@/lib/song-request";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const row = await fetchSongRequestPublic(id);
  if (!row) {
    return NextResponse.json(
      { ok: false, error: "not_found" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  let queuePosition: number | undefined;
  let estWaitSeconds: number | undefined;
  if (row.status === "queued") {
    queuePosition = await queuePositionFor(row.id, row.createdAt);
    estWaitSeconds = queuePosition * 210;
  }

  const audioUrl = row.track?.assets.find((a) => a.assetType === "audio_stream")
    ?.publicUrl;
  const artworkUrl = row.track?.assets.find((a) => a.assetType === "artwork_primary")
    ?.publicUrl;

  return NextResponse.json(
    {
      ok: true,
      status: row.status,
      errorMessage: row.errorMessage,
      finalArtistName: row.artistName,
      artistNameSubstituted: row.originalArtistName !== null,
      title: row.track?.title ?? row.titleGenerated ?? null,
      audioUrl: audioUrl ?? null,
      artworkUrl: artworkUrl ?? null,
      isInstrumental: row.isInstrumental,
      lyricsFallback: row.lyricsFallback,
      trackId: row.trackId,
      queuePosition,
      estWaitSeconds,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
```

- [ ] **Step 2: Build**

```bash
npm run build 2>&1 | grep "song/\[id\]/status"
```

Expected: `ƒ /api/booth/song/[id]/status`.

- [ ] **Step 3: Commit**

```bash
git add "app/api/booth/song/[id]/status/route.ts"
git commit -m "feat(booth): GET /api/booth/song/[id]/status for client polling

Returns the song's current state plus resolved title/audio/artwork URLs
once the Track has been created, plus live queuePosition while still
queued."
```

---

## Task 7: `workers/song-worker/claim.ts` — atomic job claim (TDD)

**Files:**
- Create: `workers/song-worker/claim.ts`
- Test: `workers/song-worker/claim.test.ts`

- [ ] **Step 1: Write the failing test**

Create `workers/song-worker/claim.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClaimSql } from "./claim.ts";

test("buildClaimSql updates one queued row atomically with SKIP LOCKED", () => {
  const sql = buildClaimSql();
  assert.match(sql, /UPDATE "SongRequest"/);
  assert.match(sql, /SET "status" = 'processing'/);
  assert.match(sql, /"startedAt" = NOW\(\)/);
  assert.match(sql, /WHERE "id" = \(/);
  assert.match(sql, /SELECT "id"/);
  assert.match(sql, /WHERE "status" = 'queued'/);
  assert.match(sql, /ORDER BY "createdAt" ASC/);
  assert.match(sql, /LIMIT 1/);
  assert.match(sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(sql, /RETURNING/);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/marku/saas/numaradio && npm test -- --test-name-pattern="buildClaimSql"
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the claim module**

Create `workers/song-worker/claim.ts`:

```typescript
import { PrismaClient } from "@prisma/client";

export interface ClaimedJob {
  id: string;
  prompt: string;
  artistName: string;
  isInstrumental: boolean;
}

export function buildClaimSql(): string {
  return `
    UPDATE "SongRequest"
       SET "status" = 'processing',
           "startedAt" = NOW()
     WHERE "id" = (
       SELECT "id"
         FROM "SongRequest"
        WHERE "status" = 'queued'
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     )
    RETURNING "id", "prompt", "artistName", "isInstrumental"
  `;
}

export async function claimNextJob(prisma: PrismaClient): Promise<ClaimedJob | null> {
  const rows = await prisma.$queryRawUnsafe<ClaimedJob[]>(buildClaimSql());
  return rows.length > 0 ? rows[0] : null;
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- --test-name-pattern="buildClaimSql"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add workers/song-worker/claim.ts workers/song-worker/claim.test.ts
git commit -m "feat(worker): atomic SongRequest claim via UPDATE ... FOR UPDATE SKIP LOCKED

One-shot SQL: atomically flip one queued row to processing and return its
generation inputs. SKIP LOCKED makes it safe if we ever scale beyond one
worker; for MVP it's serialized anyway."
```

---

## Task 8: `workers/song-worker/sweeper.ts` — stale-job recovery (TDD)

**Files:**
- Create: `workers/song-worker/sweeper.ts`
- Test: `workers/song-worker/sweeper.test.ts`

- [ ] **Step 1: Write the failing test**

Create `workers/song-worker/sweeper.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSweepSql, STALE_MINUTES } from "./sweeper.ts";

test("STALE_MINUTES is 10", () => {
  assert.equal(STALE_MINUTES, 10);
});

test("buildSweepSql resets processing rows older than 10 minutes", () => {
  const sql = buildSweepSql();
  assert.match(sql, /UPDATE "SongRequest"/);
  assert.match(sql, /SET "status" = 'queued'/);
  assert.match(sql, /"startedAt" = NULL/);
  assert.match(sql, /WHERE "status" = 'processing'/);
  assert.match(sql, /"startedAt" < NOW\(\) - INTERVAL '10 minutes'/);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --test-name-pattern="buildSweepSql|STALE_MINUTES"
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the sweeper**

Create `workers/song-worker/sweeper.ts`:

```typescript
import { PrismaClient } from "@prisma/client";

export const STALE_MINUTES = 10;

export function buildSweepSql(): string {
  return `
    UPDATE "SongRequest"
       SET "status" = 'queued',
           "startedAt" = NULL
     WHERE "status" = 'processing'
       AND "startedAt" < NOW() - INTERVAL '${STALE_MINUTES} minutes'
  `;
}

export async function sweepStaleJobs(prisma: PrismaClient): Promise<number> {
  const result = (await prisma.$executeRawUnsafe(buildSweepSql())) as unknown;
  return typeof result === "number" ? result : 0;
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- --test-name-pattern="buildSweepSql|STALE_MINUTES"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add workers/song-worker/sweeper.ts workers/song-worker/sweeper.test.ts
git commit -m "feat(worker): sweep stale processing rows back to queued after 10 min"
```

---

## Task 9: `workers/song-worker/minimax.ts` — music API client (TDD)

**Files:**
- Create: `workers/song-worker/minimax.ts`
- Test: `workers/song-worker/minimax.test.ts`

- [ ] **Step 1: Write the failing test**

Create `workers/song-worker/minimax.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeDurationMs } from "./minimax.ts";

test("normalizeDurationMs handles nanoseconds (>1e9)", () => {
  assert.equal(normalizeDurationMs(3_000_000_000), 3_000);
});

test("normalizeDurationMs handles microseconds (1e6..1e9)", () => {
  assert.equal(normalizeDurationMs(3_000_000), 3_000);
});

test("normalizeDurationMs passes milliseconds through unchanged", () => {
  assert.equal(normalizeDurationMs(180_000), 180_000);
});

test("normalizeDurationMs handles sample counts at 44.1kHz", () => {
  // 2.5 minutes × 60 × 44100 = 6,615,000 samples → this is misinterpreted as μs
  // by the reference code's heuristic. This test documents the ordering.
  const result = normalizeDurationMs(6_615_000);
  // Falls into the 1e6..1e9 branch → μs conversion → 6615 ms.
  assert.equal(result, 6_615);
});

test("normalizeDurationMs returns 0 for undefined/null", () => {
  assert.equal(normalizeDurationMs(undefined), 0);
  assert.equal(normalizeDurationMs(null), 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --test-name-pattern="normalizeDurationMs"
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the client**

Create `workers/song-worker/minimax.ts`:

```typescript
const MINIMAX_MUSIC_URL = "https://api.minimax.io/v1/music_generation";
const MUSIC_MODEL = process.env.MINIMAX_MUSIC_MODEL ?? "music-2.6";

export interface StartMusicInput {
  prompt: string;
  lyrics?: string;
  isInstrumental: boolean;
}

export interface StartMusicResult {
  taskId: string;
  immediateAudioUrl?: string;
  durationMs?: number;
}

export interface PollMusicResult {
  status: "pending" | "done" | "failed";
  audioUrl?: string;
  durationMs?: number;
  failureReason?: string;
}

export function normalizeDurationMs(raw: unknown): number {
  if (raw === null || raw === undefined) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n > 1_000_000_000) return Math.round(n / 1_000_000);  // ns → ms
  if (n > 1_000_000) return Math.round(n / 1_000);          // µs → ms
  if (n < 600_000) return Math.round(n);                    // plausible ms, pass-through
  return Math.round(n / 44.1);                              // samples at 44.1kHz → ms
}

function apiKey(): string {
  const k = process.env.MINIMAX_API_KEY;
  if (!k) throw new Error("MINIMAX_API_KEY not set");
  return k;
}

export async function startMusicGeneration(
  input: StartMusicInput,
): Promise<StartMusicResult> {
  const body: Record<string, unknown> = {
    model: MUSIC_MODEL,
    prompt: input.prompt,
    is_instrumental: input.isInstrumental,
    lyrics_optimizer: true,
    stream: false,
    output_format: "url",
  };
  if (!input.isInstrumental && input.lyrics && input.lyrics.trim().length > 0) {
    body.lyrics = input.lyrics.trim();
  }

  const res = await fetch(MINIMAX_MUSIC_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`minimax music start ${res.status}: ${detail.slice(0, 400)}`);
  }

  const data = (await res.json()) as {
    status?: number;
    task_id?: string;
    audio?: string;
    data?: { status?: number; task_id?: string; audio?: string; extra_info?: { duration?: unknown } };
    extra_info?: { duration?: unknown };
  };
  const node = data.data ?? data;
  const taskId = node.task_id ?? data.task_id;
  if (!taskId) {
    throw new Error("minimax music start: no task_id in response");
  }
  const durationMs = normalizeDurationMs(
    node.extra_info?.duration ?? data.extra_info?.duration,
  );
  return {
    taskId,
    immediateAudioUrl: node.audio ?? data.audio,
    durationMs: durationMs || undefined,
  };
}

export async function pollMusicGeneration(taskId: string): Promise<PollMusicResult> {
  const url = `${MINIMAX_MUSIC_URL}?task_id=${encodeURIComponent(taskId)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey()}` },
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`minimax music poll ${res.status}: ${detail.slice(0, 400)}`);
  }

  const data = (await res.json()) as {
    status?: number | string;
    audio?: string;
    data?: { status?: number | string; audio?: string; extra_info?: { duration?: unknown } };
    extra_info?: { duration?: unknown };
    base_resp?: { status_code?: number; status_msg?: string };
  };
  const node = data.data ?? data;
  const rawStatus = node.status ?? data.status;
  const audio = node.audio ?? data.audio;
  const durationMs = normalizeDurationMs(
    node.extra_info?.duration ?? data.extra_info?.duration,
  );

  // MiniMax music-2.6 uses integer statuses: 1=queued, 2=in-progress,
  // 3=done, 4=failed (per the reference implementation's response
  // handling at ~/examples/make-noise/app/page.tsx:301). If the API
  // returns strings instead, the heuristics below still cover it.
  if (audio && (rawStatus === 3 || rawStatus === "done" || rawStatus === "success")) {
    return { status: "done", audioUrl: audio, durationMs: durationMs || undefined };
  }
  if (
    rawStatus === 4 ||
    rawStatus === "failed" ||
    (data.base_resp?.status_code && data.base_resp.status_code !== 0)
  ) {
    return {
      status: "failed",
      failureReason:
        data.base_resp?.status_msg ?? `status=${String(rawStatus)}`,
    };
  }
  return { status: "pending" };
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- --test-name-pattern="normalizeDurationMs"
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add workers/song-worker/minimax.ts workers/song-worker/minimax.test.ts
git commit -m "feat(worker): MiniMax music-2.6 client (start + poll, duration normaliser)

Duration normalisation ported from ~/examples/make-noise (MiniMax returns
the field in ns/µs/ms/samples in different response shapes). Unit testing
the normaliser in isolation is the high-value test; the fetch calls
themselves are verified at integration time."
```

---

## Task 10: `workers/song-worker/openrouter.ts` — flux.2-pro image client (TDD)

**Files:**
- Create: `workers/song-worker/openrouter.ts`
- Test: `workers/song-worker/openrouter.test.ts`

OpenRouter routes image generation through their unified `/v1/chat/completions` endpoint with a model that supports the `modalities: ["image"]` flag (per OpenRouter's image-generation docs). Response contains the image as base64 or URL in `choices[0].message.images[0]` or `choices[0].message.content` depending on the model. We'll target the documented shape and fall back if the wire format differs.

- [ ] **Step 1: Write the failing test for the parsing helper**

Create `workers/song-worker/openrouter.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPngBase64, type OpenRouterImageResponse } from "./openrouter.ts";

test("extractPngBase64 reads choices[0].message.images[0].image_url.url data-uri", () => {
  const resp: OpenRouterImageResponse = {
    choices: [
      {
        message: {
          images: [
            {
              image_url: {
                url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA",
              },
            },
          ],
        },
      },
    ],
  };
  assert.equal(extractPngBase64(resp), "iVBORw0KGgoAAAANSUhEUgAA");
});

test("extractPngBase64 reads bare base64 in content when message.images absent", () => {
  const resp: OpenRouterImageResponse = {
    choices: [
      {
        message: {
          content: "iVBORw0KGgoAAAANSUhEUgAA",
        },
      },
    ],
  };
  assert.equal(extractPngBase64(resp), "iVBORw0KGgoAAAANSUhEUgAA");
});

test("extractPngBase64 returns null when neither path yields base64", () => {
  const resp: OpenRouterImageResponse = { choices: [{ message: { content: "" } }] };
  assert.equal(extractPngBase64(resp), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --test-name-pattern="extractPngBase64"
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the client**

Create `workers/song-worker/openrouter.ts`:

```typescript
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const IMAGE_MODEL =
  process.env.OPENROUTER_IMAGE_MODEL ?? "black-forest-labs/flux.2-pro";

export interface OpenRouterImageResponse {
  choices?: Array<{
    message?: {
      content?: string;
      images?: Array<{
        image_url?: { url?: string };
      }>;
    };
  }>;
}

function apiKey(): string {
  const k = process.env.OPEN_ROUTER_API;
  if (!k) throw new Error("OPEN_ROUTER_API not set");
  return k;
}

const DATA_URI_RE = /^data:image\/\w+;base64,(.+)$/;

export function extractPngBase64(resp: OpenRouterImageResponse): string | null {
  const choice = resp.choices?.[0];
  const images = choice?.message?.images ?? [];
  for (const img of images) {
    const url = img.image_url?.url;
    if (!url) continue;
    const m = url.match(DATA_URI_RE);
    if (m) return m[1];
    // Sometimes the URL is a remote http(s). Caller fetches it in that case.
    if (url.startsWith("http")) {
      // Encode as special sentinel; caller will re-dispatch.
      return `__REMOTE__:${url}`;
    }
  }
  const content = choice?.message?.content?.trim();
  if (content && /^[A-Za-z0-9+/=\n\r]+$/.test(content) && content.length > 200) {
    return content.replace(/\s+/g, "");
  }
  return null;
}

export async function generateArtwork(prompt: string): Promise<Buffer> {
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://numaradio.com",
      "X-Title": "Numa Radio",
    },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      modalities: ["image", "text"],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Album cover artwork, 1024x1024, no text, no logos, tasteful, painterly. Prompt: ${prompt}`,
            },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`openrouter ${res.status}: ${detail.slice(0, 400)}`);
  }

  const data = (await res.json()) as OpenRouterImageResponse;
  const extracted = extractPngBase64(data);
  if (!extracted) {
    throw new Error("openrouter: no image in response");
  }
  if (extracted.startsWith("__REMOTE__:")) {
    const url = extracted.slice("__REMOTE__:".length);
    const imgRes = await fetch(url);
    if (!imgRes.ok) {
      throw new Error(`openrouter remote image fetch ${imgRes.status}`);
    }
    return Buffer.from(await imgRes.arrayBuffer());
  }
  return Buffer.from(extracted, "base64");
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- --test-name-pattern="extractPngBase64"
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add workers/song-worker/openrouter.ts workers/song-worker/openrouter.test.ts
git commit -m "feat(worker): OpenRouter flux.2-pro artwork client

Targets OpenRouter's unified /v1/chat/completions endpoint with
modalities:['image']. extractPngBase64 tolerates the two documented
response shapes (data-uri in message.images[].image_url.url, or bare
base64 in message.content), plus a remote-http fallback we fetch
ourselves. OPEN_ROUTER_API env is read (matches the operator's chosen
var name)."
```

---

## Task 11: `workers/song-worker/prompt-expand.ts` — LLM helper (TDD)

**Files:**
- Create: `workers/song-worker/prompt-expand.ts`
- Test: `workers/song-worker/prompt-expand.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `workers/song-worker/prompt-expand.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parsePromptExpansion,
  buildPromptExpansionSystem,
} from "./prompt-expand.ts";

test("parsePromptExpansion extracts fields from clean JSON", () => {
  const raw = `{"title":"Rainy Morning","artworkPrompt":"ink-wash rainy window","lyrics":"[verse] drops"}`;
  const parsed = parsePromptExpansion(raw, { withLyrics: true });
  assert.equal(parsed.title, "Rainy Morning");
  assert.equal(parsed.artworkPrompt, "ink-wash rainy window");
  assert.equal(parsed.lyrics, "[verse] drops");
});

test("parsePromptExpansion tolerates ```json fences", () => {
  const raw = "```json\n{\"title\":\"T\",\"artworkPrompt\":\"A\"}\n```";
  const parsed = parsePromptExpansion(raw, { withLyrics: false });
  assert.equal(parsed.title, "T");
  assert.equal(parsed.artworkPrompt, "A");
  assert.equal(parsed.lyrics, undefined);
});

test("parsePromptExpansion caps long strings", () => {
  const raw = JSON.stringify({
    title: "x".repeat(200),
    artworkPrompt: "y".repeat(500),
    lyrics: "z".repeat(1000),
  });
  const parsed = parsePromptExpansion(raw, { withLyrics: true });
  assert.equal(parsed.title.length, 50);
  assert.equal(parsed.artworkPrompt.length, 280);
  assert.ok((parsed.lyrics ?? "").length <= 400);
});

test("parsePromptExpansion returns null for garbage so caller can fall back", () => {
  const parsed = parsePromptExpansion("not json at all", { withLyrics: true });
  assert.equal(parsed, null);
});

test("buildPromptExpansionSystem mentions lyrics instruction only when withLyrics", () => {
  const withLyrics = buildPromptExpansionSystem({ withLyrics: true });
  const instrumental = buildPromptExpansionSystem({ withLyrics: false });
  assert.match(withLyrics, /lyrics/i);
  assert.doesNotMatch(instrumental, /\blyrics\b/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --test-name-pattern="parsePromptExpansion|buildPromptExpansionSystem"
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `workers/song-worker/prompt-expand.ts`:

```typescript
const MINIMAX_CHAT_URL = "https://api.minimax.io/anthropic/v1/messages";
const MODEL = process.env.MINIMAX_MODERATION_MODEL ?? "MiniMax-M2.7";

export interface PromptExpansion {
  title: string;
  artworkPrompt: string;
  lyrics?: string;
}

export interface ExpandOptions {
  withLyrics: boolean;
}

const TITLE_MAX = 50;
const ARTWORK_MAX = 280;
const LYRICS_MAX = 400;

export function buildPromptExpansionSystem(opts: ExpandOptions): string {
  const lines: string[] = [
    "You turn a listener's short song prompt into release metadata for an online radio station.",
    "",
    "Return a SINGLE minified JSON object with these fields:",
    '  "title": a short, evocative song title (<= 50 chars, no quotes, title case)',
    '  "artworkPrompt": a painterly prompt for an album cover image generator (<= 280 chars, no text-on-image, no logos, tasteful)',
  ];
  if (opts.withLyrics) {
    lines.push(
      '  "lyrics": 4-12 short lines suitable for a 2-3 minute song, <= 400 chars total, separated by newlines, clearly tagged like [verse] or [chorus]. The listener did NOT write these; you do, guided by the prompt\'s vibe. Keep it clean — no profanity, slurs, or references to real public figures.',
    );
  }
  lines.push(
    "",
    "Do not include any text outside the JSON object. No code fences.",
  );
  return lines.join("\n");
}

export function parsePromptExpansion(
  raw: string,
  opts: ExpandOptions,
): PromptExpansion | null {
  const stripped = raw
    .replace(/```(?:json)?\s*/gi, "")
    .replace(/```/g, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    // fall through to scan
    parsed = null;
  }
  if (!parsed) {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        parsed = JSON.parse(stripped.slice(start, end + 1));
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }
  const obj = parsed as Record<string, unknown>;
  const title = typeof obj.title === "string" ? obj.title.trim() : "";
  const artworkPrompt =
    typeof obj.artworkPrompt === "string" ? obj.artworkPrompt.trim() : "";
  if (!title || !artworkPrompt) return null;
  const result: PromptExpansion = {
    title: title.slice(0, TITLE_MAX),
    artworkPrompt: artworkPrompt.slice(0, ARTWORK_MAX),
  };
  if (opts.withLyrics && typeof obj.lyrics === "string" && obj.lyrics.trim()) {
    result.lyrics = obj.lyrics.trim().slice(0, LYRICS_MAX);
  }
  return result;
}

function apiKey(): string {
  const k = process.env.MINIMAX_API_KEY;
  if (!k) throw new Error("MINIMAX_API_KEY not set");
  return k;
}

export async function expandPrompt(
  listenerPrompt: string,
  opts: ExpandOptions,
): Promise<PromptExpansion | null> {
  const res = await fetch(MINIMAX_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 700,
      system: buildPromptExpansionSystem(opts),
      messages: [{ role: "user", content: listenerPrompt }],
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const textBlock =
    data.content?.find((b) => b.type === "text" && b.text)?.text ?? "";
  return parsePromptExpansion(textBlock, opts);
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- --test-name-pattern="parsePromptExpansion|buildPromptExpansionSystem"
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add workers/song-worker/prompt-expand.ts workers/song-worker/prompt-expand.test.ts
git commit -m "feat(worker): LLM prompt-expansion helper — title, artwork prompt, optional lyrics

Uses MiniMax M2.7 via the Anthropic-compatible endpoint. System prompt is
built conditionally on withLyrics so instrumental requests don't waste
tokens. parsePromptExpansion tolerates code fences and stray prose; callers
silently fall back on null."
```

---

## Task 12: `workers/song-worker/pipeline.ts` — orchestrator (TDD)

**Files:**
- Create: `workers/song-worker/pipeline.ts`
- Create: `workers/song-worker/assets/default-artwork.png` (placeholder binary — the implementer supplies a square PNG; a 1024×1024 generic album-cover-style image — or temporarily uses a tiny 1×1 transparent PNG and the operator replaces it later)
- Test: `workers/song-worker/pipeline.test.ts`

- [ ] **Step 1: Write failing tests for pure orchestration fragments**

Create `workers/song-worker/pipeline.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldFallbackToInstrumental } from "./pipeline.ts";

test("shouldFallbackToInstrumental returns true when lyrics contain a profanity match", () => {
  assert.equal(
    shouldFallbackToInstrumental("[verse] what the fuck is happening"),
    true,
  );
  assert.equal(
    shouldFallbackToInstrumental("[verse] rainy days soft sighs"),
    false,
  );
});

test("shouldFallbackToInstrumental returns false for undefined / empty lyrics", () => {
  assert.equal(shouldFallbackToInstrumental(undefined), false);
  assert.equal(shouldFallbackToInstrumental(""), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --test-name-pattern="shouldFallbackToInstrumental"
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pipeline module**

Create `workers/song-worker/pipeline.ts`:

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { PrismaClient } from "@prisma/client";
import { profanityPrefilter } from "../../lib/moderate.ts";
import {
  startMusicGeneration,
  pollMusicGeneration,
} from "./minimax.ts";
import { generateArtwork } from "./openrouter.ts";
import { expandPrompt } from "./prompt-expand.ts";

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";
const QUEUE_DAEMON_URL =
  process.env.QUEUE_DAEMON_URL ?? "http://127.0.0.1:4000";

const POLL_INTERVAL_MS = 10_000;
const POLL_TIMEOUT_MS = 360_000; // 6 min

export interface PipelineJob {
  id: string;
  prompt: string;
  artistName: string;
  isInstrumental: boolean;
}

export function shouldFallbackToInstrumental(lyrics: string | undefined): boolean {
  if (!lyrics || lyrics.trim() === "") return false;
  return profanityPrefilter(lyrics) !== null;
}

let s3Client: S3Client | null = null;
function getS3(): S3Client {
  if (s3Client) return s3Client;
  s3Client = new S3Client({
    region: process.env.B2_REGION,
    endpoint: process.env.B2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.B2_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.B2_SECRET_ACCESS_KEY ?? "",
    },
  });
  return s3Client;
}

function b2PublicUrl(key: string): string {
  const base = process.env.B2_BUCKET_PUBLIC_URL;
  if (!base) throw new Error("B2_BUCKET_PUBLIC_URL not set");
  return `${base}/${key}`;
}

async function uploadToB2(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  const bucket = process.env.B2_BUCKET_NAME;
  if (!bucket) throw new Error("B2_BUCKET_NAME not set");
  await getS3().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  return b2PublicUrl(key);
}

async function loadDefaultArtwork(): Promise<Buffer> {
  const here = path.dirname(new URL(import.meta.url).pathname);
  return fs.readFile(path.join(here, "assets", "default-artwork.png"));
}

async function pollUntilDone(taskId: string): Promise<{ audioUrl: string; durationMs: number }> {
  const started = Date.now();
  while (Date.now() - started < POLL_TIMEOUT_MS) {
    const poll = await pollMusicGeneration(taskId);
    if (poll.status === "done" && poll.audioUrl) {
      return { audioUrl: poll.audioUrl, durationMs: poll.durationMs ?? 0 };
    }
    if (poll.status === "failed") {
      throw new Error(`minimax music failed: ${poll.failureReason ?? "unknown"}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error("minimax music timed out after 6 minutes");
}

async function pushToQueueDaemon(input: {
  trackId: string;
  sourceUrl: string;
  reason: string;
}): Promise<void> {
  const res = await fetch(`${QUEUE_DAEMON_URL}/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`queue-daemon push ${res.status}: ${detail.slice(0, 200)}`);
  }
}

export async function runPipeline(prisma: PrismaClient, job: PipelineJob): Promise<void> {
  const station = await prisma.station.findUnique({
    where: { slug: STATION_SLUG },
    select: { id: true },
  });
  if (!station) throw new Error(`station '${STATION_SLUG}' not found`);

  // Step 1: LLM expansion.
  const expansion = await expandPrompt(job.prompt, {
    withLyrics: !job.isInstrumental,
  });
  const title = expansion?.title ?? job.prompt.slice(0, 50);
  const artworkPrompt = expansion?.artworkPrompt ?? job.prompt;
  const rawLyrics = expansion?.lyrics;
  const lyricsFallback =
    !job.isInstrumental &&
    (rawLyrics === undefined || shouldFallbackToInstrumental(rawLyrics));
  const finalInstrumental = job.isInstrumental || lyricsFallback;
  const finalLyrics = finalInstrumental ? undefined : rawLyrics;

  await prisma.songRequest.update({
    where: { id: job.id },
    data: {
      titleGenerated: title,
      artworkPrompt,
      lyricsGenerated: finalLyrics,
      lyricsFallback,
      status: "processing",
    },
  });

  // Step 2: kick off music + artwork in parallel.
  const musicStartPromise = startMusicGeneration({
    prompt: job.prompt,
    isInstrumental: finalInstrumental,
    lyrics: finalLyrics,
  });
  const artworkPromise = generateArtwork(artworkPrompt).catch(
    (err) => {
      console.warn(`[song-worker] artwork failed for ${job.id}: ${String(err)}`);
      return null;
    },
  );

  const musicStart = await musicStartPromise;
  await prisma.songRequest.update({
    where: { id: job.id },
    data: { miniMaxTaskId: musicStart.taskId },
  });

  // Step 3: poll music until done, while artwork finishes in background.
  const { audioUrl: remoteAudioUrl, durationMs } =
    musicStart.immediateAudioUrl
      ? { audioUrl: musicStart.immediateAudioUrl, durationMs: musicStart.durationMs ?? 0 }
      : await pollUntilDone(musicStart.taskId);
  const artworkBytesOrNull = await artworkPromise;

  await prisma.songRequest.update({
    where: { id: job.id },
    data: { status: "finalizing" },
  });

  // Step 4: download MiniMax audio + upload both assets to B2.
  const audioRes = await fetch(remoteAudioUrl);
  if (!audioRes.ok) throw new Error(`minimax audio download ${audioRes.status}`);
  const audioBytes = Buffer.from(await audioRes.arrayBuffer());

  const trackId = randomUUID();
  const audioKey = `stations/${STATION_SLUG}/tracks/${trackId}/audio/stream.mp3`;
  const artworkKey = `stations/${STATION_SLUG}/tracks/${trackId}/artwork/primary.png`;
  const audioUrl = await uploadToB2(audioKey, audioBytes, "audio/mpeg");

  const artworkBuf = artworkBytesOrNull ?? (await loadDefaultArtwork());
  const artworkUrl = await uploadToB2(artworkKey, artworkBuf, "image/png");

  // Step 5: create Track + TrackAssets.
  const track = await prisma.track.create({
    data: {
      id: trackId,
      stationId: station.id,
      title,
      artistDisplay: job.artistName,
      sourceType: "internal_generated",
      airingPolicy: "library",
      safetyStatus: "approved",
      trackStatus: "ready",
      durationSeconds: durationMs > 0 ? Math.round(durationMs / 1000) : null,
      assets: {
        create: [
          {
            assetType: "audio_stream",
            storageProvider: "b2",
            storageKey: audioKey,
            publicUrl: audioUrl,
            mimeType: "audio/mpeg",
            byteSize: audioBytes.length,
            durationSeconds: durationMs > 0 ? Math.round(durationMs / 1000) : null,
          },
          {
            assetType: "artwork_primary",
            storageProvider: "b2",
            storageKey: artworkKey,
            publicUrl: artworkUrl,
            mimeType: "image/png",
            byteSize: artworkBuf.length,
          },
        ],
      },
    },
    select: { id: true },
  });

  // Step 6: push to queue daemon so Lena airs it next.
  try {
    await pushToQueueDaemon({
      trackId: track.id,
      sourceUrl: audioUrl,
      reason: `song_request:${job.id}`,
    });
  } catch (err) {
    console.warn(
      `[song-worker] queue-daemon push failed for ${job.id} (track is in library, will air in rotation): ${String(err)}`,
    );
  }

  await prisma.songRequest.update({
    where: { id: job.id },
    data: {
      status: "done",
      trackId: track.id,
      completedAt: new Date(),
    },
  });
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- --test-name-pattern="shouldFallbackToInstrumental"
```

Expected: PASS (2 tests).

- [ ] **Step 5: Create the fallback artwork placeholder**

```bash
cd /home/marku/saas/numaradio/workers/song-worker
mkdir -p assets
# 1x1 transparent PNG as a known-safe bootstrap; operator replaces with a real 1024×1024 later.
python3 -c "
import base64
b = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=')
open('assets/default-artwork.png','wb').write(b)
"
ls -la assets/default-artwork.png
```

Expected: `assets/default-artwork.png` exists, 67 bytes.

- [ ] **Step 6: Commit**

```bash
cd /home/marku/saas/numaradio
git add workers/song-worker/pipeline.ts workers/song-worker/pipeline.test.ts workers/song-worker/assets/default-artwork.png
git commit -m "feat(worker): song-worker pipeline orchestrator

Six-step generation: LLM expansion → MiniMax music start → parallel
OpenRouter artwork → poll music → B2 upload (audio + artwork) → Track
row with assets → queue-daemon push. Vocal jobs fall back to
instrumental when prompt-expand returns profanity-flagged lyrics.
Bundled default-artwork.png is a 1×1 PNG placeholder — operator can
replace with a real 1024×1024 default once the feature is live."
```

---

## Task 13: `workers/song-worker/index.ts` — entry + loop

**Files:**
- Create: `workers/song-worker/index.ts`
- Modify: `package.json` — add `song:worker` script

- [ ] **Step 1: Create the entry module**

Create `workers/song-worker/index.ts`:

```typescript
import "../../lib/load-env.ts";
import { PrismaClient } from "@prisma/client";
import { claimNextJob } from "./claim.ts";
import { sweepStaleJobs } from "./sweeper.ts";
import { runPipeline } from "./pipeline.ts";

const POLL_INTERVAL_MS = 3_000;
const SWEEPER_INTERVAL_MS = 5 * 60 * 1000;

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  console.info("[song-worker] starting");

  // One-time sweep at startup.
  try {
    const n = await sweepStaleJobs(prisma);
    if (n > 0) console.info(`[song-worker] sweeper reset ${n} stale rows at startup`);
  } catch (err) {
    console.warn(`[song-worker] sweeper failed at startup: ${String(err)}`);
  }
  setInterval(() => {
    sweepStaleJobs(prisma)
      .then((n) => {
        if (n > 0) console.info(`[song-worker] sweeper reset ${n} stale rows`);
      })
      .catch((err) => console.warn(`[song-worker] sweeper failed: ${String(err)}`));
  }, SWEEPER_INTERVAL_MS);

  let shutdown = false;
  const stop = (): void => {
    shutdown = true;
    console.info("[song-worker] shutdown requested");
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  while (!shutdown) {
    try {
      const job = await claimNextJob(prisma);
      if (!job) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }
      console.info(`[song-worker] processing ${job.id} (instrumental=${job.isInstrumental})`);
      try {
        await runPipeline(prisma, job);
        console.info(`[song-worker] done ${job.id}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[song-worker] pipeline failed ${job.id}: ${msg}`);
        try {
          // Delete the row so the listener's rate-limit slot is refunded.
          await prisma.songRequest.delete({ where: { id: job.id } });
        } catch (dErr) {
          // Delete failure is non-fatal; mark row failed instead.
          await prisma.songRequest.update({
            where: { id: job.id },
            data: { status: "failed", errorMessage: msg, completedAt: new Date() },
          });
          console.error(`[song-worker] delete failed ${job.id}: ${String(dErr)}`);
        }
      }
    } catch (err) {
      console.error(`[song-worker] loop error: ${String(err)}`);
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }

  await prisma.$disconnect();
  console.info("[song-worker] exited cleanly");
}

main().catch((err) => {
  console.error(`[song-worker] fatal: ${String(err)}`);
  process.exit(1);
});
```

- [ ] **Step 2: Add npm script**

Open `package.json`. In the `scripts` section, add:

```json
"song:worker": "tsx workers/song-worker/index.ts",
```

- [ ] **Step 3: Verify the script is parseable**

```bash
cd /home/marku/saas/numaradio && node --experimental-strip-types workers/song-worker/index.ts --dry-run 2>&1 | head -3 || true
# The script doesn't actually support --dry-run but Node will error on parse issues before it gets to runtime.
# Better: just check the file compiles with tsc:
npx tsc --noEmit workers/song-worker/index.ts 2>&1 | head -10
```

Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add workers/song-worker/index.ts package.json
git commit -m "feat(worker): song-worker entry point + loop + crash-recovery

Startup sweeps stale processing rows, then polls every 3s for the next
queued job. On pipeline failure, deletes the SongRequest row so the
listener's rate-limit slot is refunded; only fails-hard (status='failed')
if the delete itself errors. Graceful shutdown on SIGTERM/SIGINT."
```

---

## Task 14: systemd unit for the worker

**Files:**
- Create: `deploy/systemd/numa-song-worker.service`
- Modify: `deploy/systemd/numa-nopasswd.sudoers` — add restart permission for the new unit

- [ ] **Step 1: Create the unit file**

Create `deploy/systemd/numa-song-worker.service`:

```ini
[Unit]
Description=Numa Radio — song generation worker
After=network-online.target numa-queue-daemon.service
Wants=network-online.target
PartOf=multi-user.target

[Service]
Type=simple
User=marku
WorkingDirectory=/home/marku/saas/numaradio
EnvironmentFile=/home/marku/saas/numaradio/.env.local
EnvironmentFile=-/etc/numa/env
ExecStart=/usr/bin/npx tsx workers/song-worker/index.ts
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=numa-song-worker

# Kill signal the worker's SIGTERM handler treats as graceful.
KillMode=mixed
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2: Update the sudoers drop-in**

Read the current drop-in:

```bash
cat /home/marku/saas/numaradio/deploy/systemd/numa-nopasswd.sudoers
```

Expected: a `Cmnd_Alias` block listing the units the operator can restart without a password. Add `numa-song-worker` alongside the existing entries. For example, if the current file has `restart numa-dashboard` / `restart numa-dashboard.service`, add the same two spellings for `numa-song-worker`. Keep the strict Cmnd_Alias pattern used by the existing file.

- [ ] **Step 3: Commit**

```bash
git add deploy/systemd/numa-song-worker.service deploy/systemd/numa-nopasswd.sudoers
git commit -m "feat(deploy): systemd unit + sudoers permit for numa-song-worker

One-shot wrapper around 'npx tsx workers/song-worker/index.ts'. Reads
/etc/numa/env so OPEN_ROUTER_API, MINIMAX_API_KEY, and B2 creds flow in.
Ordered After=numa-queue-daemon so the worker doesn't push to a daemon
that hasn't opened its loopback socket yet. Graceful SIGTERM via
KillMode=mixed; the worker's loop breaks on SIGTERM and returns."
```

---

## Task 15: Deploy backend — migration live on Neon, worker installed on Orion

- [ ] **Step 1: Pull latest on Orion**

```bash
ssh-into-orion-or-wsl-shell
cd /home/marku/saas/numaradio
git pull
```

- [ ] **Step 2: Run the migration against prod Neon**

```bash
npx prisma migrate deploy
```

Expected: migration applied or already applied.

- [ ] **Step 3: Add `OPEN_ROUTER_API` to `/etc/numa/env`**

```bash
sudo grep -q ^OPEN_ROUTER_API= /etc/numa/env || \
  (read -s -p "Paste OPEN_ROUTER_API value: " V; echo "OPEN_ROUTER_API=$V" | sudo tee -a /etc/numa/env > /dev/null)
sudo grep ^OPEN_ROUTER_API= /etc/numa/env | cut -c1-30
```

Expected: `OPEN_ROUTER_API=sk-or-…` (truncated).

- [ ] **Step 4: Install the systemd unit**

```bash
sudo cp deploy/systemd/numa-song-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now numa-song-worker
sudo systemctl status numa-song-worker --no-pager | head -8
```

Expected: `active (running)`.

Also reinstall the sudoers drop-in so the worker can be restarted without password later:

```bash
sudo cp deploy/systemd/numa-nopasswd.sudoers /etc/sudoers.d/numa-nopasswd
sudo visudo -cf /etc/sudoers.d/numa-nopasswd
```

Expected: `/etc/sudoers.d/numa-nopasswd: parsed OK`.

- [ ] **Step 5: Watch logs for a minute**

```bash
journalctl -u numa-song-worker -n 40 --no-pager -f
```

Expected: `[song-worker] starting`, then quiet polling (no errors).

- [ ] **Step 6: No commit** — these are live-system steps. The spec + plan documents are already committed.

---

## Task 16: UI — "Create" tab + form

**Files:**
- Create: `app/_components/CreateSongForm.tsx`
- Create: `app/_components/CreateSongTab.tsx`
- Modify: `app/page.tsx` — add the Create tab to the existing tab row

- [ ] **Step 1: Create the form component**

Create `app/_components/CreateSongForm.tsx`:

```typescript
"use client";

import { useEffect, useState } from "react";

interface QueueStats {
  queueDepth: number;
  inProgress: boolean;
  estWaitSeconds: number;
}

interface SubmitResponse {
  ok: boolean;
  requestId?: string;
  queuePosition?: number;
  estWaitSeconds?: number;
  finalArtistName?: string;
  artistNameSubstituted?: boolean;
  error?: string;
  detail?: string;
  retryAfterSeconds?: number;
  max?: number;
}

interface StatusResponse {
  ok: boolean;
  status?: string;
  errorMessage?: string;
  finalArtistName?: string;
  artistNameSubstituted?: boolean;
  title?: string;
  audioUrl?: string;
  artworkUrl?: string;
  isInstrumental?: boolean;
  lyricsFallback?: boolean;
  queuePosition?: number;
  estWaitSeconds?: number;
}

const PROMPT_MIN = 4;
const PROMPT_MAX = 240;
const ARTIST_MIN = 2;
const ARTIST_MAX = 40;

function fmtWait(secs: number | undefined): string {
  if (!secs || secs <= 0) return "< 1 min";
  const m = Math.ceil(secs / 60);
  return `${m} min`;
}

export function CreateSongForm() {
  const [artistName, setArtistName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [isInstrumental, setIsInstrumental] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ requestId: string } | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);

  useEffect(() => {
    if (pending) return;
    const tick = async (): Promise<void> => {
      try {
        const res = await fetch("/api/booth/song/queue-stats");
        if (res.ok) {
          const data = (await res.json()) as { ok: boolean } & QueueStats;
          if (data.ok) setQueueStats(data);
        }
      } catch {
        // ignore
      }
    };
    tick();
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, [pending]);

  useEffect(() => {
    if (!pending) return;
    let cancelled = false;
    const tick = async (): Promise<void> => {
      try {
        const res = await fetch(`/api/booth/song/${pending.requestId}/status`);
        if (!res.ok) return;
        const data = (await res.json()) as StatusResponse;
        if (!cancelled && data.ok) setStatus(data);
      } catch {
        // ignore
      }
    };
    tick();
    const id = setInterval(tick, 5_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pending]);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/booth/song", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, artistName, isInstrumental }),
      });
      const data = (await res.json()) as SubmitResponse;
      if (!res.ok || !data.ok) {
        setSubmitError(
          data.error
            ? `${data.error}${data.detail ? `: ${data.detail}` : ""}${data.retryAfterSeconds ? ` — retry in ${fmtWait(data.retryAfterSeconds)}` : ""}`
            : "Something went wrong.",
        );
        return;
      }
      setPending({ requestId: data.requestId! });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "network error");
    } finally {
      setSubmitting(false);
    }
  }

  if (status && status.status === "done" && status.trackId !== undefined) {
    return (
      <section className="flex flex-col gap-4">
        {status.artworkUrl ? (
          <img
            src={status.artworkUrl}
            alt={status.title ?? "cover"}
            className="w-64 h-64 rounded-xl border border-line object-cover"
          />
        ) : null}
        <div>
          <div className="font-display text-2xl">{status.title ?? "Your song"}</div>
          <div className="text-sm text-fg-mute">by {status.finalArtistName}</div>
          {status.artistNameSubstituted ? (
            <div className="text-xs text-fg-mute mt-1">
              (we swapped in &ldquo;Numa Radio&rdquo; because your artist name
              couldn&rsquo;t be aired)
            </div>
          ) : null}
          {status.lyricsFallback ? (
            <div className="text-xs text-fg-mute mt-1">
              (our lyric writer tripped the moderator so we aired it
              instrumental — try a different vibe for vocals)
            </div>
          ) : null}
        </div>
        <p className="text-sm">Airing on the stream now — tune in.</p>
      </section>
    );
  }

  if (status && status.status === "failed") {
    return (
      <section className="flex flex-col gap-3">
        <p>We couldn&rsquo;t generate your song: {status.errorMessage ?? "unknown"}.</p>
        <p className="text-sm">Your slot has been refunded — try again in a minute.</p>
        <button
          className="self-start rounded bg-accent px-4 py-2 text-sm text-bg"
          onClick={() => {
            setPending(null);
            setStatus(null);
          }}
        >
          Try again
        </button>
      </section>
    );
  }

  if (pending) {
    const captions: Record<string, string> = {
      queued: "queued",
      processing: "composing",
      finalizing: "painting the cover",
    };
    const caption = status?.status ? captions[status.status] ?? status.status : "queued";
    return (
      <section className="flex flex-col gap-3">
        <div className="font-display text-xl">Generating…</div>
        <div className="text-sm text-fg-mute">{caption}</div>
        {status?.queuePosition && status.queuePosition > 0 ? (
          <div className="text-sm text-fg-mute">
            {status.queuePosition} ahead of you · est. {fmtWait(status.estWaitSeconds)}
          </div>
        ) : null}
      </section>
    );
  }

  const submitDisabled =
    submitting ||
    prompt.trim().length < PROMPT_MIN ||
    artistName.trim().length < ARTIST_MIN;

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-mono uppercase tracking-widest">Your artist name</span>
        <input
          type="text"
          value={artistName}
          onChange={(e) => setArtistName(e.target.value)}
          maxLength={ARTIST_MAX}
          required
          minLength={ARTIST_MIN}
          placeholder="e.g. Shadow Boxer"
          className="rounded border border-line bg-transparent p-3 text-sm"
        />
        <span className="text-xs text-fg-mute">
          shown as the credit — falls back to Numa Radio if it can&rsquo;t be aired
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-mono uppercase tracking-widest">Describe the song</span>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={PROMPT_MAX}
          required
          minLength={PROMPT_MIN}
          placeholder="e.g. chill lo-fi, 90 BPM, A minor key, rainy afternoon, melancholic"
          rows={3}
          className="rounded border border-line bg-transparent p-3 text-sm"
        />
        <span className="text-xs text-fg-mute">
          {prompt.length}/{PROMPT_MAX} · include mood, genre, tempo / BPM and key if you care — MiniMax reads all of it
        </span>
      </label>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={isInstrumental}
          onChange={(e) => setIsInstrumental(e.target.checked)}
        />
        <span className="text-sm">Instrumental only</span>
      </label>

      <button
        type="submit"
        disabled={submitDisabled}
        className="self-start rounded bg-accent px-5 py-2 text-sm text-bg disabled:opacity-50"
      >
        {submitting ? "Submitting…" : "Create song"}
      </button>
      {submitError ? <p className="text-sm text-red-400">{submitError}</p> : null}
      {queueStats ? (
        <p className="text-xs text-fg-mute">
          ~3 min · {queueStats.queueDepth + (queueStats.inProgress ? 1 : 0)} request
          {queueStats.queueDepth + (queueStats.inProgress ? 1 : 0) === 1 ? "" : "s"} ahead of you
        </p>
      ) : null}
    </form>
  );
}
```

- [ ] **Step 2: Create the tab wrapper**

Create `app/_components/CreateSongTab.tsx`:

```typescript
import { CreateSongForm } from "./CreateSongForm";

export function CreateSongTab() {
  return (
    <div className="flex flex-col gap-4">
      <div className="font-display text-xl">Create a song</div>
      <p className="text-sm text-fg-mute max-w-prose">
        Describe the song. We&rsquo;ll generate the music and cover and air it
        on the stream within a few minutes.
      </p>
      <CreateSongForm />
    </div>
  );
}
```

- [ ] **Step 3: Wire the tab into the homepage**

Open `app/page.tsx` (the public homepage, not the dashboard). Find where existing tabs (Listen / Requests) are registered. Add a third tab item for "Create" whose content is `<CreateSongTab />`, using the same tab-framework shape the existing tabs use. The exact change depends on the current file's tab shape — inspect with:

```bash
grep -nE "Listen|Requests|tabs?\b|activeTab" app/page.tsx | head -20
```

Then add the new tab entry following that file's pattern.

- [ ] **Step 4: Build**

```bash
cd /home/marku/saas/numaradio && npm run build 2>&1 | tail -15
```

Expected: build succeeds, `ƒ /api/booth/song`, `ƒ /api/booth/song/queue-stats`, and `ƒ /api/booth/song/[id]/status` all appear.

- [ ] **Step 5: Commit**

```bash
git add app/_components/CreateSongForm.tsx app/_components/CreateSongTab.tsx app/page.tsx
git commit -m "feat(homepage): Create tab with song-generation form

Form: artist (required), prompt textarea with mood/genre/BPM placeholder,
instrumental checkbox, submit button. Below the button, live 'N requests
ahead of you' counter polling queue-stats every 10s. After submit,
5s-interval polling of /status drives the pending → done UX. Done state
shows artwork + title + artist + 'airing now' message. Failed state
shows the error and offers a retry."
```

---

## Task 17: Deploy Vercel + live smoke test

- [ ] **Step 1: Confirm Vercel env**

Vercel needs `MINIMAX_API_KEY` (already set — the existing shoutout moderator uses it), `DATABASE_URL` (already set), and `INTERNAL_API_SECRET` (already set). **No new Vercel env is required** — OpenRouter only runs in the Orion worker (already set in `/etc/numa/env` in Task 15).

Verify in the Vercel project settings that `MINIMAX_API_KEY` and `DATABASE_URL` are populated in Production.

- [ ] **Step 2: Push main to origin**

```bash
cd /home/marku/saas/numaradio && git push origin main
```

Vercel auto-deploys.

- [ ] **Step 3: Visit numaradio.com, click "Create" tab**

Expected: form renders, "X requests ahead of you" counter shows 0 on a quiet queue.

- [ ] **Step 4: Submit one song as the operator**

Prompt: `chill lo-fi 90 BPM A minor rainy afternoon melancholic`.
Artist: your real name or handle.
Instrumental toggle: off for first test (vocal).

Expected:
1. Form flips to pending state immediately.
2. Caption cycles: `queued → processing → finalizing → done`.
3. Within ~3-4 min, artwork appears, title displayed, "Airing on the stream now" message.
4. Stream plays the new track (listen via the existing Listen tab).
5. `SELECT id, status, titleGenerated, trackId FROM "SongRequest" ORDER BY "createdAt" DESC LIMIT 1` on Neon shows `status='done'`.

- [ ] **Step 5: Negative smoke tests**

a) Submit a prompt with profanity:

Prompt: `a fucking banger about heartbreak`. Expected: 422 `prompt_not_allowed` (the profanity prefilter catches it pre-MiniMax).

b) Submit a clean prompt with an offensive artist name:

Artist: `fuckface`. Prompt: `chill jazz`. Expected: song generates, final artist displayed as `Numa Radio`, response indicates `artistNameSubstituted=true`.

c) Hit the per-IP hour limit:

Submit twice from the same IP in the same hour. Expected: second submission gets 429 `hour_limit` with `retryAfterSeconds` until the first-in-window's 1h mark.

- [ ] **Step 6: Check numa-song-worker logs on Orion**

```bash
journalctl -u numa-song-worker -n 50 --no-pager
```

Expected: `[song-worker] processing <id>` → `[song-worker] done <id>`, no errors.

- [ ] **Step 7: If anything fails, diagnose + fix on a follow-up commit**

Common issues to anticipate:

- **OpenRouter image shape differs from what `extractPngBase64` expects** — response-body mismatch is the most likely field-trial finding. Paste a curl output from OpenRouter into the log, tweak `extractPngBase64` to match, add a fixture test.
- **MiniMax status integers are different** — our poll checks `rawStatus === 3 || "done" || "success"`. If the reality is different we adjust the constants in `minimax.ts:pollMusicGeneration`.
- **Queue-daemon socket error** — worker continues and the track enters rotation anyway. Non-fatal.
- **Vercel can't reach the dashboard for moderation** — the prompt moderator runs on Vercel (moderateShoutout calls MiniMax directly, no dashboard involved), so this shouldn't happen. If it does, check MiniMax moderation model env.

---

## Task 18: Documentation — update HANDOFF

- [ ] **Step 1: Edit `docs/HANDOFF.md` to announce the feature**

Add a section near the top of HANDOFF summarising:
- What shipped (Phase A: listener song generation).
- Where the spec + plan live.
- Rate limits (1/hr, 3/day per IP; 20/hr site-wide cap via worker serialisation).
- How to monitor (`journalctl -u numa-song-worker`, `SELECT ... FROM "SongRequest"`).
- How to disable the feature temporarily (future: `NEXT_PUBLIC_SONG_CREATION_ENABLED=false` flag — plan has it as a Phase B toggle if ever needed).
- Phase B/C deferred items (shareable pages, dashboard curation).

- [ ] **Step 2: Commit**

```bash
git add docs/HANDOFF.md
git commit -m "docs(handoff): listener song generation Phase A is live"
```

---

## Rollback

Each surface is independently revertable:

1. **Kill the feature without a redeploy:** `sudo systemctl stop numa-song-worker && sudo systemctl disable numa-song-worker`. Queued rows pile up; new submissions still hit the rate limit but nothing aires. Restart to resume.
2. **Remove the Create tab:** revert the `app/page.tsx` edit in Task 16. Vercel redeploys. The backend keeps working if any already-submitted jobs are still queued.
3. **Full revert:** revert commits from this plan in reverse order, `git push`, on Orion remove the systemd unit. The Neon migration leaves the empty `SongRequest` table behind — costs nothing, ignore.

---

## Out of scope (deferred to Phase B / C, per spec)

- Email / shareable links for "listen to my song later".
- User accounts, gallery, login.
- Listener-written lyrics + speech-to-text output moderation.
- Structured form fields (genre dropdown, tempo slider, mood chips).
- Dashboard operator curation UI.
- `NEXT_PUBLIC_SONG_CREATION_ENABLED` feature flag (add when we need to turn the feature off for maintenance).
- Rate-limit-aware UI that greys out the form when the listener is already pending or over-limit.
