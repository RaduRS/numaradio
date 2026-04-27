# Music Submissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a public music submission form on `/submit` (name + email + MP3 + optional artwork + airing preference + vouch checkbox), with operator approve/reject in the dashboard, ingesting approved tracks through the same frame-accurate path the seed uses.

**Architecture:** Three surfaces — public form on `numaradio.com/submit`, server API at `numaradio.com/api/submissions`, operator panel on `dashboard.numaradio.com/shoutouts`. New `MusicSubmission` Postgres table (additive migration). New B2 prefix `submissions/` for pending audio + artwork. On approve, the existing `lib/ingest.ingestTrack` (extended with optional `airingPolicy`) writes the track to production paths and the submission's B2 originals are deleted.

**Tech Stack:** Next.js 15 App Router, Prisma 6 / Neon Postgres, Backblaze B2 via AWS S3 SDK, `music-metadata` for ID3 + duration probing, node:test for shared-lib unit tests, Tailwind v4 for styling.

**Spec:** `docs/superpowers/specs/2026-04-27-music-submissions-design.md`

---

## File Map

**New files (numaradio repo root):**
- `lib/submissions.ts` — magic-byte sniffing, multipart parsing helpers, validation, B2 path helpers
- `lib/submissions.test.ts`
- `lib/extract-id3-artwork.ts` — pulls embedded `APIC` cover from an MP3 buffer using `music-metadata`
- `lib/extract-id3-artwork.test.ts`
- `app/api/submissions/route.ts` — `POST` handler for new submissions
- `app/api/submissions/[id]/audio/route.ts` — server-proxied audio so the dashboard can preview a pending submission without exposing the raw B2 URL
- `app/_components/SubmitForm.tsx` — client form component
- `prisma/migrations/<TIMESTAMP>_add_music_submissions/migration.sql` — schema migration

**New files (dashboard):**
- `dashboard/app/api/submissions/list/route.ts` — list pending + last-10 reviewed
- `dashboard/app/api/submissions/[id]/approve/route.ts` — approve handler
- `dashboard/app/api/submissions/[id]/reject/route.ts` — reject handler
- `dashboard/app/shoutouts/SubmissionsPanel.tsx` — operator UI panel

**Modified files:**
- `prisma/schema.prisma` — add `SubmissionStatus`, `SubmissionAiringPreference` enums + `MusicSubmission` model + `MusicSubmission[]` relation on `Station` and `Track`
- `lib/ingest.ts` — add optional `airingPolicy` to `IngestInput`; hardcoded `"library"` becomes `input.airingPolicy ?? "library"`
- `app/submit/page.tsx` — replace the email-CTA block with `<SubmitForm />`; drop the bitrate copy
- `app/privacy/page.tsx` — add a `#submissions` section with the legal language
- `dashboard/app/shoutouts/page.tsx` — embed `<SubmissionsPanel />` in the right rail

---

## Task 1: Schema migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<TIMESTAMP>_add_music_submissions/migration.sql` (generated)

- [ ] **Step 1: Add enums + model to `prisma/schema.prisma`**

Append to the enum section (after the existing `WorkflowStatus` enum, around line 153):

```prisma
enum SubmissionStatus {
  pending
  approved
  rejected
  withdrawn
}

enum SubmissionAiringPreference {
  one_off
  permanent
}
```

Append to the model section (after the existing `SongRequest` model, end of file):

```prisma
model MusicSubmission {
  id               String                       @id @default(cuid())
  stationId        String
  artistName       String
  email            String
  ipHash           String
  audioStorageKey       String
  artworkStorageKey     String?
  artworkSource    String?
  durationSeconds  Int?
  airingPreference SubmissionAiringPreference   @default(one_off)
  status           SubmissionStatus             @default(pending)
  vouched          Boolean                      @default(false)
  rejectReason     String?
  trackId          String?
  createdAt        DateTime                     @default(now())
  reviewedAt       DateTime?
  reviewedBy       String?

  station Station @relation(fields: [stationId], references: [id])
  track   Track?  @relation(fields: [trackId], references: [id])

  @@index([status, createdAt])
  @@index([email, status])
}
```

Add the back-relation field on `Station` (find the existing `Station` model, add inside its body):

```prisma
  musicSubmissions MusicSubmission[]
```

Add the back-relation field on `Track` (find the existing `Track` model, add inside its body):

```prisma
  musicSubmissions MusicSubmission[]
```

- [ ] **Step 2: Generate the migration**

Run: `npx prisma migrate dev --name add_music_submissions --create-only`
Expected: a new directory `prisma/migrations/<TIMESTAMP>_add_music_submissions/` containing `migration.sql`. The `--create-only` keeps it from auto-applying so we can review.

- [ ] **Step 3: Review generated SQL**

