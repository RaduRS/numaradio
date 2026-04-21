# Dashboard polish — held card, unified headers, B2 bandwidth widget

**Date:** 2026-04-21
**Status:** Approved, ready for implementation plan

## Problem

Three small quality-of-life gaps on the operator dashboard:

1. **Held shoutouts are buried.** They only appear on `/shoutouts`.
   Because the operator spends most of the day on the main dashboard
   (`/`), a listener submission that MiniMax held can sit unreviewed
   until the next navigation. The new Telegram-approval flow helps, but
   is a fallback — the dashboard is the primary surface.
2. **Header inconsistency.** `/shoutouts` uses a three-column header
   ("← Operator / Shoutouts / Library →") and is missing the
   Numa·Radio logo. `/` and `/library` both lead with the logo on the
   left and a single back-link on the right. The operator wants every
   dashboard page to look like it belongs to the same app.
3. **No visibility into B2 bandwidth.** Backblaze caps the free plan at
   6 GB egress per day. The operator checks the B2 web dashboard
   manually to see how close they are to the cap. A rough estimate on
   the main dashboard would eliminate the context-switch.

## Constraints

- **Reuse existing endpoints, don't invent new ones unless necessary.**
  The held card reuses `/api/shoutouts/list` (adds a second poll loop
  to `/` but not a new endpoint). The bandwidth pill needs its own
  endpoint because there isn't a natural home for it. `/api/status`
  stays focused on infra status.
- **Held-card behaviour must match `/shoutouts`' Held card.** Same
  `approve`/`reject` endpoints (the ones refactored in the 2026-04-21
  telegram-shoutout-approvals spec), so both the main dashboard and
  the Telegram flow end up in the same DB state via the shared helper.
- **Bandwidth is an estimate, not a measurement.** B2's public API
  does not expose daily egress cleanly. We compute it from
  `PlayHistory` × `TrackAsset.byteSize`. Label everything "est." so
  the estimate claim is honest.
- **Quiet dashboard when idle.** The held card only renders when
  `held.length > 0`. No empty-state row, no reserved whitespace.

## Components

### 1. Held shoutouts card on `/`

**New file:** `dashboard/components/held-shoutouts-card.tsx`

Client component. Accepts `{ held: ShoutoutRow[]; onAction: () => void }`
as props. Renders `null` when `held.length === 0`; otherwise renders a
`<Card>` with an accent border and:

- Header: "Held for review" + count badge (`·  <N>`).
- One row per held shoutout:
  - Requester name (or "anonymous") in `font-mono text-xs`.
  - Raw text (or cleanText when present), clipped at ~200 chars with
    `line-clamp-2`.
  - Moderation reason as a small pill/badge.
  - **Approve** button (accent/primary variant) → `POST
    /api/shoutouts/[id]/approve` → on 2xx calls `onAction()` to
    refresh; on error surfaces a `toast` with the message.
  - **Reject** button (ghost variant) → `POST
    /api/shoutouts/[id]/reject` → same pattern. No reason prompt in
    this card — the CF-Access reject route doesn't accept one, and
    keeping parity with the current `/shoutouts` Held card avoids a UX
    fork.

**Wiring in `dashboard/app/page.tsx`:**

- Add a parallel `usePolling<ShoutoutsListResponse>("/api/shoutouts/list", 5_000)`.
- Insert `<HeldShoutoutsCard held={shoutoutsData?.held ?? []} onAction={shoutoutsPoll.refresh} />` between `StatusPills` and `ServicesCard`.
- The card returns `null` on empty so it doesn't contribute to layout.

Shoutouts polling on `/` is cheap: the existing
`/api/shoutouts/list` endpoint already runs two small SELECTs
(`listHeldShoutouts` + `listRecentShoutouts`). We accept the tiny extra
DB load because the feature needs the held set live.

### 2. Unified header on `/shoutouts`

**File:** `dashboard/app/shoutouts/page.tsx`

