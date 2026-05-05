# Numa Radio — parked work

Tasks paused mid-decision. Each entry is self-contained — pick up cold,
read the **resume trigger** at the top, run the plan.

---

## Send terms-update notice email to approved artists

**Status:** parked 2026-05-05.
**Resume trigger:** when the v2 social-batch videos start going live on
TikTok / Instagram Reels / YouTube Shorts / X. (Today they're rendered
in `~/saas/numaradio-videos/out/social-v2/` but not yet posted.)
**Don't send until:** posts are imminent or already up. Sending the
notice before posting anything just confuses recipients.

### Background

The 2026-05-05 v2 social batch added 10 short-form videos that may
include real listener shoutouts + promotional uses of accepted-artist
tracks. The station's submitter consent text was updated the same day
(`app/_components/SubmitForm.tsx` + `app/privacy/page.tsx`, commits
`ccd2ec9` + `55063ec`) so:

- Form vouch checkbox now also authorises "promotional clips on its
  social media" (kept generic so adding platforms later doesn't need
  re-consent).
- Privacy page lists the four current accounts: TikTok, Instagram
  Reels, YouTube Shorts, X (Twitter). No length constraint stated.

Existing approved artists submitted under the OLD terms. Best
practice — match what most labels and platforms do — is to send one
courtesy notice email summarising the change with a clear opt-out path.
Future submitters tick the new checkbox at submission time and need no
follow-up.

### Decision

One blanket email to every approved artist (~33 unique recipients,
verify count at send time). Single round of effort, covers everyone
including future video features, no per-feature DM cycles.

The featured-in-v2 senders (Glitchd84, Barely Jared, SlimIsChillin,
Digital Culprit) are subsets of the approved-artist list — one email
covers them too. No separate per-sender notice needed.

For pure listener-shoutout senders without email on file (Justin King,
RT in the v2 videos): the updated `/privacy` page governs forward-
looking shoutouts. Existing two v2 videos with their nicknames are low
risk per operator review (Justin King = nickname, RT = initials only).

### Email template

```
Subject: Numa Radio — small terms update

Hi [first name],

One small update on our submission terms. The full version is at
numaradio.com/privacy — here's the plain-English bit that changed:

Before: we could broadcast your track on the 24/7 audio stream
        and the YouTube Live simulcast.

Added:  we can also use it in promotional clips on our social
        media (TikTok, Instagram Reels, YouTube Shorts, X). Your
        artist name and track title may appear on screen.

Why we're telling you: we've started posting these clips this
week to promote the station, and we want you to hear it from us.

If you'd rather we don't include your tracks in those posts, just
reply to this email and we'll pull anything related within 24
hours — no problem at all.

Thanks for being on Numa.

— Numa Radio
hello@numaradio.com  ·  numaradio.com
```

**Sign-off rule:** every Numa Radio email is signed `— Numa Radio`,
never the operator's first name. The existing approval / rejection
templates in `lib/email/` already follow this; new templates must too.

`[first name]` is the artistName on the MusicSubmission. Some are
project names ("Digital Culprit", "Music Moon") rather than real
first names — those work fine literally; the recipient still
recognises themselves.

### Implementation plan

1. **Email template** — `lib/email/terms-update.ts`. Mirror the
   shape of `lib/email/submission-approved.ts` /
   `submission-rejected.ts` (already wired to Resend, already in
   production). Subject + plain-text body + HTML body that renders
   the same content with brand styling.

2. **One-shot send script** — `scripts/send-terms-update.ts`:
   - Pull unique approved-artist emails from MusicSubmission
     (`status = "approved"`, dedupe on `email`).
   - Skip any already-notified rows by checking SystemEvent for
     `eventType = "terms_update_notice_sent"` with matching
     payload key. Idempotent on re-run.
   - Send via Resend (use the existing `client` from
     `lib/email/client.ts` — From/Reply-To both
     `hello@numaradio.com`).
   - Log `[ok] <email> · <artistName>` or `[fail] <email> ·
     <reason>` per recipient.
   - On finish, write a single SystemEvent audit row recording
     {totalSent, totalFailed, sentAt, recipients[]} so a re-run
     can dedupe and the operator has a paper trail.

3. **Verify before send.** Run with `--dry-run` first; print the
   recipient list (count + emails + names) for sanity check.
   Operator types `--apply` (or removes the dry-run flag) to
   actually send.

4. **Watch the inbox.** Reply-To is `hello@numaradio.com`; any
   "please pull mine" replies need a same-day pull. The 24-hour
   commitment in the email body is load-bearing.

### Recipient lookup query (run at resume time to confirm count)

```ts
import "../lib/load-env.ts";
import { prisma } from "../lib/db/index.ts";

const rows = await prisma.musicSubmission.findMany({
  where: { status: "approved" },
  select: { artistName: true, email: true },
});
const unique = new Map<string, string>();
for (const r of rows) {
  if (!unique.has(r.email)) unique.set(r.email, r.artistName);
}
console.log(`unique approved artists: ${unique.size}`);
for (const [email, name] of unique) console.log(`  ${name} <${email}>`);
```

(At parking time the count was 33, verified via
`scripts/.tmp-find-shoutout-senders.ts` lookup. May have grown by
resume time.)

### Open questions / things to decide at resume

- **Single send or rolling?** If artists are still submitting daily
  and getting approved before the email goes out, do we send to
  everyone-as-of-send-time or just the cohort that submitted under
  old terms? Cleanest: send to everyone-as-of-send-time. Future
  submitters auto-consent via the new checkbox, but a courtesy
  notice doesn't hurt and is simpler than gating on submission
  date.

- **Testing.** Send a test to `rsrusu90@gmail.com` (operator) first
  before triggering the full batch. The script should support a
  `--to <email>` flag for that.

- **Resend rate limits.** ~33 emails fits comfortably under
  Resend's free tier per-day limit. No batching needed.

### Files we'd touch at resume

- New: `lib/email/terms-update.ts`
- New: `scripts/send-terms-update.ts`
- Maybe: small index addition to `MusicSubmission` if we want
  notification dedupe at the row level instead of via SystemEvent.
  Probably not — SystemEvent is the right place.

### When this is done

Update this section to "Sent YYYY-MM-DD · N recipients · M opt-outs"
or remove the entry from this file entirely.

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
