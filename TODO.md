# Numa Radio — parked work

Tasks paused mid-decision. Each entry is self-contained — pick up cold,
read the **resume trigger** at the top, run the plan.

---

## Lena Producer — Phases 2 through 6

**Status:** parked 2026-05-16. Phase 1 (ShiftMemory foundation) shipped
in 23 commits on `main` — see `docs/HANDOFF.md` 2026-05-16 entry for
the deploy steps.
**Resume trigger:** anytime after Phase 1 is deployed and observed
healthy for a few days. Each phase is independently shippable behind
its own flag.

### Reference docs (load these first)

- **Spec (full architecture, all phases):** `docs/superpowers/specs/2026-05-16-lena-producer-design.md`
- **Phase 1 plan (completed, reference for code conventions used):** `docs/superpowers/plans/2026-05-16-lena-producer-phase-1.md`
- **HANDOFF.md 2026-05-16 entry:** deploy steps + Neon-pooler caveat + the two schema findings (Track.key absent, Shoutout.requesterName not handle)

### Phase ladder (build in this order)

| Phase | Flag | Approx size | What it ships |
|---|---|---|---|
| **2** | `LENA_PRODUCER_AUTO=on` | ~25-30 tasks | Producer + Writer for `auto_track_boundary` only. First time Lena's spoken output actually changes. New code in `workers/queue-daemon/lena-producer/`: `producer.ts`, `producer-prompt.ts`, `producer-context.ts`, `writer.ts`, `writers/{opinion,callback,aside,...}.ts`, `modes.ts`. Replaces inline prompts in `workers/queue-daemon/auto-host.ts` (lines ~407-570). |
| **2.5** | `LENA_CLASSIFIER_REQUEST=on` | ~8 tasks | Extend `lib/classify-shoutout-intent.ts` from tri-state to 5-state (adds `request` + `shoutout_with_request`). Inert until Phases 3/5 consume. |
| **3** | `LENA_PRODUCER_REPLY=on` | ~10 tasks | Route YouTube `@lena` reply path (`lib/lena-reply.ts`) through Producer. Depends on Phase 2 shipping the Producer surface. |
| **4** | `LENA_PRODUCER_SHOUTOUT=on` | ~12 tasks | Route shoutout narration (`dashboard/lib/humanize.ts`) through Producer. **Includes the two known fixes:** scrub "let it ride" / "we'll take that one" examples from humanize.ts ~line 130, and fix the `,.` regex bug in `dashboard/lib/radio-host.ts` (existing regex catches `.,` not `,.` — add `[,;]\./g`). |
| **5** | `LENA_QUEUE_AUTONOMY=on` | ~20-25 tasks | QueueDirector module. New modes: `queue_pick`, `accept_request`, `accept_request_deferred`, `decline_request` with phrasebook by reason. Inserts into `priority_request` band via existing `createQueueItemAtomically` (`workers/queue-daemon/index.ts:382-401`). Needs `lib/show-genre-fit.ts` helper (doesn't exist yet — must build). |
| **6** | none — pure cleanup | ~5 tasks | Delete deprecated paths: `workers/queue-daemon/chatter-prompts.ts`, `workers/queue-daemon/context-line.ts`, old `lib/lena-reply.ts` prompt, old `dashboard/lib/humanize.ts` rewrite. Only after Phases 2-4 have been on for a few days with no fallback fires. |

### Operating principles to remember

- Each phase = one plan file at `docs/superpowers/plans/YYYY-MM-DD-lena-producer-phase-N.md`
- Each phase ships independently behind its own flag, can be rolled back by unsetting the flag
- Lena's behavior is unchanged until Phase 2 flag is flipped on
- `mode=silence` is ONLY valid for `auto_track_boundary` triggers — direct `@lena` mentions ALWAYS get a spoken response (see memory `feedback_lena_never_ignores_direct_mention.md`)
- Suno is NOT in this codebase — `decline_request` for any catalog miss (see memory `project_numa_suno_separation.md`)
- Generated music always takes priority — `priority_request` only interleaves between scheduled tracks
- autoChatter ON = Lena is fully alive (no per-action quotas, qualitative guardrails only)

### Resume recipe

1. Check that Phase 1 is deployed and `journalctl | grep lena-shift-memory` shows `notify healthy`
2. Read the spec (~450 lines) to refresh context
3. Skim Phase 1 plan for code patterns (file structure, TDD style, commit message template)
4. Write Phase 2 plan: `superpowers:writing-plans` skill, output to `docs/superpowers/plans/YYYY-MM-DD-lena-producer-phase-2.md`
5. Execute: `superpowers:subagent-driven-development` skill

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

## Lena Producer Phase 5b — Listener song requests

**Status:** parked 2026-05-16. Phase 5 MVP (daemon-side queue_pick) is
shipped locally; Phase 5b extends the queue-autonomy story to listener
requests via YouTube `@lena play X` messages.

**Why it's not in Phase 5 MVP:** the listener-request dispatch route
runs on Vercel (`app/api/internal/youtube-chat-shoutout/route.ts`),
but the queue insert (`createQueueItemAtomically`) runs in the daemon.
Cross-process queue insert requires either:
1. A new HTTP endpoint on the daemon (exposed via cloudflared) that
   Vercel POSTs to with the desired trackId + reason. Daemon validates
   via QueueDirector + inserts.
2. Vercel-side QueueDirector that writes directly to `QueueItem` via
   Prisma — but needs careful pg_advisory_xact_lock coordination with
   the daemon's createQueueItemAtomically. Risky.

**Recommended approach:** option 1 (HTTP endpoint on daemon). The
daemon already has an HTTP server on loopback :4000; expose
`POST /lena-queue-action` via cloudflared at `api.numaradio.com/...`
with the existing `INTERNAL_API_SECRET` auth.

**What ships in 5b:**
- New `POST /lena-queue-action` on daemon HTTP server
- Cloudflared route for it
- Vercel-side classifier + Producer-lite for chat request intents
  (`request` + `shoutout_with_request`) — extend `lib/lena-producer-chat/`
  with new modes: `accept_request`, `accept_request_deferred`, `decline_request`
- Catalog candidate lookup on Vercel side (Prisma fuzzy match on Track
  title/artist against listener's request text)
- Dispatch route gates request-intent handling behind `LENA_REQUEST_AUTONOMY`
- Lena's reply line is consistent with what's queued ("Pulling Aphex up
  for you, Anna — coming after this one")

**Estimated size:** ~12-15 tasks. Bigger than Phase 5 MVP because of the
cross-process plumbing + auth + Vercel-side catalog lookup.

**When to ship:** after Phase 5 MVP has been live + observed for a few
days. Verify the QueueDirector guardrails work as expected before adding
listener-driven queue inserts on top.

---

