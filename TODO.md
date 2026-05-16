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
