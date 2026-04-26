# Dynamic Lena quote — design

Date: 2026-04-26

## Problem

The "Lena · Host · Live" block on the public site shows a single
hard-coded paragraph in four places (PlayerCard, ExpandedPlayerDesktop,
ExpandedPlayerMobile, About page):

> "Alright, night owls — that's Russell sliding into frame. Someone
> in Lisbon asked for slow and a little heartbroken. I heard you.
> We'll pick the tempo back up after this one, promise."

Same words every page load. Reads as marketing copy that *pretends*
to be live, which undercuts the "always-on" brand.

## Goal

Replace the static paragraph with a dynamic line per page render
that feels alive. Two channels feed it:

1. **Real auto-chatter** — when the queue daemon has just spoken
   (≤ 5 min ago), display **what Lena actually said**.
2. **Per-show pool** — a curated library of ~150 evergreen Lena
   lines per show (~600 total), picked at random when no fresh
   chatter is available.

## Non-goals

- Generating Lena lines on demand at page render via MiniMax
  (cost/latency unsuitable for a render path)
- Replacing the actual broadcast chatter pipeline (it stays
  voice-over-air; this only surfaces the script text on the site)
- Tying any track-specific chatter to the page if the displayed
  track has since changed (the timestamp on the line frames it
  as "what she just said")

## Architecture

```
┌─ queue-daemon (auto-host.runChatter) ─────────────────────┐
│ generates Lena script (MiniMax) → TTS (Deepgram) →       │
│ overlays on stream                                        │
│                                                            │
│ NEW: also persists script + type + timestamp to Chatter   │
│      table in Neon                                         │
└───────────────────────────────────────────────────────────┘
                                   │
                                   ▼
                        ┌──────────────────────┐
                        │  Neon: Chatter rows  │
                        └──────────────────────┘
                                   ▲
                                   │ recent (≤ 5 min)?
                                   │
┌─ Vercel: /api/station/lena-line ──────────────────────────┐
│  if recent Chatter row → return { source: "live",         │
│                                   script, atIso, type }   │
│  else                  → return { source: "pool",         │
│                                   script }                │
│                            (random pool quote for current │
│                            show, derived from time-of-day)│
└───────────────────────────────────────────────────────────┘
                                   │
                                   ▼
        ┌── PlayerCard / ExpandedPlayer / About page ──┐
        │  client polls every 60 s, renders the line   │
        │  as the Lena card body                       │
        └──────────────────────────────────────────────┘
```

## Schema change

New table in `prisma/schema.prisma`:

```prisma
model Chatter {
  id          String   @id @default(cuid())
  stationId   String
  /// "back_announce" | "shoutout_cta" | "song_cta" | "filler"
  chatterType String
  /// 1..20 — slot index in the daemon's rotation buffer
  slot        Int
  script      String
  audioUrl    String?
  airedAt     DateTime @default(now())

  station Station @relation(fields: [stationId], references: [id])

  @@index([stationId, airedAt])
}
```

Migration: `add_chatter_table` (additive, zero-downtime).

## Daemon write

