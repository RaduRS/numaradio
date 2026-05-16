# Numa Radio — parked work

Tasks paused mid-decision. Each entry is self-contained — pick up cold,
read the **resume trigger** at the top, run the plan.

---

## Booth consent checkbox — shoutout + song-request forms

**Status:** parked 2026-05-05.
**Resume trigger:** anytime — independent of the social-post timing.
Worth doing before too many new listener shoutouts pile up under the
old (no-checkbox) flow, but not blocking.

### Background

The artist submission form already has a vouch checkbox covering
social-media reuse (`app/_components/SubmitForm.tsx` —
`I confirm this is my own work...` text, includes the social-media
clause as of commits `ccd2ec9` + `55063ec`). The booth has two other
input surfaces with NO equivalent gate:

1. **Shoutout form** (`app/_components/RequestForm.tsx` shoutout tab)
   — listener types name + message, hits "Send to the booth", and
   right now there's no per-submit consent UI. The only consent
   text lives on `/privacy` (added 2026-05-05) — passive notice, not
   an active checkbox.

2. **Song-request form** (`app/_components/SongTab.tsx`) — listener
   types prompt + artist name, hits "Create song". Same gap.

Going forward, every listener shoutout / song prompt may end up in a
promotional Short. Active consent checkbox closes the gap.

### What to build

Both forms get a tiny checkbox + label, gating the submit button:

> ☐ OK with this appearing in Numa's social posts ([terms]).

- "terms" links to `/privacy` (opens new tab).
- Visual: very small text (~11 px), dimmed (`opacity ~0.85`), inline
  underneath the existing input fields.
- Submit button stays `disabled` while the box is unchecked AND in
  the existing `sending` / `submitting` state.
