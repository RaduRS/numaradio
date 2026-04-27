# Music Submissions — Design Spec

**Status:** Approved 2026-04-27. Implementation pending.
**Owner:** marku
**Repo:** `numaradio`

## Problem

Today the `/submit` page tells artists to email `hello@numaradio.com` with a track. There's no form, no rate limit, no audit trail, and no operator workflow — the operator has to manually save the file, run an ingest script, and remember to reply. As submissions grow that doesn't scale, and there's no liability protection.

We want a public form that takes name + email + MP3 (+ optional artwork), validates the upload, stores it for review, surfaces it in the operator dashboard with approve/reject controls, and ingests approved tracks through the same frame-accurate `lib/ingest` path the seed uses. Plus a privacy update for the legal posture.

## Goals

- Replace the email-only CTA on `/submit` with a real in-page submission form.
- Capture: artist name, email, MP3, optional artwork, airing preference (one-off / permanent), mandatory vouch checkbox.
- Persist submissions in a new `MusicSubmission` Postgres table; store audio + artwork in B2 under a `submissions/` prefix.
- Operator surface on `/shoutouts` (right rail) with inline preview, approve, reject (with reason).
- On approve: route through existing `lib/ingest.ingestTrack()` so the track gets the same frame-accurate duration probe the seed uses, and the artwork cascade (uploaded → ID3 → generated) attaches whichever cover wins.
- Update privacy page with a "Submitting music" section covering hold-harmless, removal process, and data retention.
- Drop the misleading "320kbps" copy (we stream at 192).

## Non-goals (deferred or explicitly out)

- **Email notifications** on accept/reject — built later. Operator handles correspondence manually for now.
- **Self-service withdraw form** — manual email to `hello@numaradio.com` is the channel.
- **Magic-link confirmation** to verify email — not built.
- **Captcha or IP rate-limit** beyond pending-per-email — `ipHash` recorded for forensics only.
- **Duplicate-detection** (same file resubmitted) — not worth the cost at current volume.
- **Promote from one-off → permanent later** — not exposed to the artist; once approved the lane is set. Operator can still flip `airingPolicy` manually in the dashboard if needed.

## Architecture

```
PUBLIC                    SERVER                            OPERATOR
──────                    ──────                            ────────
/submit form ──POST──►  /api/submissions ──┬──► B2: submissions/<id>.mp3
                        (multipart/form    ├──► B2: submissions/<id>.<ext>  (artwork, optional)
                         -data)            ├──► Postgres: MusicSubmission row (status=pending)
                                           └──► Returns {ok, id}; UI swaps to confirmation card

                                           ◄──/api/submissions/<id>/approve── /shoutouts panel
                                           ◄──/api/submissions/<id>/reject── + reason
```

## Public form on `/submit`

Replace the existing "Where to send it / hello@numaradio.com / Email now" card with a real form. Surrounding sections (the "01 — What we need" checklist, "02 — Three steps. One reply.", "03 — Short list we stick to.") all stay; copy fixes in §11.

### Fields

| Field | Type | Required | Constraints |
|---|---|---|---|
| Your name | text | yes | 2–80 chars, trimmed; used as `artistDisplay` on air |
| Email | email | yes | RFC-style validation; lowercased + trimmed before persist |
| MP3 file | file | yes | `audio/mpeg`, ≤10 MB, magic-byte verified |
| Album art | file | no | `image/png` or `image/jpeg`, ≤2 MB, magic-byte verified |
| Airing preference | radio | yes (default = one-off) | `one_off` or `permanent` |
| Vouch checkbox | bool | yes | must be true to submit |

### UX

- Field-level validation: red ring + inline error, same chrome as the booth shoutout/song forms.
- Submit button disabled until name + email + file + checkbox are valid.
- Tooltips on the airing-preference radios:
  - One-off airing — "We air this once. After that it's not in rotation."
  - Permanent rotation — "We add this to our regular library. Plays on rotation indefinitely."
- Vouch checkbox label:
  > "I confirm this is my own work or I have all rights to it, and I'm authorising Numa Radio to broadcast it. I understand I can withdraw it any time by emailing hello@numaradio.com. I've read the [terms](/privacy#submissions)."
- After successful submit: replace form with confirmation card ("Got it. Lena will listen and you'll hear back at <email>.") — same pattern as the booth song "pending" card.
- A small fallback line below the form: "Or email hello@numaradio.com if you'd rather not use the form." Keeps the door open for artists who prefer email.

## API route

`POST /api/submissions` — `multipart/form-data`.

### Validation order (fail-fast)

