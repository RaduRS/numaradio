# Dashboard Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Held Shoutouts card to the main dashboard, unify the `/shoutouts` header with `/` and `/library`, and show a rough B2-egress-today pill on `/`.

**Architecture:** Extract the Held card from `/shoutouts` into a shared `components/held-shoutouts-card.tsx` so both `/` and `/shoutouts` render the same component. Add a new `/api/bandwidth/today` endpoint backed by a SQL sum over today's `PlayHistory` × `TrackAsset.byteSize`, plus a `BandwidthPill` component that polls it.

**Tech Stack:** Next.js 16 App Router, React client components, `pg` raw queries on the dashboard, `usePolling` hook, Tailwind tokens defined in `app/globals.css`, Node test runner (`node --test --experimental-strip-types`).

**Spec:** `docs/superpowers/specs/2026-04-21-dashboard-polish-design.md`

---

## File structure

**New files:**
- `dashboard/components/held-shoutouts-card.tsx` — shared Held card.
- `dashboard/lib/bandwidth.ts` — `fetchBandwidthToday(pool)` helper + types.
- `dashboard/lib/bandwidth.test.ts` — unit tests.
- `dashboard/app/api/bandwidth/today/route.ts` — GET endpoint.
- `dashboard/components/bandwidth-pill.tsx` — pill UI.

**Modified files:**
- `dashboard/app/shoutouts/page.tsx` — swap inline Held card for the extracted component; unify header with `/library`'s pattern.
- `dashboard/app/page.tsx` — add Held card + Bandwidth pill with their own polls.

---

## Task 1: Extract `HeldShoutoutsCard` component

**Files:**
- Create: `dashboard/components/held-shoutouts-card.tsx`

Copy-extract the existing `/shoutouts` Held card into a standalone component so both pages can render it.

- [ ] **Step 1: Create the component**

Create `dashboard/components/held-shoutouts-card.tsx` with this EXACT content:

```typescript
"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ShoutoutRow } from "@/lib/shoutouts";

interface Props {
  held: ShoutoutRow[];
  onAction: () => void;
  /**
   * When true, the card is only rendered if `held.length > 0`.
   * Used on the main dashboard where the card should vanish when idle.
   * Default false: always render (used on /shoutouts where the empty
   * state is also informative).
   */
  hideWhenEmpty?: boolean;
}

function fmtRelative(iso: string): string {
  const d = new Date(iso);
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  if (sec < 600) return `${Math.floor(sec / 60)}m ago`;
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const hhmm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return hhmm;
  const mmmdd = d.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${mmmdd} ${hhmm}`;
}