- After successful send, RESET the checkbox to false. Each submit
  is a per-message consent, not a per-session one. Mirrors how the
  /privacy page text frames it ("by sending a shoutout you also
  agree...").

### Files to touch

- `app/_components/RequestForm.tsx` — add `consented` state, the
  checkbox JSX before the submit button, gate `disabled={sending ||
  !consented}`, and `setConsented(false)` after a successful submit.
- `app/_components/SongTab.tsx` — same pattern. Existing
  `req-check` styling is fine to reuse (same as the "Instrumental
  only" checkbox already present), with the small/dim inline style.
- No DB column needed — checkbox is enforcement-only. The privacy
  page already states the consent legally; the checkbox just makes
  it active.

### Why parked

I started writing this in-session and the operator parked the whole
social-launch sequence pending first post. Making the booth gate
visible BEFORE posts go live is fine; making it visible AFTER posts
go live is also fine. Operator preference: keep all this off the
production site until the first social post is imminent so we don't
confuse current listeners with consent UI for a feature they
haven't seen evidence of yet.

### When this is done

Remove the entry from this file.

---

## Newsletter subscribe checkbox on submit page

**Status:** parked 2026-05-16.
**Resume trigger:** anytime — small additive feature, no blockers.

### What to build

On the artist submission form (`app/_components/SubmitForm.tsx`),
add an optional checkbox the submitter can tick to opt in to a
Numa Radio newsletter / mailing list:

> ☐ Keep me posted with Numa Radio updates (occasional, no spam).

- Default UNCHECKED (opt-in, not opt-out).
- Visual: same small / dim inline style as the existing consent
  checkbox cluster — sits below the social-media vouch checkbox.
- Submit button stays enabled regardless of this checkbox (it's
  optional).
- When checked + submitted: persist the submitter's email to a
  newsletter list. Either:
  - **Resend** (already integrated for transactional approval/reject
    emails — see HANDOFF 2026-05-03 evening) — Resend has Audiences
    / Contacts. Add the email to a "numaradio-artists" audience.
  - **Or a simple DB column on `MusicSubmission`** (`newsletterOptIn boolean`)
    + a periodic export. Simpler, no extra service dependency.

Recommend Resend Audiences path — already paid for, no new infra,
and Resend has unsubscribe links + double-opt-in patterns out of
the box.

### Files to touch

- `app/_components/SubmitForm.tsx` — new checkbox state + JSX
- `app/api/submissions/intake/route.ts` (or wherever submit lands)
  — pass `newsletterOptIn` through
- `dashboard/lib/email/` (existing Resend client) — add a helper
  `addToArtistAudience(email, displayName)` that POSTs to the
  Resend Audiences API. Look up Resend Audiences docs for endpoint.
- Optionally: a small operator-side audit log so we can see opt-in
  rate over time.

### Operator follow-ups

- Create a "numaradio-artists" audience in Resend dashboard (one-time)
- Decide on first newsletter cadence + content (monthly station
  updates? release roundups? — separate brand decision)
- Add unsubscribe link + footer to any newsletter we send (legal
  requirement under GDPR / CAN-SPAM — Resend templates handle this)

### When this is done

Remove the entry from this file.

---

## Lena Producer Phase 6 — Delete deprecated paths

**Status:** parked 2026-05-16. Phases 1–5b shipped today; Phase 6
cleanup deferred until prod observation period passes.

**Resume trigger:** after Phases 2 / 3 / 4b / 5b have all been on
in production for 5+ days with no `fallback` log lines firing (the
legacy paths are the fallbacks — if they never trigger, safe to
delete).

### What to delete

Once verified safe:
- `workers/queue-daemon/chatter-prompts.ts` — Phase 2's Producer
  replaces it. Currently still imported as the fallback if
  `lenaSpeak()` returns null. Deletion removes that fallback —
  acceptable when Producer has been stable.
- `workers/queue-daemon/context-line.ts` — Subsumed by Producer's
  `aside` mode. Still runs on a 10-min tick writing text-only
  Chatter rows for the public site's "Lena quote" surface. Need
  to decide: keep for non-audio Lena quotes, or surface Producer
  `aside` rows for that purpose too.
- Old `lib/lena-reply.ts` prompt code — Phase 3's chat-Producer
  replaces it. Currently still imported as the reply fallback.
- Old `dashboard/lib/humanize.ts` rewrite logic — Phase 4b's
  shoutout-Producer replaces it. Currently the fallback.

### Operator follow-ups

- Verify each phase has zero fallback log lines for 5+ days
- Then run the cleanup PR; ~5 small commits to delete each path

### When this is done

Remove the entry from this file.

---

## Lena Producer — Website song-request surface

**Status:** parked 2026-05-16. Phase 5b shipped YouTube-only listener
requests (`@lena play X` in chat → catalog lookup → queue insert via
`/api/internal/lena-queue`). Website booth (numaradio.com) still has
NO way for listeners to request a library track.

**Resume trigger:** after Phase 5b has been observed live for 3+ days
with no reconciler-loop incidents, no stale "queued up" announcements,
no false-decline complaints from listeners. Verify YouTube path is
rock-solid before doubling the surface.

### Why parked

Tonight (2026-05-16) had two prod incidents in the request flow:
1. Loop bug — `lib/lena-producer-chat` bypassed `pushHandler`, reconciler
   re-played Fault Lines 4× in a row. Fixed in `f29078e`.
2. Temporal-frame bug — Lena announced "Silhouette queued up" while
   the track was ending. Fixed in `68e3eb9`.

Doubling the surface before the YouTube path is observed clean would
amplify any latent bug to the website audience too.

### What to build

A new input on numaradio.com that submits library-track requests
through the same backend as YouTube chat. Options for UX:

- **Option A:** new third tab on the booth ("Play a track"), text input
  with autocomplete against catalog
- **Option B:** add a "Play this track" button to each entry in the
  existing library/now-playing surface
- **Option C:** voice search ("type or speak a song title")

### Files likely touched

- `app/_components/RequestForm.tsx` or a new component
- New `app/api/booth/request-track/route.ts` (Vercel) — calls the
  existing `api.numaradio.com/api/internal/lena-queue` dashboard endpoint
  with `INTERNAL_API_SECRET`
- Catalog autocomplete endpoint (probably reuses `lib/catalog-lookup.ts`)

### Cross-cuts

- Catalog disclosure: listeners can request things that aren't in the
  catalog → decline reason "not_in_catalog" airs on stream. Avoid
  spamming this by adding client-side autocomplete that only shows
  matchable tracks.
- Rate limit: `priority_request` band is shared with shoutouts. Allow
  N requests per IP per hour (like booth submit). Same per-author rate
  limit pattern as YouTube chat (3/hr).
- Anonymous vs named: dashboard already has a sanitiseName helper for
  YouTube — reuse for website too.

### Estimated size

~6-8 tasks. Smaller than Phase 5b because backend already exists
(`/api/internal/lena-queue`). Mostly frontend + a thin Vercel proxy
route + rate-limit wiring.

---

## Lena proactively asks listeners "what should I play next?" in YouTube chat

**Status:** parked 2026-05-16. Phase 5b (listener requests via @lena play X)
shipped today. Natural next step: Lena initiates the conversation,
posts a message to YouTube live chat asking listeners what they want.

**Resume trigger:** after Phase 5b is observed for 1-2 weeks. Requires
both the request flow + YouTube CTA from Lena to be working naturally
before adding outbound chat.

### What to build

When YouTube broadcast is live AND chat has been quiet for N minutes
AND there are listeners (gate threshold met), Lena posts a brief
chat message: "Anyone got a request? Drop @lena play <title> in chat
and I'll spin it up."

### Architecture

Currently Lena's YouTube chat path is INBOUND only:
`workers/queue-daemon/youtube-chat-loop.ts` reads messages every N
seconds via `liveChatMessages.list`. Phase 5b dispatches the route
that handles them.

For outbound, we need:
- New OAuth scope: `youtube.force-ssl` (currently only have `youtube.readonly`).
  See HANDOFF 2026-04-29 — the `youtube-go-live.ts` script already
  uses force-ssl for the same OAuth token, so the credentials exist.
- `liveChatMessages.insert` API call (50 quota units per call — expensive!).
- A new daemon-side scheduler: tracks last-outbound timestamp + last-
  inbound timestamp, fires every M minutes when conditions are met.
- A new Producer mode `chat_ask` that generates the prompt text.
- Cool-down: minimum 15-30 min between outbound asks (avoid feeling spammy).
- Quota guard: max N outbound per day to stay under the 10k daily YouTube quota.

### Files likely touched

- New `workers/queue-daemon/youtube-chat-write.ts` — wrapper around
  `liveChatMessages.insert` with quota tracking
- New `workers/queue-daemon/youtube-chat-scheduler.ts` — orchestrator
  that fires the proactive ask
- New `workers/queue-daemon/lena-producer/writers/chat-ask.ts` — Writer
  prompt for the proactive ask (vary the wording each time)
- `workers/queue-daemon/lena-producer/modes.ts` — add `chat_ask` mode
- Dashboard UI: probably an operator toggle (auto / forced_on / forced_off)
  mirroring the existing autoChatter pattern, in case the operator wants
  Lena quieter during certain shows

### Cross-cuts

- YouTube chat quota: outbound costs 50 units, vs 5 units for inbound.
  Currently we use ~3,300/day for inbound polling. Outbound at 1/hour
  during live broadcasts = ~24/day × 50 = 1,200/day extra. Fits inside
  10k quota with headroom.
- Tone: avoid sounding like a bot. Vary wording, reference recent vibe
  ("Late night in here — anything specific you want to hear?").
- Tie to existing ShiftMemory: if a listener already requested something
  recently, prefer to thank them instead of asking for more.
- Anti-pattern: don't ask if no listeners (gate threshold ≥4 already
  exists for auto-chatter — reuse).

### Estimated size

~10-15 tasks. Bigger because it's a new outbound surface (write API,
quota, scheduling, mode, prompt, dashboard toggle, tests).

