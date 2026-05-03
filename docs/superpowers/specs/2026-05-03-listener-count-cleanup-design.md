# Listener-count cleanup — icecast tuning + OBS subtraction + YouTube viewer fold-in

**Status:** approved 2026-05-03, ready to implement.

**Problem:** Dashboard "Listening now" reads raw icecast count, which includes:
1. Stuck/zombie TCP connections (hours-long lifetime due to default queue-size).
2. The OBS encoder itself, which pulls icecast as a media source while broadcasting.

Auto-chatter gate uses the same raw count, so Lena chatters when nobody real is listening (just OBS + zombies), and conversely could go silent if we naively subtract OBS while a YouTube audience exists.

**Goal:** Single coherent "listener" notion across all surfaces: real audio listeners on icecast + concurrent YouTube viewers, minus the OBS encoder pull.

---

## Three patches

### 1. Icecast queue tuning (one-time server config)

Operator runs the sed command:

```bash
sudo cp /etc/icecast2/icecast.xml /etc/icecast2/icecast.xml.bak.$(date +%Y%m%d-%H%M%S)
sudo sed -i 's|<queue-size>[0-9]*</queue-size>|<queue-size>204800</queue-size>|g' /etc/icecast2/icecast.xml
sudo sed -i 's|<burst-size>[0-9]*</burst-size>|<burst-size>32768</burst-size>|g' /etc/icecast2/icecast.xml
sudo xmllint --noout /etc/icecast2/icecast.xml
sudo systemctl restart icecast2
```

`queue-size`: `524288` → `204800` (~22s buffer → ~8.5s @ 192 kbps). Stuck listeners are kicked by icecast's "fallen too far behind" mechanism in seconds, not hours. Stable connections never fall behind. `burst-size`: `65535` → `32768` reduces initial catch-up data on connect.

Real-listener impact: zero on stable networks. Network blip > 8.5s → kicked, browser auto-reconnects within ~1s of recovery.

### 2. Three Vercel endpoints subtract OBS when broadcasting

| File | Helper used | Edit |
|---|---|---|
| `app/api/station/listeners/route.ts` | `fetchPublicYoutubeState()` from `@/lib/youtube-public` | If `state === "live"`, `listeners = max(0, listeners - 1)` before computing `withFloor`. |
| `dashboard/app/api/station/listeners/route.ts` | `fetchYoutubeSnapshot()` from `@/lib/youtube` | Same subtraction before composing `withFloor`. |
| `dashboard/app/api/status/route.ts` | `fetchYoutubeSnapshot()` from `@/lib/youtube` | Inside `buildStreamSnapshot`, subtract 1 from `s.listeners` when broadcasting. |

Both helpers are already in-process cached (60s for public, 30s for dashboard). **Zero new YouTube API calls.** Both are already called by sibling routes — no new dependencies introduced.

Failure handling: any helper exception → treat as `state = "off"` → no subtraction → falls back to today's behavior. Never increases the count.

### 3. Daemon gate folds in YouTube viewers

**`workers/queue-daemon/auto-host.ts`:**

The `runChatter()` gate currently calls `this.deps.getListenerCount()` and skips if `< 3`. Add a parallel call:

```ts
if (cfg.autoHost.mode === "auto") {
  const [icecast, audience] = await Promise.all([
    this.deps.getListenerCount(),
    this.deps.getYoutubeAudience(),  // NEW
  ]);
  const liveBroadcast = audience?.state === "live";
  const effective =
    (icecast ?? 0)
    + (liveBroadcast ? (audience?.viewers ?? 0) - 1 : 0);
  // null icecast still fail-closes (raw === null → effective === 0 + ...).
  // If icecast is null AND broadcast is off, effective = 0 → skip.
  if (icecast === null || effective < 3) {
    this.state.markFailure();
    return;
  }
}
```

**New dep `getYoutubeAudience(): Promise<{ state, viewers } | null>`:**

