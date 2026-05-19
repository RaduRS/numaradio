# Fingerprint Check — Design

**Date:** 2026-05-19
**Status:** Draft

---

## What we're building

An on-demand audio fingerprint check accessible from two places in the dashboard:
1. **SubmissionsPanel** — next to Preview, for tracks still in `pending` status
2. **Library table** — in the actions dropdown (⋯), alongside Play Next / Delete / Regenerate Artwork

The check queries **AcoustID** (open-source fingerprint DB, free forever) and **MusicBrainz** (cover art + metadata). Results are stored on the `Track` row to avoid re-checking.

---

## Architecture

### Fingerprint flow

```
Track audio URL
    ↓
fpcalc (Chromaprint CLI) — generates fingerprint from MP3 locally
    ↓
AcoustID Web API — submits fingerprint, gets back recording MBIDs
    ↓
MusicBrainz API — resolves MBIDs to title + artist
    ↓
Store result on Track row → operator sees ✓ or ✗
```

### Tooling on Orion

- **fpcalc** — part of `chromaprint` package. Generates audio fingerprint from MP3.
  ```bash
  sudo apt-get install chromaprint
      # or on WSL2/Ubuntu:
      sudo apt-get install libchromaprint-tools
  fpcalc -length 120 /path/to/audio.mp3   # first 120s is enough
  ```
  If `fpcalc` is not in PATH, the route tries common install locations before failing.

- **AcoustID API** — free, no key required for typical use (rate limits apply)
  - Endpoint: `POST https://api.acoustid.org/v2/lookup`
  - Params: `format=json`, `client=<hardcoded app-key>`, `duration`, `fingerprint`
  - Returns: array of `recordings[]` each with `id` (MBID) + `sources[]`

- **MusicBrainz API** — free, no key, rate-limited to 1 req/s
  - Endpoint: `GET https://musicbrainz.org/ws/2/recording/{mbid}?fmt=json&inc=releases+artist-credits`
  - Returns: title, artist-credit list (name + disambiguation)

### API route

**`POST /api/internal/tracks/[id]/fingerprint`**

Auth: `x-internal-secret` header.

Request body: none (trackId comes from URL).

Process:
1. Load Track from DB, resolve primary audio asset publicUrl
2. Download MP3 to temp file (streamed, max 200MB, 60s timeout)
3. Run `fpcalc -length 120 <tmpfile>`, parse stdout for fingerprint + duration
4. Call AcoustID `lookup` with fingerprint + duration
5. If `results[]` is empty → clean
6. For each result, call MusicBrainz to get title/artist
7. Store on Track:
   - `fingerprintResult`: `clean | match | error`
   - `fingerprintResultMeta`: JSON — matched recordings from AcoustID, or error message
   - `fingerprintedAt`: `now()`
8. Return `{ result: "clean" | "match" | "error", meta: {...} }`

Edge cases:
- `fpcalc` not installed → 500 with `{error: "fpcalc_not_installed"}`
- MP3 download fails → 500 with `{error: "audio_fetch_failed"}`
- AcoustID returns no results → `result: "clean"` (nothing found = clean)
- MusicBrainz lookup fails for a given MBID → skip that result, log and continue
- High confidence match: AcoustID returns a `score` (0–1). Threshold ≥0.9 = match. Below = clean.

### Approve route — hard block on match

**UI-enforced gate (SubmissionsPanel):** the Approve button is `disabled` until the operator has clicked Check Fingerprint and the check has completed (regardless of result).

**Route-level safety net:** in `app/api/internal/submissions/[id]/approve/route.ts`, before calling `ingestTrack()`:
```typescript
const track = await prisma.track.findUnique({ where: { id: trackId }, select: { fingerprintResult: true } });
if (track?.fingerprintResult === 'match') {
  return Response.json({ error: 'Fingerprint match — track appears to be a known commercial recording. Reject it instead.' }, { status: 422 });
}
```

This prevents approval even if someone calls the route directly (bypassing the dashboard UI). If `fingerprintResult` is null (never checked) or `'clean'`, approval proceeds normally — the UI gate is the primary mechanism, the route block is a backstop.

---

## Prisma schema changes

```prisma
enum FingerprintResult {
  clean
  match
  error
}

model Track {
  // ...existing fields...
  fingerprintResult    FingerprintResult?
  fingerprintMeta     Json?   // { matchedRecordings: [{mbid, title, artist, score}], errorMsg }
  fingerprintedAt     DateTime?
}
```

Migration: `npx prisma migrate dev --name add_track_fingerprint_fields`

---

## Dashboard UI

### SubmissionsPanel — gating flow

The fingerprint check is **mandatory before approving** a submission:

```
[▶ Play] [Check Fingerprint ○]  [✓ Approve (disabled until checked)] [✗ Reject]
```

**Button states (Fingerprint column):**
- **idle / unchecked**: fingerprint icon (gray/outline), no result yet
- **checking**: spinner (`Loader2` with spin animation)
- **clean**: green check icon (`CheckCircle`, green), "No match found"
- **match**: red X icon (`XCircle`, red), "Matched — do not approve"
- **error**: yellow warning icon (`AlertCircle`, yellow), error details

**Approve button state:**
- `disabled` until fingerprint check has run (regardless of result — operator decides after seeing the result)
- `enabled` after fingerprint check completes

**On match found:** Approve stays disabled. Operator must Reject instead. This enforces the manual review gate.

**Pre-fill:** if the submission's track already has a `fingerprintResult` from a prior check, show that state immediately and don't re-run unless operator clicks again.

### Library table actions menu

In the `actions` cell of each library row, add a new item:

```
[🔀 Play Next]
[🗑 Delete]
[🎨 Regenerate Artwork]
[🔍 Check Fingerprint]
```

Clicking it runs the same fingerprint check on the track.

If the track already has a `fingerprintResult`, the button pre-fills based on that result (shows ✓ or ✗), and clicking re-runs the check (to re-verify after edits).

### Loading / done states

While checking:
- Spinner replaces the icon
- Button is disabled

On done:
- Icon flips to the result state (✓ clean / ✗ match)
- Toast notification: "Clean — no match" or "Match found — review before approving"
- Row doesn't auto-update elsewhere — operator must refresh or check the fingerprint column if we add one to the table

---

## Files to touch

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `FingerprintResult` enum + 3 columns to `Track` |
| `app/api/internal/tracks/[id]/fingerprint/route.ts` | New route |
| `dashboard/app/library/SubmissionsPanel.tsx` | Fingerprint button per pending row |
| `dashboard/app/library/page.tsx` | Actions menu item for library tracks |
| `app/api/internal/submissions/[id]/approve/route.ts` | Hard block if `fingerprintResult === 'match'` |
| `lib/fingerprint.ts` | New — shared `runFingerprintCheck(trackId)` helper |

---

## Not in scope (deferred)

- Form checkbox additions ("I wrote the lyrics" / "I am 18+")
- Background/auto fingerprinting on upload
- Storing matched recordings in a separate table
- Fingerprint status column visible in the main library table (can add later)