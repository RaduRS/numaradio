# On-demand track queue + Neon-backed rotation — Design

**Date:** 2026-04-20
**Status:** Design approved, awaiting implementation plan
**Owner:** Markus

## 1. Purpose

Replace the current static one-line `/etc/numa/playlist.m3u` with a two-source broadcast pipeline so that:

1. **User-requested tracks air as the next song** after the currently-playing one finishes — no mid-track interruption, upper bound on wait = remaining duration of the current song.
2. **Library tracks added to Neon appear in rotation within ~2 minutes** without any manual step or service restart.
3. **Liquidsoap can restart** without losing pending priority requests.
4. **The station never goes to dead air** when Neon, the queue daemon, or the rotation refresher is unavailable.

## 2. Background — today's state

- `liquidsoap/numa.liq` reads a single source: `playlist.reloadable(reload_mode="watch", "/etc/numa/playlist.m3u")`.
- `/etc/numa/playlist.m3u` is a static file last written 2026-04-19 containing one B2 URL. Nothing regenerates it.
- Liquidsoap already calls the existing `/api/internal/track-started` endpoint on every track boundary (via `on_track`) — that wiring is kept untouched.
- The Prisma schema already models the end-state: `QueueItem`, `AiringPolicy.priority_request`, `RequestStatus.queued_for_air` / `aired`, `PlayHistory`, `TrackAsset`. This design uses those tables as intended rather than adding new ones.
- `numa-liquidsoap.service`, `icecast2.service`, `cloudflared.service`, `numa-dashboard.service` all run on the mini-server (Orion, WSL2 Ubuntu) and auto-start on boot; verified working post-reboot on 2026-04-20.

## 3. Scope

### In scope

- A two-source fallback in `numa.liq`: a Liquidsoap `request.queue` (priority) layered above the existing reloadable playlist (rotation), with `track_sensitive=true` so neither source can interrupt the other mid-track.
- A new Node service, **`numa-queue-daemon`**, that owns a telnet connection to Liquidsoap's local control socket and exposes a tiny loopback HTTP API for pushing tracks onto the priority queue.
- A new script + systemd timer, **`numa-rotation-refresher`**, that regenerates `/etc/numa/playlist.m3u` from Neon every 2 minutes.
- A `QueueItem`-based durability model: every push writes a DB row before sending to the socket; on startup the daemon hydrates the socket from unfinished priority `QueueItem`s.
- A manual `npm run queue:push` CLI for exercising the pipeline before NanoClaw exists.
- A "last N pushes / failures" endpoint on the daemon that the dashboard health card will consume.

### Out of scope (upstream, owned by the NanoClaw design)

- How user-request songs are generated (MiniMax 2.6 audio + Deepgram host intro + Flux-via-OpenRouter artwork).
- How `Track.title` is inferred from the raw request text.
- How `artistDisplay` is chosen (decision: AI/station persona, never the requester; requester name/location are separate fields).
- What happens when a requester supplies a location instead of a name (decision: "Requested from Milan" style text shown as a secondary line on the hero, `requesterName` left null, never "Unknown").
- Vote-weighted / genre-clustered / dayparted rotation scheduling. This spec ships simple shuffle + recent-N exclusion only.
- Dashboard admin UI for manual queueing (the CLI covers this need for now; dashboard button is a small follow-up).

## 4. Architecture

