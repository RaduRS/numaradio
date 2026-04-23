# Submit-feedback UX: make Lena feel like a person

**Date:** 2026-04-23
**Surfaces:** `numaradio.com` (public site) — Shoutout and Song request tabs.
**Out of scope:** dashboard compose card, queue daemon, Liquidsoap, song
generation pipeline, NanoClaw chatter work (another agent is in that area).

## Problem

Two submit flows on the listener homepage feel broken-ish for different
reasons:

1. **Shoutout.** `POST /api/booth/submit` holds the HTTP response open for the
   whole pipeline — moderation (~1–3 s) → dashboard's internal shoutout route
   which does radio-host rewrite (LLM, ~5–15 s) → Deepgram TTS (~5–10 s) →
   B2 upload (~2–5 s) → queue push. That's 20–40 s of spinner. Users wonder
   if it's broken and click again.

2. **Song generation.** Submit itself is ~1 s (server returns `requestId`
   fast), but what fills the next ~3 min is a progress-bar-shaped screen
   that cycles "Queued… / Composing… / Painting the cover…" — reads like a
   machine running stages, and worse, `pending` lives in `SongTab`'s local
   `useState` so **tab-switching to the Shoutout tab and back wipes it
   entirely**. User sees an empty form and may try to submit again (caught
   by the 1/hour server rate limit as a 429 that reads like a failure).

Underlying UX complaint from the operator: it should feel like "Lena will
review your request and air it soon" — a person, not a job queue.

## Design

### Shoutout: optimistic fire-and-forget

**Server.** `app/api/booth/submit/route.ts` stops awaiting the internal
shoutout forward. After moderation approves (or rewrites) the text and the
`Shoutout` row is created, return 200 immediately. Kick the forward to
`api.numaradio.com/api/internal/shoutout` via Next.js `after()` so the TTS /
B2 / queue-push runs in the background. Response time drops from ~25 s to
~2 s.

**Meaning of "approved" changes.** It no longer guarantees the audio reaches
the queue. A late TTS / B2 / queue failure is now invisible to the user
unless we check for it. Mitigation below.

**Client.** `app/_components/RequestForm.tsx`:

- On success, dismiss the form and show one calm static line:
  "**Got it. It's on its way to air.**"
- Stash `{ shoutoutId, submittedAt }` in `localStorage` under
  `numa.shoutout.last`.
- On mount (or window focus), if there's a stash ≤ 5 min old, hit a new
  read-only status endpoint. If `deliveryStatus === "failed"`, surface a
  one-time dismiss-on-acknowledge line:
  "Heads up — your last shoutout didn't make it on air. Try again."
  Clear the stash.
- If `deliveryStatus === "aired"` (already on air by the time they looked),
  just clear the stash quietly.

**New endpoint.** `GET /api/booth/shoutout/[id]/status` — reads
`Shoutout.deliveryStatus` only, returns `{ ok, status }`. No auth (the ID
is a client-visible UUID; worst case someone learns their own row aired).

### Song: localStorage persistence + quieter voice

**Server.** No changes — pipeline already async, `status` endpoint already
polled.

**Client.** `app/_components/SongTab.tsx`:

- Persist `{ requestId, submittedAt }` to `localStorage` under
  `numa.song.pending` the moment the server returns a `requestId`.
- On mount, hydrate from `localStorage`. If a pending request is found and
  is < 10 min old, jump straight into the pending card and resume polling.
  Stale entries (> 10 min) are dropped — the server may have timed out.
- Clear the localStorage entry when `status` becomes `done` or `failed`.
- **Double-submit guard is now automatic** — the form only renders when
  there's no pending entry, and tab-switching no longer wipes state.

**Voice change.** Replace the stage-specific headings (`Queued… / Composing…
/ Painting the cover…`) with a quiet-confidence rotator that cycles every
~4.5 s while pending:

1. "In the studio — your song's coming up."
2. "Lena's giving it a listen."
3. "Almost ready for air."

