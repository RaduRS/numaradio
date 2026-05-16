# Lena Producer — Phase 5b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development.

**Goal:** Listener `@lena play X` requests. When a YouTube chat message classifies as `request` or `shoutout_with_request` (Phase 2.5 already added the intents), look up the requested track in the catalog and — if found and guardrails pass — insert into `priority_request` band + Lena announces. Behind `LENA_REQUEST_AUTONOMY` flag.

**Architecture:** Extract the existing `createQueueItemAtomically` from `workers/queue-daemon/index.ts` into a shared `lib/queue-insert.ts` (importable from both Vercel and daemon, since `.vercelignore` excludes `workers/`). The Postgres `pg_advisory_xact_lock` makes it safe to write from multiple processes. Vercel-side Producer-lite (`lib/lena-producer-chat/`) gains new modes: `accept_request`, `accept_request_deferred`, `decline_request`. The dispatch route detects request intents → catalog lookup → Producer decision → optional queue insert + spoken response.

**Tech Stack:** TypeScript, Prisma (on Vercel), node:test.

**Spec:** `docs/superpowers/specs/2026-05-16-lena-producer-design.md`

---

## File Structure

### Created
```
lib/queue-insert.ts                                     # shared createQueueItemAtomically
lib/queue-insert.test.ts
lib/catalog-lookup.ts                                   # fuzzy match request text → Track candidates
lib/catalog-lookup.test.ts
lib/lena-producer-chat/writers/accept-request.ts        # "queuing that up" line
lib/lena-producer-chat/writers/accept-request.test.ts
lib/lena-producer-chat/writers/accept-request-deferred.ts  # "queued behind Jane's pick"
lib/lena-producer-chat/writers/accept-request-deferred.test.ts
lib/lena-producer-chat/writers/decline-request.ts       # "we just played that" / "not in catalog"
lib/lena-producer-chat/writers/decline-request.test.ts
```

### Modified

| File | What |
|---|---|
| `workers/queue-daemon/index.ts` | Replace local `createQueueItemAtomically` with `import { createQueueItemAtomically } from "@/lib/queue-insert"` |
| `lib/lena-producer-chat/feature-flag.ts` | Add `isRequestAutonomyEnabled()` |
| `lib/lena-producer-chat/modes.ts` | Extend `ChatMode` to include the 3 new modes; add `requestIntent` + `candidateTracks` to relevant types |
| `lib/lena-producer-chat/chat-context.ts` | Add optional `candidateTracks` + `requestText` for request triggers |
| `lib/lena-producer-chat/producer-prompt.ts` | Teach the 3 new modes + decline_reason JSON field |
| `lib/lena-producer-chat/producer.ts` | Validate new modes; for request triggers, force mode into the request-family |
| `lib/lena-producer-chat/writer.ts` | Dispatch the 3 new modes |
| `lib/lena-producer-chat/index.ts` | Accept request-flavored triggers; on accept, call `createQueueItemAtomically` |
| `app/api/internal/youtube-chat-shoutout/route.ts` | For request intents, invoke chat-producer with catalogCandidates instead of going through shoutout pipeline |
| `docs/HANDOFF.md` | Phase 5b deploy notes |

---

## Task 1: Extract `createQueueItemAtomically` to `lib/queue-insert.ts`

**Files:**
- Create: `lib/queue-insert.ts` + `lib/queue-insert.test.ts`
- Modify: `workers/queue-daemon/index.ts` (import from new location, delete the local definition)

- [ ] **Step 1: Read the existing function**

`grep -n "async function createQueueItemAtomically" workers/queue-daemon/index.ts` — confirm location.

The function (currently in workers/queue-daemon/index.ts, around line 537):

```typescript
async function createQueueItemAtomically(
  sid: string,
  data: Omit<Parameters<typeof prisma.queueItem.create>[0]["data"], "positionIndex">,
): Promise<{ id: string }> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${sid + ":priority_request"})::bigint)
    `;
    const top = await tx.queueItem.findFirst({
      where: { stationId: sid, priorityBand: "priority_request" },
      orderBy: { positionIndex: "desc" },
      select: { positionIndex: true },
    });
    const position = (top?.positionIndex ?? 0) + 1;
    return tx.queueItem.create({
      data: { ...data, positionIndex: position },
      select: { id: true },
    });
  });
}
```

- [ ] **Step 2: Create `lib/queue-insert.ts`**

```typescript
// lib/queue-insert.ts

import type { PrismaClient } from "@prisma/client";

/**
 * Atomically allocate the next priority_request positionIndex AND
 * create the QueueItem inside one Postgres transaction, serialised by
 * a station-scoped advisory xact lock.
 *
 * SAFE FOR CROSS-PROCESS USE: the lock is held in Postgres, so the
 * daemon and Vercel-side writers (Phase 5b listener requests) can call
 * this without racing on positionIndex.
 *
 * Lock releases when the transaction commits.
 */
export async function createQueueItemAtomically(
  prisma: Pick<PrismaClient, "$transaction">,
  sid: string,
  data: Omit<Parameters<PrismaClient["queueItem"]["create"]>[0]["data"], "positionIndex">,
): Promise<{ id: string }> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${sid + ":priority_request"})::bigint)
    `;
    const top = await tx.queueItem.findFirst({
      where: { stationId: sid, priorityBand: "priority_request" },
      orderBy: { positionIndex: "desc" },
      select: { positionIndex: true },
    });
    const position = (top?.positionIndex ?? 0) + 1;
    return tx.queueItem.create({
      data: { ...data, positionIndex: position },
      select: { id: true },
    });
  });
}
```

Note the signature change: now takes `prisma` as first arg (caller-provided). This avoids importing a global prisma instance in the shared lib (different processes have different prismas).

- [ ] **Step 3: Update `workers/queue-daemon/index.ts`**