```
  ┌──────────────────────── MINI-SERVER (Orion, WSL2) ────────────────────────┐
  │                                                                            │
  │   ┌─────────────┐   push       ┌──────────────────────┐                    │
  │   │  request-   │ ───────────► │  numa-queue-daemon   │                    │
  │   │  worker     │   (local)    │  :4000   (Node)      │                    │
  │   │  (NanoClaw, │              │                      │                    │
  │   │   future)   │              │ HTTP:                │                    │
  │   └─────────────┘              │  POST /push          │                    │
  │         │                      │  GET  /status        │                    │
  │         │ writes Track +       │                      │                    │
  │         │ QueueItem            │ Talks to:            │                    │
  │         ▼                      │  - Neon (Prisma)     │                    │
  │    ┌────────┐                  │  - Liquidsoap socket │                    │
  │    │ Neon   │ ◄──────────────  │    (127.0.0.1:1234)  │                    │
  │    └────────┘   reads/updates  └──────────┬───────────┘                    │
  │         ▲                                 │ telnet:                        │
  │         │ query library                   │   priority.push <url>          │
  │         │                                 ▼                                │
  │   ┌─────┴─────────┐           ┌──────────────────────┐                     │
  │   │ rotation-     │           │  Liquidsoap          │                     │
  │   │ refresher     │ writes    │  numa.liq            │ ── mp3 ──► Icecast  │
  │   │ (systemd      │ ────────► │                      │             :8000   │
  │   │  timer, 2min) │ .m3u      │  fallback([          │                     │
  │   └───────────────┘           │   priority (req.q),  │                     │
  │                               │   rotation (m3u),    │                     │
  │                               │   blank()            │                     │
  │                               │  ], track_sensitive) │                     │
  │                               └──────────────────────┘                     │
  └────────────────────────────────────────────────────────────────────────────┘
```

Three new moving parts, all co-located on the mini-server. No changes to the public site, the tunnel, the dashboard service, or the MP3 audio path. One minor change to the Vercel endpoint `/api/internal/track-started`: it gains a `PlayHistory` insert alongside the existing `NowPlaying` upsert, so the rotation refresher has a reliable source for "recently played tracks." This runs every track boundary — rotation and priority both.

## 5. Components

### 5.1 Liquidsoap config change — `liquidsoap/numa.liq`

Replace the single reloadable playlist with a priority+rotation fallback, and enable the local telnet control socket.

```liquidsoap
# (unchanged: settings, env, notify_track_started)

settings.server.telnet.set(true)
settings.server.telnet.bind_addr.set("127.0.0.1")
settings.server.telnet.port.set(1234)

priority = request.queue(id="priority")

rotation = playlist.reloadable(
  id="rotation",
  reload_mode="watch",
  "/etc/numa/playlist.m3u"
)

# track_sensitive=true: don't switch sources mid-track. A priority push
# lands at the NEXT track boundary, not immediately. This is the
# "no-interrupt" rule.
source = fallback(track_sensitive=true, [priority, rotation, blank()])

source.on_track(notify_track_started)
source = mksafe(source)

output.icecast(...)  # unchanged
```

- The socket binds to `127.0.0.1` only. No auth is configured because the socket is unreachable from off-host; anyone on the host is already trusted.
- `request.queue` is a FIFO. Pushing N URLs plays them in push order.
- Command name on the socket is `priority.push <url>` (mirrors the `id=`). It returns a request ID; we log it and don't otherwise track it — the existing `on_track` callback is the authoritative per-boundary signal.
- `blank()` is the final fallback so Icecast never sees a source disconnect when both queue and rotation are empty.

**One additional change to `notify_track_started`:** after it POSTs to Vercel, it also POSTs the same JSON body to `http://127.0.0.1:4000/on-track` (the local daemon). This is the signal the daemon uses to drive `QueueItem` / `Request` transitions. It's a fire-and-forget call — if the daemon is down, the public-facing track signal (to Vercel) still fires, audio keeps playing, and only the queue-item bookkeeping lags until the daemon comes back.

### 5.2 `numa-queue-daemon` (Node service, `workers/queue-daemon/`)

Single-process, single socket-owner, ~150 LOC. Uses `@prisma/client` (already in repo).

**HTTP surface** — loopback only (`127.0.0.1:4000`):

