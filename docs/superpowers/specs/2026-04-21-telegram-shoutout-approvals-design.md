# Telegram shoutout approvals via NanoClaw

**Date:** 2026-04-21
**Status:** Approved, ready for implementation plan

## Problem

When a listener-submitted shoutout is classified `held` by the MiniMax
moderator in `/api/booth/submit`, the only way for the operator to act on
it is the Held card on `dashboard.numaradio.com/shoutouts`. That requires
opening the dashboard — not a natural flow when the operator is away from
their laptop.

The operator already has a Telegram DM with `@nanoOrion_bot` (NanoClaw's
agent-driven bot). A held shoutout should ping that DM with enough context
to decide, and a natural-language reply ("yep" / "nah too aggressive")
should approve or reject it. The existing dashboard Held card must keep
working; both paths should converge on the same database state.

## Constraints

- **Reuse `@nanoOrion_bot`.** No new Telegram bot. NanoClaw owns the
  bot's receiver; only one process can poll/webhook a given bot. Sending
  from a second process (via the Bot API) is fine.
- **Natural-language approval, not button-tapping.** The operator types
  "yes" / "no" / "ok" / "don't" etc; the MiniMax-M2.7 agent in NanoClaw
  interprets and acts.
- **No new dependencies in the radio hot path.** If NanoClaw is down, the
  public booth submission still works and the dashboard card still serves
  as the approval surface.
- **Audit parity with the dashboard flow.** Telegram-sourced approvals
  must leave the same kind of trail as dashboard-sourced approvals
  (different operator tag so they're distinguishable).

## End-to-end flow

1. Listener POSTs to Vercel `/api/booth/submit`. Moderation returns
   `held`. A `Shoutout` row is created with `moderationStatus='held'`
   (unchanged from today).
2. Vercel fires a best-effort
   `POST https://api.numaradio.com/api/internal/shoutouts/held-notify`
   with `x-internal-secret`, body
   `{ id, rawText, cleanText?, requesterName?, moderationReason }`.
3. The new dashboard route receives the notify, writes a JSON file
   atomically into `$NANOCLAW_IPC_DIR/held-<id>.json`:
   ```json
   {
     "type": "message",
     "chatJid": "<TELEGRAM_OPERATOR_CHAT_JID>",
     "text": "🎙 *Held shoutout awaiting your call* …"
   }
   ```
4. NanoClaw's IPC watcher picks up the file, calls the Telegram channel's
   `sendMessage(chatJid, text)`. Bot delivers a plain (non-agent-voiced)
   message to the operator's DM.
5. Operator replies naturally ("yep", "nah too aggressive", "hold off",
   "air it", "block"). The reply goes through the Telegram channel →
   NanoClaw router → `telegram_main` group's agent container.
6. Agent reads its `groups/telegram_main/CLAUDE.md` "Held shoutout
   approvals" subsection and runs either
   `curl POST http://host.docker.internal:3001/api/internal/shoutouts/<id>/approve`
   or `…/reject`, authenticated with `x-internal-secret` set to
   `$INTERNAL_API_SECRET` (passed into the container via NanoClaw's env
   file).
7. Dashboard route runs the shared approve/reject helper (same code path
   as the existing CF-Access-gated dashboard routes), flips the DB,
   generates TTS on approve, pushes to the on-demand queue daemon.
8. Agent reads the response and replies in chat: "Approved — Lena is
   reading it now" / "Blocked" / "Already handled on the dashboard" (409
   path).

The dashboard `/shoutouts` Held card is unchanged. Whichever path flips
`moderationStatus` out of `held` first wins; the other gets 409.

## Components

### Numa Radio repo (`/home/marku/saas/numaradio`)

- **`app/api/booth/submit/route.ts`** — after the held-branch returns its
  response, `await` is not used; instead `void fetch(INTERNAL_HELD_NOTIFY_URL, …)`
  is fired and we log-and-swallow errors so the listener's response is
  unaffected. The booth submit contract to the public is unchanged.
- **`dashboard/lib/shoutouts-ops.ts` (new)** — extracts the bodies of the
  existing `dashboard/app/api/shoutouts/[id]/approve/route.ts` and
  `.../reject/route.ts` into `approveShoutout({ id, operator, pool })` and
  `rejectShoutout({ id, operator, pool })`. Both the CF-Access routes and
  the new internal routes call these. The helper tightens the held-check
  into a conditional `UPDATE … WHERE "moderationStatus"='held'` so two
  concurrent callers cannot both proceed.
