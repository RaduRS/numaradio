# Dashboard ↔ NanoClaw Chat — Design

**Date:** 2026-04-23
**Status:** approved (all six clarifying questions locked + architecture approved)

---

## 1. Problem

Lena's producer (the NanoClaw agent, MiniMax-M2.7 brain) is currently reachable
only through Telegram. The operator wants a conversational surface inside
`dashboard.numaradio.com` that feels like talking to the same agent — natural
language in, natural language out — plus the ability to drive on-station
actions (generate a song, send a shoutout, push a track, approve a held
shoutout, restart a service, toggle auto-chatter). The Telegram path works but
is context-switchy and can't show or act on dashboard state.

## 2. Product decisions (locked)

| # | Decision | Choice |
|---|---|---|
| 1 | UI surface | **Full page** at `/chat`, alongside `/library` and `/shoutouts`. |
| 2 | Persistence | **One persistent conversation.** Reopens with full history. |
| 3 | Agent scope | **Telegram parity + dashboard ops.** All existing agent tools, plus new dashboard-specific internal APIs (library search/push, held-shoutout approve/reject, service restart, auto-chatter toggle, logs tail). |
| 4 | Tool-call rendering | **Clean by default, progressive disclosure.** Final reply visible; a subtle caret expands to one-line chips per action; each chip can expand further to JSON args + result. |
| 5 | Confirmations | **Yellow-light for risky mutations.** Reads & routine pushes run unilaterally. Service restarts, bulk rejections, destructive ops render a Confirm/Cancel card inline. |
| 6 | Memory | **New `dashboard_main` group** with separate conversation history and a dashboard-flavored CLAUDE.md briefing. Global memory shared with `telegram_main` — she still "knows you". |

## 3. Architecture

```
 Browser (CF-Access-authenticated operator)
   │
   │  fetch POST /api/chat/send            (user message)
   │  EventSource GET /api/chat/stream     (agent replies, tool chips, confirms)
   │  fetch GET /api/chat/history          (page-load backfill)
   │  fetch POST /api/chat/confirm/[id]    (resolve a yellow-light card)
   ▼
 dashboard/app/chat/page.tsx                          ─┐
 dashboard/app/api/chat/{send,stream,history,confirm}  ├─ Next.js on Orion:3001 (CF Access)
 dashboard/app/api/internal/tools/*                   ─┘
   │  proxies loopback            ┊  internal tool endpoints
   ▼ 127.0.0.1:4001                ┊  (INTERNAL_API_SECRET guarded)
 NanoClaw HttpChannel (new)                 ─┐
   │  ownsJid("dashboard:main")               │  NanoClaw in Docker
   │  POST /chat/send → onMessage callback    │  (port 4001 mapped to 127.0.0.1)
   │  GET /chat/stream → SSE fan-out          │
   │  GET /chat/history → DB lookup          ─┘
   ▼
 NanoClaw router → group dashboard_main
   │  MiniMax-M2.7 + bash + container-runner
   │  curls dashboard internal APIs for ops
```

Two pieces are new; everything else is a thin proxy or a small addition to
the existing internal-API pattern.

## 4. NanoClaw `HttpChannel`

New module `src/channels/http.ts` implementing the existing `Channel`
interface. Mirrors the Telegram channel's structure.

### 4.1 Jid semantics

- Format: `dashboard:main`
- `ownsJid(jid)` returns true iff `jid.startsWith("dashboard:")`.
- Disjoint from `telegram:*`; the router already resolves by prefix.

### 4.2 HTTP surface (binds 127.0.0.1:${DASHBOARD_CHANNEL_PORT:-4001})

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/chat/send` | `{groupJid, senderName, text}` → synthesize a `NewMessage` and fire `onMessage`. Return `{ok, turnId}` immediately. |
| `GET` | `/chat/stream?groupJid=…` | SSE stream. Channel pushes events when `sendMessage(jid,text)` is called OR when parsers detect structured tags. |
| `GET` | `/chat/history?groupJid=…&limit=N` | Read from `db.getMessagesSince(…)` (existing NanoClaw DB). Returns newest N turns. |
| `POST` | `/chat/inject` | Internal-only (shared secret): inject a synthetic operator message (used by the confirmation-resolution path). |

All endpoints require an `X-Internal-Secret: $INTERNAL_API_SECRET` header.
The dashboard proxy routes add it; the browser never talks to NanoClaw
directly.

### 4.3 SSE event protocol

```
event: typing
data: {"turnId":"t_abc"}

event: message.chunk
data: {"turnId":"t_abc","text":"Queued "}

event: action
data: {"turnId":"t_abc","id":"a_1","name":"library.push","args":{...},"at":"2026-04-23T…"}

event: action.result
data: {"id":"a_1","ok":true,"summary":"Pushed \"One More Dance\""}

