# Auto-chatter listener-aware gating — design

**Status:** Approved 2026-04-24
**Scope:** Small. One Prisma migration + queue-daemon decision hook + dashboard UI change.

## Problem

Auto-chatter (Lena speaking between tracks) is currently a single manual
boolean toggle on the `/shoutouts` dashboard page. If the operator forgets
to turn it off, Lena keeps talking to an empty room. If listeners show up
and auto-chatter is off, she stays silent when she could be filling space.

The operator still needs the **final say** — e.g. when testing with zero
listeners, forcing it on must actually keep it on — but as a failsafe the
forced state should auto-revert so a forgotten force doesn't persist.

## Requirements

- **Auto mode:** evaluate at each break decision. On if raw Icecast
  listener count ≥5, off if <5. No hysteresis — the queue-daemon already
  decides roughly every 6 minutes (every 2 music tracks), which provides
  natural debouncing against listener-count bounces.
- **Forced On:** speak regardless of listener count. Expires after 20 min
  back to Auto.
- **Forced Off:** skip breaks regardless of listener count. Expires after
  20 min back to Auto.
- **Fail-closed on Icecast error:** if we can't read listener count, in
  Auto mode skip the break. Better silence than shouting to no one.
- Listener count throughout is the **raw** Icecast value, never the +15
  marketing boost used on the public hero.

## Data model

Prisma migration on `Station`:

```prisma
enum AutoHostMode {
  auto
  forced_on
  forced_off
}

model Station {
  // ...
  // REMOVE:
  // autoHostEnabled Boolean @default(false)
  // ADD:
  autoHostMode        AutoHostMode @default(auto)
  autoHostForcedUntil DateTime?
  autoHostForcedBy    String?   // CF Access email that forced
}
```

**Invariant:** `autoHostMode == auto` ⟹ `autoHostForcedUntil` and
`autoHostForcedBy` are both `null`. Set and cleared atomically in the
same update.

## State machine (queue-daemon)

Hook at `workers/queue-daemon/auto-host.ts:runChatter()` line ~186,
before the existing flag check:

```
config = StationConfigCache.read()      // {mode, forcedUntil, forcedBy}

if config.mode != "auto" and config.forcedUntil <= now:
    // Lazy revert. Atomic UPDATE WHERE forcedUntil = <stored> to
    // avoid racing with an operator toggle landing simultaneously.
    db.station.update({mode: "auto", forcedUntil: null, forcedBy: null})
    log("Auto-chatter auto-reverted from <mode> to Auto (20m elapsed)")
    cache.invalidate()
    config.mode = "auto"

switch config.mode:
  case "forced_off": return   // skip break, don't speak
  case "forced_on":  proceed  // skip listener check
  case "auto":
    try:
      listeners = parseIcecastStatus().listeners   // raw count
    catch:
      return                  // fail-closed
    if listeners < 5: return
    proceed
```

### Cache

Rename `StationFlagCache` → `StationConfigCache`. Same 30s TTL. Returns
`{mode, forcedUntil, forcedBy}` instead of `boolean`. Signature change
is small — the only consumer is `auto-host.ts`.

### Listener count source

Reuse `dashboard/lib/icecast.ts:parseIcecastStatus()`. In the daemon,
call it directly (no HTTP hop through the Next.js route) — the daemon
already hits Icecast for other things. Short timeout (2s). Error path
returns undefined → `auto` mode skips the break.

## Dashboard UI — `/shoutouts`

Replace the existing boolean toggle with a three-button segmented
control:

```
[ Auto ]  [ Forced On ]  [ Forced Off ]
```

**Auto state** (secondary text underneath):
- `Auto — currently On (7 listeners)`  (raw count, live from /api/station/listeners)
- `Auto — currently Off (2 listeners)`

**Forced state** (secondary text underneath):
- `Forced On — reverts to Auto in 18 min` (countdown, client-side math
  from `forcedUntil`)
- `Forced Off — reverts to Auto in 12 min`

Countdown is plain client-side math; no SSE, no polling. If the operator
leaves the tab open past expiry, the countdown just reads `Reverting…`
until the next page refresh picks up the new state.

### API

`POST /api/shoutouts/auto-host` body changes:

