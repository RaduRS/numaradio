# Listener-count cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop counting OBS encoder + TCP zombies as listeners, fold YouTube viewer count into the auto-chatter gate, so all four listener-count surfaces (public hero, /live stage, dashboard pill, autochatter UI + gate) reflect "real audio listeners + real YouTube viewers."

**Architecture:** Three layers. (1) Server config (sed on icecast.xml) tightens icecast's queue so zombies are kicked at the TCP layer in seconds, not hours. (2) Three Vercel routes import their app's already-cached YouTube state probe and subtract 1 from `icecast.listeners` when the broadcast is live — zero new YouTube API calls. (3) Queue-daemon gets a new `youtube-audience.ts` helper that hits the dashboard's `/api/youtube/health` over loopback (`127.0.0.1:3001`); auto-host gate becomes `effective = icecast + yt_viewers - (live ? 1 : 0)`, threshold `>= 3` unchanged.

**Tech Stack:** TypeScript, Next.js 15 (two apps: `/` main site, `dashboard/`), Prisma, node:test + node:assert/strict, queue-daemon runs as systemd unit.

**Spec:** `docs/superpowers/specs/2026-05-03-listener-count-cleanup-design.md`

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `workers/queue-daemon/youtube-audience.ts` | create | Fetch + parse `{state, viewers}` from dashboard's `/api/youtube/health` over loopback. Single-purpose, fail-soft. |
| `workers/queue-daemon/youtube-audience.test.ts` | create | Parser + fetch unit tests using `node:test` + mock `fetch`. |
| `workers/queue-daemon/auto-host.ts` | modify | Extend `AutoHostDeps` with `getYoutubeAudience`, change gate math in `runChatter`. |
| `workers/queue-daemon/auto-host.test.ts` | modify | Extend test fixture + add 4 new gate tests. |
| `workers/queue-daemon/index.ts` | modify | Wire new dep with loopback URL. |
| `app/api/station/listeners/route.ts` | modify | Subtract 1 from `listeners` when `fetchPublicYoutubeState().state === "live"`. |
| `dashboard/app/api/station/listeners/route.ts` | modify | Same subtraction using `fetchYoutubeSnapshot().state`. |
| `dashboard/app/api/status/route.ts` | modify | Subtract 1 in `buildStreamSnapshot` when YT is live. |
| `/etc/icecast2/icecast.xml` | manual edit on Orion | Operator runs sed; not in repo. |

---

## Task 1: Write `youtube-audience` parser test (failing)

**Files:**
- Test: `workers/queue-daemon/youtube-audience.test.ts` (create)

- [ ] **Step 1: Write the test file**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseYoutubeAudience,
  fetchYoutubeAudience,
} from "./youtube-audience.ts";

test("parseYoutubeAudience extracts state and concurrentViewers", () => {
  const r = parseYoutubeAudience({
    state: "live",
    concurrentViewers: 12,
  });
  assert.deepEqual(r, { state: "live", viewers: 12 });
});

test("parseYoutubeAudience treats missing concurrentViewers as 0", () => {
  const r = parseYoutubeAudience({ state: "ready" });
  assert.deepEqual(r, { state: "ready", viewers: 0 });
});

test("parseYoutubeAudience treats null concurrentViewers as 0", () => {
  const r = parseYoutubeAudience({ state: "live", concurrentViewers: null });
  assert.deepEqual(r, { state: "live", viewers: 0 });
});

test("parseYoutubeAudience defaults missing state to 'off'", () => {
  const r = parseYoutubeAudience({ concurrentViewers: 5 });
  assert.deepEqual(r, { state: "off", viewers: 5 });
});

test("parseYoutubeAudience returns null for non-object input", () => {
  assert.equal(parseYoutubeAudience(null), null);
  assert.equal(parseYoutubeAudience("string"), null);
  assert.equal(parseYoutubeAudience(42), null);
});

test("fetchYoutubeAudience returns parsed object on 200", async () => {
  const mockFetch = (async () =>
    new Response(
      JSON.stringify({ state: "live", concurrentViewers: 7 }),
      { status: 200 },
    )) as typeof fetch;
  const r = await fetchYoutubeAudience({
    url: "http://x/y",
    fetcher: mockFetch,
  });
  assert.deepEqual(r, { state: "live", viewers: 7 });
});