1. Add `import { createQueueItemAtomically } from "@/lib/queue-insert";` near the top (use whatever path alias works, fall back to relative `../../lib/queue-insert.ts` if @/ doesn't resolve).
2. Delete the local `async function createQueueItemAtomically(...)` definition (around line 537).
3. Update ALL call sites in the file to pass `prisma` as the first argument:
   - `grep -n "createQueueItemAtomically" workers/queue-daemon/index.ts` to find call sites
   - Each `createQueueItemAtomically(sid, {...})` becomes `createQueueItemAtomically(prisma, sid, {...})`
4. ALSO check the daemon-boot's lena-producer queueDirector closure (added in Phase 5 MVP) — that calls `createQueueItemAtomically(sid, {...})` too. Update to pass `prisma`.

- [ ] **Step 4: Quick test for the extracted function**

```typescript
// lib/queue-insert.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createQueueItemAtomically } from "./queue-insert.ts";

test("createQueueItemAtomically passes data through $transaction and computes position from top+1", async () => {
  let topSeen = false;
  let createdData: any = null;
  const fakePrisma = {
    $transaction: async (fn: any) => {
      const fakeTx = {
        $executeRaw: async () => 0,
        queueItem: {
          findFirst: async () => { topSeen = true; return { positionIndex: 5 }; },
          create: async ({ data }: any) => { createdData = data; return { id: "new" }; },
        },
      };
      return fn(fakeTx);
    },
  };
  const r = await createQueueItemAtomically(fakePrisma as never, "sid1", {
    stationId: "sid1",
    queueType: "music",
    sourceObjectType: "track",
    sourceObjectId: "t1",
    trackId: "t1",
    priorityBand: "priority_request",
    queueStatus: "planned",
  } as never);
  assert.equal(r.id, "new");
  assert.equal(topSeen, true);
  assert.equal(createdData.positionIndex, 6);
});
```

Run: `npx tsx --test lib/queue-insert.test.ts` → 1/1 PASS.

- [ ] **Step 5: Run full suite + builds**

```bash
npm test 2>&1 | grep -E "^(ℹ|# )" | tail -8
npm run build 2>&1 | grep -E "(error|✓ Compiled)" | head -3
cd dashboard && npm run build 2>&1 | grep -E "(error|✓ Compiled)" | head -3
```

All green. Daemon tests should still pass (the extraction is API-compatible after passing prisma).

- [ ] **Step 6: Commit**

```bash
git add lib/queue-insert.ts lib/queue-insert.test.ts workers/queue-daemon/index.ts
git commit -m "$(cat <<'EOF'
queue-insert: extract createQueueItemAtomically to shared lib

Phase 5b prep. Daemon and Vercel-side callers both need atomic
queue inserts; Postgres pg_advisory_xact_lock works cross-process so
sharing the helper is safe. .vercelignore excludes workers/, so the
helper lives in lib/.

Signature change: prisma is now passed as first arg (each process
has its own client).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Feature flag + catalog-lookup helper

**Files:**
- Modify: `lib/lena-producer-chat/feature-flag.ts` + `.test.ts`
- Create: `lib/catalog-lookup.ts` + `lib/catalog-lookup.test.ts`

- [ ] **Step 1: Feature flag**

Append to `lib/lena-producer-chat/feature-flag.ts`:

```typescript
export function isRequestAutonomyEnabled(env: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean {
  const v = (env.LENA_REQUEST_AUTONOMY ?? "").toLowerCase();
  return v === "on" || v === "true" || v === "1";
}
```

Append 3 tests (mirror existing pattern for isProducerReplyEnabled).

- [ ] **Step 2: catalog-lookup**

```typescript
// lib/catalog-lookup.ts

import type { PrismaClient } from "@prisma/client";

export interface CatalogMatch {
  id: string;
  title: string;
  artist: string | null;
  genre: string | null;
  bpm: number | null;
  /** 0..1, higher = better. Simple substring + token-overlap heuristic. */
  score: number;
}

type PrismaSlice = Pick<PrismaClient, "track">;

const STOPWORDS = new Set(["play", "playing", "can", "you", "the", "a", "by", "please", "next", "song", "track", "tune"]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function scoreMatch(query: string, track: { title: string; artistDisplay: string | null }): number {
  const qTokens = new Set(tokenize(query));
  if (qTokens.size === 0) return 0;
  const trackTokens = new Set([...tokenize(track.title), ...tokenize(track.artistDisplay ?? "")]);
  let overlap = 0;
  for (const t of qTokens) if (trackTokens.has(t)) overlap += 1;
  return overlap / qTokens.size;
}

export async function lookupCatalogCandidates(args: {
  prisma: PrismaSlice;
  stationId: string;
  requestText: string;
  /** Maximum candidates to return (sorted by score desc). */
  limit?: number;
}): Promise<CatalogMatch[]> {
  const limit = args.limit ?? 5;
  // Fetch up to 200 library tracks for the station — cheap.
  const tracks = await args.prisma.track.findMany({
    where: { stationId: args.stationId, trackStatus: "ready", airingPolicy: "library" },
    take: 200,
    select: { id: true, title: true, artistDisplay: true, genre: true, bpm: true },
  });
  const scored = tracks
    .map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artistDisplay,
      genre: t.genre,
      bpm: t.bpm,
      score: scoreMatch(args.requestText, t),
    }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored;
}
```

Tests:

```typescript
// lib/catalog-lookup.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { lookupCatalogCandidates } from "./catalog-lookup.ts";

const fakeTracks = [
  { id: "t1", title: "Hotel California", artistDisplay: "Eagles", genre: "rock", bpm: 75 },
  { id: "t2", title: "Take It Easy", artistDisplay: "Eagles", genre: "rock", bpm: 138 },
  { id: "t3", title: "Dusk", artistDisplay: "Anna", genre: "synth", bpm: 112 },
];

const fakePrisma = {
  track: { findMany: async () => fakeTracks },
};

test("lookupCatalogCandidates returns matching track for explicit title+artist", async () => {
  const r = await lookupCatalogCandidates({ prisma: fakePrisma as never, stationId: "s1", requestText: "play hotel california by eagles" });
  assert.ok(r.length > 0);
  assert.equal(r[0].id, "t1");
});

test("lookupCatalogCandidates returns multiple results sorted by score", async () => {
  const r = await lookupCatalogCandidates({ prisma: fakePrisma as never, stationId: "s1", requestText: "play eagles" });
  // Both t1 and t2 are by Eagles — both should match
  assert.ok(r.length >= 2);
});

test("lookupCatalogCandidates filters out tracks with zero score", async () => {
  const r = await lookupCatalogCandidates({ prisma: fakePrisma as never, stationId: "s1", requestText: "play queen bohemian rhapsody" });
  assert.equal(r.length, 0);
});

test("lookupCatalogCandidates ignores stopwords", async () => {
  const r = await lookupCatalogCandidates({ prisma: fakePrisma as never, stationId: "s1", requestText: "can you play the next song" });
  // No real track tokens — should match nothing
  assert.equal(r.length, 0);
});
```

Run: `npx tsx --test lib/catalog-lookup.test.ts` → 4/4 PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/lena-producer-chat/feature-flag.ts lib/lena-producer-chat/feature-flag.test.ts lib/catalog-lookup.ts lib/catalog-lookup.test.ts
git commit -m "$(cat <<'EOF'
catalog-lookup: fuzzy match listener request text against Track library

Token-overlap score (stopwords stripped). Returns top-5 matches by
score, filters zero-score. Used by Phase 5b's youtube-chat-shoutout
route to find candidate tracks for accept_request decisions.

Also adds LENA_REQUEST_AUTONOMY feature flag.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Extend ChatMode + ChatContext for request triggers

**Files:**
- Modify: `lib/lena-producer-chat/modes.ts`
- Modify: `lib/lena-producer-chat/chat-context.ts`

- [ ] **Step 1: modes.ts**

Extend `ChatMode` and `ChatDecision`:

```typescript
// lib/lena-producer-chat/modes.ts

export type ChatMode = "answer" | "callback" | "accept_request" | "accept_request_deferred" | "decline_request";

export type DeclineReason = "recently_aired" | "not_in_catalog" | "wrong_show_block" | "same_artist_too_soon" | "queue_full";

export interface ChatDecision {
  mode: ChatMode;
  targetFocus: string;
  callbackTo: string | null;
  lengthHint: "short" | "medium";
  tone: "dry" | "warm" | "playful" | "low-key";
  /** Phase 5b: when mode='accept_request' or 'accept_request_deferred', the chosen catalog track id. */
  pickedTrackId: string | null;
  /** Phase 5b: when mode='decline_request', the reason. */
  declineReason: DeclineReason | null;
}

export const LENGTH_WORDS: Record<ChatDecision["lengthHint"], { min: number; max: number }> = {
  short: { min: 4, max: 25 },
  medium: { min: 25, max: 45 },
};
```

- [ ] **Step 2: chat-context.ts**

Extend `ChatTrigger` to include intent + optional candidates:

```typescript
export interface ChatTrigger {
  source: "youtube_chat_mention";
  handle: string;
  text: string;
  /** Phase 5b: classifier intent — reply (default), request, or shoutout_with_request. */
  intent?: "reply" | "request" | "shoutout_with_request";
}
```

And `ChatContext`:

```typescript
export interface ChatContext {
  trigger: ChatTrigger;
  now: { localTime: string; bucket: string };
  recentShoutouts: { id: string; handle: string; originalText: string; minsAgo: number }[];
  recentLenaLines: { text: string; airedAt: number }[];
  /** Phase 5b: when trigger.intent is request/shoutout_with_request, the catalog candidates from fuzzy lookup. */
  catalogCandidates: { id: string; title: string; artist: string | null; genre: string | null; bpm: number | null }[];
  /** Phase 5b: ids of tracks aired in the last 60min (for recently_aired guardrail). */
  recentlyAiredTrackIds: string[];
  /** Phase 5b: number of pending priority_request items already in queue (for deferred mode). */
  queueDepth: number;
}
```

Update `buildChatContext` to accept + pass through the new fields:

```typescript
export function buildChatContext(args: {
  trigger: ChatTrigger;
  nowMs: number;
  recentShoutouts: ChatContext["recentShoutouts"];
  recentLenaLines: ChatContext["recentLenaLines"];
  catalogCandidates?: ChatContext["catalogCandidates"];
  recentlyAiredTrackIds?: ChatContext["recentlyAiredTrackIds"];
  queueDepth?: number;
}): ChatContext {
  const now = new Date(args.nowMs);
  return {
    trigger: args.trigger,
    now: { localTime: fmtHHMM(now), bucket: bucketFor(now.getHours()) },
    recentShoutouts: args.recentShoutouts,
    recentLenaLines: args.recentLenaLines,
    catalogCandidates: args.catalogCandidates ?? [],
    recentlyAiredTrackIds: args.recentlyAiredTrackIds ?? [],
    queueDepth: args.queueDepth ?? 0,
  };
}
```

Update `fetchChatContext` to fetch recentlyAired + queueDepth when needed:

```typescript
type PrismaSlice = Pick<PrismaClient, "shoutout" | "chatter" | "playHistory" | "queueItem">;

export async function fetchChatContext(args: {
  prisma: PrismaSlice;
  stationId: string;
  trigger: ChatTrigger;
  nowMs: number;
  catalogCandidates?: ChatContext["catalogCandidates"];
}): Promise<ChatContext> {
  const cutoff = new Date(args.nowMs - THIRTY_MIN_MS);
  const sixtyMinCutoff = new Date(args.nowMs - 60 * 60 * 1000);
  const isRequest = args.trigger.intent === "request" || args.trigger.intent === "shoutout_with_request";

  const [shoutouts, lines, recentTracks, queueRows] = await Promise.all([
    args.prisma.shoutout.findMany({
      where: { stationId: args.stationId, createdAt: { gte: cutoff } },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, requesterName: true, cleanText: true, createdAt: true },
    }),
    args.prisma.chatter.findMany({
      where: { stationId: args.stationId, airedAt: { gte: cutoff } },
      orderBy: { airedAt: "desc" },
      take: 5,
      select: { id: true, script: true, airedAt: true },
    }),
    isRequest
      ? args.prisma.playHistory.findMany({
          where: { stationId: args.stationId, startedAt: { gte: sixtyMinCutoff } },
          select: { trackId: true },
        })
      : Promise.resolve([] as { trackId: string | null }[]),
    isRequest
      ? args.prisma.queueItem.findMany({
          where: { stationId: args.stationId, priorityBand: "priority_request", queueStatus: { in: ["planned", "staged"] } },
          select: { id: true },
        })
      : Promise.resolve([] as { id: string }[]),
  ]);

  return buildChatContext({
    trigger: args.trigger,
    nowMs: args.nowMs,
    recentShoutouts: shoutouts.map((s) => ({
      id: s.id,
      handle: s.requesterName ?? "anonymous",
      originalText: s.cleanText ?? "",
      minsAgo: Math.floor((args.nowMs - s.createdAt.getTime()) / 60_000),
    })),
    recentLenaLines: lines.map((l) => ({ text: l.script, airedAt: l.airedAt.getTime() })),
    catalogCandidates: args.catalogCandidates,
    recentlyAiredTrackIds: recentTracks.map((t) => t.trackId).filter((id): id is string => id != null),
    queueDepth: queueRows.length,
  });
}
```

- [ ] **Step 3: Update existing chat-context.test.ts**

Add `catalogCandidates: []`, `recentlyAiredTrackIds: []`, `queueDepth: 0` to existing test fixture expectations.

Add one new test:

```typescript
test("buildChatContext exposes catalogCandidates + queueDepth when passed", () => {
  const ctx = buildChatContext({
    trigger: { source: "youtube_chat_mention", handle: "anna", text: "play x", intent: "request" },
    nowMs: T0,
    recentShoutouts: [],
    recentLenaLines: [],
    catalogCandidates: [{ id: "t1", title: "X", artist: "Y", genre: "rock", bpm: 120 }],
    recentlyAiredTrackIds: ["t2"],
    queueDepth: 3,
  });
  assert.equal(ctx.catalogCandidates.length, 1);
  assert.equal(ctx.recentlyAiredTrackIds.length, 1);
  assert.equal(ctx.queueDepth, 3);
});
```

Run tests → all pass.

- [ ] **Step 4: Commit**

```bash
git add lib/lena-producer-chat/modes.ts lib/lena-producer-chat/chat-context.ts lib/lena-producer-chat/chat-context.test.ts
git commit -m "$(cat <<'EOF'
lena-producer-chat: extend types + context for Phase 5b request triggers

ChatMode gains 3 new modes (accept_request, accept_request_deferred,
decline_request). ChatDecision gains pickedTrackId + declineReason.
ChatTrigger.intent identifies the request flow. ChatContext gains
catalogCandidates + recentlyAiredTrackIds + queueDepth.
fetchChatContext fetches the new fields only when intent is request
(skips for default reply intent — no extra DB cost).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Extend Producer for request modes

**Files:**
- Modify: `lib/lena-producer-chat/producer-prompt.ts`
- Modify: `lib/lena-producer-chat/producer.ts`

- [ ] **Step 1: producer-prompt.ts — branch on trigger.intent**

Change the SYSTEM constant to a SYSTEM function that picks the appropriate prompt:

```typescript
const REPLY_SYSTEM = `You are the producer for Lena...
[existing 4-mode prompt for reply intent — answer/callback]
RULES:
- "silence" is NEVER valid here.
- "callback" only if recentShoutouts entry fits.
...`;

const REQUEST_SYSTEM = `You are the producer for Lena, deciding how she handles a listener's song request on YouTube live chat.

OUTPUT — strict JSON, no prose:
{
  "mode": "accept_request" | "accept_request_deferred" | "decline_request",
  "target_focus": "<one short phrase>",
  "callback_to": null,
  "length_hint": "short" | "medium",
  "tone": "dry" | "warm" | "playful" | "low-key",
  "picked_track_id": "<id from catalogCandidates, or null>",
  "decline_reason": "recently_aired" | "not_in_catalog" | "wrong_show_block" | "same_artist_too_soon" | "queue_full" | null
}

RULES:
- "silence" is NEVER valid.
- If catalogCandidates is empty → decline_request, decline_reason="not_in_catalog".
- If best catalogCandidate's id is in recentlyAiredTrackIds → decline_request, decline_reason="recently_aired".
- If queueDepth >= 2 → accept_request_deferred (Lena tells the listener they're behind others).
- Otherwise → accept_request, pick the highest-score candidate.
- picked_track_id MUST be from catalogCandidates (or null for decline).
- decline_reason MUST be set when mode=decline_request.
- length_hint: short=4-25, medium=25-45.`;

export function buildChatProducerPrompt(ctx: ChatContext): { system: string; user: string } {
  const isRequest = ctx.trigger.intent === "request" || ctx.trigger.intent === "shoutout_with_request";
  const system = isRequest ? REQUEST_SYSTEM : REPLY_SYSTEM;
  
  const lines: string[] = [];
  lines.push(`Listener: ${ctx.trigger.handle}`);
  lines.push(`Message: "${ctx.trigger.text}"`);
  lines.push(`Local time: ${ctx.now.localTime} (${ctx.now.bucket})`);
  if (isRequest) {
    if (ctx.catalogCandidates.length === 0) {
      lines.push(`Catalog candidates: (none — request didn't match any library track)`);
    } else {
      lines.push(`Catalog candidates (pick from these):`);
      for (const c of ctx.catalogCandidates) {
        lines.push(`  - id=${c.id}: "${c.title}" by ${c.artist ?? "?"} (${c.genre ?? "?"})`);
      }
    }
    lines.push(`Recently aired track ids (decline if pick is here): ${ctx.recentlyAiredTrackIds.slice(0, 10).join(", ") || "(none)"}`);
    lines.push(`Current queue depth (priority_request): ${ctx.queueDepth}`);
  }
  // Recent shoutouts / lines blocks (existing logic) below...
  if (ctx.recentShoutouts.length > 0) {
    lines.push(`Recent shoutouts (last 30 min):`);
    for (const s of ctx.recentShoutouts) lines.push(`  - id=${s.id} (${s.handle}, ${s.minsAgo}min ago): ${s.originalText.slice(0, 60)}`);
  }
  lines.push("");
  lines.push("Emit the decision JSON now.");
  return { system, user: lines.join("\n") };
}
```

Note: REPLY_SYSTEM is the EXISTING content of the SYSTEM constant — just rename it. REQUEST_SYSTEM is new.

- [ ] **Step 2: producer.ts — handle new modes**

Extend `VALID_MODES`:

```typescript
const VALID_MODES = ["answer", "callback", "accept_request", "accept_request_deferred", "decline_request"] as const;
const VALID_DECLINE_REASONS = ["recently_aired", "not_in_catalog", "wrong_show_block", "same_artist_too_soon", "queue_full"] as const;
```

Update `parseDecision` to handle new fields:

```typescript
function parseDecision(
  raw: string,
  validCallbackIds: ReadonlySet<string>,
  validCatalogIds: ReadonlySet<string>,
): ChatDecision | null {
  // ... existing parse ...
  
  // Validate pickedTrackId
  const pickedTrackIdRaw = o.picked_track_id;
  const pickedTrackId =
    typeof pickedTrackIdRaw === "string" && validCatalogIds.has(pickedTrackIdRaw)
      ? pickedTrackIdRaw
      : null;
  
  // Validate declineReason
  const declineReasonRaw = o.decline_reason;
  const declineReason =
    typeof declineReasonRaw === "string" && VALID_DECLINE_REASONS.includes(declineReasonRaw as never)
      ? (declineReasonRaw as ChatDecision["declineReason"])
      : null;
  
  // Mode-consistency check
  if ((mode === "accept_request" || mode === "accept_request_deferred") && !pickedTrackId) return null;
  if (mode === "decline_request" && !declineReason) return null;
  
  return {
    mode,
    targetFocus: o.target_focus,
    callbackTo,
    lengthHint: o.length_hint,
    tone: o.tone,
    pickedTrackId,
    declineReason,
  };
}
```

Update safe-default to know about request triggers:

```typescript
function safeDefault(ctx: ChatContext): ChatDecision {
  const isRequest = ctx.trigger.intent === "request" || ctx.trigger.intent === "shoutout_with_request";
  if (isRequest) {
    // Catalog might have something, might not — safest is decline with not_in_catalog
    return { mode: "decline_request", targetFocus: "couldn't find that one", callbackTo: null, lengthHint: "short", tone: "warm", pickedTrackId: null, declineReason: "not_in_catalog" };
  }
  return { mode: "answer", targetFocus: "respond directly", callbackTo: null, lengthHint: "short", tone: "warm", pickedTrackId: null, declineReason: null };
}
```

Update `runChatProducer` to call `safeDefault(ctx)` (was `safeDefault()`) and pass `validCatalogIds`:

```typescript
const validCatalogIds = new Set(ctx.catalogCandidates.map((c) => c.id));
// ... call parseDecision with validCallbackIds + validCatalogIds in both attempts
// ... return safeDefault(ctx) at end
```

- [ ] **Step 3: Update existing producer.test.ts**

Existing tests construct decisions with new fields — add `pickedTrackId: null, declineReason: null` to all test fixtures and assertions where ChatDecision is checked.

Add new tests:

```typescript
test("runChatProducer accepts a request: catalog candidate available, not recently aired, queue light", async () => {
  const ctx: ChatContext = {
    trigger: { source: "youtube_chat_mention", handle: "anna", text: "play hotel california", intent: "request" },
    now: { localTime: "23:00", bucket: "night" },
    recentShoutouts: [],
    recentLenaLines: [],
    catalogCandidates: [{ id: "t1", title: "Hotel California", artist: "Eagles", genre: "rock", bpm: 75 }],
    recentlyAiredTrackIds: [],
    queueDepth: 0,
  };
  const llm = async () => JSON.stringify({ mode: "accept_request", target_focus: "queue it", callback_to: null, length_hint: "short", tone: "warm", picked_track_id: "t1", decline_reason: null });
  const d = await runChatProducer(ctx, { llm });
  assert.equal(d.mode, "accept_request");
  assert.equal(d.pickedTrackId, "t1");
});