Open the generated `migration.sql`. Confirm it:
- Creates the two enums
- Creates the `MusicSubmission` table with the indexes
- Adds `musicSubmissions` foreign keys (back-relations don't write columns, but the FK from `MusicSubmission.stationId` → `Station.id` and `MusicSubmission.trackId` → `Track.id` should exist)

If it looks right, apply: `npx prisma migrate dev --name add_music_submissions` (this re-runs the same migration against your dev DB, but since `--create-only` already wrote the file, this just applies it).

- [ ] **Step 4: Regenerate Prisma client**

Run: `npx prisma generate`
Expected: TypeScript types now include `MusicSubmission`, `SubmissionStatus`, `SubmissionAiringPreference`.

- [ ] **Step 5: Type-check + commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "submissions: add MusicSubmission table + enums

Adds SubmissionStatus and SubmissionAiringPreference enums plus the
MusicSubmission model. Additive only — no existing tables touched.
Backs the new public submission form and the operator approve/reject
flow described in docs/superpowers/specs/2026-04-27-music-submissions-design.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

## Task 2: Validation library + tests

**Files:**
- Create: `lib/submissions.ts`
- Create: `lib/submissions.test.ts`

- [ ] **Step 1: Write failing tests**

Create `lib/submissions.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidEmail,
  isValidName,
  sniffMp3,
  sniffImage,
  audioStorageKey,
  artworkStorageKey,
} from "./submissions.ts";

test("isValidEmail accepts well-formed addresses", () => {
  assert.equal(isValidEmail("a@b.co"), true);
  assert.equal(isValidEmail("first.last+tag@sub.example.com"), true);
});

test("isValidEmail rejects bad shapes", () => {
  assert.equal(isValidEmail(""), false);
  assert.equal(isValidEmail("no-at-sign"), false);
  assert.equal(isValidEmail("@nohost.com"), false);
  assert.equal(isValidEmail("nohost@"), false);
  assert.equal(isValidEmail("a@b"), false);
});

test("isValidName trims and enforces 2..80 chars", () => {
  assert.equal(isValidName("A"), false);
  assert.equal(isValidName("Ab"), true);
  assert.equal(isValidName("  Ab  "), true);
  assert.equal(isValidName("x".repeat(80)), true);
  assert.equal(isValidName("x".repeat(81)), false);
});

test("sniffMp3 accepts ID3-tagged MP3", () => {
  // ID3 header: 'I' 'D' '3' followed by version + flags + size
  const buf = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  assert.equal(sniffMp3(buf), true);
});

test("sniffMp3 accepts raw MPEG audio frames (FF FB / FF F3)", () => {
  assert.equal(sniffMp3(Buffer.from([0xFF, 0xFB, 0x90, 0x00])), true);
  assert.equal(sniffMp3(Buffer.from([0xFF, 0xF3, 0x90, 0x00])), true);
});

test("sniffMp3 rejects non-MP3 bytes", () => {
  assert.equal(sniffMp3(Buffer.from([0x00, 0x00, 0x00])), false);
  assert.equal(sniffMp3(Buffer.from([0x52, 0x49, 0x46, 0x46])), false); // 'RIFF' (WAV)
  assert.equal(sniffMp3(Buffer.from([])), false);
});

test("sniffImage detects PNG", () => {
  const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  assert.equal(sniffImage(png), "png");
});

test("sniffImage detects JPEG", () => {
  const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);
  assert.equal(sniffImage(jpeg), "jpeg");
});

test("sniffImage returns null for unknown bytes", () => {
  assert.equal(sniffImage(Buffer.from([0x00, 0x00])), null);
  assert.equal(sniffImage(Buffer.from([])), null);
});

test("audioStorageKey + artworkStorageKey produce stable paths", () => {
  assert.equal(audioStorageKey("abc123"), "submissions/abc123.mp3");
  assert.equal(artworkStorageKey("abc123", "png"), "submissions/abc123.png");
  assert.equal(artworkStorageKey("abc123", "jpeg"), "submissions/abc123.jpg");
});
```

- [ ] **Step 2: Run tests — expect failure**

Run: `node --test --experimental-strip-types lib/submissions.test.ts`
Expected: FAIL with "Cannot find module './submissions.ts'".

- [ ] **Step 3: Implement `lib/submissions.ts`**

Create `lib/submissions.ts`:

```ts
// Validation + storage helpers shared by the public submission form
// and the operator approve/reject endpoints. Magic-byte sniffing here
// avoids trusting the multipart MIME header from the client.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(s: unknown): boolean {
  return typeof s === "string" && EMAIL_RE.test(s.trim()) && s.trim().length <= 254;
}

export function isValidName(s: unknown): boolean {
  if (typeof s !== "string") return false;
  const t = s.trim();
  return t.length >= 2 && t.length <= 80;
}

export function normalizeEmail(s: string): string {
  return s.trim().toLowerCase();
}

export function normalizeName(s: string): string {
  return s.trim();
}

/**
 * MP3 magic-byte check. Tagged files start with ASCII "ID3"; raw MPEG
 * audio frames start with the 11-bit sync (0xFF followed by 0xFB / 0xF3
 * for MPEG-1/2 Layer III). Anything else gets rejected — we do not
 * trust the multipart MIME header from the browser.
 */
export function sniffMp3(buf: Buffer): boolean {
  if (buf.length < 3) return false;
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return true; // 'ID3'
  if (buf[0] === 0xFF && (buf[1] === 0xFB || buf[1] === 0xF3 || buf[1] === 0xF2)) return true;
  return false;
}

export function sniffImage(buf: Buffer): "png" | "jpeg" | null {
  if (buf.length < 4) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return "png";
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return "jpeg";
  return null;
}

export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;  // 10 MB
export const MAX_ARTWORK_BYTES = 2 * 1024 * 1024; //  2 MB

export function audioStorageKey(submissionId: string): string {
  return `submissions/${submissionId}.mp3`;
}

export function artworkStorageKey(submissionId: string, kind: "png" | "jpeg"): string {
  const ext = kind === "jpeg" ? "jpg" : "png";
  return `submissions/${submissionId}.${ext}`;
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `node --test --experimental-strip-types lib/submissions.test.ts`
Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/submissions.ts lib/submissions.test.ts
git commit -m "submissions: validation helpers (magic-byte sniff, B2 paths, email/name)

Pure helpers used by the public POST handler and the operator approve
endpoint. Magic-byte checks reject non-MP3 / non-PNG-or-JPEG uploads
without trusting the multipart MIME header.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

## Task 3: ID3 artwork extractor

**Files:**
- Create: `lib/extract-id3-artwork.ts`
- Create: `lib/extract-id3-artwork.test.ts`

- [ ] **Step 1: Write failing tests**

Create `lib/extract-id3-artwork.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractId3Artwork } from "./extract-id3-artwork.ts";

test("extractId3Artwork returns null for buffer without artwork", async () => {
  // 10-byte ID3 header, version 3, no APIC frame.
  const buf = Buffer.concat([
    Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
    Buffer.alloc(100, 0),
  ]);
  const result = await extractId3Artwork(buf);
  assert.equal(result, null);
});

test("extractId3Artwork returns null for empty buffer", async () => {
  const result = await extractId3Artwork(Buffer.alloc(0));
  assert.equal(result, null);
});
```

(We don't have a fixture MP3 with an APIC frame in-tree; the positive-path coverage comes from the integration smoke test in Task 13. The unit tests just confirm graceful degradation when no cover is present.)

- [ ] **Step 2: Run tests — expect failure**

Run: `node --test --experimental-strip-types lib/extract-id3-artwork.test.ts`
Expected: FAIL with "Cannot find module './extract-id3-artwork.ts'".

- [ ] **Step 3: Implement `lib/extract-id3-artwork.ts`**

Create `lib/extract-id3-artwork.ts`:

```ts
// Pulls the first embedded cover image from an MP3 buffer. Used as the
// second tier of the artwork cascade (after a separately-uploaded image,
// before falling back to generation).
//
// music-metadata exposes pictures via parseBuffer's `common.picture`.
// We pick the first one — most MP3s only embed one APIC frame anyway.

import { parseBuffer } from "music-metadata";

export type ExtractedArtwork = {
  buffer: Buffer;
  mimeType: string; // e.g. "image/jpeg" or "image/png"
};