export function HeldShoutoutsCard({ held, onAction, hideWhenEmpty = false }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);

  async function act(id: string, action: "approve" | "reject") {
    setBusyId(id);
    try {
      const res = await fetch(`/api/shoutouts/${id}/${action}`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        toast.error(body.error ?? `failed to ${action}`);
      } else if (action === "approve") {
        toast.success("Approved — Lena is on it.");
      } else {
        toast.success("Rejected.");
      }
      onAction();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "network error");
    } finally {
      setBusyId(null);
    }
  }

  if (hideWhenEmpty && held.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-3">
          Held for review
          <Badge className="border-[var(--warn)] text-[var(--warn)]">
            {held.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {held.length === 0 ? (
          <p className="text-sm text-fg-mute">
            Nothing waiting. MiniMax is handling everything that&apos;s come in.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--line)]">
            {held.map((s) => (
              <li
                key={s.id}
                className="flex items-start gap-4 py-4 first:pt-0 last:pb-0"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="font-mono text-xs uppercase tracking-[0.15em]">
                      {s.requesterName ?? "anonymous"}
                    </span>
                    <span className="font-mono text-[10px] text-fg-mute">
                      {fmtRelative(s.createdAt)}
                    </span>
                  </div>
                  <p className="text-sm">
                    &ldquo;{s.cleanText ?? s.rawText}&rdquo;
                  </p>
                  {s.cleanText && s.cleanText !== s.rawText && (
                    <p className="mt-1 text-xs text-fg-mute">
                      original: {s.rawText}
                    </p>
                  )}
                  {s.moderationReason && (
                    <p className="mt-1 text-xs text-fg-mute">
                      reason: {s.moderationReason}
                    </p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="default"
                    disabled={busyId === s.id}
                    onClick={() => act(s.id, "approve")}
                  >
                    {busyId === s.id ? "…" : "Approve"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === s.id}
                    onClick={() => act(s.id, "reject")}
                  >
                    Reject
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Build to confirm types compile**

```bash
cd /home/marku/saas/numaradio/dashboard && npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
cd /home/marku/saas/numaradio
git add dashboard/components/held-shoutouts-card.tsx
git commit -m "feat(dashboard): extract HeldShoutoutsCard component

Shared component used by /shoutouts and /. Optional hideWhenEmpty prop
collapses the card to nothing when there are no held items, so the
main dashboard stays quiet on quiet days."
```

---

## Task 2: Refactor `/shoutouts` to use `HeldShoutoutsCard`

**Files:**
- Modify: `dashboard/app/shoutouts/page.tsx`

Remove the inline Held card (and its `fmtRelative` / `act` / `busyId` state that is now owned by the shared component).

- [ ] **Step 1: Inspect the file to locate the exact lines**

```bash
grep -n "fmtRelative\|busyId\|async function act\|Held for review" /home/marku/saas/numaradio/dashboard/app/shoutouts/page.tsx
```

Make sure you know:
- The `fmtRelative` declaration block.
- The `busyId` state.
- The `async function act` body.
- The `<Card>` that renders "Held for review".

- [ ] **Step 2: Replace `act` references and delete the inline card**

In `dashboard/app/shoutouts/page.tsx`:

- Import the new component at the top, alongside the existing imports:
  ```typescript
  import { HeldShoutoutsCard } from "@/components/held-shoutouts-card";
  ```
- **Remove** the top-level `fmtRelative` function declaration (the one above the component).
- **Remove** the `const [busyId, setBusyId] = useState<string | null>(null);` line.
- **Remove** the entire `async function act(id, action) { ... }` body.
- **Replace** the entire `<Card>` for "Held for review" (from its opening `<Card>` to its closing `</Card>`) with:
  ```tsx
        <HeldShoutoutsCard
          held={held}
          onAction={refresh}
        />
  ```
- `fmtRelative` is still used elsewhere in this file (the "Recent" card calls it). **Keep it** if so, delete only if completely unreferenced. Re-grep after the edits:
  ```bash
  grep -n fmtRelative /home/marku/saas/numaradio/dashboard/app/shoutouts/page.tsx
  ```
  If there are no remaining references, remove the declaration. Otherwise leave it in.

- [ ] **Step 3: Build**

```bash
cd /home/marku/saas/numaradio/dashboard && npm run build
```

Expected: build succeeds. If TypeScript complains about unused `useState` or `toast` imports, remove them.

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd /home/marku/saas/numaradio
git add dashboard/app/shoutouts/page.tsx
git commit -m "refactor(dashboard): /shoutouts uses extracted HeldShoutoutsCard"
```

---

## Task 3: Add Held card to `/` (main dashboard) with its own poll

**Files:**
- Modify: `dashboard/app/page.tsx`

- [ ] **Step 1: Edit the page**

Replace the contents of `dashboard/app/page.tsx` with:

```typescript
"use client";
import Link from "next/link";
import { usePolling } from "@/hooks/use-polling";
import { StatusPills } from "@/components/status-pills";
import { ServicesCard } from "@/components/services-card";
import { HealthCard } from "@/components/health-card";
import { LogsCard } from "@/components/logs-card";
import { HeldShoutoutsCard } from "@/components/held-shoutouts-card";
import type { StatusSnapshot } from "@/lib/types";
import type { ShoutoutRow } from "@/lib/shoutouts";

interface ShoutoutsListResponse {
  held: ShoutoutRow[];
  recent: ShoutoutRow[];
}

export default function OperatorDashboard() {
  const { data, isStale, refresh } = usePolling<StatusSnapshot>("/api/status", 5_000);
  const shoutoutsPoll = usePolling<ShoutoutsListResponse>(
    "/api/shoutouts/list",
    5_000,
  );

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10 flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span
            className="font-display text-2xl font-extrabold uppercase tracking-wide"
            style={{ fontStretch: "125%" }}
          >
            Numa<span className="text-accent">·</span>Radio
          </span>
          <nav className="flex items-center gap-4">
            <Link
              href="/shoutouts"
              className="font-mono text-xs uppercase tracking-[0.2em] text-fg-mute hover:text-fg"
            >
              Shoutouts →
            </Link>
            <Link
              href="/library"
              className="font-mono text-xs uppercase tracking-[0.2em] text-fg-mute hover:text-fg"
            >
              Library →
            </Link>
          </nav>
        </div>
        <span className="font-mono text-xs uppercase tracking-[0.2em] text-fg-mute">
          Operator · polling every 5s {isStale ? "· ⚠ stale, retrying" : ""}
        </span>
      </header>

      <StatusPills data={data} isStale={isStale} />
      <HeldShoutoutsCard
        held={shoutoutsPoll.data?.held ?? []}
        onAction={shoutoutsPoll.refresh}
        hideWhenEmpty
      />
      <ServicesCard data={data} onActionComplete={refresh} />
      <HealthCard data={data} />
      <LogsCard />
    </main>
  );
}
```

- [ ] **Step 2: Build**

```bash
cd /home/marku/saas/numaradio/dashboard && npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
cd /home/marku/saas/numaradio
git add dashboard/app/page.tsx
git commit -m "feat(dashboard): Held card on main dashboard

Renders between StatusPills and ServicesCard, hidden when no rows are
held. Uses its own /api/shoutouts/list poll at 5s so the operator can
act without switching to /shoutouts."
```

---

## Task 4: Unify `/shoutouts` header with `/library`

**Files:**
- Modify: `dashboard/app/shoutouts/page.tsx`

- [ ] **Step 1: Replace the header block**

In `dashboard/app/shoutouts/page.tsx`, locate the `<header>` block that currently contains `"← Operator"`, the `"Shoutouts"` title span, and the `"Library →"` link. Replace the entire `<header>...</header>` with:

```tsx
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
          Shoutouts · {held.length} held · {recent.length} recent · polling every 8s{isStale ? " · ⚠ stale, retrying" : ""}
        </span>
      </header>
```

Note: `held`, `recent`, and `isStale` are already destructured near the top of the component from `data` and `usePolling` — no new state needed. If the current file doesn't have local bindings for `held`/`recent`/`isStale`, add these near the top of `ShoutoutsPage()`:

```typescript
  const held = data?.held ?? [];
  const recent = data?.recent ?? [];
```

(and make sure `isStale` is included in the existing destructure from `usePolling`).

- [ ] **Step 2: Build**

```bash
cd /home/marku/saas/numaradio/dashboard && npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
cd /home/marku/saas/numaradio
git add dashboard/app/shoutouts/page.tsx
git commit -m "style(dashboard): unify /shoutouts header with / and /library"
```

---

## Task 5: Bandwidth helper (TDD)

**Files:**
- Create: `dashboard/lib/bandwidth.ts`
- Test: `dashboard/lib/bandwidth.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `dashboard/lib/bandwidth.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import { fetchBandwidthToday, DEFAULT_CAP_BYTES } from "./bandwidth.ts";

interface FakeRow {
  bytes_today: string | number;
  sampled_rows: string | number;
  unaccounted_rows: string | number;
}

function fakePool(row: FakeRow): Pool {
  return {
    query: async () => ({ rows: [row] }),
  } as unknown as Pool;
}

test("fetchBandwidthToday returns zero when nothing has played today", async () => {
  const pool = fakePool({ bytes_today: "0", sampled_rows: "0", unaccounted_rows: "0" });
  const result = await fetchBandwidthToday(pool);
  assert.equal(result.bytesToday, 0);
  assert.equal(result.sampledRows, 0);
  assert.equal(result.unaccountedRows, 0);
  assert.equal(result.capBytes, DEFAULT_CAP_BYTES);
  assert.equal(result.fractionUsed, 0);
});

test("fetchBandwidthToday converts string aggregates from pg to numbers", async () => {
  // pg returns bigint aggregates as strings by default.
  const pool = fakePool({
    bytes_today: "3221225472", // 3 GiB
    sampled_rows: "42",
    unaccounted_rows: "2",
  });
  const result = await fetchBandwidthToday(pool);
  assert.equal(result.bytesToday, 3_221_225_472);
  assert.equal(result.sampledRows, 42);
  assert.equal(result.unaccountedRows, 2);
});

test("fetchBandwidthToday computes fractionUsed against the default 6 GiB cap", async () => {
  const pool = fakePool({
    bytes_today: String(3 * 1024 ** 3), // 3 GiB
    sampled_rows: "10",
    unaccounted_rows: "0",
  });
  const result = await fetchBandwidthToday(pool);
  // 3 GiB out of 6 GiB = 0.5
  assert.ok(Math.abs(result.fractionUsed - 0.5) < 1e-6);
});

test("fetchBandwidthToday clips fractionUsed at 1.0 when over cap", async () => {
  const pool = fakePool({
    bytes_today: String(10 * 1024 ** 3), // 10 GiB, over 6 GiB cap
    sampled_rows: "40",
    unaccounted_rows: "0",
  });
  const result = await fetchBandwidthToday(pool);
  assert.equal(result.fractionUsed, 1.0);
});

test("fetchBandwidthToday reads B2_DAILY_CAP_GB env to override the cap", async () => {
  const prev = process.env.B2_DAILY_CAP_GB;
  process.env.B2_DAILY_CAP_GB = "10";
  try {
    const pool = fakePool({
      bytes_today: String(5 * 1024 ** 3),
      sampled_rows: "5",
      unaccounted_rows: "0",
    });
    const result = await fetchBandwidthToday(pool);
    assert.equal(result.capBytes, 10 * 1024 ** 3);
    assert.ok(Math.abs(result.fractionUsed - 0.5) < 1e-6);
  } finally {
    if (prev === undefined) delete process.env.B2_DAILY_CAP_GB;
    else process.env.B2_DAILY_CAP_GB = prev;
  }
});

test("fetchBandwidthToday handles numeric pg aggregates (future-proof)", async () => {
  // Future pg versions or custom drivers may return numbers directly.
  const pool = fakePool({
    bytes_today: 1024,
    sampled_rows: 1,
    unaccounted_rows: 0,
  });
  const result = await fetchBandwidthToday(pool);
  assert.equal(result.bytesToday, 1024);
  assert.equal(result.sampledRows, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/marku/saas/numaradio/dashboard
npm test -- --test-name-pattern="fetchBandwidthToday"
```

Expected: all 6 cases FAIL with "Cannot find module './bandwidth.ts'".

- [ ] **Step 3: Implement the helper**

Create `dashboard/lib/bandwidth.ts`:

```typescript
import type { Pool } from "pg";

export const DEFAULT_CAP_GB = 6;
export const DEFAULT_CAP_BYTES = DEFAULT_CAP_GB * 1024 ** 3;

export interface BandwidthToday {
  bytesToday: number;
  capBytes: number;
  fractionUsed: number;
  unaccountedRows: number;
  sampledRows: number;
}

function toNumber(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function readCapBytes(): number {
  const raw = process.env.B2_DAILY_CAP_GB;
  if (!raw) return DEFAULT_CAP_BYTES;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_CAP_BYTES;
  return Math.floor(n * 1024 ** 3);
}

export async function fetchBandwidthToday(pool: Pool): Promise<BandwidthToday> {
  const { rows } = await pool.query(
    `
    WITH today_plays AS (
      SELECT "id", "trackId"
        FROM "PlayHistory"
       WHERE "startedAt" >= date_trunc('day', NOW() AT TIME ZONE 'UTC')
         AND "trackId" IS NOT NULL
    )
    SELECT
      COALESCE(SUM(ta."byteSize"), 0)::bigint AS bytes_today,
      COUNT(*)                              AS sampled_rows,
      COUNT(*) FILTER (WHERE ta.id IS NULL) AS unaccounted_rows
    FROM today_plays tp
    LEFT JOIN "TrackAsset" ta
           ON ta."trackId"   = tp."trackId"
          AND ta."assetType" = 'audio_stream'
    `,
  );

  const row = rows[0] ?? {};
  const bytesToday = toNumber(row.bytes_today);
  const sampledRows = toNumber(row.sampled_rows);
  const unaccountedRows = toNumber(row.unaccounted_rows);
  const capBytes = readCapBytes();
  const fractionUsed =
    capBytes > 0 ? Math.min(1, bytesToday / capBytes) : 0;

  return {
    bytesToday,
    capBytes,
    fractionUsed,
    sampledRows,
    unaccountedRows,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --test-name-pattern="fetchBandwidthToday"
```

Expected: all 6 tests pass.

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```

Expected: all tests pass, no regressions.

- [ ] **Step 6: Commit**

```bash
cd /home/marku/saas/numaradio
git add dashboard/lib/bandwidth.ts dashboard/lib/bandwidth.test.ts
git commit -m "feat(dashboard): B2 bandwidth today estimator

Sums byteSize across today's PlayHistory rows joined to their
audio_stream TrackAsset. Caps fractionUsed at 1.0. Defaults to a
6 GiB daily cap; override via B2_DAILY_CAP_GB env."
```

---

## Task 6: `/api/bandwidth/today` route

**Files:**
- Create: `dashboard/app/api/bandwidth/today/route.ts`

- [ ] **Step 1: Create the route**

Create `dashboard/app/api/bandwidth/today/route.ts` with EXACT content:

```typescript
import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import { fetchBandwidthToday } from "@/lib/bandwidth";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const result = await fetchBandwidthToday(getDbPool());
    if (
      result.sampledRows > 0 &&
      result.unaccountedRows / result.sampledRows > 0.05
    ) {
      console.warn(
        `bandwidth-today: unaccounted=${result.unaccountedRows}/${result.sampledRows} rows missing an audio_stream asset`,
      );
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "query_failed";
    console.error(`bandwidth-today: ${msg}`);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 2: Build**

```bash
cd /home/marku/saas/numaradio/dashboard && npm run build
```

Expected: build succeeds. New route appears as `ƒ /api/bandwidth/today` in the Next.js output.

- [ ] **Step 3: Commit**

```bash
cd /home/marku/saas/numaradio
git add dashboard/app/api/bandwidth/today/route.ts
git commit -m "feat(dashboard): GET /api/bandwidth/today

Returns {bytesToday, capBytes, fractionUsed, sampledRows, unaccountedRows}
from the bandwidth estimator. Warns in logs when > 5% of today's plays
have no audio_stream asset."
```

---

## Task 7: `BandwidthPill` component

**Files:**
- Create: `dashboard/components/bandwidth-pill.tsx`

- [ ] **Step 1: Create the component**

Create `dashboard/components/bandwidth-pill.tsx` with EXACT content:

```typescript
"use client";
import type { BandwidthToday } from "@/lib/bandwidth";

interface Props {
  data: BandwidthToday | null;
  isStale: boolean;
}

function gib(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1);
}

function barColorClass(frac: number): string {
  if (frac >= 0.9) return "bg-red-500";
  if (frac >= 0.7) return "bg-amber-500";
  return "bg-accent";
}

export function BandwidthPill({ data, isStale }: Props) {
  if (!data) {
    return (
      <div
        className="flex flex-col gap-1 rounded-md border border-line px-3 py-2"
        title="B2 bandwidth today — awaiting data"
      >
        <div className="flex items-center justify-between gap-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-mute">
            B2 today
          </span>
          <span className="font-mono text-xs text-fg-mute">—</span>
        </div>
      </div>
    );
  }

  const pct = Math.round(data.fractionUsed * 100);
  const usedGib = gib(data.bytesToday);
  const capGib = gib(data.capBytes);

  return (
    <div
      className={`flex flex-col gap-1 rounded-md border border-line px-3 py-2 ${
        isStale ? "opacity-70" : ""
      }`}
      title="Estimated from today's plays since midnight UTC. Actual B2 egress may differ by a few percent."
    >
      <div className="flex items-center justify-between gap-4">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-mute">
          B2 est. today
        </span>
        <span className="font-mono text-xs">
          {usedGib} / {capGib} GB · {pct}%
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded bg-[var(--line)]">
        <div
          className={`h-full ${barColorClass(data.fractionUsed)}`}
          style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build**

```bash
cd /home/marku/saas/numaradio/dashboard && npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
cd /home/marku/saas/numaradio
git add dashboard/components/bandwidth-pill.tsx
git commit -m "feat(dashboard): BandwidthPill component

Shows 'B2 est. today · X / 6.0 GB · NN%' with a thin progress bar.
Colour tiers: accent < 70%, amber 70-90%, red ≥ 90%. Shows em-dash
when data is not yet available."
```

---

## Task 8: Wire `BandwidthPill` into the main dashboard

**Files:**
- Modify: `dashboard/app/page.tsx`

- [ ] **Step 1: Add the poll and render the pill**

In `dashboard/app/page.tsx`, add imports at the top:

```typescript
import { BandwidthPill } from "@/components/bandwidth-pill";
import type { BandwidthToday } from "@/lib/bandwidth";
```

Inside `OperatorDashboard()`, alongside the existing `usePolling` calls, add:

```typescript
  const bandwidthPoll = usePolling<BandwidthToday & { ok: boolean }>(
    "/api/bandwidth/today",
    30_000,
  );
  const bandwidthData =
    bandwidthPoll.data && (bandwidthPoll.data as { ok?: boolean }).ok
      ? (bandwidthPoll.data as BandwidthToday)
      : null;
```

Then render `<BandwidthPill>` right after `<StatusPills>`, before `<HeldShoutoutsCard>`:

```tsx
      <StatusPills data={data} isStale={isStale} />
      <BandwidthPill data={bandwidthData} isStale={bandwidthPoll.isStale} />
      <HeldShoutoutsCard
        held={shoutoutsPoll.data?.held ?? []}
        onAction={shoutoutsPoll.refresh}
        hideWhenEmpty
      />
```

- [ ] **Step 2: Build**

```bash
cd /home/marku/saas/numaradio/dashboard && npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
cd /home/marku/saas/numaradio
git add dashboard/app/page.tsx
git commit -m "feat(dashboard): wire BandwidthPill into / with 30s poll"
```

---

## Task 9: Deploy + smoke-test

- [ ] **Step 1: Deploy the dashboard**

```bash
cd /home/marku/saas/numaradio/dashboard && npm run deploy
```

Expected: `✓ dashboard deployed`.

- [ ] **Step 2: Bandwidth endpoint smoke**

```bash
curl -sS http://127.0.0.1:3001/api/bandwidth/today | head -c 400
```

Expected: `{"ok":true,"bytesToday":<N>,"capBytes":6442450944,"fractionUsed":<0..1>,"sampledRows":<M>,"unaccountedRows":<K>}`.

- [ ] **Step 3: Visual check on `/`**

Open `https://dashboard.numaradio.com/` in a browser.

Expect:
- `Numa·Radio` logo top-left, "Shoutouts →" and "Library →" top-right.
- `StatusPills` unchanged.
- `BandwidthPill` showing "B2 est. today · X.X / 6.0 GB · NN%" with a coloured progress bar.
- **Only if a shoutout is currently held**, the "Held for review" card appears between the bandwidth pill and Services. When none are held, that space is empty — no blank card.
- ServicesCard, HealthCard, LogsCard as before.

- [ ] **Step 4: Visual check on `/shoutouts`**

Header should match `/library`'s pattern: `Numa·Radio` left, `← Dashboard` right, subtitle `Shoutouts · N held · N recent · polling every 8s`.

Held card and Recent card below, unchanged functionally.

- [ ] **Step 5: Held-card interaction check**

On `/`, approve and reject one held shoutout each. Verify:
- Toasts appear.
- Row disappears after success.
- Same row disappears from `/shoutouts` Held list on next poll.
- Approval airs Lena. Rejection does not.

- [ ] **Step 6: Cap-tier colour check (optional, requires env change)**

On the dashboard host:

```bash
echo "B2_DAILY_CAP_GB=0.1" >> /home/marku/saas/numaradio/dashboard/.env.local
sudo systemctl restart numa-dashboard
```

Open `/`. Bandwidth pill should be red, `fractionUsed` clipped at 100%. Revert:

```bash
sed -i "/^B2_DAILY_CAP_GB=/d" /home/marku/saas/numaradio/dashboard/.env.local
sudo systemctl restart numa-dashboard
```

---

## Rollback

Each task is an independent commit. Revert any single commit to remove that feature; everything else keeps working. The bandwidth estimator and the Held card do not share code paths, so reverting one does not affect the other.
