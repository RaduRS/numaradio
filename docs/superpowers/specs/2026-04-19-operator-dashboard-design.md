# Numa Radio — Operator Dashboard (v1) — Design

**Status:** locked 2026-04-19
**Scope:** v1 operator dashboard for monitoring and 1-click start/stop/restart of the Numa Radio broadcast stack (Icecast + Liquidsoap + cloudflared) plus DB/B2 health.
**Repo location:** sub-folder at `/home/marku/saas/numaradio/dashboard/` inside the existing `numaradio` repo.

---

## 1. Summary

A single-page Next.js 16 dashboard that runs on the same WSL2 mini-server as the broadcast services. It shows live status (stream reachable? listeners? now-playing? services active?), exposes a `[Start]` `[Stop]` `[Restart]` control per service, tails systemd logs, and probes Neon + B2 + Cloudflare tunnel health.

Accessible at `https://dashboard.numaradio.com`, gated by Cloudflare Access (email allowlist), routed through the **same** cloudflared tunnel we already run for the stream. No new public ports, no new tunnel, no new auth code.

---

## 2. Locked decisions

| # | Decision | Choice | Why |
|---|---|---|---|
| 1 | Network exposure | Public at `dashboard.numaradio.com`, gated by Cloudflare Access | Phone + other-PC control with zero auth code to maintain; Cloudflare handles identity at the edge |
| 2 | Control mechanism | Passwordless sudo allowlist for user `marku` on `start/stop/restart/status` of `icecast2`, `numa-liquidsoap`, `cloudflared` | Least privilege; well-understood pattern; no extra daemon |
| 3 | v1 feature scope | Status pills + services card + health-checks card + logs card | See §5 for exact fields |
| 4 | Data freshness | Browser polls `/api/status` every 5s; pauses when `document.visibilityState !== 'visible'` | Simpler than SSE, good enough for 1 operator + 3 services |
| 5 | Repo layout | Sub-folder inside parent repo (`numaradio/dashboard/`) | Single `git push`; this is a dev tool, not a shipped product |
| 6 | Polish level | Next.js + Tailwind v4 + shadcn/ui | Looks professional immediately, no hand-rolled components |

Deferred (explicitly not in v1): queue/playlist view, request moderation UI, manual skip-to-next, historical metrics graphs, listener geography, dark-mode toggle, settings page, multi-page navigation.

---

## 3. Architecture

```
┌──────────────┐   HTTPS   ┌───────────────────────┐   HTTPS   ┌───────────────────────┐
│ Any device   │  ──────►  │  Cloudflare Access    │  ──────►  │  Cloudflare Tunnel    │
│ (phone, PC)  │           │  (email allowlist)    │           │  (existing cloudflared)│
└──────────────┘           └───────────────────────┘           └──────────┬─────────────┘
                                                                          │  ingress rule:
                                                                          │  dashboard.numaradio.com
                                                                          │  → http://localhost:3001
                                                                          ▼
                                                     ┌────────────────────────────────────┐
                                                     │  Next.js dashboard (user: marku)   │
                                                     │  :3001 (dev), :3001 (systemd prod) │
                                                     └─┬───────────┬───────────┬──────────┘
                                                       │           │           │
                                        shell + sudo ──┘           │           │
                                            ▼                      │           │
                                    systemctl / journalctl         │           │
                                    (allowlisted via sudoers)      │           │
                                                                   ▼           │
                                                    HTTP ── localhost:8000      │
                                                           Icecast status-json  │
                                                                                ▼
                                                   HTTP ── 127.0.0.1:20241
                                                          cloudflared /metrics
                                                                                │
                                                   pg  ─── Neon Postgres ───────┘
                                                   s3  ─── Backblaze B2
```

**Key properties:**
- One tunnel, two hostnames. We add a `dashboard.numaradio.com` ingress rule to the **same** `/etc/cloudflared/config.yml`.
- Dashboard is never reachable except through Cloudflare Access — no new public ports, not bound to LAN.
- Dashboard process runs as `marku`, not root. The sudoers allowlist is the only privileged edge.

---

## 4. Components & file layout