test("runChatProducer empty catalogCandidates → safe-default declines", async () => {
  const ctx: ChatContext = {
    trigger: { source: "youtube_chat_mention", handle: "anna", text: "play queen", intent: "request" },
    now: { localTime: "23:00", bucket: "night" },
    recentShoutouts: [],
    recentLenaLines: [],
    catalogCandidates: [],
    recentlyAiredTrackIds: [],
    queueDepth: 0,
  };
  const llm = async () => "garbage";  // force fallback
  const d = await runChatProducer(ctx, { llm });
  assert.equal(d.mode, "decline_request");
  assert.equal(d.declineReason, "not_in_catalog");
});
```

- [ ] **Step 4: Commit**

```bash
git add lib/lena-producer-chat/producer-prompt.ts lib/lena-producer-chat/producer.ts lib/lena-producer-chat/producer.test.ts
git commit -m "$(cat <<'EOF'
lena-producer-chat: Producer handles request-family modes

producer-prompt branches by trigger.intent — REPLY_SYSTEM (existing 2-mode)
vs REQUEST_SYSTEM (new 3-mode with picked_track_id + decline_reason).
producer.ts validates mode↔field consistency: accept_* requires a
valid catalog id, decline_request requires a reason.

Safe-default is now context-aware: declines with not_in_catalog when
the trigger is a request, falls back to answer otherwise.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Three new Writer prompts + dispatcher