1. Parse multipart; reject if any required field missing → 400.
2. Trim/lowercase email; validate shape → 400 on bad shape.
3. **Per-email pending-rate-limit:** `MusicSubmission.findFirst({ where: { email, status: "pending" } })`. If found → 429 with `{ error: "pending_exists", message: "You've already got a submission pending. We'll respond before you can send another." }`.
4. Field length checks (name 2–80; vouched=true; airingPreference in enum).
5. MP3 size ≤10 MB → 413 if oversize.
6. MP3 magic bytes: first 3 bytes `ID3` (tagged) OR first 2 bytes `0xFF 0xFB` / `0xFF 0xF3` (raw MPEG audio frame). Reject anything else → 400 `bad_mp3`.
7. Artwork (if present): size ≤2 MB; magic bytes PNG (`89 50 4E 47`) or JPEG (`FF D8 FF`). Reject otherwise → 400 `bad_artwork`.
8. Probe duration via `lib/probe-duration.probeDurationSeconds` (frame-accurate). Same call the seed uses.

### Persist

1. Generate `id` (cuid).
2. Upload audio buffer to B2 at `submissions/<id>.mp3`.
3. Upload artwork (if present) to B2 at `submissions/<id>.<png|jpg>`.
4. Insert `MusicSubmission` row with status = `pending`, `audioB2Key`, `artworkB2Key` (nullable), `durationSeconds`, `vouched=true`, `ipHash`.
5. Return `{ ok: true, id }`.

### Errors

- All validation failures return JSON `{ error: "<code>", message: "<human>" }` with appropriate status codes.
- Multipart parse errors → 400 `bad_form`.
- B2 upload errors → 502 `storage_failed`.
- DB errors → 500 `db_failed`.

## Data model — new Prisma table

```prisma
enum SubmissionStatus {
  pending
  approved
  rejected
  withdrawn   // operator action when artist emails to pull
}

enum SubmissionAiringPreference {
  one_off
  permanent
}

model MusicSubmission {
  id               String                       @id @default(cuid())
  stationId        String
  artistName       String
  email            String                       // lowercased + trimmed on insert
  ipHash           String                       // forensics only, never displayed
  audioB2Key       String                       // submissions/<id>.mp3
  artworkB2Key     String?                      // submissions/<id>.<ext>
  artworkSource    String?                      // "upload" | "id3" | "generated", set on approve
  durationSeconds  Int?
  airingPreference SubmissionAiringPreference   @default(one_off)
  status           SubmissionStatus             @default(pending)
  vouched          Boolean
  rejectReason     String?
  trackId          String?                      // FK to Track, populated on approve
  createdAt        DateTime                     @default(now())
  reviewedAt       DateTime?
  reviewedBy       String?                      // CF Access email of operator

  station Station @relation(fields: [stationId], references: [id])
  track   Track?  @relation(fields: [trackId], references: [id])

  @@index([status, createdAt])
  @@index([email, status])
}
```

Migration is additive only — no existing tables touched.

## B2 storage layout

- **Submissions (pending / awaiting review):** `submissions/<id>.mp3`, `submissions/<id>.<png|jpg>`
- **On approve:** `lib/ingest.ingestTrack()` writes to the production paths it already uses (`tracks/<trackId>/audio/...`, `tracks/<trackId>/artwork/...`). The `submissions/<id>.*` originals are **deleted** after the ingest succeeds (cost saver).
- **On reject:** both files deleted immediately. DB row kept (with `rejectReason`) for audit.

## Artwork cascade (on approve)

Order — first hit wins:

1. Submitter uploaded an image → use `submissions/<id>.<ext>`. `artworkSource = "upload"`.
2. MP3's embedded ID3 cover (extract via `music-metadata`'s `common.picture[0]`) → use that. `artworkSource = "id3"`.
3. Generate one with the existing Flux/MiniMax pipeline used for listener-generated songs (`workers/song-worker/...`). `artworkSource = "generated"`.

`artworkSource` is recorded on the `MusicSubmission` row for ops triage.

## Dashboard panel — `/shoutouts`

New section in the existing right-rail area, below "Auto-chatter & announcement activity".

### Layout

- Section header: "Music submissions" + count chip "N pending · M reviewed".
- Pending list (newest first):
  - Artist name + email (small, dimmed)
  - "Submitted X min/hr ago"
  - Tag chip: "One-off" or "Permanent" (matches their preference)
  - Inline `<audio controls preload="none">` pointing at a server-proxied URL (so we don't expose the raw B2 URL of pending content)
  - Buttons:
    - **Approve** (green) → `POST /api/submissions/<id>/approve`
    - **Reject** (red) → expands an inline `<textarea>` for reason (required, ≥3 chars) → `POST /api/submissions/<id>/reject` with `{ reason }`
- Collapsible "Recently reviewed (last 10)" with status badges (approved/rejected/withdrawn) for context and undo lookups (no actual undo built — just visibility).

### Auth

All operator endpoints (`/api/submissions/<id>/approve`, `/reject`) sit under the dashboard's existing CF-Access-protected `/api/internal/...` pattern (or the dashboard's own auth — match what the existing approve flow uses).

