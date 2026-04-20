# Dashboard Library Page — design

**Date:** 2026-04-20
**Status:** Approved (user-authorized direct build)

## Purpose

Give the operator a way, from the dashboard, to:

1. Browse the library (titles, artists, durations, status, genre/mood) without SSH or `psql`.
2. Pick one song and have it play next on the live stream — without invoking the `npm run queue:push` CLI.

Use case: a blend of catalog inspector and DJ-style override. Operator goes to the page, finds a track, hits "Play Next", trusts it'll air at the next track boundary.

## Scope (what is and isn't in v1)

**In:**
- New page at `/library` on the dashboard (separate route, not a card on `/`).
- Searchable, status-filterable list of all `Track` rows for the `numaradio` station.
- One-click "Play Next" button per row that pushes to the priority queue via the existing daemon `/push` endpoint.
- Sonner toast for success / failure feedback.
- "Recent pushes" panel reading the daemon's existing `/status` endpoint (`lastPushes` + `lastFailures`).
- Nav link from the main dashboard page to `/library`.

**Out (YAGNI for v1):**
- Live "what's currently in the priority queue inside Liquidsoap" view (would need a new daemon endpoint).
- Bulk select / multi-push.
- Confirm dialog (push is low-blast-radius; one click is fine).
- Undo / cancel a queued push.
- Per-track inline edit (title, genre, mood, etc.).
- Pagination (single-page render fine at 50-500 row scale).
- Server-side search.

## Architecture

Three new dashboard routes plus one new page component.

### Server-side

**`GET /api/library/tracks`** — `dashboard/app/api/library/tracks/route.ts`

Queries Neon directly with the existing `pg` pool (`dashboard/lib/db.ts`). Scopes by station slug (`numaradio` or `STATION_SLUG` env). Returns one row per `Track`, with the primary audio asset's `publicUrl` and the primary art asset's `publicUrl` joined in. Server-side filter: only tracks where `airingPolicy='library'` (the rotation policy).

Response shape:
```ts
{
  tracks: Array<{
    id: string;
    title: string;
    artist: string | null;
    durationSeconds: number | null;
    bpm: number | null;
    genre: string | null;
    mood: string | null;
    trackStatus: 'draft' | 'ready' | 'failed' | string;
    createdAt: string;          // ISO
    audioStreamUrl: string | null;   // null = un-pushable
    artworkUrl: string | null;
  }>;
}
```

The `audioStreamUrl` is what gets POSTed to the daemon. If null (no `audio_stream` asset) the row's "Play Next" button is disabled — pushing such a track would crash the player.

**`POST /api/library/push`** — `dashboard/app/api/library/push/route.ts`

Body: `{ trackId: string }`. Looks the track up in Neon (must exist, must have an `audio_stream` asset, must have `airingPolicy='library'`). Forwards to `http://127.0.0.1:4000/push` with `{ trackId, sourceUrl, reason: "dashboard:<email>" }` where `<email>` comes from the `cf-access-authenticated-user-email` header (same pattern as the services route). Returns `{ ok: true, queueItemId }` or `{ ok: false, error }`.

**`GET /api/library/recent-pushes`** — `dashboard/app/api/library/recent-pushes/route.ts`

Thin proxy of `http://127.0.0.1:4000/status`. Returns `{ lastPushes, lastFailures }` (the `socket` field is irrelevant for this view). 2-second timeout; on error returns `{ lastPushes: [], lastFailures: [], error: <msg> }` so the panel can degrade gracefully.

### Client-side

**`/library/page.tsx`** — `dashboard/app/library/page.tsx`

Layout: same `mx-auto max-w-5xl px-6 py-10` as `/`, header matching the dashboard's, then:

1. Search input (title/artist substring, case-insensitive, client-side filter).
2. Status filter chips: `all` (default) / `ready` / `draft` / `failed` / `other`. Click toggles.
3. Table of tracks (HTML `<table>` with the same Tailwind-token aesthetic as the existing cards). Columns: artwork thumbnail (32px), Title, Artist, Duration (mm:ss), Status badge, [Play Next] button.
4. Recent pushes panel below the table — last ~10 pushes with timestamps, last few failures with error messages.

Polling: tracks list polled every 30s via `usePolling` (low-frequency — ingestion is rare). Recent pushes polled every 5s after a push action so the operator sees their action confirmed.

Sort default: `createdAt DESC` (newest first).

### Nav

Add a single text link in the main dashboard's header — "Library →" — that routes to `/library`. Library page reciprocates with "← Dashboard".

## Data flow

```
[user] click "Play Next" on row "Sunset"
  └─→ POST /api/library/push { trackId: 'cmo6...' }
       └─→ Neon SELECT track + audio_stream asset
       └─→ POST http://127.0.0.1:4000/push { trackId, sourceUrl, reason: 'dashboard:rsrusu90@gmail.com' }
            └─→ daemon writes telnet `priority.push <url>` to Liquidsoap
            └─→ daemon stores in lastPushes ring buffer
       └─→ returns { ok: true, queueItemId }
  └─← UI shows toast.success("Queued — Sunset"), refreshes recent-pushes panel
```

## Error handling

- DB unreachable → tracks API returns 503, page shows "Library unavailable — check Neon health".
- Daemon unreachable → push API returns 502, toast shows error with detail; recent-pushes panel shows degraded state.
- Track has no `audio_stream` asset → button disabled with tooltip "No audio asset".
- Track is not `airingPolicy='library'` → server filters it out (never appears in list).
- Push succeeds but Liquidsoap was restarted between push and on_track → priority queue stays empty in LS; daemon's `lastPushes` will still show it. Acceptable — operator can re-push.

## Testing

Mirror existing dashboard test patterns (`lib/*.test.ts` using `node --test --experimental-strip-types`). Add:

- `lib/library.test.ts` — pure SQL builder + parser tests (mocked pg pool).
- Smoke test added to `scripts/smoke.ts`: hit `/api/library/tracks` and assert response shape.
- Manual: `curl http://127.0.0.1:3001/api/library/tracks | jq` then push the first track via curl and verify the `[numa] track:` log line appears in Liquidsoap.

## Why not a new daemon endpoint?

Considered exposing `priority.queue` via the daemon (so the dashboard could show "3 songs waiting"). Skipped because:

- Operator pushes one song at a time; queue depth is rarely > 1.
- `lastPushes` from `/status` already covers the "did my action work?" question.
- It's a small, well-scoped follow-up if usage shows we want it.

## Files touched

New:
- `dashboard/app/library/page.tsx`
- `dashboard/app/api/library/tracks/route.ts`
- `dashboard/app/api/library/push/route.ts`
- `dashboard/app/api/library/recent-pushes/route.ts`
- `dashboard/lib/library.ts` — SQL queries + types shared between the two server-side routes
- `dashboard/lib/library.test.ts`
- `docs/superpowers/specs/2026-04-20-dashboard-library-card-design.md` (this file)

Modified:
- `dashboard/app/page.tsx` — header gets a "Library →" link
- `docs/HANDOFF.md` — note the new page in the dashboard section