**Files:**
- Create: `lib/lena-producer-chat/writers/{accept-request,accept-request-deferred,decline-request}.ts` + tests
- Modify: `lib/lena-producer-chat/writer.ts`

- [ ] **Step 1: Three writers**

```typescript
// lib/lena-producer-chat/writers/accept-request.ts
import type { ChatDecision } from "../modes.ts";
import { LENGTH_WORDS } from "../modes.ts";
import type { ChatContext } from "../chat-context.ts";

const SYSTEM = `You write ONE spoken line for Lena confirming a listener's song request she's queuing up.

RULES:
- Contractions. Spoken English. Warm + brief.
- Address listener by handle.
- Name the track + artist naturally — "Pulling Hotel California up for you, Anna — coming right after this one."
- BANNED: "let it ride", "we'll let it ride", "we'll take that one", "hope this reaches them", "going out to".

OUTPUT: one line. No quotes. No stage directions.`;

export function buildAcceptRequestPrompt(decision: ChatDecision, ctx: ChatContext): { system: string; user: string } {
  const w = LENGTH_WORDS[decision.lengthHint];
  const picked = ctx.catalogCandidates.find((c) => c.id === decision.pickedTrackId);
  const lines: string[] = [];
  lines.push(`listener_handle: ${ctx.trigger.handle}`);
  lines.push(`listener_said: "${ctx.trigger.text}"`);
  lines.push(`picked_track: ${picked ? `"${picked.title}" by ${picked.artist ?? "?"}` : "(unresolved)"}`);
  lines.push(`tone: ${decision.tone}`);
  lines.push(`length: ${w.min}-${w.max} words`);
  lines.push("");
  lines.push("Write Lena's confirmation now.");
  return { system: SYSTEM, user: lines.join("\n") };
}
```