## Approval workflow (server-side on approve)

1. Validate submission status === `pending`. Reject → 409 if not.
2. Determine `airingPolicy` from `airingPreference`:
   - `one_off` → `airingPolicy = "priority_request"` (matches existing listener-generated-song pattern: airs once via priority queue, auto-demoted to `request_only` after).
   - `permanent` → `airingPolicy = "library"`.
3. Resolve artwork (cascade §6); upload to B2 production path or pass through generated-artwork pipeline.
4. Call `lib/ingest.ingestTrack({ ... })` — reuses the music-metadata probe, creates `Track` + `TrackAsset` rows, uploads audio to production B2 paths.
5. Update `MusicSubmission` row: `status = "approved"`, `trackId = newTrack.id`, `reviewedAt = now`, `reviewedBy = <operator email>`, `artworkSource = <source>`.
6. Delete original `submissions/<id>.*` from B2.
7. Return `{ ok: true, trackId }`.

## Rejection workflow

1. Validate submission status === `pending`. Reject → 409 if not.
2. Validate reason is non-empty + ≤500 chars.
3. Update `MusicSubmission` row: `status = "rejected"`, `rejectReason`, `reviewedAt`, `reviewedBy`.
4. Delete `submissions/<id>.*` from B2.
5. Return `{ ok: true }`.

## Privacy page update

Add a new section at the bottom of `app/privacy/page.tsx` with id `#submissions`:

> ### Submitting music
>
> When you upload a track to Numa Radio you confirm:
> - The recording and the composition are your work, or you have all rights to broadcast them.
> - You authorise Numa Radio to air the track on its 24/7 stream.
> - You can request removal at any time by emailing hello@numaradio.com — we'll pull it from rotation within 24 hours.
> - You're solely responsible for the rights status of what you submit. Numa Radio is not liable for disputes arising from material you upload that turns out not to be yours to share.
>
> We store the audio file, your name, and your email only. The audio is removed from our submission storage on approval (it moves into the broadcast catalog) or on rejection (deleted). Email and name are kept on the submission record so we can reach you.

The vouch checkbox label on the form deep-links to this section via `/privacy#submissions`.

## Copy fixes on `/submit`

In `app/submit/page.tsx`:

- Drop the bitrate number entirely. The current `CHECKLIST[0]` text "WAV or 320kbps MP3. Attached or on Dropbox / Drive / WeTransfer — not a streaming link." becomes:
  > "MP3 file (we'll handle the rest). Upload directly through the form below."
- Remove the "Where to send it / hello@…" inline card and the `EmailCta` button — replaced by the new form. Keep one small fallback link at the bottom of the form ("Or email hello@numaradio.com if you'd rather not use the form").

## Existing patterns this design reuses

- **Validation chrome:** booth shoutout / song form (red ring + inline error).
- **Confirmation card:** booth song "pending" card.
- **Frame-accurate probe:** `lib/probe-duration.probeDurationSeconds` (used by `scripts/ingest-seed` and `workers/song-worker`).
- **Ingest:** `lib/ingest.ingestTrack` (used by seed and song-worker).
- **Artwork generation:** existing Flux/MiniMax pipeline in `workers/song-worker`.
- **Dashboard panel layout / auth:** existing `/shoutouts` page.

## Open risks / things to watch

- **Magic-byte sniffing for MP3** — files with weird leading silence or non-standard headers may fail the check. Edge case; we can loosen if it bites.
- **B2 upload latency on large files** — at 10 MB max, expect 1–3 s per upload. The form's Submit button needs a clear loading state to avoid double-submit.
- **Artist with same email submits two different tracks** — the rate limit blocks them. Acceptable. They get a clear message to wait for our reply.
- **Magic-byte of artwork might fail for valid JPEGs with EXIF prefix** — extend allowed prefix list if it bites.
- **CF Access email parsing on the operator endpoints** — confirm the existing dashboard uses `cf-access-authenticated-user-email` header or similar, and reuse that.

## Plan

After this spec is approved, hand off to `superpowers:writing-plans` for the step-by-step implementation plan. Expected build sequence (rough):

1. Schema + migration
2. API route (POST /api/submissions) + validation + B2 helpers
3. Form on /submit
4. Dashboard panel + approve/reject endpoints
5. Privacy page section + /submit copy fixes
6. End-to-end smoke test through Playwright
7. Commit + push (per workflow rule)
