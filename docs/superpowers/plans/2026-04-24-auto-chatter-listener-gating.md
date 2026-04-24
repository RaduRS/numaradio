# Auto-chatter listener-aware gating — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace boolean `autoHostEnabled` with a tri-state (`auto` / `forced_on` / `forced_off`) where `auto` mode gates on raw Icecast listener count ≥ 5, and forced states expire to `auto` after 20 minutes.

**Architecture:** Prisma schema change + queue-daemon config cache + Icecast listener fetcher + dashboard UI + API shape change. Queue-daemon does a lazy revert when it reads an expired forced state.

**Tech Stack:** Prisma + Postgres (Neon), Node (queue-daemon, `node --test --experimental-strip-types`), Next.js 15 App Router (dashboard), Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-04-24-auto-chatter-listener-gating-design.md`.

---

## File Structure

**Create:**
- `prisma/migrations/<timestamp>_auto_host_mode/migration.sql` — enum + columns + drop old
- `workers/queue-daemon/station-config.ts` — `StationConfigCache` returning `{mode, forcedUntil, forcedBy}`
- `workers/queue-daemon/station-config.test.ts` — cache behavior + lazy-revert helper
- `workers/queue-daemon/icecast-listeners.ts` — raw listener count from Icecast, fail-closed
- `workers/queue-daemon/icecast-listeners.test.ts`

**Modify:**
- `prisma/schema.prisma` — add `AutoHostMode` enum, add `autoHostMode`/`autoHostForcedUntil`/`autoHostForcedBy`, drop `autoHostEnabled`
- `workers/queue-daemon/auto-host.ts` — swap `flag` dep for `config` + `getListenerCount` + `revertExpired`
- `workers/queue-daemon/auto-host.test.ts` — new cases (forced states + listener gating + lazy revert)
- `workers/queue-daemon/index.ts` — wire new deps, remove flag wiring
- `dashboard/app/api/shoutouts/auto-host/route.ts` — new `{mode}` shape
- `dashboard/app/shoutouts/page.tsx` — 3-button segmented control, countdown, listener display
- `docs/HANDOFF.md` — new entry for this feature

**Delete:**
- `workers/queue-daemon/station-flag.ts`
- `workers/queue-daemon/station-flag.test.ts`

---

### Task 1: Prisma schema + migration

**Files:**
- Modify: `prisma/schema.prisma:140-161`
- Create: `prisma/migrations/<timestamp>_auto_host_mode/migration.sql`

- [ ] **Step 1: Edit schema — add enum + new fields, drop old field**

In `prisma/schema.prisma`, add the new enum next to `StationStatus` (around line 20):

```prisma
enum AutoHostMode {
  auto
  forced_on
  forced_off
}
```

In the `Station` model, replace:

```prisma
  autoHostEnabled     Boolean       @default(false)
```

with:

```prisma
  autoHostMode        AutoHostMode  @default(auto)
  autoHostForcedUntil DateTime?
  autoHostForcedBy    String?
```

- [ ] **Step 2: Generate migration**

Run: `npx prisma migrate dev --name auto_host_mode --create-only`

This writes the SQL without applying it. Open the generated file — it should contain roughly:

```sql
-- CreateEnum
CREATE TYPE "AutoHostMode" AS ENUM ('auto', 'forced_on', 'forced_off');

-- AlterTable
ALTER TABLE "Station" DROP COLUMN "autoHostEnabled",
ADD COLUMN     "autoHostForcedBy" TEXT,
ADD COLUMN     "autoHostForcedUntil" TIMESTAMP(3),
ADD COLUMN     "autoHostMode" "AutoHostMode" NOT NULL DEFAULT 'auto';
```

If Prisma generated something different (e.g. preserving the column), hand-edit the SQL to match the above exactly — drop first, then add the three columns with the default.

- [ ] **Step 3: Apply migration to dev DB and regenerate client**

Run: `npx prisma migrate dev && npx prisma generate`
Expected: migration applies; `prisma/client` updated; the daemon's `prisma.station.findUnique(...)` calls referencing `autoHostEnabled` now show as TypeScript errors (fine — we're about to replace them).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "prisma: Station auto-host tri-state (auto/forced_on/forced_off)"
```

---

### Task 2: `StationConfigCache` (replaces `StationFlagCache`)

**Files:**
- Create: `workers/queue-daemon/station-config.ts`
- Create: `workers/queue-daemon/station-config.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `workers/queue-daemon/station-config.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { StationConfigCache, type StationConfig } from "./station-config.ts";

const AUTO: StationConfig = { mode: "auto", forcedUntil: null, forcedBy: null };
const FORCED_ON_30: StationConfig = {
  mode: "forced_on",
  forcedUntil: new Date("2026-04-24T10:30:00Z"),
  forcedBy: "op@example.com",
};

test("StationConfigCache fetches on first call", async () => {
  let calls = 0;
  const cache = new StationConfigCache({
    ttlMs: 30_000,
    fetchOnce: async () => { calls += 1; return AUTO; },
    now: () => 0,
  });
  assert.deepEqual(await cache.read(), AUTO);
  assert.equal(calls, 1);
});