- **`dashboard/app/api/shoutouts/[id]/approve/route.ts`** and
  **`.../reject/route.ts`** — trimmed down to: auth via CF-Access header,
  set operator to `cf-access-authenticated-user-email`, call the shared
  helper, translate errors to HTTP.
- **`dashboard/app/api/internal/shoutouts/[id]/approve/route.ts`
  (new)** and **`.../reject/route.ts` (new)** — auth via
  `x-internal-secret`, operator is a tag-string (see interface contracts
  below), call the shared helper.
- **`dashboard/app/api/internal/shoutouts/held-notify/route.ts` (new)**
  — auth via `x-internal-secret`, writes the IPC JSON file atomically.
- **`dashboard/app/api/internal/shoutouts/held/route.ts` (new, GET)** —
  auth via `x-internal-secret`, returns most-recent-first list of rows
  still in `moderationStatus='held'`, limit 10, shape
  `{ ok: true, held: [{ id, rawText, requesterName, moderationReason,
  createdAt }] }`. Used by the agent to disambiguate ambiguous replies.
- **`dashboard/lib/ipc-writer.ts` (new)** — small helper to write a JSON
  file atomically (`writeFile` to `.tmp` then `rename`) with a fixed
  filename derived from the shoutout id, so retries overwrite instead of
  piling up.

### NanoClaw (`/home/marku/nanoclaw`)