export async function extractId3Artwork(audioBuffer: Buffer): Promise<ExtractedArtwork | null> {
  try {
    const meta = await parseBuffer(audioBuffer, undefined, {
      duration: false,
      skipCovers: false,
    });
    const pic = meta.common.picture?.[0];
    if (!pic || !pic.data || pic.data.length === 0) return null;
    return {
      buffer: Buffer.from(pic.data),
      mimeType: pic.format ?? "image/jpeg",
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `node --test --experimental-strip-types lib/extract-id3-artwork.test.ts`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/extract-id3-artwork.ts lib/extract-id3-artwork.test.ts
git commit -m "submissions: extract embedded MP3 artwork via music-metadata

Tier 2 of the artwork cascade for music submissions: if the artist
didn't upload a separate image but their MP3 has an APIC frame
embedded, use it. Falls through to generation only when neither
exists.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

## Task 4: Extend `ingestTrack` to accept `airingPolicy`

**Files:**
- Modify: `lib/ingest.ts`

- [ ] **Step 1: Add optional field to `IngestInput`**

In `lib/ingest.ts`, find the `IngestInput` type (around line 13). Add inside the type:

```ts
  airingPolicy?: "library" | "request_only" | "priority_request" | "hold";
```

- [ ] **Step 2: Use it in the `track.create` call**

Find the `airingPolicy: "library",` line (around line 129). Replace with:

```ts
          airingPolicy: input.airingPolicy ?? "library",
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run existing ingest tests**

Run: `node --test --experimental-strip-types lib/ingest.test.ts`
Expected: all existing tests still pass (the change is additive — default behaviour is unchanged).

- [ ] **Step 5: Commit**

```bash
git add lib/ingest.ts
git commit -m "ingest: optional airingPolicy on IngestInput (defaults to library)

Lets the music-submissions approval flow ingest a track as
priority_request when the submitter picked one-off, while keeping the
existing library default for the seed and song-worker callers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

## Task 5: Privacy page `#submissions` section

**Files:**
- Modify: `app/privacy/page.tsx`

- [ ] **Step 1: Read the current privacy page**

Run: `cat app/privacy/page.tsx | head -60`
Expected: confirm structure (likely a Nav + content sections + Footer).

- [ ] **Step 2: Add the new section**

Find the last content section in `app/privacy/page.tsx` (just before `<Footer />`). Insert above the Footer:

```tsx
<section id="submissions" style={{ padding: "60px 0", borderTop: "1px solid var(--line)" }}>
  <div className="shell" style={{ maxWidth: 760 }}>
    <div className="eyebrow" style={{ marginBottom: 16 }}>Submitting music</div>
    <h2
      style={{
        fontFamily: "var(--font-display)",
        fontWeight: 800,
        fontStretch: "125%",
        fontSize: "clamp(28px, 3.4vw, 44px)",
        lineHeight: 0.95,
        letterSpacing: "-0.02em",
        textTransform: "uppercase",
        marginBottom: 18,
      }}
    >
      What you&apos;re agreeing to
    </h2>
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        color: "var(--fg-dim)",
        fontSize: 16,
        lineHeight: 1.6,
      }}
    >
      <p>When you upload a track to Numa Radio you confirm:</p>
      <ul style={{ paddingLeft: 22, display: "flex", flexDirection: "column", gap: 8 }}>
        <li>The recording and the composition are your work, or you have all rights to broadcast them.</li>
        <li>You authorise Numa Radio to air the track on its 24/7 stream.</li>
        <li>You can request removal at any time by emailing <a href="mailto:hello@numaradio.com" style={{ color: "var(--accent)" }}>hello@numaradio.com</a> — we&apos;ll pull it from rotation within 24 hours.</li>
        <li>You&apos;re solely responsible for the rights status of what you submit. Numa Radio is not liable for disputes arising from material you upload that turns out not to be yours to share.</li>
      </ul>
      <p style={{ marginTop: 8 }}>
        We store the audio file, your name, and your email only. The audio is removed from
        our submission storage on approval (it moves into the broadcast catalog) or on rejection
        (deleted). Email and name are kept on the submission record so we can reach you.
      </p>
    </div>
  </div>
</section>
```

- [ ] **Step 3: Verify the deep-link works**

Run: `npm run dev` (in background)
Wait until ready, then `curl -s http://localhost:3000/privacy | grep -c 'id="submissions"'`
Expected: `1`

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add app/privacy/page.tsx
git commit -m "privacy: add submitting-music section (#submissions)

Hold-harmless + removal-on-request language for the new music
submission form. The form's mandatory vouch checkbox deep-links to
/privacy#submissions.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

## Task 6: Public POST `/api/submissions`

**Files:**
- Create: `app/api/submissions/route.ts`

- [ ] **Step 1: Implement the route**

Create `app/api/submissions/route.ts`:

```ts
// POST /api/submissions
//
// Public endpoint accepting multipart/form-data:
//   - name (text, required, 2-80 chars)
//   - email (text, required, RFC-ish)
//   - audio (file, required, audio/mpeg ≤10MB, magic-byte verified)
//   - artwork (file, optional, image/png|jpeg ≤2MB, magic-byte verified)
//   - airingPreference (text: "one_off" | "permanent", default "one_off")
//   - vouched (text: "true", required)
//
// Side-effects on success: row in MusicSubmission (status=pending),
// audio (and artwork if present) uploaded to B2 under submissions/.
//
// Per-email pending rate-limit: only one pending submission per email
// at a time. Returns 429 with a clear message when blocked.

import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { putObject } from "@/lib/storage";
import { probeDurationSeconds } from "@/lib/probe-duration";
import {
  isValidEmail,
  isValidName,
  normalizeEmail,
  normalizeName,
  sniffMp3,
  sniffImage,
  audioStorageKey,
  artworkStorageKey,
  MAX_AUDIO_BYTES,
  MAX_ARTWORK_BYTES,
} from "@/lib/submissions";

export const dynamic = "force-dynamic";
// Multipart can be a few MB — give the route headroom on body parse.
export const maxDuration = 30;

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";

function fail(error: string, message: string, status = 400) {
  return NextResponse.json({ error, message }, { status });
}

function ipHashOf(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  const ip = xff?.split(",")[0]?.trim() ?? "0.0.0.0";
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("bad_form", "Could not parse the form data.");
  }

  const name = form.get("name");
  const email = form.get("email");
  const vouched = form.get("vouched");
  const airingPrefRaw = form.get("airingPreference");
  const audioBlob = form.get("audio");
  const artworkBlob = form.get("artwork");

  if (typeof name !== "string" || !isValidName(name)) {
    return fail("bad_name", "Please enter a name between 2 and 80 characters.");
  }
  if (typeof email !== "string" || !isValidEmail(email)) {
    return fail("bad_email", "Please enter a valid email address.");
  }
  if (vouched !== "true") {
    return fail("not_vouched", "You must confirm the rights and broadcast authorisation.");
  }
  const airingPreference = airingPrefRaw === "permanent" ? "permanent" : "one_off";

  if (!(audioBlob instanceof Blob) || audioBlob.size === 0) {
    return fail("missing_audio", "Please attach an MP3 file.");
  }
  if (audioBlob.size > MAX_AUDIO_BYTES) {
    return fail("audio_too_large", "MP3 must be 10 MB or smaller.", 413);
  }

  const audioBuffer = Buffer.from(await audioBlob.arrayBuffer());
  if (!sniffMp3(audioBuffer)) {
    return fail("bad_mp3", "That file doesn't look like a valid MP3.");
  }

  // Optional artwork
  let artworkBuffer: Buffer | null = null;
  let artworkKind: "png" | "jpeg" | null = null;
  if (artworkBlob instanceof Blob && artworkBlob.size > 0) {
    if (artworkBlob.size > MAX_ARTWORK_BYTES) {
      return fail("artwork_too_large", "Artwork must be 2 MB or smaller.", 413);
    }
    artworkBuffer = Buffer.from(await artworkBlob.arrayBuffer());
    artworkKind = sniffImage(artworkBuffer);
    if (!artworkKind) {
      return fail("bad_artwork", "Artwork must be a PNG or JPEG image.");
    }
  }

  const normEmail = normalizeEmail(email);

  const station = await prisma.station.findUnique({
    where: { slug: STATION_SLUG },
    select: { id: true },
  });
  if (!station) return fail("no_station", "Server misconfiguration.", 500);

  // Per-email pending rate-limit
  const existing = await prisma.musicSubmission.findFirst({
    where: { email: normEmail, status: "pending" },
    select: { id: true },
  });
  if (existing) {
    return fail(
      "pending_exists",
      "You've already got a submission pending. We'll respond before you can send another.",
      429,
    );
  }

  // Probe duration (frame-accurate, same as seed)
  let durationSeconds: number | null = null;
  try {
    durationSeconds = Math.round(await probeDurationSeconds(audioBuffer));
  } catch {
    // Don't block submission on a probe failure — the operator will see it
    // in the dashboard and can re-probe at approval time. Worst case we
    // store the row without a duration.
  }

  // Insert row first (id is generated server-side via cuid default), then
  // upload to B2 using that id as the key. Order keeps the DB authoritative.
  const submission = await prisma.musicSubmission.create({
    data: {
      stationId: station.id,
      artistName: normalizeName(name),
      email: normEmail,
      ipHash: ipHashOf(req),
      audioStorageKey: "", // filled after upload
      artworkStorageKey: null,
      durationSeconds,
      airingPreference,
      status: "pending",
      vouched: true,
    },
    select: { id: true },
  });

  const audioKey = audioStorageKey(submission.id);
  await putObject(audioKey, audioBuffer, { contentType: "audio/mpeg" });

  let artKey: string | null = null;
  if (artworkBuffer && artworkKind) {
    artKey = artworkStorageKey(submission.id, artworkKind);
    await putObject(artKey, artworkBuffer, {
      contentType: artworkKind === "png" ? "image/png" : "image/jpeg",
    });
  }

  await prisma.musicSubmission.update({
    where: { id: submission.id },
    data: { audioStorageKey: audioKey, artworkStorageKey: artKey },
  });

  return NextResponse.json({ ok: true, id: submission.id }, { status: 200 });
}
```

- [ ] **Step 2: Verify `putObject` signature matches**

Run: `grep -n "export.*putObject" lib/storage/index.ts`
Expected: a function signature taking `(key, body, options)` (or similar). If the actual signature differs (e.g. uses positional `contentType`), adjust the two `putObject(...)` calls to match. Don't guess — if the call site fails type-check, fix to the real signature.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. If errors appear about `putObject`, adjust to the real signature found in step 2.

- [ ] **Step 4: Smoke-test with curl**

Start dev server: `npm run dev` (background)

In another shell, create a tiny test MP3 (any small valid MP3 — there's likely one in `seed/` or `public/`). If none exists, skip to manual UI test in Task 13.

```bash
curl -i -X POST http://localhost:3000/api/submissions \
  -F "name=Test Artist" \
  -F "email=test+plan@example.com" \
  -F "vouched=true" \
  -F "airingPreference=one_off" \
  -F "audio=@<path-to-test.mp3>;type=audio/mpeg"
```

Expected: `HTTP/1.1 200 OK` with `{ "ok": true, "id": "..." }`. Verify a row appeared:

```bash
npx tsx -e 'import "./lib/load-env"; import { prisma } from "./lib/db"; prisma.musicSubmission.findFirst({ where: { email: "test+plan@example.com" }, orderBy: { createdAt: "desc" } }).then((r) => { console.log(r); prisma.$disconnect(); });'
```

Then re-run the same curl. Expected this time: `HTTP/1.1 429` with `pending_exists`.

Clean up: delete that test row from the DB and the B2 file before committing.

```bash
npx tsx -e 'import "./lib/load-env"; import { prisma } from "./lib/db"; import { deleteObject } from "./lib/storage"; (async () => { const r = await prisma.musicSubmission.findFirst({ where: { email: "test+plan@example.com" }, orderBy: { createdAt: "desc" } }); if (r) { await deleteObject(r.audioStorageKey).catch(() => {}); await prisma.musicSubmission.delete({ where: { id: r.id } }); console.log("cleaned", r.id); } prisma.$disconnect(); })();'
```

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add app/api/submissions/route.ts
git commit -m "submissions: POST /api/submissions accepts MP3 + metadata

Multipart route with field validation, magic-byte sniffing, 10 MB
audio cap, 2 MB artwork cap, per-email pending rate-limit, frame-
accurate duration probe, B2 upload under submissions/<id>.*. Returns
429 when a pending submission already exists for the email.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

## Task 7: SubmitForm component

**Files:**
- Create: `app/_components/SubmitForm.tsx`

- [ ] **Step 1: Implement the component**

Create `app/_components/SubmitForm.tsx`:

```tsx
"use client";

import { useState, type FormEvent, type ChangeEvent } from "react";

type State =
  | { kind: "input" }
  | { kind: "submitting" }
  | { kind: "ok"; email: string }
  | { kind: "error"; message: string };

const MAX_AUDIO_MB = 10;
const MAX_ART_MB = 2;

export function SubmitForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [audio, setAudio] = useState<File | null>(null);
  const [artwork, setArtwork] = useState<File | null>(null);
  const [airingPreference, setAiringPreference] = useState<"one_off" | "permanent">("one_off");
  const [vouched, setVouched] = useState(false);
  const [state, setState] = useState<State>({ kind: "input" });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function validate(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (name.trim().length < 2 || name.trim().length > 80) {
      errs.name = "Between 2 and 80 characters.";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errs.email = "Enter a valid email address.";
    }
    if (!audio) {
      errs.audio = "Pick an MP3 file.";
    } else if (audio.size > MAX_AUDIO_MB * 1024 * 1024) {
      errs.audio = `MP3 must be ${MAX_AUDIO_MB} MB or smaller.`;
    }
    if (artwork && artwork.size > MAX_ART_MB * 1024 * 1024) {
      errs.artwork = `Artwork must be ${MAX_ART_MB} MB or smaller.`;
    }
    if (!vouched) {
      errs.vouched = "Tick the confirmation box to submit.";
    }
    return errs;
  }

  const errs = validate();
  const canSubmit = Object.keys(errs).length === 0 && state.kind === "input";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const v = validate();
    setFieldErrors(v);
    if (Object.keys(v).length > 0) return;
    setState({ kind: "submitting" });

    const fd = new FormData();
    fd.append("name", name.trim());
    fd.append("email", email.trim());
    fd.append("vouched", "true");
    fd.append("airingPreference", airingPreference);
    if (audio) fd.append("audio", audio);
    if (artwork) fd.append("artwork", artwork);

    try {
      const res = await fetch("/api/submissions", { method: "POST", body: fd });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; message?: string };
      if (!res.ok) {
        setState({ kind: "error", message: json.message ?? `Submission failed (HTTP ${res.status}).` });
        return;
      }
      setState({ kind: "ok", email: email.trim() });
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  if (state.kind === "ok") {
    return (
      <div
        style={{
          padding: "28px 28px",
          border: "1px solid var(--line)",
          borderRadius: 12,
          background: "var(--bg-1)",
          maxWidth: 620,
        }}
      >
        <div className="eyebrow" style={{ marginBottom: 12, color: "var(--accent)" }}>
          Got it
        </div>
        <p style={{ fontSize: 17, lineHeight: 1.55, color: "var(--fg)", marginBottom: 8 }}>
          Lena will listen and you&apos;ll hear back at <strong>{state.email}</strong>.
        </p>
        <p style={{ fontSize: 13, color: "var(--fg-mute)", lineHeight: 1.55 }}>
          One submission per email at a time. Want to withdraw later? Email{" "}
          <a href="mailto:hello@numaradio.com" style={{ color: "var(--accent)" }}>
            hello@numaradio.com
          </a>
          .
        </p>
      </div>
    );
  }

  const inputCls = "w-full bg-bg border rounded px-3.5 py-2.5 text-sm outline-none focus:border-accent transition-colors";
  const errorCls = "text-xs mt-1.5";

  return (
    <form
      onSubmit={onSubmit}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 18,
        padding: "24px 24px 28px",
        border: "1px solid var(--line)",
        borderRadius: 12,
        background: "var(--bg-1)",
        maxWidth: 620,
      }}
      noValidate
    >
      {/* Name */}
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="caption-sm" style={{ color: "var(--fg-mute)" }}>Your name</span>
        <input
          type="text"
          value={name}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
          placeholder="As we should credit you on air"
          className={inputCls}
          style={{ borderColor: fieldErrors.name ? "var(--bad)" : "var(--line)" }}
        />
        {fieldErrors.name && <span className={errorCls} style={{ color: "var(--bad)" }}>{fieldErrors.name}</span>}
      </label>

      {/* Email */}
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="caption-sm" style={{ color: "var(--fg-mute)" }}>Email</span>
        <input
          type="email"
          value={email}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
          placeholder="Where we'll write back yes / no"
          className={inputCls}
          style={{ borderColor: fieldErrors.email ? "var(--bad)" : "var(--line)" }}
        />
        {fieldErrors.email && <span className={errorCls} style={{ color: "var(--bad)" }}>{fieldErrors.email}</span>}
      </label>

      {/* Audio */}
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="caption-sm" style={{ color: "var(--fg-mute)" }}>MP3 file (max {MAX_AUDIO_MB} MB)</span>
        <input
          type="file"
          accept="audio/mpeg,.mp3"
          onChange={(e) => setAudio(e.target.files?.[0] ?? null)}
          className="text-sm"
        />
        {fieldErrors.audio && <span className={errorCls} style={{ color: "var(--bad)" }}>{fieldErrors.audio}</span>}
      </label>

      {/* Artwork */}
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="caption-sm" style={{ color: "var(--fg-mute)" }}>
          Album art (optional, PNG or JPEG, max {MAX_ART_MB} MB)
        </span>
        <input
          type="file"
          accept="image/png,image/jpeg,.png,.jpg,.jpeg"
          onChange={(e) => setArtwork(e.target.files?.[0] ?? null)}
          className="text-sm"
        />
        <span className={errorCls} style={{ color: "var(--fg-dim)" }}>
          If you skip this we&apos;ll use the cover embedded in your MP3, or generate one.
        </span>
        {fieldErrors.artwork && <span className={errorCls} style={{ color: "var(--bad)" }}>{fieldErrors.artwork}</span>}
      </label>

      {/* Airing preference */}
      <fieldset style={{ display: "flex", flexDirection: "column", gap: 8, border: 0, padding: 0 }}>
        <legend className="caption-sm" style={{ color: "var(--fg-mute)", marginBottom: 4 }}>
          How should we air it?
        </legend>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
          <input
            type="radio"
            name="airing"
            checked={airingPreference === "one_off"}
            onChange={() => setAiringPreference("one_off")}
            style={{ marginTop: 4 }}
            title="We air this once. After that it's not in rotation."
          />
          <span>
            <span style={{ color: "var(--fg)", fontSize: 14, fontWeight: 500 }}>One-off airing</span>
            <span style={{ color: "var(--fg-mute)", fontSize: 12, display: "block" }}>
              We air this once. After that it&apos;s not in rotation.
            </span>
          </span>
        </label>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
          <input
            type="radio"
            name="airing"
            checked={airingPreference === "permanent"}
            onChange={() => setAiringPreference("permanent")}
            style={{ marginTop: 4 }}
            title="We add this to our regular library. Plays on rotation indefinitely."
          />
          <span>
            <span style={{ color: "var(--fg)", fontSize: 14, fontWeight: 500 }}>Permanent rotation</span>
            <span style={{ color: "var(--fg-mute)", fontSize: 12, display: "block" }}>
              We add this to our regular library. Plays on rotation indefinitely.
            </span>
          </span>
        </label>
      </fieldset>

      {/* Vouch */}
      <label
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          padding: "14px 14px",
          border: `1px ${fieldErrors.vouched ? "solid var(--bad)" : "dashed var(--line-strong)"}`,
          borderRadius: 8,
          background: "rgba(255,77,77,0.03)",
          cursor: "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={vouched}
          onChange={(e) => setVouched(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span style={{ fontSize: 13, color: "var(--fg-dim)", lineHeight: 1.5 }}>
          I confirm this is my own work or I have all rights to it, and I&apos;m authorising
          Numa Radio to broadcast it. I understand I can withdraw it any time by emailing{" "}
          <a href="mailto:hello@numaradio.com" style={{ color: "var(--accent)" }}>
            hello@numaradio.com
          </a>
          . I&apos;ve read the{" "}
          <a href="/privacy#submissions" style={{ color: "var(--accent)" }}>
            terms
          </a>
          .
        </span>
      </label>
      {fieldErrors.vouched && (
        <span className={errorCls} style={{ color: "var(--bad)", marginTop: -10 }}>
          {fieldErrors.vouched}
        </span>
      )}

      {/* Error from server */}
      {state.kind === "error" && (
        <div
          style={{
            padding: "10px 14px",
            border: "1px solid var(--bad)",
            borderRadius: 8,
            background: "rgba(255,77,77,0.06)",
            color: "var(--bad)",
            fontSize: 13,
          }}
        >
          ✗ {state.message}
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={!canSubmit}
        style={{
          padding: "14px 22px",
          fontSize: 14,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          fontWeight: 500,
          border: "1px solid var(--accent)",
          color: canSubmit ? "var(--accent)" : "var(--fg-mute)",
          background: "transparent",
          borderRadius: 6,
          cursor: canSubmit ? "pointer" : "not-allowed",
          opacity: canSubmit ? 1 : 0.5,
          alignSelf: "flex-start",
        }}
      >
        {state.kind === "submitting" ? "Submitting…" : "Send to Lena"}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/_components/SubmitForm.tsx
git commit -m "submissions: client SubmitForm component

Field-level validation, file size client-side cap, airing-preference
radios with tooltips, mandatory vouch checkbox with /privacy#submissions
deep-link, post-submit confirmation card. Wires to POST /api/submissions.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

## Task 8: Wire the form into `/submit` + drop bitrate copy

**Files:**
- Modify: `app/submit/page.tsx`

- [ ] **Step 1: Drop the bitrate text in CHECKLIST[0]**

In `app/submit/page.tsx`, find the `CHECKLIST` array (around line 22). Replace the first item:

```ts
const CHECKLIST = [
  {
    title: "An MP3 file",
    body: "Up to 10 MB. Upload directly through the form below — no streaming links.",
  },
  // ... rest stays the same
];
```

- [ ] **Step 2: Replace the email-CTA section with the form**

In `app/submit/page.tsx`, find the section containing the existing `EmailCta` component (the "Where to send it / hello@numaradio.com" card). Replace that entire section with:

```tsx
{/* Submission form */}
<section style={{ padding: "24px 0 40px" }}>
  <div className="shell">
    <SubmitForm />
    <p style={{ marginTop: 18, fontSize: 13, color: "var(--fg-mute)", maxWidth: 620 }}>
      Or email <a href="mailto:hello@numaradio.com" style={{ color: "var(--accent)" }}>hello@numaradio.com</a> if you&apos;d rather not use the form.
    </p>
  </div>
</section>
```

Add the import at the top of the file:

```tsx
import { SubmitForm } from "../_components/SubmitForm";
```

Remove the `import { EmailCta } from "./EmailCta";` line at the top of the file (if `EmailCta` is no longer referenced).

- [ ] **Step 3: Type-check + visual check**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run dev` (background)
Open `http://localhost:3000/submit` in Playwright (or browser). Confirm:
- The new form renders with all fields
- The CHECKLIST shows "An MP3 file" / "Up to 10 MB" instead of "WAV or 320kbps MP3"
- The vouch link goes to `/privacy#submissions`

Stop dev server.

- [ ] **Step 4: Commit**

```bash
git add app/submit/page.tsx
git commit -m "submit: wire SubmitForm in place of email-only CTA + drop 320kbps copy

CHECKLIST[0] drops the misleading bitrate (we stream at 192). Email
fallback remains as a single line under the form for artists who
prefer email.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

## Task 9: Server-proxied audio for dashboard preview

**Files:**
- Create: `app/api/submissions/[id]/audio/route.ts`

- [ ] **Step 1: Implement the proxy**

Create `app/api/submissions/[id]/audio/route.ts`:

```ts
// GET /api/submissions/:id/audio
//
// Streams a pending submission's audio for the dashboard preview
// player. Public B2 URLs are not handed to the browser — pending
// content shouldn't be reachable without going through this gate.
// Auth is loose for now (any caller); tighten in a follow-up if we
// expose this surface beyond CF-Access-protected dashboard origins.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getObjectStream } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const submission = await prisma.musicSubmission.findUnique({
    where: { id },
    select: { audioStorageKey: true, status: true },
  });
  if (!submission || submission.status !== "pending" || !submission.audioStorageKey) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const stream = await getObjectStream(submission.audioStorageKey);
  return new Response(stream as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "private, no-store",
    },
  });
}
```

- [ ] **Step 2: Verify `getObjectStream` exists**

Run: `grep -n "getObjectStream\|getObject" lib/storage/index.ts`
Expected: a function that streams an object by key.

If `getObjectStream` doesn't exist but a buffer-returning `getObject` does, change the route to:

```ts
const buf = await getObject(submission.audioStorageKey);
return new Response(buf, {
  status: 200,
  headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, no-store" },
});
```

If neither exists, add a minimal `getObjectStream` to `lib/storage/index.ts` using the existing S3 client (use `GetObjectCommand` from `@aws-sdk/client-s3` — the SDK is already in use).

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/submissions/[id]/audio/route.ts lib/storage/
git commit -m "submissions: server-proxied audio route for dashboard preview

GET /api/submissions/:id/audio streams pending audio so the dashboard
can preview without exposing raw B2 URLs of unreviewed content.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

## Task 10: Dashboard list endpoint

**Files:**
- Create: `dashboard/app/api/submissions/list/route.ts`

- [ ] **Step 1: Confirm dashboard prisma client path**

Run: `cat dashboard/lib/db.ts | head -10`
Note the export name (likely `prisma`). Use it below.

- [ ] **Step 2: Implement the route**

Create `dashboard/app/api/submissions/list/route.ts`:

```ts
// GET /api/submissions/list
//
// Returns pending submissions (newest first) plus the last 10 reviewed,
// for the operator panel on /shoutouts. Auth piggybacks on the
// dashboard's CF-Access-protected origin — no extra token needed.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const [pending, reviewed] = await Promise.all([
    prisma.musicSubmission.findMany({
      where: { status: "pending" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, artistName: true, email: true,
        airingPreference: true, durationSeconds: true,
        artworkStorageKey: true, createdAt: true,
      },
    }),
    prisma.musicSubmission.findMany({
      where: { status: { in: ["approved", "rejected", "withdrawn"] } },
      orderBy: { reviewedAt: "desc" },
      take: 10,
      select: {
        id: true, artistName: true, status: true,
        rejectReason: true, reviewedAt: true, reviewedBy: true,
      },
    }),
  ]);
  return NextResponse.json({ pending, reviewed });
}
```

- [ ] **Step 3: Type-check (dashboard)**

Run: `cd dashboard && npx tsc --noEmit && cd ..`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add dashboard/app/api/submissions/list/route.ts
git commit -m "dashboard: list endpoint for music submissions

Returns pending (newest first) + last 10 reviewed for the operator
panel on /shoutouts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

## Task 11: Dashboard approve endpoint

**Files:**
- Create: `dashboard/app/api/submissions/[id]/approve/route.ts`

- [ ] **Step 1: Implement**

Create `dashboard/app/api/submissions/[id]/approve/route.ts`:

```ts
// POST /api/submissions/:id/approve
//
// Approves a pending submission:
//   1. Read submission row + load audio (and artwork if any) from B2
//   2. Resolve artwork via cascade: uploaded → ID3 → generated
//   3. Call lib/ingest.ingestTrack with airingPolicy mapped from the
//      submitter's preference (one_off → priority_request, permanent
//      → library)
//   4. Update the submission row (status=approved, trackId, reviewedBy,
//      reviewedAt, artworkSource)
//   5. Delete the originals from submissions/ in B2 (cost saver — the
//      production ingest already wrote new copies under tracks/)

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ingestTrack } from "@/lib/ingest";
import { getObject, deleteObject } from "@/lib/storage";
import { extractId3Artwork } from "@/lib/extract-id3-artwork";