- `POST /push`
  - Request body: `{ trackId: string, sourceUrl: string, requestId?: string, reason?: string }`.
  - Behavior:
    1. Look up `Track` by id. 400 if not found.
    2. Create a `QueueItem` row: `stationId` = the track's station, `queueType="music"`, `priorityBand="priority_request"`, `queueStatus="staged"`, `positionIndex` = `(max(positionIndex) + 1) WHERE stationId=? AND priorityBand='priority_request'`, `sourceObjectType`/`sourceObjectId` = `"request"`/`requestId` when `requestId` is present, otherwise `"track"`/`trackId`, `insertedBy="queue-daemon"`, `reasonCode=reason`.
    3. Send `priority.push <sourceUrl>` over the socket.
    4. Return `200 { queueItemId }`.
  - Idempotency: callers that want dedupe should check their own Neon state first. The daemon treats every `/push` as a distinct queue event.

- `GET /status`
  - Returns `{ socket: "connected"|"reconnecting", lastPushes: [...], lastFailures: [...] }`.
  - `lastPushes` and `lastFailures` are in-memory ring buffers of the last 10 each, cleared on restart. Enough for the dashboard card; DB is authoritative for anything long-lived.

- `POST /on-track`
  - Body: `{ sourceUrl?: string, trackId?: string, title?: string, artist?: string }` — same shape as the Vercel endpoint.
  - Behavior:
    1. Resolve `trackId` (same fallback chain as `/api/internal/track-started`: explicit id → path extraction → title+artist lookup).
    2. Find any `QueueItem` where `queueStatus='playing' AND priorityBand='priority_request'` for this station → mark `completed`. If there was a linked `Request`, leave its status `aired` (already set).
    3. Find the oldest `QueueItem` where `queueStatus='staged' AND priorityBand='priority_request' AND trackId = <resolved>` → mark `playing`. Transition linked `Request.requestStatus=aired`.
    4. If no matching staged priority item exists, the track came from rotation — no-op.
    5. Return 200 regardless; this endpoint never fails audibly for the listener.
  - Note: `PlayHistory` is NOT written here — that's the Vercel endpoint's job (it always runs, daemon may not).

**Socket ownership:**

- One persistent telnet connection to `127.0.0.1:1234`. On disconnect, the daemon reconnects with exponential backoff (2s, 4s, 8s, …, capped at 30s).
- `/push` does **not** block on socket send — it commits the DB row first, then fires the socket send asynchronously. If the socket is down at send time, the item stays `staged` and the hydrator picks it up on reconnect.

**Hydrator (runs on daemon startup and on every socket reconnect):**

- `SELECT * FROM QueueItem WHERE priorityBand='priority_request' AND queueStatus IN ('planned','staged') ORDER BY positionIndex ASC`.
- For each row, resolve its `sourceUrl` (from `TrackAsset.publicUrl` via `trackId`) and push to the socket. If the track no longer exists or has no audio asset, mark the item `failed` with `reasonCode="hydrate_missing_asset"` and move on.

**Track-boundary observer:**

- Needs to know when a priority item starts playing so it can transition `QueueItem.queueStatus` → `playing` → `completed` and transition `Request.requestStatus` → `aired`.
- Signal path: **`notify_track_started` in `numa.liq` POSTs to the daemon's `/on-track` endpoint** (in addition to its existing POST to Vercel). The daemon handles the state machine there. This avoids both telnet-event-subscription version quirks and journal-tailing fragility — Liquidsoap's built-in HTTP client is already used and proven in this codebase.

**Systemd unit** — `/etc/systemd/system/numa-queue-daemon.service`:
- `User=numa` (created at install time; same user that runs Liquidsoap).
- `After=numa-liquidsoap.service`
- `Restart=always`, `RestartSec=2s`.
- `EnvironmentFile=/etc/numa/env` (for `DATABASE_URL`).

### 5.3 `numa-rotation-refresher` (script + timer, `scripts/refresh-rotation.ts`)

One-shot Node script, ~60 LOC. Invoked by a systemd timer and once on daemon boot.