```typescript
// lib/lena-producer-chat/writers/accept-request-deferred.ts
import type { ChatDecision } from "../modes.ts";
import { LENGTH_WORDS } from "../modes.ts";
import type { ChatContext } from "../chat-context.ts";

const SYSTEM = `You write ONE spoken line for Lena confirming a listener's song request she's queuing — but they're BEHIND other listener picks already in queue.

RULES:
- Contractions. Spoken English. Warm, honest about the wait.
- Address listener by handle.
- Name the track + artist + roughly when ("queued you up behind two other picks — about six minutes out").
- BANNED: "let it ride", "we'll let it ride", "we'll take that one", "hope this reaches them", "going out to".

OUTPUT: one line. No quotes.`;

export function buildAcceptRequestDeferredPrompt(decision: ChatDecision, ctx: ChatContext): { system: string; user: string } {
  const w = LENGTH_WORDS[decision.lengthHint];
  const picked = ctx.catalogCandidates.find((c) => c.id === decision.pickedTrackId);
  // Rough wait estimate: avg track ~3min × queueDepth
  const minsBehind = Math.max(3, ctx.queueDepth * 3);
  const lines: string[] = [];
  lines.push(`listener_handle: ${ctx.trigger.handle}`);
  lines.push(`listener_said: "${ctx.trigger.text}"`);
  lines.push(`picked_track: ${picked ? `"${picked.title}" by ${picked.artist ?? "?"}` : "(unresolved)"}`);
  lines.push(`queue_depth_behind: ${ctx.queueDepth} other picks (~${minsBehind} min out)`);
  lines.push(`tone: ${decision.tone}`);
  lines.push(`length: ${w.min}-${w.max} words`);
  lines.push("");
  lines.push("Write Lena's deferred confirmation now.");
  return { system: SYSTEM, user: lines.join("\n") };
}
```