No queue-position / ETA text under the rotator (it's machine-y). The
queue-stats hint before submit (`~3 min · N requests ahead of you`) stays —
that sets expectations before commitment, which is fine.

Final-state card (when `status === "done"`) keeps its current shape — cover
art + title + "Airing on the stream now — tune in." — but we nudge that
closing line to "On air now — listen."

Failure card (when `status === "failed"`) stays — it's already honest and
refund-oriented.

## Data & interfaces

### `Shoutout.deliveryStatus` state machine (unchanged, but now client-visible)

| Value     | Set by                                                    |
|-----------|------------------------------------------------------------|
| `pending` | `booth/submit` when moderation allows/rewrites.           |
| `aired`   | Dashboard's internal shoutout route after queue push.     |
| `failed`  | `booth/submit` or dashboard internal route on error.      |
| `held`    | `booth/submit` when moderation returns `held`.            |
| `blocked` | `booth/submit` when moderation returns `blocked`.         |

### New `GET /api/booth/shoutout/[id]/status` response

```json
{ "ok": true, "status": "pending" | "aired" | "failed" | "held" | "blocked" }
```

404 if the row doesn't exist. No sensitive fields leaked.

### localStorage keys

- `numa.shoutout.last` = `{ "shoutoutId": "...", "submittedAt": 1714000000000 }`
- `numa.song.pending` = `{ "requestId": "...", "submittedAt": 1714000000000 }`

Both are client-only; no PII. Cleared on terminal state or explicit user
action (e.g. "Try again" on a failed song).

## Error handling

- **Shoutout moderator call fails** → existing behavior (500 with a visible
  error). Unchanged.
- **Shoutout row insert fails** → existing behavior (500). Unchanged.
- **Shoutout internal forward fails after we've returned 200** → background
  `after()` logs the failure; dashboard already marks the row
  `deliveryStatus='failed'`. The focus-triggered status check catches it on
  the user's next interaction.
- **Song submit fails** → existing submit error path unchanged.
- **Song poll returns `failed`** → existing failure card unchanged.
- **localStorage unavailable / JSON corrupt** → treat as no pending state;
  form renders fresh. Never blocks the user.

## Testing

Unit / component level:

- `lib/booth-stash.ts` (new tiny helper): round-trip `stash / read / clear`
  for the two keys, with tolerant JSON parse (bad JSON = null).
- `app/api/booth/shoutout/[id]/status/route.ts`: returns 200 for each
  `deliveryStatus` value; 404 for unknown IDs; 400 for malformed IDs.
- `app/api/booth/submit/route.ts` refactor: unit the moderator-accepted
  branch now returns synchronously without awaiting the internal fetch.
  Use a fake fetch that never resolves to prove the response is returned
  first; then assert `after()` ran it.

Manual smoke (since these are mostly UX):

1. Submit a clean shoutout → confirmation visible within ~2 s. Stream pill
   lights up "Lena on air" ~30–60 s later. Reload the page during that
   window — no leftover UI state (stash cleared, page looks normal).
2. Submit a song → instant pending card with rotator. Switch to Shoutout
   tab, switch back → card still there, rotator still running, no empty
   form. Wait ~3 min → done card with cover art.
3. Force a shoutout failure (e.g. dashboard internal unreachable) → visit
   the page again → one-time "didn't make it on air" line, stash cleared.
4. Submit two songs rapidly → second attempt blocked by UI (form hidden)
   not by server 429.

## Non-goals (explicitly deferred)

- "Your song / shoutout is LIVE RIGHT NOW" listener-specific callout —
  existing generic "Lena on air" pill + now-playing already communicates
  this.
- Site-wide persistent chip showing pending state outside the form region.
  The localStorage-backed in-form card is enough for v1.
- Push notifications, email-when-ready, account system.
- Telemetry on how often the focus-check catches a failure — add only if
  we see user reports.