Replace the existing header block (currently "← Operator / Shoutouts /
Library →") with the same shape `/library` uses:

```jsx
<header className="flex flex-col gap-1">
  <div className="flex items-center justify-between">
    <span
      className="font-display text-2xl font-extrabold uppercase tracking-wide"
      style={{ fontStretch: "125%" }}
    >
      Numa<span className="text-accent">·</span>Radio
    </span>
    <Link
      href="/"
      className="font-mono text-xs uppercase tracking-[0.2em] text-fg-mute hover:text-fg"
    >
      ← Dashboard
    </Link>
  </div>
  <span className="font-mono text-xs uppercase tracking-[0.2em] text-fg-mute">
    Shoutouts · <N> held · <M> recent · polling every 8s{isStale ? " · ⚠ stale, retrying" : ""}
  </span>
</header>
```

The "Library →" link is dropped from this header — the main dashboard
already exposes both Shoutouts and Library from its nav, and operators
go back to `/` to move between sub-pages. This matches `/library`
(which has no "← Shoutouts" shortcut for the same reason).

### 3. B2 bandwidth estimate

**Goal:** a small pill visible on `/` showing `B2 est. today · 3.4 / 6.0 GB`
with a slim progress bar underneath and a colour tier based on
percentage used. Tooltip: "Estimated from today's plays since
midnight UTC. Actual B2 egress may differ by a few percent."

**New lib helper:** `dashboard/lib/bandwidth.ts`

```typescript
export interface BandwidthToday {
  bytesToday: number;
  capBytes: number;
  fractionUsed: number;   // 0..1, capped at 1
  unaccountedRows: number; // PlayHistory rows without an audio asset
  sampledRows: number;     // rows considered
}

export async function fetchBandwidthToday(pool: Pool): Promise<BandwidthToday>;
```

One query, roughly:

```sql
WITH today_plays AS (
  SELECT id, "trackId"
    FROM "PlayHistory"
   WHERE "startedAt" >= date_trunc('day', NOW() AT TIME ZONE 'UTC')
)
SELECT
  COALESCE(SUM(ta."byteSize"), 0)::bigint AS bytes_today,
  COUNT(*)                            AS sampled_rows,
  COUNT(*) FILTER (WHERE ta.id IS NULL) AS unaccounted_rows
FROM today_plays tp
LEFT JOIN "TrackAsset" ta
       ON ta."trackId"   = tp."trackId"
      AND ta."assetType" = 'audio_stream'
```

`capBytes` comes from `process.env.B2_DAILY_CAP_GB` (default `6`) ×
1024³.

**New route:** `dashboard/app/api/bandwidth/today/route.ts`

- Public within the CF-Access zone (no extra auth — it's already gated
  at the edge).
- GET only.
- Returns `{ ok: true, ...BandwidthToday }` or `{ ok: false, error }`.
- Logs a `console.warn` if `unaccountedRows / sampledRows > 0.05`, so
  we notice when the estimator drifts (e.g., a new asset type lands
  that we're not counting).

**New UI component:** `dashboard/components/bandwidth-pill.tsx`

Thin client component. Accepts `BandwidthToday` prop. Renders a pill
with:

- Label "B2 today" in `font-mono text-xs`.
- Value "X.X / 6.0 GB" formatted to one decimal place.
- Progress bar using existing Tailwind tokens: `bg-accent` under 70%,
  `bg-amber-500` 70–90%, `bg-red-500` above 90%.
- Tooltip via `title=""` with the label "Estimated from today's
  plays since midnight UTC. Actual B2 egress may differ by a few
  percent."

Wired into `dashboard/app/page.tsx` alongside `<StatusPills>` — either
inside the existing pill row or as its own narrow row just below.
Implementation note: `StatusPills` is not the right place to jam this
in because it currently takes a `StatusSnapshot` shape. Render
`<BandwidthPill>` as a sibling to `StatusPills` with its own polling
cadence (reuse `usePolling<BandwidthToday>("/api/bandwidth/today",
30_000)` — bandwidth changes slowly, 30 s is plenty and keeps DB load
low).

## Interface contracts

**`GET /api/bandwidth/today`**

Response:

```json
{
  "ok": true,
  "bytesToday": 3650721280,
  "capBytes": 6442450944,
  "fractionUsed": 0.5666,
  "sampledRows": 42,
  "unaccountedRows": 0
}
```

Error (500): `{ "ok": false, "error": "<message>" }`. The pill falls
back to a grey "B2 today · —" when the API returns not-ok.

**Approve/Reject endpoints used by the held card** — unchanged from
their current contracts (`POST /api/shoutouts/[id]/approve` and
`.../reject`, CF-Access-authenticated, shared helper behind both).

## Error handling & edge cases

- **Held card: approve fails with 409** (already handled on Telegram
  or by another operator clicking just before) — toast the error
  verbatim ("already aired" or "not held"), refresh the list. Row
  disappears. Same for reject 409.
- **Held card: approve 500** (Deepgram/B2/queue daemon down) — toast
  the error, do NOT auto-remove the row. Operator retries when the
  downstream comes back.
- **Bandwidth query fails** (Neon down, unreachable) — the `/today`
  route returns 500; the pill shows greyed-out placeholder. Dashboard
  does not crash or block.
- **Zero rows today** (midnight UTC, nothing played yet) — pill shows
  `0.0 / 6.0 GB`, progress bar empty. This is a normal state.
- **Unaccounted rows > 5%** — logged server-side; UI continues
  showing whatever the SUM returned. Indicates an ingest bug or a
  new asset-type not being counted. (Example: if `audio_stream` is
  renamed to `audio_mp3` one day, every play becomes unaccounted.)
- **`B2_DAILY_CAP_GB` env unset** — default `6`. Setting it to a
  different number requires only a dashboard restart.
- **Clock-skew boundary** — the "today" boundary is midnight UTC.
  Backblaze's cap window is also UTC, so operator will see the
  estimate reset at the same moment the cap resets.

## Testing

**Unit (`dashboard/lib/bandwidth.test.ts`):**

- Returns `bytesToday = 0` and `sampledRows = 0` when the mocked pool
  returns an empty `today_plays`.
- Returns `bytesToday = SUM(byteSize)` across mocked rows, joining on
  `trackId`.
- Returns `unaccountedRows = <count>` for mocked rows whose LEFT JOIN
  produced `NULL`.
- `capBytes` reflects `B2_DAILY_CAP_GB` env; defaults to 6 GiB
  (6 × 1024³).
- `fractionUsed` clips to 1.0 when `bytesToday > capBytes`.

**No UI tests.** The three UI surfaces (header edit, held card,
bandwidth pill) are verified visually during the manual integration
pass.

**Manual integration:**

1. Open `/` when at least one shoutout is in `held` state. Card
   appears right below `StatusPills` with the count and correct rows.
2. Click Approve on a held row → Lena airs it, row disappears from
   both `/` and `/shoutouts` Held cards.
3. Click Reject on another held row → row moves to Recent on
   `/shoutouts` with `rejected_by:<your-cf-email>`; card on `/`
   removes it.
4. Open `/shoutouts` — header is "Numa·Radio ... ← Dashboard",
   matching `/library`.
5. Check the bandwidth pill on `/`. Compare the number to the
   Backblaze web console — they should agree within a few percent.
6. Force the pill red by temporarily setting `B2_DAILY_CAP_GB=0.1`
   and restarting the dashboard — pill should turn red and show
   fractionUsed > 1.0 clipped at 100%.

## Out of scope

- No Held-card on `/library` (the operator is there to push tracks,
  not moderate).
- No new moderation reasons, no UI for editing the shoutout before
  approving (if it needed editing, it should be rejected and
  re-submitted).
- No email/push/desktop notifications for held rows (Telegram already
  handles out-of-dashboard alerting).
- No historical bandwidth graph or per-hour breakdown — just the
  today total.
- No B2 log ingestion, no real-time B2 egress measurement. Estimate
  from `PlayHistory` only.

## Rollout

1. Implement behind the existing dashboard deploy flow (`cd
   dashboard && npm run deploy`).
2. `B2_DAILY_CAP_GB` is optional; default 6. Set in
   `dashboard/.env.local` if the cap ever changes.
3. After deploy, eyeball the three surfaces (held card, unified
   header, bandwidth pill). If the bandwidth number looks off (more
   than ~10% vs. the B2 dashboard), check `unaccountedRows` in the
   API response and investigate the asset-type filter.

## Rollback

Each of the three changes is independent. Revert commits in any order;
the previous surface behaviour returns.