`workers/queue-daemon/auto-host.ts:generateAsset()` already returns
`{ chatterId, type, slot, url, script }`. The pipeline currently
calls `deps.logPush(entry)` which writes to an in-memory ring
buffer. **Add** a parallel `await prisma.chatter.create({...})` so
the script lands in Neon. Failure mode: if Neon is down, log + skip
(don't block the broadcast). The audio still fires regardless.

## Pool generation

One-shot script: `scripts/generate-lena-quote-pool.ts`

- Reuses the existing MiniMax client (`workers/queue-daemon/minimax-script.ts`)
- Calls MiniMax with a per-show prompt that asks for **150 evergreen
  Lena lines** (no specific track refs — the line should make sense
  any time of day within the show window)
- Saves to `patterns/lena-quotes/<show>.json` as a `string[]`
- Run once per show (4 calls). Total runtime ~15-25 minutes per show
  given MiniMax's rate limits and the 150-line ask, so plan for ~1
  hour total. Idempotent — script skips shows whose JSON already
  has ≥ 150 entries.

Each prompt anchors the show's voice:

- **Night Shift:** intimate, hypnotic, breathy. Short.
- **Morning Room:** warm, observational, gentle.
- **Daylight Channel:** composed, cohesive, calm.
- **Prime Hours:** charged, playful, sharper.

Validation: each line is 1-3 sentences, max ~280 chars, no real
artist names, no specific track titles, no time-of-day markers
that would lock to a moment ("right now", "the next hour" are OK;
"4 AM exactly" is not).

## Vercel API: `/api/station/lena-line`

```ts
GET /api/station/lena-line?show=<show?>
→ { source: "live", script: "...", atIso: "...", type: "filler" }
  | { source: "pool", script: "..." }
```

If `show` query param is omitted, derive from current local hour
via `lib/schedule.ts:showForHour()`. Look up the most recent
Chatter row for the station within the last 5 minutes; if found,
return it as `live`. Otherwise, pick a random pool line from
`patterns/lena-quotes/<show>.json` and return as `pool`.

`force-dynamic` so we hit Neon every poll, but the result is
cheap (one indexed query + one file read). Falls back gracefully:
if the pool file is missing, return a minimal hardcoded line so
the UI never breaks.

## Frontend wire-up

Replace the 4 hard-coded blocks in:
- `app/_components/PlayerCard.tsx`
- `app/_components/ExpandedPlayerDesktop.tsx`
- `app/_components/ExpandedPlayerMobile.tsx`
- `app/about/page.tsx`

With a new client component:

```tsx
<LenaLine />
```

That component:
- Polls `/api/station/lena-line` every 60 s
- Shows "Lena · on the mic" + the line text
- When `source === "live"`, optionally appends a small "· just now"
  / "· 2 min ago" timestamp to make the live-ness legible
- Skeleton on first render until the first poll lands (uses the
  existing `<Skeleton />` primitive)

The `usePolling` hook from the dashboard codebase isn't shared
into the public site, but the existing `useNowPlaying` /
`useBroadcast` patterns set the precedent for client-side
polling with shared cache. Use the same shape: a small singleton
in `app/_components/useLenaLine.ts`, fetch on mount, 60 s
interval, abort on unmount.

## Edge cases

- **Daemon paused / no chatter for hours**: API always returns
  `pool` source. Site never breaks.
- **Pool JSON missing or empty for a show**: API returns the
  hardcoded fallback line ("Always live. Stay a while."). Site
  never breaks.
- **Multiple Chatter rows in last 5 min**: API returns the most
  recent (`ORDER BY airedAt DESC LIMIT 1`).
- **Live chatter mentions a track that's since aged out**: timestamp
  on the line ("3 min ago") frames it as past-tense. Acceptable.

## Performance / cost

- DB: one indexed query per page (Chatter by station, airedAt).
  Negligible. Cached for 60 s on the client side.
- File I/O: one JSON read per pool fall-through. Cached at module
  level on the server, so first-hit cost only.
- Daemon: one extra Prisma write per chatter push (~every 9 min on
  average). Trivial.
- Frontend: ~1 KB JSON per poll, every 60 s. Trivial.

## Build sequence

1. **Spec** (this doc) ✓
2. **Schema migration** — add `Chatter` model + run `npx prisma
   migrate dev --name add_chatter_table`
3. **Pool generation script** — `scripts/generate-lena-quote-pool.ts`
   reusing `workers/queue-daemon/minimax-script.ts`. Run once per
   show. Long step (~1 h total).
4. **Validation pass** — quick sanity over the generated pools to
   ensure no trailing real-artist names / track titles. Trim the
   ~5 % of duds if any.
5. **Daemon update** — add `await prisma.chatter.create({...})`
   in the `generateAsset` flow next to `logPush`. Run worker tests.
6. **API route** — `app/api/station/lena-line/route.ts` with the
   live/pool branching.
7. **Client component + hook** — `app/_components/LenaLine.tsx` +
   `useLenaLine.ts` singleton.
8. **Replace the four hardcoded blocks** with `<LenaLine />`.
9. **Build** + smoke test.
10. **Push**, Vercel auto-deploy. **Restart `numa-queue-daemon`**
    so the Chatter writes start landing.

## Out of scope (deferred)

- Per-line popularity tracking ("which Lena lines do listeners
  resonate with") — premature
- Operator-curated promotion of a specific Lena line — operator can
  edit the pool JSON if a line bombs
- AI-on-demand line generation per page view — too expensive at
  scale; the pool already gives enough variety
- Surfacing the live chatter on the dashboard — the dashboard already
  has the lastPushes ring buffer in /status; no public-site change
  affects it
