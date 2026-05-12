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