```
numaradio/
├── (existing: app/, lib/, prisma/, liquidsoap/, scripts/, docs/, ...)
└── dashboard/                        ← everything new
    ├── package.json                  # Next.js 16, React 19, Tailwind v4, shadcn
    ├── tsconfig.json
    ├── next.config.ts
    ├── postcss.config.mjs
    ├── components.json               # shadcn-ui config
    ├── .env.local                    # DB + B2 creds (gitignored, duplicated from parent)
    ├── ACCEPTANCE.md                 # manual test checklist
    ├── app/
    │   ├── layout.tsx                # root layout, font, theme
    │   ├── globals.css               # Tailwind v4 + minimal tokens
    │   ├── page.tsx                  # THE dashboard page — one screen, four cards
    │   └── api/
    │       ├── status/route.ts                     # GET aggregator
    │       ├── services/[name]/[action]/route.ts   # POST start|stop|restart
    │       └── logs/[name]/route.ts                # GET last N journalctl lines
    ├── lib/
    │   ├── systemd.ts                # wraps systemctl / journalctl via spawn()
    │   ├── systemd.test.ts           # validates input-allowlist logic
    │   ├── icecast.ts                # fetch + parse status-json.xsl
    │   ├── icecast.test.ts           # parses captured-fixture JSON
    │   ├── cloudflared.ts            # parse /127.0.0.1:20241/metrics (Prometheus text)
    │   ├── health.ts                 # Neon SELECT 1 + B2 HEAD probe
    │   └── db.ts                     # raw `pg` pool (no Prisma in dashboard)
    ├── components/
    │   ├── status-pills.tsx          # stream live + listener count + now playing
    │   ├── services-card.tsx
    │   ├── service-row.tsx           # one row + 3 action buttons + state badge
    │   ├── health-card.tsx
    │   ├── logs-card.tsx             # expandable; only polls when expanded
    │   └── ui/                       # shadcn-generated components
    ├── hooks/
    │   └── use-polling.ts            # 5s poll + pause on document.hidden
    └── scripts/
        └── smoke.ts                  # integration smoke test
```

### Design decisions inside the folder

- **No Prisma in the dashboard.** Dashboard only does a single read-only `SELECT 1` for Neon health. Now-playing is read from Icecast's `status-json.xsl` `source.title` field (Liquidsoap passes playlist-entry titles through as stream metadata), not from the DB — at v1 we haven't yet built the Liquidsoap→API event bridge that populates the `NowPlaying` row. Raw `pg` for that one health query keeps the dashboard's dependency footprint minimal.
- **Duplicate `.env.local`** in `dashboard/` (not a symlink — WSL + git symlinks can misbehave). Gitignored. Same vars as the parent: `DATABASE_URL`, `B2_*`. One extra var: `CLOUDFLARED_METRICS_URL` = `http://127.0.0.1:20241/metrics` (overridable for testing).
- **shadcn/ui copies source into `components/ui/`**, it is **not** a runtime dependency. `npx shadcn@latest add button card badge dialog tabs toast` installs what we need into the repo as first-party files.
- **One screen, no routing.** v1 is a single `app/page.tsx`. When v2 adds queue/history, we add routes then.
- **No auth code in the app.** Cloudflare Access gates the request before it reaches Next.js. If we ever want to display "who is logged in", Cloudflare injects `Cf-Access-Authenticated-User-Email` and we read the header.

---

## 5. Data flow & API shapes

### 5.1 `GET /api/status` — the single aggregator

Backend fires every probe in parallel via `Promise.allSettled`, each with a **2-second timeout**. Returns:

```jsonc
{
  "ts": "2026-04-19T16:55:12Z",
  "stream": {
    "publicUrl": "https://api.numaradio.com/stream",
    "reachable": true,                  // probe: small GET with Range 0-1, check 200/206
    "listeners": 0,                     // from Icecast status-json
    "listenerPeak": 3,
    "bitrate": 192,
    "nowPlaying": {
      "title": "One More Dance",
      "artist": "Russell Ross"
    }
  },
  "services": [
    { "name": "icecast2",        "state": "active", "activeSince": "2026-04-19T15:32:45Z", "uptimeSec": 4987 },
    { "name": "numa-liquidsoap", "state": "active", "activeSince": "2026-04-19T16:57:00Z", "uptimeSec": 472  },
    { "name": "cloudflared",     "state": "active", "activeSince": "2026-04-19T16:55:00Z", "uptimeSec": 612  }
  ],
  "health": {
    "neon":   { "ok": true,  "latencyMs": 34 },
    "b2":     { "ok": false, "error": "timeout after 2000ms" },
    "tunnel": { "ok": true,  "connections": 4 }
  }
}
```

- `state` ∈ `active | inactive | failed | activating | deactivating` (from `systemctl is-active` + `systemctl show --property=ActiveState,ActiveEnterTimestamp`).
- `activeSince` is `ActiveEnterTimestamp` in ISO-8601.
- `uptimeSec` computed server-side (`Date.now() - activeSince`).
- Every `ok`/`reachable` field has a companion `error?: string` on failure.

### 5.2 `POST /api/services/:name/:action` — the one dangerous route

**Input validation happens first**, before any I/O:

```ts
const SERVICES: ReadonlySet<string> = new Set(['icecast2', 'numa-liquidsoap', 'cloudflared']);
const ACTIONS:  ReadonlySet<string> = new Set(['start', 'stop', 'restart']);

if (!SERVICES.has(name) || !ACTIONS.has(action)) {
  return Response.json({ ok: false, error: 'invalid service or action' }, { status: 400 });
}
```

On valid input:

```ts
spawn('sudo', ['systemctl', action, name], { shell: false });
// wait for exit, capture stderr
// then re-query `systemctl is-active <name>` to get the post-action state
```

Response:

```jsonc
{ "ok": true, "state": "active", "durationMs": 1832 }
// or
{ "ok": false, "error": "Job for numa-liquidsoap.service failed because ...", "state": "failed" }
```

**Never** use `shell: true` and **never** concatenate `name` or `action` into a string. This prevents command injection even if the allowlist check has a bug.

**Audit log** — one info line to stdout per action (captured by journalctl when dashboard runs as a systemd service):

```
2026-04-19T17:05:01Z INFO action=restart service=numa-liquidsoap user=marku@example.com exit=0 duration=1832ms
```

The `user=` value comes from the `Cf-Access-Authenticated-User-Email` request header.

### 5.3 `GET /api/logs/:name?lines=50` — journalctl tail

```ts
spawn('journalctl', ['-u', name, '-n', String(Math.min(lines, 500)), '--no-pager', '-o', 'short-iso'], { shell: false });
```

Same name-allowlist as 5.2. Cap `lines` to 500. Returns:

```jsonc
{ "name": "numa-liquidsoap", "lines": ["2026-04-19T17:05:01+0100 Orion liquidsoap[...]: ...", "..."] }
```

### 5.4 Polling loop (browser)

1. Page mounts → `use-polling` hook fetches `/api/status` immediately.
2. Set interval: every 5s, if `document.visibilityState === 'visible'`, fetch again.
3. On `visibilitychange` → `visible`: fetch immediately (no interval wait).
4. On error: keep the last good snapshot in state, dim the UI, show a small `⚠ stale · retrying…` pill. Retries continue at the same 5s cadence.
5. Logs card polls `/api/logs/:name` on its own 5s cycle, **only** when the card is expanded. Collapsed → no polling for logs.

### 5.5 Click-to-restart flow

```
User clicks [Restart] on Liquidsoap row
  → shadcn Dialog: "Restart numa-liquidsoap? The stream will drop for ~3 seconds."
  → On confirm: button spinner + POST /api/services/numa-liquidsoap/restart
  → Server: sudo systemctl restart → wait → is-active → response
  → Client: trigger immediate /api/status re-fetch (skip the 5s wait)
  → Toast: "Restarted numa-liquidsoap (✓ active in 2.1s)" — or red toast with error
```

No auto-retry on failure. Operator decides what to do.

---

## 6. Error handling

### Principle: partial failure, not total failure

Every probe in `/api/status` runs inside its own try/catch with a 2-second timeout (`AbortController`). A failing probe yields `{ ok: false, error: "..." }` for that field. Others keep working. The dashboard is **never** a blank screen.

### Failure-mode matrix

| Scenario | Server behavior | UI behavior |
|---|---|---|
| Public stream HEAD fails | `stream.reachable: false`, `listeners: null` | Top pill red, "Stream is down" |
| Icecast service dead | `services[icecast2].state: inactive`; Icecast HTTP probe fails | Icecast row red "Inactive"; `[Start]` button highlighted |
| Liquidsoap dead but Icecast up | Liquidsoap row `failed`; stream may briefly still 200 (Icecast serves `mksafe` silence) | Liquidsoap row red; stream pill may lag; logs card auto-scrolls to crash lines |
| cloudflared 0 tunnel connections | `health.tunnel.ok: false, connections: 0` | Tunnel row red (caught even when `systemctl is-active` says active) |
| Neon timeout / unreachable | `health.neon.ok: false, error: "..."` | Neon row red; unrelated rows unaffected |
| `sudo systemctl X Y` fails | Action route 500 with stderr in `error` | Red toast with verbatim stderr; no auto-retry |
| Sudoers misconfigured | Same as above, stderr says `user marku is not allowed...` | Toast + link to `docs/SERVER_SETUP.md` sudoers section |
| `journalctl` permission denied | `lines: []`, `error: "permission denied"` | One-time banner: "Add marku to `adm` group: `sudo usermod -aG adm marku` then log out/in." |
| `/api/status` itself errors | Client fetch fails | Last good snapshot stays dimmed with stale pill; retries continue |
| Next.js process down | 502 from Cloudflare | Dashboard inaccessible. Production: systemd auto-restart. Worst case: SSH in. |
| Slow probes | `Promise.allSettled` + 2s timeout per probe | `/api/status` bounded by max probe latency, not sum |