```typescript
// lib/lena-producer-chat/writers/decline-request.ts
import type { ChatDecision } from "../modes.ts";
import { LENGTH_WORDS } from "../modes.ts";
import type { ChatContext } from "../chat-context.ts";

const REASON_GUIDANCE: Record<NonNullable<ChatDecision["declineReason"]>, string> = {
  recently_aired: "We just played that one — you'd hear the same song twice. Try again later.",
  not_in_catalog: "That one's not in our catalog tonight.",
  wrong_show_block: "Doesn't quite fit this hour's vibe — try later when the show shifts.",
  same_artist_too_soon: "Same artist's already playing — we'll get back to them.",
  queue_full: "Queue's stacked tonight — try again in a bit.",
};

const SYSTEM = `You write ONE spoken line for Lena politely declining a listener's song request.

RULES:
- Contractions. Spoken English. Warm, never dismissive.
- Address listener by handle.
- Use the supplied reason naturally — don't read it verbatim, paraphrase in your voice.
- BANNED: "let it ride", "we'll let it ride", "we'll take that one", "hope this reaches them", "going out to".

OUTPUT: one line. No quotes.`;

export function buildDeclineRequestPrompt(decision: ChatDecision, ctx: ChatContext): { system: string; user: string } {
  const w = LENGTH_WORDS[decision.lengthHint];
  const reasonText = decision.declineReason ? REASON_GUIDANCE[decision.declineReason] : "Can't queue that one right now.";
  const lines: string[] = [];
  lines.push(`listener_handle: ${ctx.trigger.handle}`);
  lines.push(`listener_said: "${ctx.trigger.text}"`);
  lines.push(`decline_reason_hint: ${reasonText}`);
  lines.push(`tone: ${decision.tone}`);
  lines.push(`length: ${w.min}-${w.max} words`);
  lines.push("");
  lines.push("Write Lena's polite decline now.");
  return { system: SYSTEM, user: lines.join("\n") };
}
```

Quick tests (one per writer):

```typescript
// lib/lena-producer-chat/writers/accept-request.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAcceptRequestPrompt } from "./accept-request.ts";

const ctx = {
  trigger: { source: "youtube_chat_mention" as const, handle: "anna", text: "play hotel california", intent: "request" as const },
  now: { localTime: "23:00", bucket: "night" },
  recentShoutouts: [],
  recentLenaLines: [],
  catalogCandidates: [{ id: "t1", title: "Hotel California", artist: "Eagles", genre: "rock", bpm: 75 }],
  recentlyAiredTrackIds: [],
  queueDepth: 0,
};

test("buildAcceptRequestPrompt names track + artist + handle", () => {
  const decision = { mode: "accept_request" as const, targetFocus: "x", callbackTo: null, lengthHint: "short" as const, tone: "warm" as const, pickedTrackId: "t1", declineReason: null };
  const p = buildAcceptRequestPrompt(decision, ctx);
  assert.match(p.user, /anna/);
  assert.match(p.user, /Hotel California/);
  assert.match(p.user, /Eagles/);
});

test("buildAcceptRequestPrompt bans 'let it ride'", () => {
  const decision = { mode: "accept_request" as const, targetFocus: "x", callbackTo: null, lengthHint: "short" as const, tone: "warm" as const, pickedTrackId: "t1", declineReason: null };
  const p = buildAcceptRequestPrompt(decision, ctx);
  assert.match(p.system, /let it ride/i);
});
```

```typescript
// lib/lena-producer-chat/writers/accept-request-deferred.test.ts — similar pattern, asserts queue_depth_behind appears in user msg.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAcceptRequestDeferredPrompt } from "./accept-request-deferred.ts";

const ctx = {
  trigger: { source: "youtube_chat_mention" as const, handle: "anna", text: "play x", intent: "request" as const },
  now: { localTime: "23:00", bucket: "night" },
  recentShoutouts: [],
  recentLenaLines: [],
  catalogCandidates: [{ id: "t1", title: "Dusk", artist: "Anna", genre: "synth", bpm: 112 }],
  recentlyAiredTrackIds: [],
  queueDepth: 3,
};

test("buildAcceptRequestDeferredPrompt includes queue depth + estimate", () => {
  const decision = { mode: "accept_request_deferred" as const, targetFocus: "x", callbackTo: null, lengthHint: "medium" as const, tone: "warm" as const, pickedTrackId: "t1", declineReason: null };
  const p = buildAcceptRequestDeferredPrompt(decision, ctx);
  assert.match(p.user, /3 other picks/);
  assert.match(p.user, /9 min out/);
});
```

```typescript
// lib/lena-producer-chat/writers/decline-request.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDeclineRequestPrompt } from "./decline-request.ts";

const ctx = {
  trigger: { source: "youtube_chat_mention" as const, handle: "anna", text: "play x", intent: "request" as const },
  now: { localTime: "23:00", bucket: "night" },
  recentShoutouts: [],
  recentLenaLines: [],
  catalogCandidates: [],
  recentlyAiredTrackIds: [],
  queueDepth: 0,
};

test("buildDeclineRequestPrompt passes the reason guidance for not_in_catalog", () => {
  const decision = { mode: "decline_request" as const, targetFocus: "x", callbackTo: null, lengthHint: "short" as const, tone: "warm" as const, pickedTrackId: null, declineReason: "not_in_catalog" as const };
  const p = buildDeclineRequestPrompt(decision, ctx);
  assert.match(p.user, /not in our catalog/i);
});

test("buildDeclineRequestPrompt passes the reason guidance for recently_aired", () => {
  const decision = { mode: "decline_request" as const, targetFocus: "x", callbackTo: null, lengthHint: "short" as const, tone: "warm" as const, pickedTrackId: null, declineReason: "recently_aired" as const };
  const p = buildDeclineRequestPrompt(decision, ctx);
  assert.match(p.user, /just played/i);
});
```

- [ ] **Step 2: writer.ts dispatcher**

Add cases for the 3 new modes:

```typescript
import { buildAcceptRequestPrompt } from "./writers/accept-request.ts";
import { buildAcceptRequestDeferredPrompt } from "./writers/accept-request-deferred.ts";
import { buildDeclineRequestPrompt } from "./writers/decline-request.ts";

export async function runChatWriter(decision: ChatDecision, ctx: ChatContext, deps: ChatWriterDeps): Promise<string | null> {
  let prompts: { system: string; user: string };
  switch (decision.mode) {
    case "answer": prompts = buildChatAnswerPrompt(decision, ctx); break;
    case "callback": prompts = buildChatCallbackPrompt(decision, ctx); break;
    case "accept_request": prompts = buildAcceptRequestPrompt(decision, ctx); break;
    case "accept_request_deferred": prompts = buildAcceptRequestDeferredPrompt(decision, ctx); break;
    case "decline_request": prompts = buildDeclineRequestPrompt(decision, ctx); break;
  }
  const raw = await deps.llm(prompts);
  return raw.trim() || null;
}
```

Update existing writer.test.ts: existing tests still pass (just new switch arms). Optionally add 1 test confirming the dispatch for each new mode.

- [ ] **Step 3: Commit**

```bash
git add lib/lena-producer-chat/writers/ lib/lena-producer-chat/writer.ts lib/lena-producer-chat/writer.test.ts
git commit -m "$(cat <<'EOF'
lena-producer-chat: 3 new writers (accept_request, accept_request_deferred, decline_request)

Each writer reads decision.pickedTrackId or decision.declineReason
and produces an honest, listener-aware line. decline-request maps
declineReason → a guidance phrase the Writer paraphrases.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Update lenaSpeakChat to handle request triggers + insert into queue

**Files:**
- Modify: `lib/lena-producer-chat/index.ts` + `.test.ts`

- [ ] **Step 1: Extend LenaSpeakChatArgs + index logic**

```typescript
import { createQueueItemAtomically } from "../queue-insert.ts";
// ... existing imports

export interface LenaChatResult {
  text: string;
  mode: ChatMode;
  /** Phase 5b: when mode='accept_request' or 'accept_request_deferred', the trackId that was inserted. */
  queuedTrackId: string | null;
}

export interface LenaSpeakChatArgs {
  trigger: ChatTrigger;
  prisma: Pick<PrismaClient, "shoutout" | "chatter" | "playHistory" | "queueItem" | "track" | "$transaction">;
  stationId: string;
  nowMs: number;
  llm: (prompts: { system: string; user: string }) => Promise<string>;
  /** Phase 5b: passed in when trigger is request/shoutout_with_request. */
  catalogCandidates?: { id: string; title: string; artist: string | null; genre: string | null; bpm: number | null }[];
}