**Algorithm:**

1. Query library tracks: `Track` where `trackStatus='ready' AND airingPolicy='library'`, including `TrackAsset` for the primary audio asset.
2. Query recent plays: last 20 rows of `PlayHistory` where `trackId IS NOT NULL` ordered by `startedAt DESC`, keep their `trackId`s. (Non-music segments — future host intros, station IDs — have null `trackId` and are ignored.)
3. Candidate pool = library tracks minus recent-play trackIds.
4. Floor: if pool has fewer than 5 tracks (fresh install / tiny library), fall back to full library. Shuffle still runs.
5. Fisher–Yates shuffle.
6. Write to `/tmp/playlist-<pid>-<timestamp>.m3u` then `rename()` to `/etc/numa/playlist.m3u`. Atomic — Liquidsoap's watcher never reads a half-file.
7. Log the pool size, recent-exclusion count, and first 3 titles. Exit 0 on success, non-zero on any failure (so `systemctl is-failed` reports correctly for the dashboard).

**Resolving the URL for each track:**

`TrackAsset` has `publicUrl`. Pick the row with `assetType="audio_stream"` (the value written by `scripts/ingest-seed.ts` and read by `app/api/station/now-playing/route.ts`). If no audio asset exists, skip the track and log a warning.

**Systemd units:**

- `/etc/systemd/system/numa-rotation-refresher.service` — `Type=oneshot`, runs the script.
- `/etc/systemd/system/numa-rotation-refresher.timer` — `OnBootSec=30s`, `OnUnitActiveSec=2min`, `Persistent=true`.

### 5.4 Vercel endpoint change — `app/api/internal/track-started/route.ts`

Add a `PlayHistory` insert alongside the existing `NowPlaying` upsert, inside the same transaction so a resolved track always yields both rows. Fields:

- `stationId` = resolved station.
- `trackId` = resolved track id.
- `segmentType = "audio_track"` (schema-required string).
- `titleSnapshot` = track title at airing time (copied so PlayHistory is stable if the track row is later edited).
- `startedAt` = same `startedAt` as NowPlaying.
- `durationSeconds` = track.durationSeconds.
- `completedNormally` = true (we write the row at track START, not end; accept the small inaccuracy — tracks that fail mid-play will be rare, and when we need accuracy later we'll add an end-of-track signal).

No other behavior changes in the endpoint. Existing auth, error handling, and response shape stay identical.

### 5.5 Manual CLI — `scripts/queue-push.ts`

```
npm run queue:push -- --trackId=<trackId> [--reason=<free text>]
```

Looks up the track's audio asset URL in Neon and calls `POST http://127.0.0.1:4000/push`. This is the stand-in for NanoClaw until it exists, and stays useful forever for ops / debugging.

### 5.6 Integration seam — the contract NanoClaw will call

When NanoClaw lands, its final step is:

```http
POST http://127.0.0.1:4000/push
Content-Type: application/json

{ "trackId": "<cuid>", "sourceUrl": "<B2 public URL>", "reason": "user_request:<requestId>" }
```

No other handshake. NanoClaw is responsible for writing `Track` + `TrackAsset` + `Request` updates in Neon before this call. The daemon doesn't care how the track got there.

## 6. Data flow

### 6.1 Path A — priority request (manual CLI today, NanoClaw later)

```
  caller                      queue-daemon             Liquidsoap        on_track observer
    │                              │                        │                    │
 1. │  POST /push                  │                        │                    │
    │ ─────────────────────────►   │                        │                    │
    │                              │                        │                    │
 2. │                     create QueueItem                  │                    │
    │                     status=staged                     │                    │
    │                              │                        │                    │
 3. │                   telnet: priority.push <url>         │                    │
    │                              │ ──────────────────►    │                    │
    │                              │ ◄── "RID 42"           │                    │
    │                              │                        │                    │
 4. │  200 OK { queueItemId }      │                        │                    │
    │ ◄─────────────────────────   │                        │                    │
    │                              │                        │                    │
    ... current library track finishes naturally ...         │                    │
    │                              │                        │                    │
 5. │                              │                 on_track fires              │
    │                              │                 → notify_track_started      │
    │                              │                   POST → Vercel             │
    │                              │                   (NowPlaying)              │
    │                              │                        │                    │
 6. │                              │                 log line "[numa] track:     │
    │                              │                   src=<url> ..."            │
    │                              │   ◄──── observed by ────────────────────    │
    │                              │         daemon                              │
    │                              │                                             │
 7. │                     UPDATE QueueItem (prior, if any priority-queue         │
    │                       item was playing) status=completed                   │
    │                     UPDATE QueueItem (now) status=playing                  │
    │                     UPDATE Request       requestStatus=aired               │
    │                     INSERT PlayHistory row                                 │
```

### 6.2 Path B — base rotation

```
  systemd timer (every 2 min / on boot)    rotation-refresher         Liquidsoap
        │                                          │                        │
  1.    │ run refresh-rotation.ts                  │                        │
        │ ──────────────────────────────►          │                        │
        │                                          │                        │
  2.    │                  SELECT Track + TrackAsset                        │
        │                  WHERE status=ready AND policy=library            │
        │                                          │                        │
  3.    │                  SELECT trackId FROM PlayHistory                  │
        │                  ORDER BY startedAt DESC LIMIT 20                 │
        │                                          │                        │
  4.    │                  shuffle(pool minus recent)                       │
        │                                          │                        │
  5.    │                  write /tmp/x.m3u, rename → playlist.m3u          │
        │                                          │                        │
  6.    │                                          │  watcher sees mtime ►  │
        │                                          │  reloads playlist      │
        │                                          │                        │
       ... current track finishes naturally ...                              │
        │                                          │  next track comes      │
        │                                          │  from new order        │
```

### 6.3 Key invariants

- **No interruption.** `fallback(track_sensitive=true, ...)` means Liquidsoap only re-evaluates which source is active at track boundaries. A priority push mid-song waits; a playlist reload mid-song waits.
- **Priority wins at every boundary.** Because `priority` is first in the fallback list and `request.queue` reports "available" when non-empty, Liquidsoap picks it over rotation.
- **DB is truth.** Every push writes a `QueueItem` row before sending to the socket. If the daemon crashes between DB write and socket send, the hydrator re-sends on restart.
- **Atomic playlist writes.** `rename()` is atomic on Linux; Liquidsoap's watcher can never read a half-file.

### 6.4 Empty states

- Priority queue empty + rotation has tracks → rotation plays. Normal case.
- Priority queue empty + rotation empty (fresh install, no ready library) → `blank()` silence. Icecast stays connected. A later rotation refresh fills in tracks without a listener disconnect.
- Liquidsoap restart mid-queue → hydrator re-pushes. Already-aired items (`queueStatus=completed`) are excluded by the hydrator's filter.

## 7. Failure handling

| Failure | Observed where | Response |
|---|---|---|
| Bad source URL (B2 404, decode error) | Liquidsoap logs resolve/decode error; next item plays | Daemon observes, marks `QueueItem.queueStatus=failed` with `reasonCode="resolve_failed"`, transitions linked `Request.requestStatus=song_failed`. Listeners never hear silence. |
| Liquidsoap socket down when daemon tries to push | Daemon socket error | Push is buffered (DB row already `staged`); reconnect backoff 2s → 30s. On reconnect, hydrator re-sends any `staged` items. `POST /push` returned 200 already because DB write committed. |
| Neon down at daemon boot | Health check fails | Systemd restarts daemon (`Restart=always`). Liquidsoap keeps playing rotation — base station stays on air even with request pipeline dead. |
| Rotation refresher fails | Timer unit logs failure | Existing `playlist.m3u` stays on disk; Liquidsoap loops last-known-good rotation. Next timer tick retries. Dashboard health card picks up `systemctl is-failed`. |
| Tunnel down | Cloudflared off | Unrelated to this design. Local pipeline keeps running. |
| Orphaned `QueueItem` stuck in `staged` | e.g., track deleted from Neon between push and hydrate | Hydrator tolerates missing tracks, marks `failed` with `reasonCode="hydrate_missing_asset"`, logs warning. |
| Daemon crashed mid-update | Systemd restart | Hydrator re-reads state from Neon. In-memory ring buffers for `/status` are lost — acceptable, they're informational only. |

A janitor for aging out `QueueItem`s stuck in `staged` longer than some threshold is noted as future work but not in this spec.

## 8. Testing

### 8.1 Unit tests (Vitest, in-repo)

- **Rotation refresher**: given a fixture Neon state with N library tracks and a recent-history window, the output m3u excludes recent tracks, contains only assets from the library policy, and is shuffled (not sorted).
- **Queue daemon `/push` handler**: given a valid body, (a) writes the expected `QueueItem`, (b) invokes the socket sender with the right command, (c) returns 200. Plus failure cases: missing `trackId`, bad JSON, unknown track, socket disconnected (still returns 200, item stays `staged`).
- **Socket / log parser**: given sample Liquidsoap 2.2.4 telnet or journal output (including the metadata quirks already captured in the 2026-04-19 decisions log — `initial_uri` vs `filename` for `playlist.reloadable`), correctly identifies track-boundary events and maps them back to a queue item.

### 8.2 Integration test — `scripts/test-queue-e2e.sh`

1. Assert `numa-liquidsoap` and `numa-queue-daemon` services are active.
2. Pick a known-good `Track` from Neon; push it via `POST /push`.
3. Wait up to `currentTrackRemaining + 5s` for the `[numa] track:` log line to include that track's URL.
4. Assert the `QueueItem` transitioned `staged → playing → completed` in Neon.
5. Assert `PlayHistory` has a new row for that track.

### 8.3 Manual verification checklist

- Push 3 URLs in quick succession — they air in FIFO order; each waits for the previous track to finish.
- Stop `numa-queue-daemon` mid-queue, restart it — hydrator re-pushes remaining items; they still air.
- Push a deliberately-broken URL — marked `failed`, next item plays, listeners never hear silence.
- Delete every library track from Neon — within 2 min the rotation regen skips / empties and `blank()` kicks in without a listener disconnect.
- Add a new library track to Neon — within 2 min it appears in the next rotation regen.

### 8.4 Not automated

- Audio-correctness verification (is the right MP3 coming out of Icecast?). Listen-with-your-ears check on first deploy. After that, log-line + DB-state assertions are sufficient.

## 9. Open questions / deferred decisions

- **Janitor for stuck `QueueItem`s** (aged-out `staged` rows whose socket send never succeeded and hydrator never resolved). Noted as future work; not part of this spec.
- **Dashboard "last failed pushes" card.** The daemon's `/status` endpoint exposes the data; the small dashboard UI change is in scope for this spec but can ship one iteration after the daemon if desired.
- **End-of-track signal** (vs. current start-of-track-only). This spec records `PlayHistory` at track start with `completedNormally=true` as a simplification. A future refinement can add `on_end` or duration-based correction if we need accurate completion data.

## 10. References

- `liquidsoap/numa.liq` (current config, single-source).
- `prisma/schema.prisma` (QueueItem, AiringPolicy, RequestStatus, PlayHistory, TrackAsset).
- `docs/HANDOFF.md` (mini-server topology, service list).
- `docs/numa-radio/Decisions Log.md` — 2026-04-19 night session, Liquidsoap 2.2.4 metadata quirks.
- Liquidsoap 2.2.4 docs: `request.queue`, `fallback`, `playlist.reloadable`, `settings.server.telnet`.