- **`groups/telegram_main/CLAUDE.md`** — extend the existing "Numa Radio"
  section with a "Held shoutout approvals" subsection:
  - Explain that the bot sometimes sends "🎙 Held shoutout awaiting your
    call" messages containing a shoutout id.
  - When the operator replies yes-ish (yes / yeah / yep / ok / sure /
    air it / go / do it / send it) → run the approve curl with that id.
  - When they reply no-ish (no / nah / don't / stop / block / skip /
    kill it / hold off) → run the reject curl with that id.
  - When the reply is ambiguous or several shoutouts are pending, call
    `GET /api/internal/shoutouts/held` first, list them back, ask which.
  - On 409 ("already handled"), acknowledge naturally ("looks like you
    already did that one on the dashboard").
  - On 404, treat as a stale id and check the held list.
  - Always read back a short confirmation of the outcome.
  - Explicit vocabulary list included so the agent doesn't over-broaden
    ("what's airing?" is not an approval).
- **`data/env/env`** — add `INTERNAL_API_SECRET=<same value as
  /etc/numa/env>` so the agent container can authenticate its curls.

### Env additions

- **Vercel:** `INTERNAL_HELD_NOTIFY_URL` (optional, defaults to
  `https://api.numaradio.com/api/internal/shoutouts/held-notify`).
- **Dashboard** (`dashboard/.env.local` and the `numa-dashboard` systemd
  unit's environment):
  - `NANOCLAW_IPC_DIR` (default
    `/home/marku/nanoclaw/data/ipc/telegram_main/messages`). Soft
    dependency: if the directory is missing or unwritable, log loudly
    at startup and have the `held-notify` route return 503 at request
    time. Do not crash the dashboard — NanoClaw is not in the hot path
    for any other surface.
  - `TELEGRAM_OPERATOR_CHAT_JID` — numeric Telegram chat id for the
    operator's DM with `@nanoOrion_bot`. Set once manually during
    rollout.
- **NanoClaw:** `INTERNAL_API_SECRET` added to `data/env/env` (see
  above). Copy the value from `/etc/numa/env`.

## Interface contracts

### `POST /api/internal/shoutouts/held-notify` (dashboard, tunneled)

- **Auth:** `x-internal-secret` header must equal `INTERNAL_API_SECRET`.
  Constant-time compare.
- **Body:** `{ id: string, rawText: string, cleanText?: string,
  requesterName?: string, moderationReason?: string }`.
- **Action:** writes one JSON file to `$NANOCLAW_IPC_DIR/held-<id>.json`
  with `{ type: "message", chatJid: $TELEGRAM_OPERATOR_CHAT_JID, text:
  <formatted> }` using the atomic-rename helper.
- **Returns:** `{ ok: true }` on success, `{ ok: false, error }` on
  failure (500 for write errors, 503 if IPC dir not configured, 401 on
  auth fail, 400 on malformed body).
- **Idempotency:** filename is `held-<id>.json`, so repeated notifies for
  the same shoutout row overwrite; if NanoClaw already consumed the
  first, the operator sees two pings (rare, harmless).

### `POST /api/internal/shoutouts/[id]/approve` (dashboard)

- **Auth:** `x-internal-secret` (constant-time compare).
- **Body:** empty.
- **Action:** calls `approveShoutout({ id, operator:
  "telegram:nanoclaw", pool })`. The helper runs a conditional `UPDATE`
  that only progresses if the row is still in `moderationStatus='held'`
  and `deliveryStatus!='aired'`, then generates TTS and pushes to the
  queue daemon (same as the existing CF-Access route).
- **Returns:** on success `{ ok: true, trackId, queueItemId }`; on
  "already handled" 409 `{ ok: false, error: "already handled",
  code: "not_held" }`; 404 for unknown id; 500 on downstream failure.
- **Audit:** `moderationReason` set to `approved_by:telegram:nanoclaw`.

### `POST /api/internal/shoutouts/[id]/reject` (dashboard)

- **Auth:** `x-internal-secret`.
- **Body:** `{ reasonHint?: string }` (optional free-text, clipped to 200
  chars, appended to the audit).
- **Action:** calls `rejectShoutout({ id, operator: "telegram:nanoclaw",
  pool, reasonHint })`. Helper runs a conditional `UPDATE` that only
  flips `held → blocked`; anything else yields 409.
- **Returns:** `{ ok: true }` / `{ ok: false, error }` / 409 / 404.
- **Audit:** `moderationReason` set to `rejected_by:telegram:nanoclaw` or
  `rejected_by:telegram:nanoclaw reason=<hint>` when a hint is present.

### `GET /api/internal/shoutouts/held` (dashboard)

- **Auth:** `x-internal-secret`.
- **Returns:** `{ ok: true, held: Array<{ id, rawText, requesterName,
  moderationReason, createdAt }> }`, ordered `createdAt DESC`, limit 10.
  Used by the agent when the operator's reply is ambiguous.

### Telegram message format

Plain bot-voiced message written by `held-notify`. Telegram/WhatsApp
markdown per NanoClaw's formatting guide — single-asterisk bold, no
double-stars, no `[link](url)` syntax:

```
🎙 *Held shoutout awaiting your call*

From: <requesterName or "anonymous">
_"<rawText, clipped at 300 chars>"_

Moderator flagged: <moderationReason or "no specific reason">

ID: `<shoutoutId>`

Reply *yes* to air or *no* to block.
```

### IPC file shape (consumed by NanoClaw)

```json
{
  "type": "message",
  "chatJid": "<numeric chat id>",
  "text": "<formatted markdown>"
}
```

`telegram_main` is NanoClaw's main group (`isMain: true`), so the IPC
authorization check allows it to send to any chatJid — no extra
allowlisting needed.

## Error handling & edge cases

- **NanoClaw is down** — IPC files sit in the directory; when NanoClaw
  starts, the watcher processes them. If it's been down for hours, the
  operator receives a burst of pings at startup. Acceptable: same model
  as any queued notification.
- **Notify call from Vercel fails** — booth submit still returns `held`
  to the listener; dashboard card still shows the row. Error is logged
  on Vercel. No retry.
- **Dashboard is down when Vercel calls notify** — Vercel catches
  network error, logs, moves on. Operator sees nothing on Telegram but
  sees the row on the dashboard once it's back.
- **Same held row notified twice** — IPC file overwritten atomically.
  If NanoClaw already consumed the first, operator sees two pings.
  Rare; harmless.
- **Race between dashboard Approve click and Telegram "yes"** — shared
  helper uses `UPDATE … WHERE id=$1 AND "moderationStatus"='held'`; the
  second caller gets 0 rows and a 409. Lena reads the shoutout exactly
  once.
- **Ambiguous reply with multiple held rows** — agent calls `GET
  /held`, lists them, asks. Agent's CLAUDE.md forbids guessing silently.
- **Reply after chat-history compaction** — agent calls `GET /held`,
  resolves from there.
- **Agent hallucinates an id** — route returns 404, agent reads error
  and checks the held list.
- **Misconfigured `TELEGRAM_OPERATOR_CHAT_JID`** — NanoClaw sends to
  whatever jid we pass (it's trusted because `telegram_main` is the
  main group). If the jid is wrong, the message silently goes to
  another chat or Telegram returns an error; symptoms show up in
  NanoClaw logs. Document in rollout notes to double-check on first
  setup.
- **`approveShoutout` downstream failure (Deepgram / B2 / queue
  daemon)** — existing behavior preserved: row is flipped
  `deliveryStatus='failed'` with the error stored in `moderationReason`.
  The agent reads the response error and tells the operator "approval
  failed: <error>".

## Testing

### Unit (dashboard, `node --test --experimental-strip-types`)

- `dashboard/lib/shoutouts-ops.test.ts` covers `approveShoutout` and
  `rejectShoutout` against a mocked `pg` pool:
  - not-found (helper returns `{ ok: false, code: "not_found" }`)
  - already-aired (`{ code: "already_aired" }`, 409 in the route layer)
  - not-held (`{ code: "not_held" }`)
  - happy-path approve (UPDATE → generate → push → final UPDATE;
    returns `{ ok: true, trackId, queueItemId }`)
  - happy-path reject (single UPDATE)
  - TTS-generate failure leaves the row `deliveryStatus='failed'`.
  - Concurrent double-approve: second call yields `not_held`.
- `dashboard/lib/ipc-writer.test.ts` covers atomic writes:
  - writes `.tmp` then renames
  - correct filename derived from id
  - correct JSON shape
  - missing directory → clear error
  - overwrite of existing file works.

### Integration (manual, on Orion)

1. Submit a deliberately-held shoutout from `numaradio.com` (a phrase
   MiniMax classifies `held` reliably).
2. Verify the Telegram message lands on the operator's DM within a few
   seconds.
3. Reply "yep" in Telegram → Lena should air it within the next track
   boundary. Dashboard Held card should clear that row.
4. Submit another held shoutout, reply "no, too aggressive" → dashboard
   card shows it moved to `moderationStatus='blocked'` with operator
   tag `rejected_by:telegram:nanoclaw` and `reasonHint` included.
5. Submit another held shoutout, approve it on the dashboard web UI
   first, then reply "yes" on Telegram → agent should report "already
   handled on the dashboard" (409 path).
6. Submit two held shoutouts back-to-back, reply "yes" without
   specifying which → agent should list both and ask which one.

### No UI tests

Dashboard Held card behavior is unchanged; no visual regressions
expected.

## Out of scope

- No new Telegram bot. No BotFather setup.
- No webhook / callback-query listener on the Numa Radio side.
- No approval from arbitrary Telegram users — only the single operator
  chat configured in `TELEGRAM_OPERATOR_CHAT_JID`.
- No retry logic for IPC file writes or notify calls. Dashboard card
  remains the fallback.
- No Telegram pings for non-held outcomes (allowed, rewritten,
  blocked). Only held events page the operator.
- No song-generation flow. This design covers only shoutout approvals.

## Rollout notes

1. Deploy dashboard changes first (new internal routes, shared helper).
   Existing CF-Access approve/reject must keep working through the
   refactor — deploy checkpoint: the `/shoutouts` Held card still
   approves and rejects correctly after the helper extraction.
2. Add `INTERNAL_API_SECRET` to `/home/marku/nanoclaw/data/env/env`.
   Restart NanoClaw.
3. Update `groups/telegram_main/CLAUDE.md` with the "Held shoutout
   approvals" subsection. (No NanoClaw restart needed; the agent reads
   it on its next turn.)
4. Set `NANOCLAW_IPC_DIR` and `TELEGRAM_OPERATOR_CHAT_JID` in
   `dashboard/.env.local` and the `numa-dashboard` systemd unit env.
   Restart the dashboard.
5. Update Vercel env with `INTERNAL_HELD_NOTIFY_URL` (optional — the
   default points at the production tunnel).
6. Deploy the Vercel booth-submit change.
7. Run the integration-test checklist above end-to-end.

Rollback: revert the Vercel booth-submit commit (Telegram pings stop;
dashboard Held card keeps working). Revert dashboard changes (internal
routes go away; CF-Access routes still work).