export const dynamic = "force-dynamic";

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";

function operatorEmail(req: NextRequest): string {
  return req.headers.get("cf-access-authenticated-user-email") ?? "operator";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const submission = await prisma.musicSubmission.findUnique({ where: { id } });
  if (!submission) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (submission.status !== "pending") {
    return NextResponse.json({ error: "not_pending", status: submission.status }, { status: 409 });
  }

  const station = await prisma.station.findUniqueOrThrow({
    where: { slug: STATION_SLUG },
    select: { id: true },
  });

  // Load audio
  const audioBuffer = await getObject(submission.audioStorageKey);

  // Artwork cascade
  let artwork: { buffer: Buffer; mimeType: string } | undefined;
  let artworkSource: "upload" | "id3" | "generated" | null = null;
  if (submission.artworkStorageKey) {
    const buf = await getObject(submission.artworkStorageKey);
    const mt = submission.artworkStorageKey.endsWith(".png") ? "image/png" : "image/jpeg";
    artwork = { buffer: buf, mimeType: mt };
    artworkSource = "upload";
  } else {
    const fromId3 = await extractId3Artwork(audioBuffer);
    if (fromId3) {
      artwork = { buffer: fromId3.buffer, mimeType: fromId3.mimeType };
      artworkSource = "id3";
    }
  }
  // Tier 3 (generation) is intentionally NOT wired here in MVP — most
  // submitted tracks have either an attached image or an embedded ID3
  // cover. If neither exists, the track ingests without artwork and the
  // operator can attach one later from the existing dashboard library
  // page. Wiring full Flux/MiniMax generation here adds API spend +
  // failure modes that aren't worth it for the first cut.

  const airingPolicy = submission.airingPreference === "permanent" ? "library" : "priority_request";

  // Pick a show slot. Submissions don't carry a show preference yet —
  // default to morning_room as a neutral slot the operator can move
  // later from the existing library page.
  const result = await ingestTrack({
    stationId: station.id,
    audioBuffer,
    show: "morning_room",
    title: `Untitled — ${submission.artistName}`, // operator can rename later
    artistDisplay: submission.artistName,
    durationSeconds: submission.durationSeconds ?? undefined,
    airingPolicy,
    sourceType: "external_import",
    artwork,
  });

  if (result.status !== "ingested") {
    return NextResponse.json({ error: "ingest_failed", reason: result }, { status: 500 });
  }

  await prisma.musicSubmission.update({
    where: { id: submission.id },
    data: {
      status: "approved",
      trackId: result.trackId,
      artworkSource: artworkSource ?? null,
      reviewedAt: new Date(),
      reviewedBy: operatorEmail(req),
    },
  });

  // Delete originals — we copied them into the production catalog
  await deleteObject(submission.audioStorageKey).catch(() => undefined);
  if (submission.artworkStorageKey) {
    await deleteObject(submission.artworkStorageKey).catch(() => undefined);
  }

  return NextResponse.json({ ok: true, trackId: result.trackId });
}
```

- [ ] **Step 2: Verify `sourceType: "external_import"` is a valid `TrackSourceType`**

Run: `grep -n "TrackSourceType\|external_import" prisma/schema.prisma`
Expected: `external_import` appears as one of the enum values. If not, drop the `sourceType` line — the `ingestTrack` default will be used.

- [ ] **Step 3: Type-check (dashboard)**

Run: `cd dashboard && npx tsc --noEmit && cd ..`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add dashboard/app/api/submissions/\[id\]/approve/route.ts
git commit -m "dashboard: approve endpoint ingests via lib/ingest with airingPolicy mapping

one_off → priority_request, permanent → library. Artwork cascade:
uploaded image → ID3 embedded → none (operator can attach later).
Submission B2 originals are deleted after the production ingest copies
them to tracks/.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

## Task 12: Dashboard reject endpoint

**Files:**
- Create: `dashboard/app/api/submissions/[id]/reject/route.ts`

- [ ] **Step 1: Implement**

Create `dashboard/app/api/submissions/[id]/reject/route.ts`:

```ts
// POST /api/submissions/:id/reject
//
// Body: { reason: string }
//
// Marks the submission rejected with a reason, deletes the audio +
// artwork from B2 (cost saver), keeps the row for audit.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { deleteObject } from "@/lib/storage";