### When this is done

Remove the entry from this file.

---

## Watch in prod after Phase 5b validation

**Status:** parked 2026-05-16. Phase 5b validated end-to-end
(YT listener `@lena play digital culprit` → queued + announced +
rotation resumed cleanly). Not action items, just things to keep
an eye on for the next 1-2 weeks.

### Watch list

1. **Rate-limit hits.** `AUTHOR_HOUR_LIMIT = 3` per author channel ID
   per hour. If a single YT listener spams `@lena play X` more than
   3×/hr their later asks drop silently — they keep seeing their
   chat message land but Lena never reacts. Watch
   `journalctl --user -u numa-queue-daemon -f | grep yt-chat` for
   patterns where the same `<channel-id-suffix>` shows + then goes
   quiet. If real listeners hit this, raise the limit or surface a
   one-time "all yours for the next hour" reply.
2. **same_artist_too_soon declines.** Listener asks for track by
   currently-playing artist → Phase 5b declines with "Same artist's
   already playing — we'll get back to them." Watch
   `journalctl --user -u numa-queue-daemon | grep same_artist` for
   decline rate. If it's a meaningful fraction of all requests,
   consider relaxing to "queue this after the current track ends"
   instead of declining.
3. **Decline-rate by reason.** `lib/lena-producer-chat/writers/decline-request.ts`
   has 5 reasons (`not_in_catalog` / `recently_aired` /
   `wrong_show_block` / `same_artist_too_soon` / `queue_full`).
   Grep for `[lena-request] mode=decline_request` in Vercel logs to
   spot if any reason dominates — `not_in_catalog` dominating would
   mean the website also needs the request surface (parked above) +
   listener-facing autocomplete.

### When this is done

Remove the entry from this file once Phase 5b has 2+ weeks of clean
prod observation and the above are tuned (or confirmed irrelevant).

---

## numaradio-suno: random voice-accent variation on track generation

**Status:** parked 2026-05-16. Lives in the separate numaradio-suno
repo (Suno is NOT in numaradio — Marku curates/accepts before
tracks reach catalog).

**Resume trigger:** next batch session on numaradio-suno when
generating new tracks. Decide before the next ~20-track batch so
the accent variation propagates evenly.

### What to build

When generating tracks via Suno, randomly assign a voice accent
hint (American / British / Texan / Australian / etc.) so the
catalog doesn't end up sounding like a single regional voice. Suno
accepts accent / dialect cues in the prompt style block.

### Why

Right now the catalog skews towards a single accent (likely
American-default since Suno's training distribution biases there).
Listeners hear the same vocal register across tracks → station
identity feels flatter than it could. Random accent assignment
broadens the catalog's voice palette without listener-side effort.

### Notes

- Implementation lives in numaradio-suno, NOT here. Per memory
  `project_numa_suno_separation`.
- Marku still curates each output before acceptance, so a bad
  accent → genre fit doesn't auto-leak to listeners. Worst case is
  ~10s of wasted Suno generation.
- Consider biasing the distribution — e.g., 50% American, 25%
  British, 15% Australian, 10% other — rather than uniform random,
  to keep the station identity coherent.
- Per-genre overrides may make sense (e.g., Country / Americana →
  Southern US accent; Grime / UK Drill → British; etc.).

### When this is done

Remove the entry from this file.