```diff
- { enabled: boolean }
+ { mode: "auto" | "forced_on" | "forced_off" }
```

Server behavior:
- `mode == "auto"`: `autoHostMode=auto, autoHostForcedUntil=null, autoHostForcedBy=null`
- `mode == "forced_on" | "forced_off"`: set `autoHostMode=<mode>,
  autoHostForcedUntil=now+20min, autoHostForcedBy=<cf-email>`

`GET /api/shoutouts/auto-host` returns `{mode, forcedUntil, forcedBy}`.

### Audit log

Reuse the existing `OperatorLog` writes the current toggle already does.
New log lines:

- `Operator <email> set auto-chatter to Forced On (expires in 20m)`
- `Operator <email> set auto-chatter to Forced Off (expires in 20m)`
- `Operator <email> set auto-chatter to Auto`
- `Auto-chatter auto-reverted from Forced On to Auto (20m elapsed)` —
  written by the daemon when lazy revert fires
- `Auto-chatter auto-reverted from Forced Off to Auto (20m elapsed)`

## Tests

**`workers/queue-daemon/station-config-cache.test.ts`**
- First read hits DB
- Second read within 30s returns cached value
- After 30s TTL, reads DB again
- `invalidate()` forces next read to hit DB

**`workers/queue-daemon/auto-host.test.ts`** (new cases)
- `forced_on` speaks even when listeners = 0
- `forced_off` skips even when listeners = 50
- `auto` skips when listeners < 5
- `auto` speaks when listeners ≥ 5
- Expired `forced_on` lazy-reverts to `auto`, then evaluates listener
  count and decides accordingly (listeners=0 → skip, listeners=10 → speak)
- Expired `forced_off` lazy-reverts to `auto`, then evaluates
- Icecast fetch throws in `auto` mode → skip (fail-closed)
- Icecast fetch throws in `forced_on` → still speaks (force overrides)

**`dashboard/app/api/shoutouts/auto-host/route.test.ts`**
- POST `{mode:"forced_on"}` sets mode + forcedUntil ~20min ahead + forcedBy=email
- POST `{mode:"forced_off"}` likewise
- POST `{mode:"auto"}` clears forcedUntil and forcedBy
- GET returns current config
- Rejects invalid mode values

**`dashboard/lib/icecast.test.ts`** (if not already covered)
- Parser returns listener count on good JSON
- Throws / returns undefined on malformed / network error

## Out of scope

- **Hysteresis band** — using natural 6-min debounce (single threshold
  at 5).
- **Count-based expiry** — time-only (20 min). Forced-off has no
  chatters to count anyway.
- **Server-sent events for dashboard countdown** — client-side math is
  sufficient. Refresh picks up any state change.
- **Per-show auto-chatter rules** (e.g. "quieter during Midnight Drive")
  — separate feature, not blocking this.
- **Listener-count-aware break cadence** (speak more when many listeners,
  less when few) — separate feature.

## Rollout

Single migration + daemon restart + dashboard deploy. Migration drops
`autoHostEnabled` — the default for `autoHostMode` is `auto`, which
behaves like the old `enabled=false` would have when listeners are low
and `enabled=true` would have when listeners are high. No data
backfill needed.

**Ordering gotcha:** the running daemon currently selects
`autoHostEnabled`. The migration drops that column, so the moment the
migration lands, the old daemon will error on its next 30s cache
refresh. Keep that window as short as possible by running migration +
daemon restart back-to-back.

Deploy order:
1. On Orion, `git pull` and build the daemon locally (don't restart yet).
2. Apply Prisma migration on Neon (`npx prisma migrate deploy`).
3. **Immediately** `sudo systemctl restart numa-queue-daemon` on Orion.
   Old daemon may log one or two SELECT errors in the gap — that's fine,
   it's a ~seconds window and it retries on the next track boundary.
4. `cd dashboard && npm run deploy` — ships new UI + new API shape.

Dashboard deploys last so the old UI (writing `{enabled: bool}`) can
keep working against the new API briefly (we'll make the server accept
both shapes for one deploy, then remove the compat in a follow-up) — or
simpler: just accept a brief UI outage on `/shoutouts` during the gap
between step 3 and step 4. Solo project, under a minute, acceptable.