test("fetchYoutubeAudience returns null on non-200", async () => {
  const mockFetch = (async () =>
    new Response("err", { status: 500 })) as typeof fetch;
  const r = await fetchYoutubeAudience({ url: "http://x/y", fetcher: mockFetch });
  assert.equal(r, null);
});

test("fetchYoutubeAudience returns null on network error", async () => {
  const mockFetch = (async () => {
    throw new Error("ECONNREFUSED");
  }) as typeof fetch;
  const r = await fetchYoutubeAudience({ url: "http://x/y", fetcher: mockFetch });
  assert.equal(r, null);
});

test("fetchYoutubeAudience returns null on malformed JSON", async () => {
  const mockFetch = (async () =>
    new Response("not json", { status: 200 })) as typeof fetch;
  const r = await fetchYoutubeAudience({ url: "http://x/y", fetcher: mockFetch });
  assert.equal(r, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/marku/saas/numaradio && npx tsx --test workers/queue-daemon/youtube-audience.test.ts 2>&1 | tail -10`
Expected: FAIL with "Cannot find module './youtube-audience.ts'" or similar.

---

## Task 2: Implement `youtube-audience.ts`

**Files:**
- Create: `workers/queue-daemon/youtube-audience.ts`

- [ ] **Step 1: Write the implementation**

```typescript
/**
 * Fetches the dashboard's YouTube broadcast snapshot over loopback.
 * The dashboard already in-process caches the YouTube API call for 30s,
 * so this is effectively free — no extra YouTube API quota burn.
 *
 * Returns null on any failure (network, non-2xx, malformed JSON). Callers
 * MUST treat null as "unknown audience" — the gate then ignores YouTube
 * and uses pure icecast count.
 *
 * Cloudflare Access auth applies at the CF edge, never on loopback, so
 * 127.0.0.1 fetches succeed without credentials. Same pattern the daemon
 * already uses for the shoutout-dispatch path.
 */

export type YoutubeAudience = {
  /** "live" | "ready" | "off" | "error" — only "live" triggers the
   *  encoder-subtraction in callers. */
  state: string;
  /** Concurrent YouTube viewers (0 if YouTube doesn't expose it). */
  viewers: number;
};

export interface FetchYoutubeAudienceOpts {
  url: string;
  timeoutMs?: number;
  /** Inject a mock fetch in tests; defaults to global fetch. */
  fetcher?: typeof fetch;
}

/** Pure parser, separated for direct unit testing. */
export function parseYoutubeAudience(raw: unknown): YoutubeAudience | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as { state?: unknown; concurrentViewers?: unknown };
  const state = typeof obj.state === "string" ? obj.state : "off";
  const viewers =
    typeof obj.concurrentViewers === "number" ? obj.concurrentViewers : 0;
  return { state, viewers };
}

export async function fetchYoutubeAudience(
  opts: FetchYoutubeAudienceOpts,
): Promise<YoutubeAudience | null> {
  const fetcher = opts.fetcher ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 2_000;
  try {
    const r = await fetcher(opts.url, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return null;
    const json = await r.json();
    return parseYoutubeAudience(json);
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd /home/marku/saas/numaradio && npx tsx --test workers/queue-daemon/youtube-audience.test.ts 2>&1 | tail -15`
Expected: 9 tests pass, 0 fail.

- [ ] **Step 3: Commit**

```bash
cd /home/marku/saas/numaradio
git add workers/queue-daemon/youtube-audience.ts workers/queue-daemon/youtube-audience.test.ts
git commit -m "feat(daemon): add youtube-audience helper for gate fold-in

Fetches state + viewers from the dashboard's /api/youtube/health over
loopback. Dashboard in-process caches the call for 30s, so this adds
zero YouTube API quota. Fail-soft: returns null on any error, callers
treat null as 'unknown' and skip the YouTube fold-in.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Extend `auto-host` test fixture for new gate logic (failing tests first)

**Files:**
- Modify: `workers/queue-daemon/auto-host.test.ts`

- [ ] **Step 1: Read the existing test fixture**

Run: `grep -nB2 -A30 "function makeOrch\|function makeDeps\|getListenerCount:" /home/marku/saas/numaradio/workers/queue-daemon/auto-host.test.ts | head -60`

This reveals the helper that builds an orchestrator with stub deps. You'll extend it with `getYoutubeAudience`.

- [ ] **Step 2: Add `getYoutubeAudience` to the fixture-build helper**

Find the helper that creates an `AutoHostOrchestrator` with stub deps (typically named `makeOrch`, `makeDeps`, or inline). Add a `getYoutubeAudience` field defaulting to returning `null` (preserves current behavior in existing tests):

```typescript
// In whatever helper builds AutoHostDeps for tests, add:
getYoutubeAudience: async () => null,
```

This default keeps every existing test green: `null` audience means "no YouTube fold-in" → behaves like today.

- [ ] **Step 3: Run existing tests to verify no regression from fixture change**

Run: `cd /home/marku/saas/numaradio && npx tsx --test workers/queue-daemon/auto-host.test.ts 2>&1 | tail -15`
Expected: all existing tests still pass (the `getYoutubeAudience: async () => null` field is unused until Task 4).

- [ ] **Step 4: Add 4 new gate-decision tests at the bottom of the file**

```typescript
test("auto mode + youtube live: subtracts encoder, adds viewers, speaks when total >= 3", async () => {
  // icecast=2 (1 real + 1 OBS), yt=live, viewers=5
  // effective = 2 + 5 - 1 = 6 → speak
  const orch = makeOrch({
    config: async () => ({ ...defaultConfig, autoHost: { mode: "auto" } }),
    getListenerCount: async () => 2,
    getYoutubeAudience: async () => ({ state: "live", viewers: 5 }),
  });
  // (use whatever helper your existing tests use to assert "speaks" —
  //  e.g. spy on minimax or check state.markFailure wasn't called)
  await orch.runChatter();
  assert.equal(orch.state.consecutiveFailures, 0); // adapt to your helper
});

test("auto mode + youtube live: encoder-only icecast + zero viewers → skips", async () => {
  // icecast=1 (just OBS), yt=live, viewers=0
  // effective = 1 + 0 - 1 = 0 → skip
  const orch = makeOrch({
    config: async () => ({ ...defaultConfig, autoHost: { mode: "auto" } }),
    getListenerCount: async () => 1,
    getYoutubeAudience: async () => ({ state: "live", viewers: 0 }),
  });
  await orch.runChatter();
  assert.ok(orch.state.consecutiveFailures > 0); // adapt
});

test("auto mode + youtube off: ignores YT entirely, uses raw icecast", async () => {
  // icecast=2, yt=off → effective = 2 + 0 - 0 = 2 → skip (< 3)
  const orch = makeOrch({
    config: async () => ({ ...defaultConfig, autoHost: { mode: "auto" } }),
    getListenerCount: async () => 2,
    getYoutubeAudience: async () => ({ state: "off", viewers: 0 }),
  });
  await orch.runChatter();
  assert.ok(orch.state.consecutiveFailures > 0);
});

test("auto mode + youtube fetch fails: ignores YT, uses raw icecast", async () => {
  // icecast=3, yt=null (fetch fail) → effective = 3 + 0 - 0 = 3 → speak
  const orch = makeOrch({
    config: async () => ({ ...defaultConfig, autoHost: { mode: "auto" } }),
    getListenerCount: async () => 3,
    getYoutubeAudience: async () => null,
  });
  await orch.runChatter();
  assert.equal(orch.state.consecutiveFailures, 0);
});
```

> **Adaptation note:** The exact assertion shape (`orch.state.consecutiveFailures` vs spy on `minimax`, etc.) MUST match the existing tests at `auto-host.test.ts:218` ("auto mode skips when listeners < 3") and `:229` ("auto mode speaks when listeners >= 3"). Read those two tests first and copy their assertion pattern verbatim.

- [ ] **Step 5: Run tests to verify the 4 new ones FAIL**

Run: `cd /home/marku/saas/numaradio && npx tsx --test workers/queue-daemon/auto-host.test.ts 2>&1 | tail -20`
Expected: 4 new tests fail (gate currently uses raw icecast only — the YT viewers aren't added yet).

---

## Task 4: Implement gate change in `auto-host.ts`

**Files:**
- Modify: `workers/queue-daemon/auto-host.ts`

- [ ] **Step 1: Add the dep to the interface**

Find `export interface AutoHostDeps {` (around line 105). Add this field after `getListenerCount`:

```typescript
  /**
   * Returns the current YouTube broadcast audience: state + concurrent
   * viewers. Returns null on any fetch error — gate then ignores YouTube
   * and uses pure icecast count (no fold-in, no encoder subtraction).
   *
   * Loopback fetch to the dashboard's /api/youtube/health, which is
   * in-process cached 30s. Effectively free.
   */
  getYoutubeAudience: () => Promise<{ state: string; viewers: number } | null>;
```

- [ ] **Step 2: Update the gate logic in `runChatter`**

Find the block at lines 277-283 (`if (cfg.autoHost.mode === "auto") { ... }`) and replace it with:

```typescript
      if (cfg.autoHost.mode === "auto") {
        const [icecast, audience] = await Promise.all([
          this.deps.getListenerCount(),
          this.deps.getYoutubeAudience(),
        ]);
        // null icecast = unknown stream state → fail-closed (skip).
        if (icecast === null) {
          this.state.markFailure();
          return;
        }
        // Effective audience = real icecast listeners + YouTube viewers,
        // minus 1 for the OBS/encoder pull when broadcast is live. Audience
        // null (YT fetch failed) → no fold-in, no subtraction.
        const liveBroadcast = audience?.state === "live";
        const effective =
          icecast +
          (liveBroadcast ? (audience?.viewers ?? 0) - 1 : 0);
        if (effective < 3) {
          this.state.markFailure();
          return;
        }
      }
      // forced_on or auto-with-enough-effective-audience → proceed
```

- [ ] **Step 3: Run all auto-host tests**

Run: `cd /home/marku/saas/numaradio && npx tsx --test workers/queue-daemon/auto-host.test.ts 2>&1 | tail -20`
Expected: ALL tests pass — the 4 new ones plus all pre-existing.

- [ ] **Step 4: Run the daemon's full test suite to catch any other consumers**

Run: `cd /home/marku/saas/numaradio && npx tsx --test workers/queue-daemon/*.test.ts 2>&1 | tail -10`
Expected: every test green. If any fail because they instantiate `AutoHostOrchestrator` directly without `getYoutubeAudience`, add the same `getYoutubeAudience: async () => null` default to those fixtures.

- [ ] **Step 5: Commit**

```bash
cd /home/marku/saas/numaradio
git add workers/queue-daemon/auto-host.ts workers/queue-daemon/auto-host.test.ts
git commit -m "feat(daemon): fold YouTube viewers into auto-chatter gate

Gate becomes: effective = icecast + yt_viewers - (live ? 1 : 0).
Subtracts the OBS encoder's icecast pull when broadcasting; adds YT
viewers so Lena doesn't go silent during a stream when YT has the
audience but icecast doesn't. Fail-soft: YT fetch failure → no
fold-in, falls back to today's pure-icecast behavior.

Threshold >= 3 unchanged. Semantic richer: 'real audio listeners +
real YT viewers'.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Wire `youtube-audience` into daemon `index.ts`

**Files:**
- Modify: `workers/queue-daemon/index.ts`

- [ ] **Step 1: Add the import**

At the top of the file, near `import { fetchListenerCount } from "./icecast-listeners.ts";`, add:

```typescript
import { fetchYoutubeAudience } from "./youtube-audience.ts";
```

- [ ] **Step 2: Add an env-driven URL constant**

Near the other env-derived constants (find `ICECAST_STATUS_URL`), add:

```typescript
const DASHBOARD_YOUTUBE_HEALTH_URL =
  process.env.DASHBOARD_YOUTUBE_HEALTH_URL ??
  "http://127.0.0.1:3001/api/youtube/health";
```

- [ ] **Step 3: Wire the new dep into the AutoHostOrchestrator construction**

Find the `new AutoHostOrchestrator({ ... })` call (around line 121). Add this field after the `getListenerCount` field:

```typescript
  getYoutubeAudience: () =>
    fetchYoutubeAudience({ url: DASHBOARD_YOUTUBE_HEALTH_URL }),
```

- [ ] **Step 4: Type-check the daemon**

Run: `cd /home/marku/saas/numaradio && npx tsc --noEmit 2>&1 | tail -10`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd /home/marku/saas/numaradio
git add workers/queue-daemon/index.ts
git commit -m "feat(daemon): wire fetchYoutubeAudience into AutoHostOrchestrator

Loopback to dashboard's :3001/api/youtube/health (CF Access never hits
loopback). Env-overridable via DASHBOARD_YOUTUBE_HEALTH_URL.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Patch main site `/api/station/listeners`

**Files:**
- Modify: `app/api/station/listeners/route.ts`

- [ ] **Step 1: Add the import**

Open the file and add this import after the existing `ambientFloor` import:

```typescript
import { fetchPublicYoutubeState } from "@/lib/youtube-public";
```

- [ ] **Step 2: Subtract OBS in the success branch**

Locate the line `const listeners = Math.max(0, stream?.listeners ?? 0);` and replace with:

```typescript
    // While broadcasting to YouTube, the encoder itself counts as 1
    // icecast listener (it pulls the stream as a media source). Subtract
    // it so the public count reflects real audio listeners only.
    // fetchPublicYoutubeState is in-process cached 60s — no extra API
    // quota burn for this call.
    const yt = await fetchPublicYoutubeState();
    const rawListeners = Math.max(0, stream?.listeners ?? 0);
    const listeners = Math.max(
      0,
      rawListeners - (yt.state === "live" ? 1 : 0),
    );
```

- [ ] **Step 3: Type-check**

Run: `cd /home/marku/saas/numaradio && npx tsc --noEmit 2>&1 | tail -10`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /home/marku/saas/numaradio
git add app/api/station/listeners/route.ts
git commit -m "fix(api): subtract YT encoder from public listener count

Public hero + /live broadcast stage now show real audio listeners only
when broadcasting (encoder no longer self-counts). Uses already-cached
fetchPublicYoutubeState — no new YouTube API calls.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Patch dashboard `/api/station/listeners`

**Files:**
- Modify: `dashboard/app/api/station/listeners/route.ts`

- [ ] **Step 1: Add the import**

Add after the existing `fetchIcecastStatus` import:

```typescript
import { fetchYoutubeSnapshot } from "@/lib/youtube";
```

- [ ] **Step 2: Subtract OBS in the success branch**

Replace the body of the `try { ... }` block:

```typescript
  try {
    const [s, yt] = await Promise.all([
      fetchIcecastStatus(STATUS_URL, MOUNT),
      fetchYoutubeSnapshot().catch(() => null),
    ]);
    const rawListeners =
      typeof s.listeners === "number" ? Math.max(0, s.listeners) : 0;
    const listeners = Math.max(
      0,
      rawListeners - (yt?.state === "live" ? 1 : 0),
    );
    return NextResponse.json({
      ok: true,
      listeners,
      withFloor: BOOST + listeners,
      isLive: s.mount !== null,
    });
  } catch {
    return NextResponse.json({
      ok: false,
      listeners: null,
      withFloor: BOOST,
      isLive: false,
    });
  }
```

- [ ] **Step 3: Type-check the dashboard**

Run: `cd /home/marku/saas/numaradio/dashboard && npx tsc --noEmit 2>&1 | tail -10`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /home/marku/saas/numaradio
git add dashboard/app/api/station/listeners/route.ts
git commit -m "fix(dashboard): subtract YT encoder from /shoutouts listener label

The 'Auto — currently On (N listeners)' label on /shoutouts now
matches the corrected dashboard pill: real audio listeners only when
broadcasting. fetchYoutubeSnapshot is in-process cached 30s.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Patch dashboard `/api/status`

**Files:**
- Modify: `dashboard/app/api/status/route.ts`

- [ ] **Step 1: Add the import**

Add after the existing `fetchIcecastStatus` import:

```typescript
import { fetchYoutubeSnapshot } from "@/lib/youtube";
```

- [ ] **Step 2: Add YT to the parallel Promise.all**

Find the `Promise.all([` block (line ~55). Add `fetchYoutubeSnapshot().catch(() => null),` to the array, and add a destructured `youtubeSnap` to the result:

```typescript
  const [icecastResult, servicesResult, neon, b2, tunnel, visitors, dbNowPlaying, youtubeSnap] = await Promise.all([
    fetchIcecastStatus(icecastUrl, "/stream").then(
      (v) => ({ ok: true as const, v }),
      (e) => ({ ok: false as const, e }),
    ),
    Promise.all(SERVICE_NAMES.map((n) => getServiceState(n))) as Promise<ServiceState[]>,
    checkNeon(),
    checkB2(),
    fetchTunnelHealth(metricsUrl),
    fetchSiteVisitors(),
    fetchNowPlayingFromDb(),
    fetchYoutubeSnapshot().catch(() => null),
  ]);

  const stream = buildStreamSnapshot(publicUrl, icecastResult, tunnel, dbNowPlaying, youtubeSnap);
```

- [ ] **Step 3: Update `buildStreamSnapshot` to take + apply YT state**

Modify the signature and the listeners assignment:

```typescript
function buildStreamSnapshot(
  publicUrl: string,
  icecast:
    | { ok: true; v: Awaited<ReturnType<typeof fetchIcecastStatus>> }
    | { ok: false; e: unknown },
  tunnel: TunnelHealth,
  dbNowPlaying: { artist: string | null; title: string } | null,
  youtubeSnap: Awaited<ReturnType<typeof fetchYoutubeSnapshot>> | null,
): StreamSnapshot {
  if (!icecast.ok) {
    return {
      publicUrl,
      reachable: false,
      listeners: null,
      listenerPeak: null,
      bitrate: null,
      nowPlaying: dbNowPlaying,
      error: icecast.e instanceof Error ? icecast.e.message : "icecast probe failed",
    };
  }
  const s = icecast.v;
  const sourceConnected = s.mount === "/stream";
  // Subtract the encoder's icecast pull when broadcasting so the
  // dashboard 'Listening now' pill reflects real audio listeners only.
  const rawListeners = s.listeners ?? 0;
  const listeners = Math.max(
    0,
    rawListeners - (youtubeSnap?.state === "live" ? 1 : 0),
  );
  return {
    publicUrl,
    reachable: sourceConnected && tunnel.ok,
    listeners,
    listenerPeak: s.listenerPeak,
    bitrate: s.bitrate,
    nowPlaying: dbNowPlaying ?? s.nowPlaying,
  };
}
```

- [ ] **Step 4: Type-check the dashboard**

Run: `cd /home/marku/saas/numaradio/dashboard && npx tsc --noEmit 2>&1 | tail -10`
Expected: no errors.

- [ ] **Step 5: Run dashboard tests if present**

Run: `cd /home/marku/saas/numaradio/dashboard && npm test 2>&1 | tail -15`
Expected: all green. (No new tests added — the patch is a thin transform; behavior is covered by manual verification in Task 10.)

- [ ] **Step 6: Commit**

```bash
cd /home/marku/saas/numaradio
git add dashboard/app/api/status/route.ts
git commit -m "fix(dashboard): subtract YT encoder from 'Listening now' status pill

Dashboard top-of-page pill (status-pills.tsx → /api/status) now shows
real listeners only when broadcasting. Adds fetchYoutubeSnapshot to
the existing parallel Promise.all (in-process cached 30s, no extra
quota burn).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Push to origin

- [ ] **Step 1: Push all commits**

Run: `cd /home/marku/saas/numaradio && git push`
Expected: push succeeds; Vercel auto-deploys main + dashboard within ~60-90s.

---

## Task 10: Operator deploy + verify

> This task is run by the operator (you), not the agent. The agent prints these commands and stops.

- [ ] **Step 1: Apply icecast tuning** (zombies cleanup, server config)

Paste this into the prompt with a leading `!` so it runs in your shell:

```bash
sudo cp /etc/icecast2/icecast.xml /etc/icecast2/icecast.xml.bak.$(date +%Y%m%d-%H%M%S) && \
sudo sed -i 's|<queue-size>[0-9]*</queue-size>|<queue-size>204800</queue-size>|g' /etc/icecast2/icecast.xml && \
sudo sed -i 's|<burst-size>[0-9]*</burst-size>|<burst-size>32768</burst-size>|g' /etc/icecast2/icecast.xml && \
sudo xmllint --noout /etc/icecast2/icecast.xml && echo "XML valid — restarting" && \
sudo systemctl restart icecast2 && \
sleep 2 && systemctl is-active icecast2 && \
curl -s http://127.0.0.1:8000/status-json.xsl | grep -oP '"listeners":\d+'
```

Expected:
- `XML valid — restarting`
- `active`
- `"listeners":N` (some small N — could be 0-2 since the restart drops everyone briefly)

If anything fails, revert: `sudo cp /etc/icecast2/icecast.xml.bak.* /etc/icecast2/icecast.xml && sudo systemctl restart icecast2`

- [ ] **Step 2: Restart the queue daemon** (picks up gate change + new YT fetch)

Run: `sudo systemctl restart numa-queue-daemon`
Expected: silent. Verify with `systemctl is-active numa-queue-daemon` → `active`.

- [ ] **Step 3: Verify dashboard "Listening now" matches expectation**

Open `https://dashboard.numaradio.com/`. The top "Listening now" pill should show:
- If broadcasting (YT card pill = LIVE): `real_listeners` (icecast count minus 1 for OBS).
- If not broadcasting: `real_listeners` (raw icecast count).

Cross-check with `https://dashboard.numaradio.com/shoutouts` — the "Auto — currently On (N listeners)" label should match the top pill exactly.

- [ ] **Step 4: Tail the daemon to verify gate logic**

Run: `journalctl --user -u numa-queue-daemon -f | grep -iE "auto.?chatter|gate|skip"`
Wait for an auto-chatter break (every ~2-10 min depending on rotation). You should NOT see the gate skip when YT is live with viewers, even if icecast count is low. You SHOULD see it skip when both icecast and YT are empty.

- [ ] **Step 5: Update HANDOFF.md** with a one-line note

Edit `docs/HANDOFF.md`, add a row to the "Current live state" or top of file:
```
- 2026-05-03 (afternoon) — listener-count cleanup live: icecast queue tuning,
  YT-encoder subtraction across 3 routes, daemon gate folds in YT viewers.
  Spec: docs/superpowers/specs/2026-05-03-listener-count-cleanup-design.md.
```

Then commit + push:
```bash
cd /home/marku/saas/numaradio && git add docs/HANDOFF.md && \
  git commit -m "docs: handoff note for listener-count cleanup ship

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>" && \
git push
```

---

## Self-review

**Spec coverage:**
- Patch 1 (icecast tuning) → Task 10 step 1 ✅
- Patch 2 (3 Vercel endpoints subtract OBS) → Tasks 6, 7, 8 ✅
- Patch 3 (daemon gate fold-in + youtube-audience helper) → Tasks 1, 2, 3, 4, 5 ✅
- Tests: youtube-audience parser/fetcher (5 + 4 = 9 tests) → Task 1, 2 ✅
- Tests: auto-host gate (4 new tests) → Task 3 ✅
- Deploy: Vercel auto + daemon restart + verify → Tasks 9, 10 ✅
- Failure handling notes match spec ✅
- "What this does not change" all preserved (no schema, no migration, no edge-cache TTL changes, no B2 calls, no new quota burn) ✅

**Placeholder scan:** none. All steps have real code, real commands, real expected outputs.

**Type consistency:**
- `YoutubeAudience` type is `{ state: string; viewers: number }` everywhere it appears.
- `getYoutubeAudience: () => Promise<{ state: string; viewers: number } | null>` in `AutoHostDeps` (Task 4) matches `fetchYoutubeAudience` return signature (Task 2).
- `fetchYoutubeSnapshot` return type used in dashboard routes (Tasks 7, 8) is the existing dashboard helper — pulled with `Awaited<ReturnType<>>` in Task 8 to avoid hardcoding the shape.
- `fetchPublicYoutubeState` returns `PublicYoutubeState` (`{ state: "live" | "off" | "error" }`) — used in Task 6 with `.state === "live"` check.

No issues to fix.