event: confirm.request
data: {"turnId":"t_abc","confirmId":"c_1","action":"service.restart","args":{...},"prompt":"Restart Liquidsoap now?"}

event: confirm.resolved
data: {"confirmId":"c_1","decision":"approve"}

event: message.done
data: {"turnId":"t_abc","final":true}

event: error
data: {"turnId":"t_abc","message":"MiniMax timed out"}
```

The `message.chunk` stream is built by splitting the current `sendMessage(jid,
text)` call into chunks and emitting them progressively. For v1 we can ship
a simpler "whole message, one chunk" flow and upgrade to true token-streaming
later without changing the UI contract.

### 4.4 Structured tag parsing

Agent output can include two inline tags (alongside the existing
`<internal>…</internal>`):

- `<action name="library.push" args='{"trackId":"trk_847"}'/>` — observability marker. Before emitting `message.chunk`, the channel strips these and emits `action` / `action.result` events.
- `<confirm action="service.restart" args='{"service":"numa-liquidsoap"}' id="c_1">Restart Liquidsoap now?</confirm>` — the channel strips these and emits `confirm.request`. It pauses sending the rest of the message until the operator resolves.

Parsing lives in a standalone `lib/chat-tag-parser.ts` with unit tests — no
magic regex buried in the channel.

### 4.5 `sendMessage` vs `storeMessage` coupling

`sendMessage(jid, text)` is called by NanoClaw's agent loop with the final
reply. The HttpChannel:
1. Parses out `action` / `confirm` / `internal` tags.
2. Emits SSE events.
3. Also calls `storeMessage` so the reply persists for `/chat/history`.

This matches Telegram's pattern (send to platform + DB stores it via a
separate code path).

## 5. `dashboard_main` group briefing

New folder `groups/dashboard_main/CLAUDE.md` (on Orion, inside NanoClaw's
groups directory — same place as `telegram_main`). Teaches the agent:

1. Persona: "You are Lena's on-duty producer, at the console. The operator
   can see what you do in real time."
2. Action tag usage (when to emit `<action/>`).
3. Yellow-light actions require `<confirm>`: restart service, reject shoutouts,
   delete library tracks.
4. Dashboard tool recipes — curl commands against the internal tools API,
   using `$INTERNAL_API_SECRET` from env and `host.docker.internal:3001`
   (same pattern as the existing `/api/generate/shoutout` recipe in
   `groups/main/CLAUDE.md`).

Registered with `requiresTrigger: false` (every message is processed, no
`@Andy` prefix needed — she's the dedicated dashboard agent).

## 6. Dashboard internal tools API

All mounted at `dashboard/app/api/internal/tools/*`, all guarded by
`INTERNAL_API_SECRET` (timing-safe compare), all `export const dynamic = "force-dynamic"`.

| Tool | Path | Method | Body | Action |
|---|---|---|---|---|
| library.search | `/api/internal/tools/library-search` | POST | `{query, limit}` | Search Track by title/artist; return id/title/artist/duration. |
| library.push | `/api/internal/tools/library-push` | POST | `{trackId, reason?}` | Forward to queue-daemon `/push`. Records operator in audit. |
| shoutout.list-held | `/api/internal/tools/shoutout-list-held` | GET | — | Wrap existing `getHeldShoutouts`. |
| shoutout.approve | `/api/internal/tools/shoutout-approve` | POST | `{id}` | Reuse `approveShoutout`. |
| shoutout.reject | `/api/internal/tools/shoutout-reject` | POST | `{id, reason?}` | Reuse `rejectShoutout`. |
| service.restart | `/api/internal/tools/service-restart` | POST | `{service}` | Allowlisted services only (`numa-liquidsoap`, `numa-queue-daemon`, `icecast2`, `numa-song-worker`). Wraps existing `systemd` helper. **Yellow-light.** |
| autochatter.toggle | `/api/internal/tools/autochatter-toggle` | POST | `{enabled}` | Flip the existing auto-chatter flag. |
| logs.tail | `/api/internal/tools/logs-tail` | GET | `?service=…&lines=N` | Reuse existing logs API. |
| nowplaying | `/api/internal/tools/nowplaying` | GET | — | Read `NowPlaying` from Neon. |

Operator identity for audit comes from the `senderName` relayed by the
channel (e.g. `dashboard:rsrusu90@gmail.com`). Since the agent calls these
from inside her container, she includes the operator in the body:

```
POST /api/internal/tools/library-push
Headers: x-internal-secret: …
Body: {"trackId":"trk_847","reason":"operator chat: push russell","operator":"dashboard:rsrusu90@gmail.com"}
```

## 7. Dashboard chat proxy routes

All at `dashboard/app/api/chat/*`:

- `POST /api/chat/send` — reads CF Access email, forwards to `POST
  http://127.0.0.1:4001/chat/send` with `{groupJid:"dashboard:main",
  senderName:"dashboard:<email>", text}`.
- `GET /api/chat/stream` — opens a `ReadableStream` response and pipes the
  SSE bytes from NanoClaw through. `Content-Type: text/event-stream`,
  `Cache-Control: no-cache, no-transform`.
- `GET /api/chat/history?limit=N` — forwards.
- `POST /api/chat/confirm/[confirmId]` — `{decision}` → executes the real
  internal tool if `approve`, then POSTs to `/chat/inject` on NanoClaw with
  `[confirmed: <action> → <result>]` so the agent sees the resolution.

CF Access gate is already applied to the whole `dashboard.numaradio.com`
host at the Cloudflare edge — no per-route auth needed.

## 8. UI — `/chat` page

Built with the `frontend-design` skill (per user feedback memory). High-level:

- **Layout.** Two-pane: main conversation (left/center, ~70%) + a thin right
  rail for "session info" (last action chips, operator identity, connection
  status). On narrow screens the right rail collapses.
- **Message bubbles.** Operator messages right-aligned in accent-teal.
  Agent messages left-aligned in neutral. Typing dots show during `typing`.
- **Action chips.** Rendered inline *below* the agent message, collapsed by
  default to a small `▸ 2 actions` indicator. Expanded: one-line-per-action
  chips (`library.push · "One More Dance" ✓`). Click a chip → JSON detail
  drawer for that action.
- **Confirm cards.** Appear inline, bright yellow border, two buttons
  (Confirm / Cancel). While unresolved, the chat input is disabled.
- **Scrollback.** Loads last 50 turns on mount via `/api/chat/history`.
  "Load earlier" button at top.
- **Reconnect.** EventSource auto-reconnects on drop. A subtle status dot
  in the rail flips to amber during reconnect, green when live.

Frontend-design skill invocation will cover polish — spacing, colour, motion,
empty state, error states.

## 9. Error handling

| Failure | Behavior |
|---|---|
| NanoClaw container down | Proxy routes return 503; UI shows a persistent banner "Producer offline — reconnecting." EventSource keeps retrying. |
| SSE disconnect | `EventSource` auto-reconnects; UI shows amber dot. On reconnect, it fetches history since the last known turn to backfill. |
| Tool curl failure | Agent's bash gets a non-2xx; she reports in-chat ("I tried to push that track but the queue daemon errored"). UI renders as normal message + optional `action.result {ok:false}` chip. |
| Model timeout | NanoClaw emits `error` event; UI shows inline error + "Try again" button that resends the last user message. |
| Confirm card stale (multi-tab) | First tab to resolve wins. Other tabs get `confirm.resolved`, card dims. |
| `INTERNAL_API_SECRET` mismatch | Channel returns 401; proxy surfaces as 502 to UI with "auth mismatch — check server env". |

## 10. Testing

- **Unit**: `lib/chat-tag-parser.test.ts` — `<action/>`, `<confirm>`, nested
  content, malformed tags, `<internal>` interaction.
- **Unit**: `lib/tools/*.test.ts` — per-tool input validation + audit-log shape.
- **Integration**: smoke script that starts the channel on a throwaway
  port, POSTs a message, subscribes to the SSE stream, validates event
  order (`typing → message.chunk → message.done`).
- **Build**: `cd dashboard && npm run build` must stay clean.
- **Dashboard existing tests**: `npm test` (the 18 library tests) must stay green.

## 11. Deployment

1. **NanoClaw container** — rebuild image (or `npm run build` inside
   container) and update `docker run` to map `-p 127.0.0.1:4001:4001`.
   Existing install script `deploy/install-docker-ce.sh` is idempotent —
   the port change goes in the systemd unit or compose file.
2. **Dashboard** — `cd dashboard && npm run deploy` (password-free
   restart).
3. **Env** — `DASHBOARD_CHANNEL_PORT=4001` in NanoClaw's env + dashboard's
   `.env.local`. `INTERNAL_API_SECRET` already set on both sides.
4. **Group folder** — `groups/dashboard_main/` must exist on the Orion
   NanoClaw install with the CLAUDE.md briefing. Ship the briefing in
   the Numa Radio repo; the deployment note in HANDOFF tells the operator
   to copy it into the NanoClaw groups dir.

## 12. Out of scope (explicit non-goals for v1)

- Voice input / speech-to-text in the chat.
- Rendering Lena's responses as audio in the browser.
- Multi-user presence indicators.
- Shared-conversation mode (no "who's also watching" UI).
- WebSocket transport (SSE is sufficient; WS is a future upgrade path).
- In-chat interrupts / "stop generation" button.
- Proactive agent-initiated messages without scheduling.

## 13. Open questions deferred to implementation

- Exact chunk cadence for `message.chunk` (v1 ships whole-message; token
  streaming requires changes to `runContainerAgent` we'd rather not batch
  here).
- Rate limits on `/api/chat/send` (CF Access already gates; add a soft
  per-operator limit if we ever see abuse — YAGNI for now).