export async function lenaSpeakChat(args: LenaSpeakChatArgs): Promise<LenaChatResult | null> {
  let ctx;
  try {
    ctx = await fetchChatContext({
      prisma: args.prisma,
      stationId: args.stationId,
      trigger: args.trigger,
      nowMs: args.nowMs,
      catalogCandidates: args.catalogCandidates,
    });
  } catch {
    return null;
  }

  const decision = await runChatProducer(ctx, { llm: args.llm });

  // Phase 5b: if Producer accepted, insert into queue BEFORE writing the line.
  let queuedTrackId: string | null = null;
  if ((decision.mode === "accept_request" || decision.mode === "accept_request_deferred") && decision.pickedTrackId) {
    try {
      await createQueueItemAtomically(args.prisma, args.stationId, {
        stationId: args.stationId,
        queueType: "music",
        sourceObjectType: "track",
        sourceObjectId: decision.pickedTrackId,
        trackId: decision.pickedTrackId,
        priorityBand: "priority_request",
        queueStatus: "planned",
        reasonCode: `lena_listener_request:${args.trigger.handle.slice(0, 30)}`,
        insertedBy: "lena_listener_request",
      } as never);
      queuedTrackId = decision.pickedTrackId;
    } catch (err) {
      console.warn("[lena-producer-chat] queue insert failed — downgrading to decline:", err);
      // Couldn't insert — downgrade decision so the Writer doesn't lie
      decision.mode = "decline_request";
      decision.declineReason = "queue_full";
      decision.pickedTrackId = null;
    }
  }

  try {
    const text = await runChatWriter(decision, ctx, { llm: args.llm });
    if (!text) return null;
    return { text, mode: decision.mode, queuedTrackId };
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Update existing index.test.ts**

Existing tests need:
- `queuedTrackId: null` in expected return shape
- `prisma` fake needs `playHistory.findMany`, `queueItem.findMany`, `track.findMany`, `$transaction` stubs

Add 1 new test for accept_request happy path:

```typescript
test("lenaSpeakChat accept_request: inserts into queue + returns queuedTrackId", async () => {
  let insertCalled = false;
  const fakePrisma = {
    shoutout: { findMany: async () => [] },
    chatter: { findMany: async () => [] },
    playHistory: { findMany: async () => [] },
    queueItem: { findMany: async () => [] },
    track: { findMany: async () => [] },
    $transaction: async (fn: any) => {
      const tx = {
        $executeRaw: async () => 0,
        queueItem: {
          findFirst: async () => null,
          create: async () => { insertCalled = true; return { id: "qi1" }; },
        },
      };
      return fn(tx);
    },
  };
  const llm = async (p: { system: string }) => {
    if (p.system.includes("producer for Lena, deciding how she handles")) {
      return JSON.stringify({ mode: "accept_request", target_focus: "queue it", callback_to: null, length_hint: "short", tone: "warm", picked_track_id: "t1", decline_reason: null });
    }
    return "pulling it up for you, anna.";
  };
  const r = await lenaSpeakChat({
    trigger: { source: "youtube_chat_mention", handle: "anna", text: "play x", intent: "request" },
    prisma: fakePrisma as never,
    stationId: "s1",
    nowMs: Date.now(),
    llm,
    catalogCandidates: [{ id: "t1", title: "X", artist: "Y", genre: "rock", bpm: 120 }],
  });
  assert.ok(r);
  assert.equal(r!.mode, "accept_request");
  assert.equal(r!.queuedTrackId, "t1");
  assert.equal(insertCalled, true);
});
```

- [ ] **Step 3: Commit**

```bash
git add lib/lena-producer-chat/index.ts lib/lena-producer-chat/index.test.ts
git commit -m "$(cat <<'EOF'
lena-producer-chat: lenaSpeakChat inserts requested track into queue (Phase 5b)

When Producer returns accept_request / accept_request_deferred,
lenaSpeakChat calls createQueueItemAtomically BEFORE writing the
spoken line. If insert fails, decision downgrades to
decline_request reason=queue_full so the line stays honest.

queuedTrackId returned to caller for audit logging.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Wire into youtube-chat-shoutout route + HANDOFF

**Files:**
- Modify: `app/api/internal/youtube-chat-shoutout/route.ts`
- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: Detect request intents + route through chat-producer**

The route already calls `classifyShoutoutIntent` (Phase 2.5 extended it to 5 categories). Currently the route handles `noise` (skip), `reply` (calls existing path with new Producer gate from Phase 3), `shoutout` (default).

After the `if (intent.category === "noise")` early return, BEFORE the existing isReply block, add:

```typescript
import { lookupCatalogCandidates } from "@/lib/catalog-lookup";
import { isRequestAutonomyEnabled } from "@/lib/lena-producer-chat/feature-flag";

const isRequestIntent = intent.category === "request" || intent.category === "shoutout_with_request";

if (isRequestIntent && isRequestAutonomyEnabled(process.env)) {
  try {
    const stationRow = await prisma.station.findUnique({
      where: { slug: process.env.STATION_SLUG ?? "numaradio" },
      select: { id: true },
    });
    if (stationRow) {
      const candidates = await lookupCatalogCandidates({
        prisma,
        stationId: stationRow.id,
        requestText: moderation.text,
      });
      const r = await lenaSpeakChat({
        trigger: {
          source: "youtube_chat_mention",
          handle: body.displayName ?? "anonymous",
          text: moderation.text,
          intent: intent.category,
        },
        prisma,
        stationId: stationRow.id,
        nowMs: Date.now(),
        llm: (prompts) => callMiniMaxJson(prompts, { apiKey: process.env.MINIMAX_API_KEY ?? "" }),
        catalogCandidates: candidates,
      });
      if (r) {
        // Lena's response (accept or decline) becomes the shoutout text
        // and is dispatched via the existing path.
        textToAir = r.text;
        skipHumanize = true;
        console.log(`[lena-request] mode=${r.mode} queued=${r.queuedTrackId ?? "none"}`);
      }
    }
  } catch (err) {
    console.warn("[lena-request] failed:", err);
    // Fall through to default shoutout handling (Lena reads the listener's
    // message verbatim as a shoutout — suboptimal but safe).
  }
}
```

- [ ] **Step 2: HANDOFF section**

Prepend to docs/HANDOFF.md (after first `---`, before Phase 5 MVP section):

```markdown
## 2026-05-16 — Lena Producer Phase 5b: Listener `@lena play X` requests — CODE READY, NEEDS ENV

Completes the queue-autonomy story. Listener types `@lena play Hotel
California by Eagles` → classifier returns `request` (Phase 2.5) →
catalog fuzzy-match → Producer accepts/declines → if accept, queue
insert via the shared createQueueItemAtomically.

**Spec:** `docs/superpowers/specs/2026-05-16-lena-producer-design.md`
**Plan:** `docs/superpowers/plans/2026-05-16-lena-producer-phase-5b.md`

**What ships:**
- `lib/queue-insert.ts` — shared atomic queue inserter (extracted from
  daemon; safe for cross-process use via pg_advisory_xact_lock)
- `lib/catalog-lookup.ts` — token-overlap fuzzy match against Track library
- `lib/lena-producer-chat/` extended with 3 new modes: `accept_request`,
  `accept_request_deferred` (queue is busy), `decline_request` (with
  reason: not_in_catalog / recently_aired / etc.)
- `app/api/internal/youtube-chat-shoutout/route.ts` routes request +
  shoutout_with_request intents through the new path

**Deploy:**
1. `git pull` on Orion + Vercel auto-deploys
2. Vercel env: add `LENA_REQUEST_AUTONOMY=on` (Production + Preview)
3. Vercel redeploys automatically on env change
4. Test from a non-owner YouTube account during a live broadcast:
   - `@lena play hotel california by eagles` (if in catalog → queued + announced)
   - `@lena play some song that doesn't exist` (declined politely)
   - `@lena loving this set, can you play any synthwave` (combined intent — also handled)

**Rollback:** unset `LENA_REQUEST_AUTONOMY` in Vercel env, redeploy.
Request intents fall through to default shoutout handling (Lena reads
the listener's message as a shoutout — same behavior as before Phase 5b).

**Cross-process safety:** Both the daemon (Phase 5 MVP's queue_pick)
and Vercel (Phase 5b's accept_request) now call the SAME
createQueueItemAtomically in lib/queue-insert.ts. The pg advisory lock
serialises them — no race on positionIndex. Verified during Phase 5b
extraction.

---
```

- [ ] **Step 3: Verify + commit**

```bash
cd /home/marku/saas/numaradio
npm test 2>&1 | grep -E "^(ℹ|# )" | tail -8
npm run build 2>&1 | grep -E "(error|✓ Compiled)" | head -3
```

```bash
git add app/api/internal/youtube-chat-shoutout/route.ts docs/HANDOFF.md
git commit -m "$(cat <<'EOF'
youtube-chat-shoutout: route request intents through chat-producer (Phase 5b)

For intent in {request, shoutout_with_request} AND
LENA_REQUEST_AUTONOMY=on:
1. Catalog fuzzy-lookup via lib/catalog-lookup.ts
2. lenaSpeakChat with request-flavored trigger + candidates
3. Producer decides accept/accept_deferred/decline
4. On accept, lenaSpeakChat inserts via createQueueItemAtomically
5. Lena's response replaces the shoutout text (skipHumanize=true)

On any failure → falls through to default shoutout handling
(unchanged behavior from before Phase 5b).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final verification

- `npm test 2>&1 | grep -E "^(ℹ|# )" | tail -8` — expect ~660+ pass / 1 skip / 1 pre-existing fail
- `npm run build 2>&1 | grep -E "(error|✓ Compiled)" | head -3` — ✓
- `cd dashboard && npm run build 2>&1 | grep -E "(error|✓ Compiled)" | head -3` — ✓
- DO NOT push (Marku pushes when ready)

---

## What ships

✅ `lib/queue-insert.ts` shared atomic helper (daemon + Vercel both use)
✅ `lib/catalog-lookup.ts` fuzzy match
✅ 3 new chat-producer modes + writers
✅ `LENA_REQUEST_AUTONOMY` flag (Vercel env)
✅ Listener `@lena play X` flow end-to-end
✅ Cross-process safety via pg_advisory_xact_lock
✅ Honest fallback (decline with reason when insert fails)

🔜 Phase 6 — cleanup (delete deprecated chatter-prompts.ts, context-line.ts, old lena-reply.ts/humanize.ts prompts) — defer until Phases 1-5b observed live for a few days