```ts
// workers/queue-daemon/youtube-audience.ts
export async function fetchYoutubeAudience(opts: {
  url: string; timeoutMs?: number;
}): Promise<{ state: string; viewers: number } | null> {
  try {
    const r = await fetch(opts.url, {
      signal: AbortSignal.timeout(opts.timeoutMs ?? 2_000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { state?: string; viewers?: number };
    return { state: j.state ?? "off", viewers: j.viewers ?? 0 };
  } catch {
    return null;
  }
}
```

Wired in `workers/queue-daemon/index.ts` with `url = http://127.0.0.1:3001/api/youtube/health` (the dashboard's existing endpoint, in-process cached 30s).

**Loopback bypass:** Cloudflare Access auth applies at the CF edge, never on loopback. The dashboard process itself doesn't enforce auth, so loopback fetches succeed without credentials. (The same pattern is already used by the daemon's shoutout-dispatch path.)

**Failure handling:** `null` from `fetchYoutubeAudience` → `liveBroadcast = false`, no subtraction, no addition. Gate behaves as today (raw icecast). Never blocks Lena because of a YouTube outage.

**Threshold unchanged at `>= 3`.** Semantic of the threshold is now richer: "real audio listeners + real YouTube viewers."

---

## What this does not change

- No schema changes, no migrations.
- No new B2 calls, no new YouTube API quota burn.
- No edge-cache TTL changes — the recently-tuned `s-maxage` values on `/api/station/{listeners, broadcast, lena-line, now-playing}` are untouched.
- `cache: "no-store"` is not introduced anywhere.
- The 10 visibility-gated client pollers are untouched.
- `getCachedNowPlayingSnapshot()` and the `unstable_cache` wrapper are untouched.
- `dashboard/checkB2()` and the Cloudflare Page Rule for audio/artwork are untouched.

---

## Tests

- `parseListenerCount` already has tests in `workers/queue-daemon/icecast-listeners.test.ts`. No change needed — it still returns raw icecast count.
- New `workers/queue-daemon/youtube-audience.test.ts`: parses success, network error, timeout, non-200, malformed JSON. ~5 tests.
- `auto-host.test.ts`: extend the existing gate-decision tests with a new fixture stubbing `getYoutubeAudience`. Cases:
  - icecast=2, broadcast=off → effective=2 → skip
  - icecast=2, broadcast=live, viewers=5 → effective=2+5-1=6 → proceed
  - icecast=1, broadcast=live, viewers=0 → effective=1+0-1=0 → skip
  - icecast=null, broadcast=live, viewers=10 → still skip (null → fail-closed)

No tests on the three Vercel routes — the patches are tiny, the helpers they call are already tested, and the routes are smoke-validated by browsing the dashboard.

---

## Deploy

1. **Code lands on `main`** → Vercel auto-deploys main site + dashboard. Both pick up patches 2 & 3 (Vercel side) automatically.
2. **Operator runs the sed command** for the icecast tuning. One-shot, takes 30s.
3. **Operator restarts the queue daemon** to pick up the new gate logic:
   ```
   sudo systemctl restart numa-queue-daemon
   ```
4. **Verify**:
   - Dashboard "Listening now" shows `icecast - 1` while broadcasting (you can tell because the YouTube card pill says LIVE).
   - `/shoutouts` "Auto — currently On (N listeners)" matches the dashboard pill.
   - `journalctl --user -u numa-queue-daemon -f` after a chatter tick: log line shows the combined effective count instead of just icecast.

---

## Out of scope (deferred)

- Heartbeat-based listener metric (originally proposed as #4). Right architectural answer for a multi-CDN future, but ~2-3 hours of work with a new table + migration. Defer until accurate listener counts matter for a business reason (sponsor reporting, ad pitch).
- Detection by user-agent in icecast admin API. Cleaner signal than "youtube is live" but needs admin password plumbing. The youtube-state proxy is good enough.
- Quarantining the +15 ambient floor. The floor is marketing, the new effective count is operations — they coexist fine.