test("StationConfigCache returns cached value within TTL", async () => {
  let calls = 0;
  let t = 0;
  const cache = new StationConfigCache({
    ttlMs: 30_000,
    fetchOnce: async () => { calls += 1; return AUTO; },
    now: () => t,
  });
  await cache.read();
  t = 29_000;
  await cache.read();
  assert.equal(calls, 1);
});

test("StationConfigCache refreshes after TTL", async () => {
  let calls = 0;
  let t = 0;
  const seq = [AUTO, FORCED_ON_30];
  const cache = new StationConfigCache({
    ttlMs: 30_000,
    fetchOnce: async () => { const v = seq[calls]!; calls += 1; return v; },
    now: () => t,
  });
  assert.deepEqual(await cache.read(), AUTO);
  t = 31_000;
  assert.deepEqual(await cache.read(), FORCED_ON_30);
});

test("StationConfigCache keeps last good value on fetch error", async () => {
  let t = 0;
  let fail = false;
  const cache = new StationConfigCache({
    ttlMs: 1_000,
    fetchOnce: async () => { if (fail) throw new Error("boom"); return FORCED_ON_30; },
    now: () => t,
  });
  await cache.read();
  t = 2_000;
  fail = true;
  assert.deepEqual(await cache.read(), FORCED_ON_30); // sticky
});