export const dynamic = "force-dynamic";

function operatorEmail(req: NextRequest): string {
  return req.headers.get("cf-access-authenticated-user-email") ?? "operator";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const reason = typeof (body as { reason?: unknown }).reason === "string"
    ? (body as { reason: string }).reason.trim()
    : "";
  if (reason.length < 3 || reason.length > 500) {
    return NextResponse.json(
      { error: "bad_reason", message: "Reason must be between 3 and 500 characters." },
      { status: 400 },
    );
  }

  const submission = await prisma.musicSubmission.findUnique({ where: { id } });
  if (!submission) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (submission.status !== "pending") {
    return NextResponse.json({ error: "not_pending", status: submission.status }, { status: 409 });
  }

  await prisma.musicSubmission.update({
    where: { id: submission.id },
    data: {
      status: "rejected",
      rejectReason: reason,
      reviewedAt: new Date(),
      reviewedBy: operatorEmail(req),
    },
  });

  await deleteObject(submission.audioStorageKey).catch(() => undefined);
  if (submission.artworkStorageKey) {
    await deleteObject(submission.artworkStorageKey).catch(() => undefined);
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Type-check**

Run: `cd dashboard && npx tsc --noEmit && cd ..`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add dashboard/app/api/submissions/\[id\]/reject/route.ts
git commit -m "dashboard: reject endpoint with required reason + B2 cleanup

Operator must supply a reason (3-500 chars). Stored on the row for
audit. Audio + artwork are deleted from B2 immediately — no need to
keep rejected files around.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

## Task 13: Dashboard SubmissionsPanel UI

**Files:**
- Create: `dashboard/app/shoutouts/SubmissionsPanel.tsx`
- Modify: `dashboard/app/shoutouts/page.tsx`

- [ ] **Step 1: Confirm where the right-rail lives in `dashboard/app/shoutouts/page.tsx`**

Run: `grep -n "Auto-chatter\|aside\|right" dashboard/app/shoutouts/page.tsx | head -10`
Identify the JSX section showing "Auto-chatter & announcement activity" (the existing right-rail panel). The new `<SubmissionsPanel />` mounts immediately below it, in the same parent container.

- [ ] **Step 2: Implement the panel**

Create `dashboard/app/shoutouts/SubmissionsPanel.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

type Pending = {
  id: string;
  artistName: string;
  email: string;
  airingPreference: "one_off" | "permanent";
  durationSeconds: number | null;
  artworkStorageKey: string | null;
  createdAt: string;
};

type Reviewed = {
  id: string;
  artistName: string;
  status: "approved" | "rejected" | "withdrawn";
  rejectReason: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
};

type ListResponse = { pending: Pending[]; reviewed: Reviewed[] };

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.floor(h / 24)} d ago`;
}

function fmtDur(s: number | null): string {
  if (s == null) return "?";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function SubmissionsPanel() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // submission id mid-action
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/submissions/list", { cache: "no-store" });
      if (!r.ok) return;
      setData((await r.json()) as ListResponse);
    } catch {
      /* keep previous */
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  async function approve(id: string) {
    setBusy(id);
    try {
      const r = await fetch(`/api/submissions/${id}/approve`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { message?: string }).message ?? `HTTP ${r.status}`);
      toast.success("Approved — track ingested.");
      await refresh();
    } catch (err) {
      toast.error(`Approve failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  }

  async function reject(id: string) {
    if (rejectReason.trim().length < 3) {
      toast.error("Reason must be at least 3 characters.");
      return;
    }
    setBusy(id);
    try {
      const r = await fetch(`/api/submissions/${id}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: rejectReason.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { message?: string }).message ?? `HTTP ${r.status}`);
      toast.success("Rejected.");
      setRejectingId(null);
      setRejectReason("");
      await refresh();
    } catch (err) {
      toast.error(`Reject failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  }

  if (!data) return null;

  return (
    <section className="border border-line rounded p-4 flex flex-col gap-3 bg-bg-1">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm uppercase tracking-widest text-fg-mute">Music submissions</h2>
        <span className="text-xs text-fg-dim">
          {data.pending.length} pending · {data.reviewed.length} recent
        </span>
      </div>

      {data.pending.length === 0 && (
        <p className="text-sm text-fg-mute">Nothing waiting.</p>
      )}

      <ul className="flex flex-col gap-3">
        {data.pending.map((p) => (
          <li key={p.id} className="border border-line rounded p-3 flex flex-col gap-2 bg-bg">
            <div className="flex items-baseline justify-between gap-2">
              <div className="flex flex-col">
                <span className="text-sm font-medium">{p.artistName}</span>
                <span className="text-xs text-fg-mute">{p.email}</span>
              </div>
              <span className="text-xs text-fg-dim">{relativeTime(p.createdAt)}</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span
                className={`px-2 py-0.5 rounded border ${
                  p.airingPreference === "permanent"
                    ? "border-accent text-accent"
                    : "border-line text-fg-mute"
                }`}
              >
                {p.airingPreference === "permanent" ? "Permanent" : "One-off"}
              </span>
              <span className="text-fg-dim">{fmtDur(p.durationSeconds)}</span>
              {p.artworkStorageKey && <span className="text-fg-dim">+ artwork</span>}
            </div>
            <audio
              src={`https://numaradio.com/api/submissions/${p.id}/audio`}
              controls
              preload="none"
              className="w-full"
            />

            {rejectingId === p.id ? (
              <div className="flex flex-col gap-2">
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Why are we rejecting this? (stored, not sent yet)"
                  rows={2}
                  className="bg-bg border border-line rounded p-2 text-sm outline-none focus:border-accent"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => reject(p.id)}
                    disabled={busy === p.id}
                    className="text-xs uppercase tracking-widest px-3 py-2 border border-bad text-bad rounded disabled:opacity-50"
                  >
                    {busy === p.id ? "…" : "Confirm reject"}
                  </button>
                  <button
                    onClick={() => { setRejectingId(null); setRejectReason(""); }}
                    className="text-xs uppercase tracking-widest px-3 py-2 border border-line text-fg-mute rounded"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => approve(p.id)}
                  disabled={busy === p.id}
                  className="text-xs uppercase tracking-widest px-3 py-2 border border-accent text-accent rounded disabled:opacity-50"
                >
                  {busy === p.id ? "…" : "Approve"}
                </button>
                <button
                  onClick={() => setRejectingId(p.id)}
                  disabled={busy !== null}
                  className="text-xs uppercase tracking-widest px-3 py-2 border border-line text-fg-mute rounded disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {data.reviewed.length > 0 && (
        <details className="mt-2">
          <summary className="text-xs uppercase tracking-widest text-fg-mute cursor-pointer">
            Recently reviewed (last {data.reviewed.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-1 text-xs">
            {data.reviewed.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 border-b border-line py-1">
                <span className="text-fg">{r.artistName}</span>
                <span className={
                  r.status === "approved" ? "text-accent" :
                  r.status === "rejected" ? "text-bad" : "text-fg-mute"
                }>
                  {r.status}
                </span>
                <span className="text-fg-dim">
                  {r.reviewedAt ? relativeTime(r.reviewedAt) : "—"}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Embed the panel in `dashboard/app/shoutouts/page.tsx`**

Add the import at the top of `dashboard/app/shoutouts/page.tsx`:

```tsx
import { SubmissionsPanel } from "./SubmissionsPanel";
```

In the right-rail JSX (just below the existing "Auto-chatter & announcement activity" panel — found in step 1 of this task), add:

```tsx
<SubmissionsPanel />
```

- [ ] **Step 4: Type-check**

Run: `cd dashboard && npx tsc --noEmit && cd ..`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/shoutouts/SubmissionsPanel.tsx dashboard/app/shoutouts/page.tsx
git commit -m "dashboard: SubmissionsPanel on /shoutouts (approve / reject inline)

Right-rail panel below auto-chatter activity. Pending list with
artist/email/preference chips + inline audio preview + Approve and
Reject buttons. Reject expands an inline reason textarea. Recently
reviewed (last 10) is collapsible below.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

## Task 14: End-to-end smoke test via Playwright

**Files:** none — verification only.

- [ ] **Step 1: Apply the migration to prod DB**

Run: `npx prisma migrate deploy`
Expected: the new migration is applied to Neon.

- [ ] **Step 2: Verify the public site deployed (Vercel auto-builds on push)**

Wait ~3 min after the last push, then:

```bash
curl -sI https://numaradio.com/submit | head -1
```

Expected: `HTTP/2 200`.

- [ ] **Step 3: Submit a real test track via Playwright**

Use a small valid MP3 from `seed/` or `public/`. Open `https://numaradio.com/submit` in the Playwright browser, fill in:
- Name: "Test Submission"
- Email: a throwaway address you control
- Audio: pick the test MP3
- Skip artwork (we want to exercise the ID3-then-no-artwork path)
- Default airing preference (one-off)
- Tick the vouch checkbox
- Click "Send to Lena"

Expected: form swaps to the green "Got it" confirmation card.

Verify the row landed:

```bash
npx tsx -e 'import "./lib/load-env"; import { prisma } from "./lib/db"; prisma.musicSubmission.findFirst({ where: { artistName: "Test Submission" }, orderBy: { createdAt: "desc" } }).then((r) => { console.log(r); prisma.$disconnect(); });'
```

- [ ] **Step 4: Approve from the dashboard**

Open `https://dashboard.numaradio.com/shoutouts` (CF Access challenge). Find the Music submissions panel, locate the "Test Submission" row, play the audio preview to verify it streams, then click **Approve**.

Expected: green toast, row disappears from pending, appears in "Recently reviewed" with `approved` status. Verify a Track row was created:

```bash
npx tsx -e 'import "./lib/load-env"; import { prisma } from "./lib/db"; prisma.track.findFirst({ where: { artistDisplay: "Test Submission" }, orderBy: { createdAt: "desc" } }).then((r) => { console.log(r); prisma.$disconnect(); });'
```

Expected: a row with `airingPolicy: "priority_request"` (since we picked one-off).

- [ ] **Step 5: Submit again with same email + verify rate-limit**

This time submit with an obviously bad MP3 (any non-MP3 file). Expected: red error in the form.

Then submit a real second MP3. Expected: the old approved submission is no longer "pending", so this new submission goes through (the rate-limit only blocks while `status=pending`).

- [ ] **Step 6: Reject the second one**

In the dashboard, click Reject on the new pending row. Type a reason (≥3 chars). Click "Confirm reject".

Expected: row marked `rejected`, B2 audio deleted. Verify:

```bash
npx tsx -e 'import "./lib/load-env"; import { prisma } from "./lib/db"; prisma.musicSubmission.findMany({ where: { artistName: "Test Submission" }, orderBy: { createdAt: "desc" }, take: 5 }).then((r) => { console.log(JSON.stringify(r, null, 2)); prisma.$disconnect(); });'
```

Expected: 2 rows; one `approved`, one `rejected` with the reason populated.

- [ ] **Step 7: Clean up test data**

```bash
npx tsx -e 'import "./lib/load-env"; import { prisma } from "./lib/db"; (async () => { const subs = await prisma.musicSubmission.findMany({ where: { artistName: "Test Submission" } }); for (const s of subs) { if (s.trackId) { await prisma.trackAsset.deleteMany({ where: { trackId: s.trackId } }); await prisma.track.delete({ where: { id: s.trackId } }).catch(() => {}); } await prisma.musicSubmission.delete({ where: { id: s.id } }); } console.log("cleaned", subs.length); prisma.$disconnect(); })();'
```

(B2 cleanup for the production-path Track happens via the existing Track lifecycle — no extra step here.)

- [ ] **Step 8: Final commit (if any housekeeping snuck in)**

If any small fix landed during smoke-testing, commit + push. Otherwise this task is done.

---

## Self-Review

**Spec coverage:**
- §1 Architecture overview → covered by Tasks 1–13
- §2 Public form → Tasks 7, 8
- §3 API route + validation → Tasks 2, 3, 4, 6
- §4 Data model → Task 1
- §5 B2 storage layout → Tasks 6 (write), 11 + 12 (cleanup)
- §6 Artwork cascade → Task 11 (tier 3 generation deferred per the spec's "operator can attach later" — flagged in the route comment)
- §7 Dashboard panel → Tasks 10, 13
- §8 Approve workflow → Task 11
- §9 Privacy update → Task 5
- §10 /submit copy fixes → Task 8
- §11 Non-goals → respected (no email, no captcha, no withdraw form)

**Placeholder scan:** none — every code step is complete.

**Type consistency:**
- `airingPreference` ("one_off" / "permanent") used consistently form ↔ API ↔ DB
- `airingPolicy` ("priority_request" / "library") mapped only at the approval boundary
- `audioStorageKey` / `artworkStorageKey` field names match between spec, schema, and route code
- `MusicSubmission` model name + relations match across schema, public route, and dashboard routes
- Operator email header `cf-access-authenticated-user-email` used consistently in approve + reject

**Open inline items flagged in code (not failures, just transparency for the implementer):**
- Task 6, Step 2: `putObject` call site adjusted to real signature
- Task 9, Step 2: `getObjectStream` may need to be added to `lib/storage`
- Task 11: tier-3 generation explicitly deferred; commented in the route
