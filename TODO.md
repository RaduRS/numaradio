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

## Loudness normalisation across the catalogue

**Status:** parked 2026-05-05 (operator idea, not yet decided in detail).
**Resume trigger:** any time the operator A/B's two consecutive tracks
on stream and notices a meaningful jump in perceived volume — that's
the cue to ship this. Not blocking anything else.

### Background

Numa's catalogue is a blend of three audio sources, each with its own
loudness baseline:

- **Suno-generated** tracks (Russell Ross etc., `sourceType=suno_manual`)
  — generally hot, modern-master loudness around -8 to -10 LUFS.
- **MiniMax-generated** tracks (listener-prompted requests,
  `sourceType=minimax_request`) — variable, often -12 to -14 LUFS.
- **Submitter artist tracks** (`sourceType=external_import`) — all over
  the map. Indie home-mastered tracks can be anywhere from -6 (clipping)
  to -20 LUFS.

That spread means a listener tuning in and getting a Suno banger
followed by a quietly-mastered indie submission has to reach for the
volume knob. Bad listener experience, especially on car / phone
speakers where the dynamic range fights the cabin noise.

The operator's instinct was right: normalise everything to a single
target — somewhere around **-14 LUFS** (the de-facto streaming
standard, matches Spotify / YouTube / TikTok loudness algorithms).
Could equally be -16 LUFS (Apple Music) or anywhere in that band.
Pick one and apply consistently.

### Two reasonable architectures

**A. Normalise once at ingest time** (recommended for first cut).
- After the audio lands in B2 but before the Track row goes live,
  run ffmpeg `loudnorm` filter (two-pass: measure then correct) and
  re-upload the normalised version. Track row stores the original
  measured I / TP / LRA in `provenanceJson` for audit.
- Pros: zero broadcast-time CPU, deterministic, debuggable per
  track. Listener-side hardware identical to today.
- Cons: re-upload doubles the B2 write, and the original master is
  lost (unless we keep it in a separate B2 prefix). Existing
  catalogue (~130 tracks) needs a one-shot backfill script.

**B. Normalise live in Liquidsoap.**
- Add `normalize` / `compress` operators to `liquidsoap/numa.liq`.
  Liquidsoap can read ReplayGain tags and apply on the fly.
- Pros: no re-encode, original masters preserved, easy to tweak the
  target by editing one config line.
- Cons: per-track CPU on Orion, can't get the same accuracy as a
  proper two-pass loudnorm without pre-tagging anyway, and
  ReplayGain tags would need to be written somewhere upstream.

**Likely best path:** A for the heavy lift (one-shot ingest +
backfill), B as a safety net (Liquidsoap normalize as a -3 dB ceiling
limiter so any outliers we missed don't blow the broadcast).

### Files to touch (rough)

- `workers/song-worker/pipeline.ts` — wedge a `loudnormalise()` step
  between B2 upload and Track row creation. Reuse the
  `lib/sanitize-mp3-audio-only.ts` ffmpeg-spawn pattern.
- New `lib/loudnorm.ts` — the ffmpeg invocation + parser for the
  two-pass output (first pass returns measured loudness as JSON,
  second pass applies the correction with measured numbers fed back
  in).
- `prisma/schema.prisma` — add `Track.loudnessLufs` (Float?) and
  `Track.loudnessTruePeakDbtp` (Float?) so the operator dashboard can
  show outliers. Additive migration, low risk.
- New `scripts/backfill-track-loudness.ts` — pulls every Track,
  downloads the audio, runs loudnorm, re-uploads, updates the row.
  Dry-run by default; `--apply` writes. Will rewrite ~130 B2 objects
  (~$0.05 of class B writes, no real cost). Run during off-peak
  with `nice` to stay clear of broadcast.
- `liquidsoap/numa.liq` — optional safety-net limiter
  (`normalize(target=-14.0)` or similar) at the master output.

### Open questions

- **What target?** -14 LUFS is the streaming default, fits TikTok /
  YouTube / Spotify. -16 LUFS preserves more headroom (Apple Music
  default) and sounds cleaner on quality speakers. Pick one and
  document it; don't change it later (re-running backfill is
  cheap but listener-perceived re-mastering is jarring).
- **Per-show variance?** Some operators target slightly higher LUFS
  for daytime shows, lower for late-night. Probably overkill for
  Numa's first pass — single target is fine.
- **Submitter-track handling.** If we re-encode an indie artist's
  track for loudness, do we tag the new copy as the "broadcast
  master" and keep their original on the side? Yes — separate B2
  prefix (`tracks-original/`) so an artist asking for their original
  back has a clean answer.
- **YouTube simulcast.** Numa's YouTube broadcast is a screen capture
  of the player, so Loudness ends up wherever the encoder's master
  bus sits. May want to apply a small ducker at the encoder level
  too.

### When this is done

Update or delete this section. Worth posting a one-liner in
`docs/HANDOFF.md` once shipped: "Catalogue normalised to -X LUFS via
loudnorm at ingest, with a Liquidsoap safety limiter".

---