test("StationConfigCache invalidate() forces next read to hit db", async () => {
  let calls = 0;
  const cache = new StationConfigCache({
    ttlMs: 30_000,
    fetchOnce: async () => { calls += 1; return AUTO; },
    now: () => 0,
  });
  await cache.read();
  cache.invalidate();
  await cache.read();
  assert.equal(calls, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="StationConfigCache"`
Expected: FAIL — `./station-config.ts` cannot be resolved.

- [ ] **Step 3: Write the implementation**

Create `workers/queue-daemon/station-config.ts`:

```ts
export type AutoHostMode = "auto" | "forced_on" | "forced_off";

export interface StationConfig {
  mode: AutoHostMode;
  forcedUntil: Date | null;
  forcedBy: string | null;
}

export interface StationConfigCacheOpts {
  ttlMs: number;
  fetchOnce: () => Promise<StationConfig>;
  now?: () => number;
}

const AUTO_FALLBACK: StationConfig = {
  mode: "auto",
  forcedUntil: null,
  forcedBy: null,
};

export class StationConfigCache {
  private readonly ttlMs: number;
  private readonly fetchOnce: () => Promise<StationConfig>;
  private readonly now: () => number;
  private cached: StationConfig | null = null;
  private fetchedAt = -Infinity;

  constructor(opts: StationConfigCacheOpts) {
    this.ttlMs = opts.ttlMs;
    this.fetchOnce = opts.fetchOnce;
    this.now = opts.now ?? (() => Date.now());
  }

  async read(): Promise<StationConfig> {
    const age = this.now() - this.fetchedAt;
    if (this.cached && age < this.ttlMs) return this.cached;
    try {
      const v = await this.fetchOnce();
      this.cached = v;
      this.fetchedAt = this.now();
      return v;
    } catch (err) {
      console.warn(
        "[station-config] fetch failed, using previous value:",
        err instanceof Error ? err.message : err,
      );
      return this.cached ?? AUTO_FALLBACK;
    }
  }

  invalidate(): void {
    this.fetchedAt = -Infinity;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --test-name-pattern="StationConfigCache"`
Expected: PASS, 5/5.

- [ ] **Step 5: Commit**

```bash
git add workers/queue-daemon/station-config.ts workers/queue-daemon/station-config.test.ts
git commit -m "queue-daemon: StationConfigCache replaces StationFlagCache"
```

---

### Task 3: Icecast listener-count helper

**Files:**
- Create: `workers/queue-daemon/icecast-listeners.ts`
- Create: `workers/queue-daemon/icecast-listeners.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `workers/queue-daemon/icecast-listeners.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseListenerCount } from "./icecast-listeners.ts";

test("parses single-source listener count for /stream", () => {
  const raw = {
    icestats: {
      source: { listenurl: "http://host:8000/stream", listeners: 7 },
    },
  };
  assert.equal(parseListenerCount(raw, "/stream"), 7);
});

test("parses array-source listener count for /stream", () => {
  const raw = {
    icestats: {
      source: [
        { listenurl: "http://host:8000/backup", listeners: 1 },
        { listenurl: "http://host:8000/stream", listeners: 9 },
      ],
    },
  };
  assert.equal(parseListenerCount(raw, "/stream"), 9);
});

test("returns null when wanted mount is not present", () => {
  const raw = {
    icestats: {
      source: { listenurl: "http://host:8000/other", listeners: 3 },
    },
  };
  assert.equal(parseListenerCount(raw, "/stream"), null);
});

test("returns null when source is missing (no one broadcasting)", () => {
  assert.equal(parseListenerCount({ icestats: {} }, "/stream"), null);
});

test("returns null when listeners field is not a number", () => {
  const raw = {
    icestats: {
      source: { listenurl: "http://host:8000/stream", listeners: "lots" },
    },
  };
  assert.equal(parseListenerCount(raw, "/stream"), null);
});

test("returns null when raw is not an object", () => {
  assert.equal(parseListenerCount(null, "/stream"), null);
  assert.equal(parseListenerCount("nope", "/stream"), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="listener count|returns null|parses"`
Expected: FAIL — `./icecast-listeners.ts` cannot be resolved.

- [ ] **Step 3: Write the implementation**

Create `workers/queue-daemon/icecast-listeners.ts`:

```ts
interface IcecastSource {
  listenurl?: string;
  listeners?: number;
}

/**
 * Parse the raw listener count for a specific mount from Icecast's
 * status-json.xsl payload. Returns null if the mount isn't present or
 * the count isn't a number — caller treats null as "unknown" and, in
 * `auto` mode, skips the break (fail-closed).
 *
 * This is the RAW count — never the +15 marketing boost used on the
 * public hero. Operational decisions must be based on real listeners.
 */
export function parseListenerCount(raw: unknown, wantMount: string): number | null {
  if (!raw || typeof raw !== "object") return null;
  const icestats = (raw as { icestats?: { source?: IcecastSource | IcecastSource[] } }).icestats;
  const src = icestats?.source;
  if (!src) return null;
  const sources = Array.isArray(src) ? src : [src];
  const match = sources.find((s) => {
    if (!s.listenurl) return false;
    try {
      return new URL(s.listenurl).pathname === wantMount;
    } catch {
      return false;
    }
  });
  if (!match) return null;
  return typeof match.listeners === "number" ? match.listeners : null;
}

export interface FetchListenersOpts {
  url: string;
  mount: string;
  timeoutMs?: number;
}

/**
 * Fetch the raw listener count from Icecast. Returns null on any error
 * (network, non-2xx, parse failure, missing mount). Callers MUST treat
 * null as "unknown" — in `auto` mode that means skip the break.
 */
export async function fetchListenerCount(opts: FetchListenersOpts): Promise<number | null> {
  const timeoutMs = opts.timeoutMs ?? 2_000;
  try {
    const res = await fetch(opts.url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const json = await res.json();
    return parseListenerCount(json, opts.mount);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --test-name-pattern="listener count|returns null|parses"`
Expected: PASS, 6/6.

- [ ] **Step 5: Commit**

```bash
git add workers/queue-daemon/icecast-listeners.ts workers/queue-daemon/icecast-listeners.test.ts
git commit -m "queue-daemon: parse Icecast listener count, fail-closed"
```

---

### Task 4: Update `auto-host.ts` deps + logic

**Files:**
- Modify: `workers/queue-daemon/auto-host.ts:102-125` (deps interface), `:180-206` (runChatter head)
- Modify: `workers/queue-daemon/auto-host.test.ts` (existing tests use `flag.isEnabled`, now replaced)

- [ ] **Step 1: Write the failing tests for the new gating logic**

Add the following block to `workers/queue-daemon/auto-host.test.ts` (imports/helpers should already exist — if `makeOrchestrator` or similar helper doesn't take a `flag`/`config` argument, extend it). Use the existing test helpers; the new cases are:

```ts
// At the top of the file, alongside existing imports:
// import { AutoHostOrchestrator, type AutoHostDeps } from "./auto-host.ts";
// import type { StationConfig } from "./station-config.ts";

// Helper (add near other test helpers if not already present):
function configFor(mode: "auto" | "forced_on" | "forced_off", forcedUntilIso?: string): StationConfig {
  return {
    mode,
    forcedUntil: forcedUntilIso ? new Date(forcedUntilIso) : null,
    forcedBy: forcedUntilIso ? "op@example.com" : null,
  };
}

test("forced_on speaks even when listeners=0", async () => {
  const pushed: string[] = [];
  const orch = new AutoHostOrchestrator(buildDeps({
    config: async () => configFor("forced_on", "2099-01-01T00:00:00Z"),
    getListenerCount: async () => 0,
    pushToOverlay: async (url) => { pushed.push(url); },
  }));
  orch.onMusicTrackStart("ArtistA");
  orch.onMusicTrackStart("ArtistB");
  await orch.runChatter();
  assert.equal(pushed.length, 1);
});

test("forced_off skips even when listeners=50", async () => {
  const pushed: string[] = [];
  const orch = new AutoHostOrchestrator(buildDeps({
    config: async () => configFor("forced_off", "2099-01-01T00:00:00Z"),
    getListenerCount: async () => 50,
    pushToOverlay: async (url) => { pushed.push(url); },
  }));
  orch.onMusicTrackStart("ArtistA");
  orch.onMusicTrackStart("ArtistB");
  await orch.runChatter();
  assert.equal(pushed.length, 0);
});

test("auto mode skips when listeners < 5", async () => {
  const pushed: string[] = [];
  const orch = new AutoHostOrchestrator(buildDeps({
    config: async () => configFor("auto"),
    getListenerCount: async () => 4,
    pushToOverlay: async (url) => { pushed.push(url); },
  }));
  orch.onMusicTrackStart("ArtistA");
  orch.onMusicTrackStart("ArtistB");
  await orch.runChatter();
  assert.equal(pushed.length, 0);
});

test("auto mode speaks when listeners >= 5", async () => {
  const pushed: string[] = [];
  const orch = new AutoHostOrchestrator(buildDeps({
    config: async () => configFor("auto"),
    getListenerCount: async () => 5,
    pushToOverlay: async (url) => { pushed.push(url); },
  }));
  orch.onMusicTrackStart("ArtistA");
  orch.onMusicTrackStart("ArtistB");
  await orch.runChatter();
  assert.equal(pushed.length, 1);
});

test("auto mode fails closed when listener count is null (Icecast error)", async () => {
  const pushed: string[] = [];
  const orch = new AutoHostOrchestrator(buildDeps({
    config: async () => configFor("auto"),
    getListenerCount: async () => null,
    pushToOverlay: async (url) => { pushed.push(url); },
  }));
  orch.onMusicTrackStart("ArtistA");
  orch.onMusicTrackStart("ArtistB");
  await orch.runChatter();
  assert.equal(pushed.length, 0);
});

test("expired forced_on lazy-reverts then re-evaluates in auto", async () => {
  const reverts: Array<{ fromMode: string; forcedUntil: Date | null }> = [];
  const pushed: string[] = [];
  // forcedUntil is in the past
  const orch = new AutoHostOrchestrator(buildDeps({
    config: async () => configFor("forced_on", "2000-01-01T00:00:00Z"),
    getListenerCount: async () => 0, // after revert to auto, <5 → skip
    revertExpired: async (entry) => { reverts.push(entry); },
    pushToOverlay: async (url) => { pushed.push(url); },
  }));
  orch.onMusicTrackStart("ArtistA");
  orch.onMusicTrackStart("ArtistB");
  await orch.runChatter();
  assert.equal(reverts.length, 1);
  assert.equal(reverts[0]?.fromMode, "forced_on");
  assert.equal(pushed.length, 0); // reverted to auto, listeners=0, skip
});

test("expired forced_off lazy-reverts and then speaks when listeners>=5", async () => {
  const reverts: Array<{ fromMode: string }> = [];
  const pushed: string[] = [];
  const orch = new AutoHostOrchestrator(buildDeps({
    config: async () => configFor("forced_off", "2000-01-01T00:00:00Z"),
    getListenerCount: async () => 10,
    revertExpired: async (entry) => { reverts.push(entry); },
    pushToOverlay: async (url) => { pushed.push(url); },
  }));
  orch.onMusicTrackStart("ArtistA");
  orch.onMusicTrackStart("ArtistB");
  await orch.runChatter();
  assert.equal(reverts.length, 1);
  assert.equal(reverts[0]?.fromMode, "forced_off");
  assert.equal(pushed.length, 1);
});

test("forced_on with null getListenerCount still speaks (force overrides)", async () => {
  const pushed: string[] = [];
  const orch = new AutoHostOrchestrator(buildDeps({
    config: async () => configFor("forced_on", "2099-01-01T00:00:00Z"),
    getListenerCount: async () => null,
    pushToOverlay: async (url) => { pushed.push(url); },
  }));
  orch.onMusicTrackStart("ArtistA");
  orch.onMusicTrackStart("ArtistB");
  await orch.runChatter();
  assert.equal(pushed.length, 1);
});
```

If the existing `buildDeps` helper doesn't accept `config` / `getListenerCount` / `revertExpired`, extend it to build a full `AutoHostDeps` with sensible defaults for the new fields (`config` returning auto, `getListenerCount` returning 100, `revertExpired` as a no-op).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- workers/queue-daemon/auto-host.test.ts`
Expected: FAIL — existing `buildDeps`/orchestrator don't know about `config`/`getListenerCount`/`revertExpired`; TypeScript errors.

- [ ] **Step 3: Update the `AutoHostDeps` interface and `runChatter()`**

In `workers/queue-daemon/auto-host.ts`, add the `StationConfig` import at the top of the orchestrator section:

```ts
import type { StationConfig } from "./station-config.ts";
```

Replace the `flag` field in `AutoHostDeps` (currently line ~103) with the new fields:

```ts
export interface AutoHostDeps {
  /** Reads the current tri-state config (cached ~30s by caller). */
  config: () => Promise<StationConfig>;
  /**
   * Raw Icecast listener count for the stream mount. Returns null on
   * any fetch / parse error — in auto mode, null means "skip the break"
   * (fail-closed, don't shout to no one).
   */
  getListenerCount: () => Promise<number | null>;
  /**
   * Called when runChatter() discovers an expired forced_* state. The
   * caller performs an atomic UPDATE ... WHERE autoHostForcedUntil =
   * <entry.forcedUntil> to avoid racing with a concurrent operator toggle,
   * and invalidates the config cache. Must not rethrow.
   */
  revertExpired: (entry: {
    fromMode: "forced_on" | "forced_off";
    forcedUntil: Date;
  }) => Promise<void>;
  /* ...all other existing fields UNCHANGED... */
}
```

Replace the gating block in `runChatter()` (currently lines ~185-189 starting `if (!(await this.deps.flag.isEnabled()))`) with:

```ts
      // Tri-state gating: auto / forced_on / forced_off.
      // Expired forced_* lazy-reverts to auto then evaluates.
      const now = (this.deps.now ?? Date.now)();
      let cfg = await this.deps.config();
      if (cfg.mode !== "auto" && cfg.forcedUntil && cfg.forcedUntil.getTime() <= now) {
        await this.deps.revertExpired({
          fromMode: cfg.mode,
          forcedUntil: cfg.forcedUntil,
        });
        cfg = { mode: "auto", forcedUntil: null, forcedBy: null };
      }
      if (cfg.mode === "forced_off") {
        this.state.markFailure();
        return;
      }
      if (cfg.mode === "auto") {
        const listeners = await this.deps.getListenerCount();
        if (listeners === null || listeners < 5) {
          this.state.markFailure();
          return;
        }
      }
      // forced_on or auto-with-enough-listeners → proceed
```

Leave the rest of `runChatter()` unchanged.

- [ ] **Step 4: Run tests — all new cases pass, existing cases still pass**

Run: `npm test -- workers/queue-daemon/auto-host.test.ts`
Expected: all pass (new 8 + existing). If existing tests fail because they passed `flag: { isEnabled }`, update them to pass `config`/`getListenerCount` via `buildDeps` defaults.

- [ ] **Step 5: Commit**

```bash
git add workers/queue-daemon/auto-host.ts workers/queue-daemon/auto-host.test.ts
git commit -m "auto-host: gate on listener count + honor forced states"
```

---

### Task 5: Wire new deps in `workers/queue-daemon/index.ts`

**Files:**
- Modify: `workers/queue-daemon/index.ts:11` (import), `:59-68` (stationFlag), `:70-71` (flag dep wiring)

- [ ] **Step 1: Edit imports**

Replace:

```ts
import { StationFlagCache } from "./station-flag.ts";
```

with:

```ts
import { StationConfigCache, type AutoHostMode } from "./station-config.ts";
import { fetchListenerCount } from "./icecast-listeners.ts";
```

Add the env constants near the top (after `HTTP_PORT`, ~line 20):

```ts
const ICECAST_STATUS_URL = process.env.ICECAST_STATUS_URL ?? "http://127.0.0.1:8000/status-json.xsl";
const ICECAST_MOUNT = process.env.ICECAST_MOUNT ?? "/stream";
```

- [ ] **Step 2: Replace the `stationFlag` cache with `stationConfig`**

Replace lines 59-68:

```ts
const stationConfig = new StationConfigCache({
  ttlMs: 30_000,
  fetchOnce: async () => {
    const s = await prisma.station.findUniqueOrThrow({
      where: { slug: STATION_SLUG },
      select: {
        autoHostMode: true,
        autoHostForcedUntil: true,
        autoHostForcedBy: true,
      },
    });
    return {
      mode: s.autoHostMode as AutoHostMode,
      forcedUntil: s.autoHostForcedUntil,
      forcedBy: s.autoHostForcedBy,
    };
  },
});
```

- [ ] **Step 3: Wire new deps into `AutoHostOrchestrator`**

In the `new AutoHostOrchestrator({ ... })` block (line ~70), replace:

```ts
  flag: stationFlag,
```

with:

```ts
  config: () => stationConfig.read(),
  getListenerCount: () =>
    fetchListenerCount({ url: ICECAST_STATUS_URL, mount: ICECAST_MOUNT }),
  revertExpired: async ({ fromMode, forcedUntil }) => {
    // Atomic UPDATE: only revert if forcedUntil hasn't moved (operator may
    // have just set a new forced state in the same window). `updateMany`
    // returns count=0 in that case; we invalidate the cache either way so
    // the next read picks up the authoritative state.
    try {
      await prisma.station.updateMany({
        where: { slug: STATION_SLUG, autoHostForcedUntil: forcedUntil },
        data: {
          autoHostMode: "auto",
          autoHostForcedUntil: null,
          autoHostForcedBy: null,
        },
      });
      console.info(
        `action=auto_host_auto_revert from=${fromMode} user=daemon reason=20m_elapsed`,
      );
    } catch (err) {
      console.warn(
        "[auto-host] revertExpired failed:",
        err instanceof Error ? err.message : err,
      );
    } finally {
      stationConfig.invalidate();
    }
  },
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (If tsc complains about unused imports or `AutoHostMode`, keep it — it's used in the cast above.)

- [ ] **Step 5: Commit**

```bash
git add workers/queue-daemon/index.ts
git commit -m "queue-daemon: wire StationConfigCache + Icecast listener fetch"
```

---

### Task 6: Delete the old `station-flag` files

**Files:**
- Delete: `workers/queue-daemon/station-flag.ts`
- Delete: `workers/queue-daemon/station-flag.test.ts`

- [ ] **Step 1: Delete both files and verify nothing else imports from them**

```bash
rm workers/queue-daemon/station-flag.ts workers/queue-daemon/station-flag.test.ts
rg -n "station-flag|StationFlagCache" --type ts
```

Expected from `rg`: no matches.

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: all pass. If `hydrator.test.ts` or any other test imported `StationFlagCache`, fix it to use `StationConfigCache` instead, or remove the dependency entirely.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "queue-daemon: drop StationFlagCache (replaced by StationConfigCache)"
```

---

### Task 7: Dashboard API — new `{mode}` shape

**Files:**
- Modify: `dashboard/app/api/shoutouts/auto-host/route.ts`

- [ ] **Step 1: Rewrite the route**

Replace the whole contents of `dashboard/app/api/shoutouts/auto-host/route.ts` with:

```ts
import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";

export const dynamic = "force-dynamic";

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";
const FORCE_WINDOW_MS = 20 * 60 * 1000;

type AutoHostMode = "auto" | "forced_on" | "forced_off";

interface StationRow {
  autoHostMode: AutoHostMode;
  autoHostForcedUntil: Date | null;
  autoHostForcedBy: string | null;
}

function isValidMode(v: unknown): v is AutoHostMode {
  return v === "auto" || v === "forced_on" || v === "forced_off";
}

export async function GET(): Promise<NextResponse> {
  try {
    const pool = getDbPool();
    const r = await pool.query<StationRow>(
      `SELECT "autoHostMode", "autoHostForcedUntil", "autoHostForcedBy"
         FROM "Station" WHERE slug = $1 LIMIT 1`,
      [STATION_SLUG],
    );
    const row = r.rows[0];
    if (!row) {
      return NextResponse.json(
        { ok: false, error: `station "${STATION_SLUG}" not found` },
        { status: 404 },
      );
    }
    return NextResponse.json({
      ok: true,
      mode: row.autoHostMode,
      forcedUntil: row.autoHostForcedUntil?.toISOString() ?? null,
      forcedBy: row.autoHostForcedBy,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "db error" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: { mode?: unknown };
  try {
    body = (await req.json()) as { mode?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  if (!isValidMode(body.mode)) {
    return NextResponse.json(
      { ok: false, error: "mode must be one of: auto, forced_on, forced_off" },
      { status: 400 },
    );
  }

  const user = req.headers.get("cf-access-authenticated-user-email") ?? "unknown";
  const isForced = body.mode !== "auto";
  const forcedUntil = isForced ? new Date(Date.now() + FORCE_WINDOW_MS) : null;
  const forcedBy = isForced ? user : null;

  try {
    const pool = getDbPool();
    const r = await pool.query<StationRow>(
      `UPDATE "Station"
         SET "autoHostMode" = $1::"AutoHostMode",
             "autoHostForcedUntil" = $2,
             "autoHostForcedBy" = $3,
             "updatedAt" = NOW()
       WHERE slug = $4
       RETURNING "autoHostMode", "autoHostForcedUntil", "autoHostForcedBy"`,
      [body.mode, forcedUntil, forcedBy, STATION_SLUG],
    );
    if (r.rowCount === 0) {
      return NextResponse.json(
        { ok: false, error: `station "${STATION_SLUG}" not found` },
        { status: 404 },
      );
    }
    console.info(
      `action=auto_host_set mode=${body.mode} user=${user}` +
        (isForced ? ` expires_in=20m` : ""),
    );
    const row = r.rows[0]!;
    return NextResponse.json({
      ok: true,
      mode: row.autoHostMode,
      forcedUntil: row.autoHostForcedUntil?.toISOString() ?? null,
      forcedBy: row.autoHostForcedBy,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "db error" },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: Build the dashboard to catch type errors**

Run: `cd dashboard && npm run build`
Expected: clean build. The old `enabled` callers in `page.tsx` will still compile because the field isn't referenced from anywhere typed yet — but the runtime will be wrong until Task 8.

- [ ] **Step 3: Commit**

```bash
git add dashboard/app/api/shoutouts/auto-host/route.ts
git commit -m "dashboard: auto-host API tri-state {mode} shape"
```

---

### Task 8: Dashboard UI — 3-button segmented control + countdown

**Files:**
- Modify: `dashboard/app/shoutouts/page.tsx:127-167` (state + fetch + toggle), `:302-338` (toggle strip UI)

- [ ] **Step 1: Replace the state + effect + toggle function**

In `dashboard/app/shoutouts/page.tsx`, replace the block starting `const [autoHostOn, setAutoHostOn] = useState<boolean | null>(null);` through the end of `toggleAutoHost` (approximately lines 138-166) with:

```tsx
  type AutoHostMode = "auto" | "forced_on" | "forced_off";
  interface AutoHostState {
    mode: AutoHostMode;
    forcedUntil: string | null;
  }
  const [autoHost, setAutoHost] = useState<AutoHostState | null>(null);
  const [autoHostPending, setAutoHostPending] = useState(false);
  const [listenerCount, setListenerCount] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());

  // Fetch initial auto-host state.
  useEffect(() => {
    let cancel = false;
    async function load() {
      try {
        const r = await fetch("/api/shoutouts/auto-host");
        const d = (await r.json()) as {
          ok?: boolean;
          mode?: AutoHostMode;
          forcedUntil?: string | null;
        };
        if (!cancel && d.ok && d.mode) {
          setAutoHost({ mode: d.mode, forcedUntil: d.forcedUntil ?? null });
        }
      } catch { /* ignore */ }
    }
    void load();
    return () => { cancel = true; };
  }, []);

  // Poll real listener count (raw Icecast, not +15 boosted) for the
  // "Auto — currently On (7 listeners)" display. The /api/station/listeners
  // endpoint returns BOTH listeners (raw) and withFloor (+15); we use `listeners`.
  useEffect(() => {
    let cancel = false;
    async function load() {
      try {
        const r = await fetch("/api/station/listeners");
        const d = (await r.json()) as { listeners?: number };
        if (!cancel && typeof d.listeners === "number") {
          setListenerCount(d.listeners);
        }
      } catch { /* ignore */ }
    }
    void load();
    const id = setInterval(load, 15_000);
    return () => { cancel = true; clearInterval(id); };
  }, []);

  // Tick every second while a forced state has a countdown, so the
  // "reverts in 18 min" label updates without a full refresh.
  useEffect(() => {
    if (!autoHost?.forcedUntil) return;
    const id = setInterval(() => setNowTick(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [autoHost?.forcedUntil]);

  async function setAutoHostMode(next: AutoHostMode) {
    setAutoHostPending(true);
    try {
      const r = await fetch("/api/shoutouts/auto-host", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: next }),
      });
      const d = (await r.json()) as {
        ok?: boolean;
        mode?: AutoHostMode;
        forcedUntil?: string | null;
      };
      if (d.ok && d.mode) {
        setAutoHost({ mode: d.mode, forcedUntil: d.forcedUntil ?? null });
      }
    } finally {
      setAutoHostPending(false);
    }
  }
```

- [ ] **Step 2: Replace the toggle strip UI**

Find the auto-chatter toggle strip (approximately lines 302-338, the `<div>` with comment `Auto-chatter toggle strip`) and replace its whole contents with:

```tsx
      {/* ── Auto-chatter mode strip ────────────────────────── */}
      <div className="flex flex-col gap-2 rounded-md border border-line bg-bg-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className={`h-2 w-2 rounded-full shrink-0 ${
              autoHost?.mode === "forced_off" ? "bg-fg-mute/30" :
              autoHost?.mode === "forced_on" ? "bg-accent" :
              // auto: dot reflects computed state
              (listenerCount ?? 0) >= 5 ? "bg-accent" : "bg-fg-mute/30"
            }`}
            aria-hidden
          />
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-mute">
              Auto-chatter
            </div>
            <div className="truncate text-sm">
              {autoHost === null ? (
                "Loading…"
              ) : autoHost.mode === "auto" ? (
                listenerCount === null
                  ? "Auto — currently On (listener count unavailable)"
                  : listenerCount >= 5
                    ? `Auto — currently On (${listenerCount} listeners)`
                    : `Auto — currently Off (${listenerCount} listeners, need 5+)`
              ) : autoHost.mode === "forced_on" ? (
                `Forced On · ${formatRevertCountdown(autoHost.forcedUntil, nowTick)}`
              ) : (
                `Forced Off · ${formatRevertCountdown(autoHost.forcedUntil, nowTick)}`
              )}
            </div>
          </div>
        </div>
        <div
          className="flex shrink-0 rounded-full border border-line overflow-hidden font-mono text-[11px] uppercase tracking-[0.15em]"
          role="radiogroup"
          aria-label="Auto-chatter mode"
        >
          {(["auto", "forced_on", "forced_off"] as const).map((m) => {
            const selected = autoHost?.mode === m;
            const label = m === "auto" ? "Auto" : m === "forced_on" ? "Forced On" : "Forced Off";
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={autoHost === null || autoHostPending}
                onClick={() => setAutoHostMode(m)}
                className={`px-3 py-1.5 transition ${
                  selected
                    ? "bg-[var(--accent-soft)] text-accent"
                    : "text-fg-mute hover:text-fg"
                } ${autoHostPending ? "opacity-60 cursor-wait" : ""}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
```

Add this helper just above `export default function ShoutoutsPage()` (top-level in the file):

```tsx
function formatRevertCountdown(forcedUntilIso: string | null, nowMs: number): string {
  if (!forcedUntilIso) return "reverting…";
  const ms = new Date(forcedUntilIso).getTime() - nowMs;
  if (ms <= 0) return "reverting…";
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min >= 1) return `reverts to Auto in ${min}m ${sec.toString().padStart(2, "0")}s`;
  return `reverts to Auto in ${sec}s`;
}
```

- [ ] **Step 3: Check for stale references to `autoHostOn` / `toggleAutoHost`**

Run: `rg -n "autoHostOn|toggleAutoHost" dashboard/`
Expected: no matches (all renamed).

If the "Nothing on air yet" empty-state copy still mentions "Flip auto-chatter on above" (line ~421), update to:

```tsx
: "Nothing on air yet. Set auto-chatter mode above, submit a shoutout, or compose one."
```

- [ ] **Step 4: Build**

Run: `cd dashboard && npm run build`
Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/shoutouts/page.tsx
git commit -m "dashboard: auto-chatter tri-state UI with revert countdown"
```

---

### Task 9: HANDOFF.md entry

**Files:**
- Modify: `docs/HANDOFF.md` (top of current-state section)

- [ ] **Step 1: Add a new entry at the top of HANDOFF.md (after the "Last updated" header, above the "Marketing videos" section)**

Insert:

```markdown
## Auto-chatter listener gating — CODE READY, NEEDS DEPLOY (2026-04-24)

Replaces the boolean `autoHostEnabled` toggle with a tri-state:
`auto` / `forced_on` / `forced_off`. In `auto` mode, Lena only speaks
when the raw Icecast listener count is ≥5 (fail-closed if Icecast
unreachable). Forced states expire after 20 min back to `auto` — so a
forgotten force ("left it On for testing") can't run forever to an
empty room.

- `prisma/schema.prisma` — `AutoHostMode` enum, `autoHostMode` +
  `autoHostForcedUntil` + `autoHostForcedBy` columns on `Station`,
  old `autoHostEnabled` dropped.
- `workers/queue-daemon/station-config.ts` (new, replaces
  `station-flag.ts`) — 30s TTL cache of `{mode, forcedUntil, forcedBy}`.
- `workers/queue-daemon/icecast-listeners.ts` (new) — `parseListenerCount`
  + `fetchListenerCount`; returns null on any fetch/parse error.
- `workers/queue-daemon/auto-host.ts:runChatter()` — new gating block:
  reads config, lazy-reverts expired forced states (atomic UPDATE WHERE
  forcedUntil = stored so we don't clobber a concurrent operator toggle),
  then branches on mode. `auto` with `listeners === null || listeners <
  5` → skip.
- Dashboard `/shoutouts` — three-button segmented control (Auto · Forced
  On · Forced Off) with a live countdown on forced states and a
  "currently On/Off (N listeners)" label in Auto mode, polled every 15s.
- API `POST /api/shoutouts/auto-host` body changed from `{enabled:bool}`
  to `{mode: "auto"|"forced_on"|"forced_off"}`.

**Deploy** (ordering matters — running daemon errors after migration
lands because `autoHostEnabled` column is gone):
```
cd /home/marku/saas/numaradio && git pull
npx prisma migrate deploy
sudo systemctl restart numa-queue-daemon
cd dashboard && npm run deploy
```
Gap between migration and daemon restart is seconds; old daemon may
log one or two failed selects, harmless.

**Watch after restart:**
- `/shoutouts` shows three-button control with live listener count
- `journalctl --user -u numa-queue-daemon -f` — `auto_host_auto_revert`
  line appears ~20min after a forced toggle
- With <5 listeners + Auto mode, no chatter pushes between tracks
- With Forced On + 0 listeners, chatter still fires every 2 tracks
```

- [ ] **Step 2: Commit**

```bash
git add docs/HANDOFF.md
git commit -m "handoff: log auto-chatter listener gating"
```

---

### Task 10: Deploy (manual — run on Orion)

**Files:** none (shell steps only)

- [ ] **Step 1: Fetch and confirm the daemon builds locally on Orion**

```bash
cd /home/marku/saas/numaradio && git pull
npm install         # no-op unless package.json changed
npx tsc --noEmit    # sanity
```

Expected: clean.

- [ ] **Step 2: Apply migration**

```bash
npx prisma migrate deploy
```

Expected: `applied` line for `auto_host_mode`.

- [ ] **Step 3: Immediately restart the daemon**

```bash
sudo systemctl restart numa-queue-daemon
journalctl --user -u numa-queue-daemon -n 50 --no-pager
```

Expected: boot sequence, no `autoHostEnabled`-related errors after boot.
(Pre-restart, old daemon may have logged 1–2 failed selects during the
migration window — harmless.)

- [ ] **Step 4: Deploy dashboard**

```bash
cd /home/marku/saas/numaradio/dashboard && npm run deploy
```

Expected: build + service restart via existing `deploy` script.

- [ ] **Step 5: Smoke test**

Open `https://dashboard.numaradio.com/shoutouts`. Expect:
- Three-button segmented control: **Auto · Forced On · Forced Off**
- Secondary label shows `Auto — currently On (N listeners)` with the real count (no +15 boost)
- Click **Forced On** → label updates to `Forced On · reverts to Auto in 20m 00s`, counts down every second
- Click **Auto** → label returns to the auto-state display

Then check logs:

```bash
journalctl --user -u numa-queue-daemon -f | grep -E "auto_host|auto-chatter"
```

Expected patterns: `action=auto_host_set mode=forced_on user=...`,
and eventually (20 min after Forced On with no operator action)
`action=auto_host_auto_revert from=forced_on user=daemon`.

- [ ] **Step 6: Commit HANDOFF update reflecting deploy complete**

After smoke passes, edit `docs/HANDOFF.md` to flip the heading from
"CODE READY, NEEDS DEPLOY" to "LIVE" and commit:

```bash
git add docs/HANDOFF.md
git commit -m "handoff: auto-chatter listener gating live"
git push
```

---

## Self-Review

**Spec coverage:**
- Tri-state data model → Task 1
- State machine (auto / forced_on / forced_off + lazy revert + fail-closed) → Task 4
- Listener count source (raw Icecast, parseListenerCount) → Task 3
- 20 min expiry on both forced states → Task 7 (`FORCE_WINDOW_MS`)
- Dashboard 3-button UI + countdown + listener-count display → Task 8
- Audit log (console.info lines, no `OperatorLog` table exists) → Tasks 5 + 7 log strings
- Rollout ordering gotcha → Task 10 (migration → daemon restart → dashboard)
- Drop old `autoHostEnabled` + rename cache → Task 1 + Task 6

**Placeholder scan:** All code blocks complete. No TODO/TBD. No "similar to Task N".

**Type consistency:**
- `AutoHostMode` defined as union type in `station-config.ts` (Task 2) and used as string-literal type in the route (Task 7), schema uses matching enum values (Task 1). All three spell it `"auto" | "forced_on" | "forced_off"`.
- `StationConfig` shape `{mode, forcedUntil, forcedBy}` consistent across Tasks 2, 4, 5.
- `revertExpired` parameter `{fromMode, forcedUntil}` consistent in Task 4 (interface) and Task 5 (implementation).
- `FORCE_WINDOW_MS = 20 * 60 * 1000` only in Task 7 (dashboard route sets it); the daemon doesn't set the timestamp, only reads it, so no duplication.