### Discipline for the action route

- Validate before spawning.
- Fixed argv arrays — never shell strings.
- Log who, what, when, result to stdout.
- Never retry automatically.

---

## 7. Testing

### 7.1 Unit tests (minimal, only the risky bits)

Using node's built-in test runner (`node --test`). No jest, no vitest.

- **`lib/systemd.test.ts`** — proves the validation blocks anything not in the allowlist:
  - `('icecast2', 'restart')` → ok
  - `('sshd', 'restart')` → throws
  - `('icecast2; rm -rf /', 'restart')` → throws
  - `('icecast2', 'destroy')` → throws
- **`lib/icecast.test.ts`** — parse a captured `status-json.xsl` fixture (single-source case and array-of-sources case — Icecast silently shape-shifts).

Everything else — UI, shell, network I/O — is not unit-tested in v1. Mocks that would be needed to fake `child_process.spawn` or remote probes tend to pass while real behavior is broken.

### 7.2 Integration smoke (`dashboard/scripts/smoke.ts`)

Spawns `next dev` on a random port, hits `GET /api/status` against the **real** local stack, asserts:
- 200 response
- Shape matches expected keys
- All `ok: true` when the stack is healthy

Run manually before committing dashboard code.

### 7.3 Manual acceptance checklist (`dashboard/ACCEPTANCE.md`)

```
[ ] https://dashboard.numaradio.com shows Cloudflare Access login on a fresh device
[ ] Signing in with an allowlisted email lands on the dashboard
[ ] Top pill shows "Stream is live" when stream is up
[ ] Listener count increments when I open api/stream in a second tab
[ ] Now-playing shows correct title + artist
[ ] All 3 service rows show "active" with an uptime
[ ] Health card shows neon + b2 + tunnel all green
[ ] Logs card expands and shows last 50 lines
[ ] Click [Restart] on Liquidsoap → confirmation → success toast
[ ] During restart, service row briefly shows "activating" then "active"
[ ] Stop Icecast externally (ssh + systemctl stop) → row goes red within 5s
[ ] Phone: dashboard on mobile, all cards stack and work
[ ] Background the tab 1 min → DevTools network tab shows no requests during hidden time
```

---

## 8. Deployment notes

- Dashboard runs on the mini-server (same WSL2 Ubuntu). It **cannot** run on Vercel because it needs local `systemctl`, `journalctl`, and `127.0.0.1:20241` access.
- **Dev:** `cd dashboard && npm run dev` (port 3001).
- **Prod:** `npm run build` once, then a systemd service `numa-dashboard.service` running `npm run start` (Next.js production server) on port 3001 as user `marku`. Service unit created in the implementation plan.
- **Cloudflare Access policy:** email allowlist scoped to user's own addresses. Configured once in the Cloudflare Zero Trust dashboard; not managed in this repo.
- **Sudoers entry** (added by implementation plan). `is-active` is read-only and works without sudo, so only the three mutating verbs are in the allowlist:
  ```
  # /etc/sudoers.d/numa-dashboard  (mode 0440)
  marku ALL=(root) NOPASSWD: /usr/bin/systemctl start icecast2, \
                              /usr/bin/systemctl stop icecast2, \
                              /usr/bin/systemctl restart icecast2, \
                              /usr/bin/systemctl start numa-liquidsoap, \
                              /usr/bin/systemctl stop numa-liquidsoap, \
                              /usr/bin/systemctl restart numa-liquidsoap, \
                              /usr/bin/systemctl start cloudflared, \
                              /usr/bin/systemctl stop cloudflared, \
                              /usr/bin/systemctl restart cloudflared
  ```
- **Cloudflared ingress update** (appended to `/etc/cloudflared/config.yml`):
  ```yaml
  ingress:
    - hostname: api.numaradio.com
      path: /stream
      service: http://localhost:8000
    - hostname: api.numaradio.com
      service: http_status:404
    - hostname: dashboard.numaradio.com
      service: http://localhost:3001
    - service: http_status:404
  ```
- **DNS**: `cloudflared tunnel route dns numaradio dashboard.numaradio.com` (run once).

---

## 9. Out of scope for v1

Listed explicitly so the implementation plan stays bounded:

- Multi-page routing (queue, history, requests, settings pages)
- Historical metrics / time-series graphs
- Listener geography map
- Request moderation UI
- Manual "skip to next track"
- Dark-mode toggle
- Multi-user audit (v1 audit log is informal stdout; no UI to view it)
- SSE/WebSocket (only if polling feels laggy in practice)
- CI pipeline for the dashboard
- Automated acceptance testing (Playwright etc.)
