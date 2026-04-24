# Shoutout flagship + voice pipeline — Stage 2b of marketing videos

**Status:** brainstormed 2026-04-24, awaiting implementation plan
**Owner:** new composition + pipeline in `~/saas/numaradio-videos/`
**Relates to:** Stage 2b of `docs/superpowers/specs/2026-04-24-marketing-videos-design.md`. Follows Stage 2a (Lena canonical portrait, shipped as `src/assets/lena/lena-v1.png`). Precedes Stage 2c (MeetLena, SongRequestDemo, DayInNuma compositions).

## Why

The shoutout flagship is the single highest-ROI piece of marketing in Phase 2 — it sells the magic loop (*type a message → Lena reads it on air → your words broadcast live worldwide*) in 15 seconds. Every viewer who watches this and understands the loop is a potential convert. This is also where the Deepgram Luna voice pipeline lands — once built for the flagship, every subsequent Phase 2/3 composition with Lena's voice reuses it.

## What we're making

1. **Voice pipeline** — `generate-voice.ts` script + Deepgram Luna TTS (same model as production radio) + committed MP3 assets under `src/assets/voice/`.
2. **Two new primitives** — `TypedText` and `Waveform`.
3. **Five extracted primitives** — `ScanLines`, `FilmGrain`, `LiveChip`, `EyebrowStrip`, `Wordmark` — lifted from ListenNow's inline helpers into reusable components; ListenNow is refactored to consume them.
4. **`ShoutoutFlagship.tsx` composition** — 15s, 1080×1920, registered in `src/Root.tsx`, renders as `out/shoutout-flagship.mp4` via the existing `npm run render` wrapper.
5. **One committed voice MP3** — `src/assets/voice/shoutout-flagship.mp3` containing Lena reading the approved shoutout text.

## The approved shoutout

Composed in the authentic voice of real catalog submissions. The DB had 14 aired shoutouts; none were marketing-grade, so we composed one modeled on the real vernacular:

> *"This one's going out to my mom. She listens every morning when she makes coffee. Tell her hi from the night shift."*

Reasons: warm specificity ("every morning when she makes coffee"), a relationship hook (mother/adult-child), and a kicker ("from the night shift") that lands the brand thesis without naming "24/7" or "never sleeps" explicitly. Reads aloud in ~7 seconds at Luna's natural pace.

## Architecture

### Voice pipeline

New script: `~/saas/numaradio-videos/src/scripts/generate-voice.ts`

- Thin wrapper around Deepgram `/v1/speak` with `?model=aura-2-luna-en&encoding=mp3`.
- Mirrors the exact pattern in `~/saas/numaradio/workers/queue-daemon/deepgram-tts.ts`: Luna primary, Asteria fallback on 4xx/5xx (422 specifically — Luna is occasionally rate-limited).
- Env: `DEEPGRAM_API_KEY` (already in `.env.local`).
- CLI: `npx tsx src/scripts/generate-voice.ts <compositionName> "<text>"` → writes `src/assets/voice/<compositionName>.mp3`.
- MP3s are committed — they're deterministic renders, not secrets. Composition references via `staticFile("voice/<name>.mp3")`.
- Re-running the script overwrites the MP3; if you want to iterate text, edit + regenerate + commit.

Why commit: Remotion renders re-execute compositions many times per second; hitting Deepgram per-render would be slow and expensive. Generate once, commit, done.

### Primitive inventory

**NEW primitives (fresh for Stage 2b):**

| File | Purpose | Pure function to export + test |
|---|---|---|
| `src/primitives/TypedText.tsx` | Letter-by-letter typing animation with variable-speed support | `visibleCharsAtFrame(frame, totalChars, framesPerChar)` |
| `src/primitives/Waveform.tsx` | Horizontal teal audio-waveform (not EQ bars — these are variable-height audio visualization) | `waveformHeights(frame, barCount, fps)` returns normalized height array |

**EXTRACTED primitives (lifted from ListenNow's inline helpers):**

| File | Source | Notes |
|---|---|---|
| `src/primitives/ScanLines.tsx` | ListenNow's inline `ScanLines` function | No props; always-on overlay |
| `src/primitives/FilmGrain.tsx` | ListenNow's inline `FilmGrain` function | No props |
| `src/primitives/LiveChip.tsx` | ListenNow's inline `LiveChip` | Pulsing red dot + "Live" text; fixed position top-right |
| `src/primitives/EyebrowStrip.tsx` | ListenNow's inline `EyebrowStrip` | `text` prop so each composition sets its own metadata |
| `src/primitives/Wordmark.tsx` | ListenNow's inline `Wordmark` | Fixed "Numa Radio" stacked display typography |

ListenNow is refactored to import from these. Net: ListenNow loses ~80 lines of inline helper code and reads cleaner.

**EXISTING primitives (reused unchanged):**

- `PulsingDot`, `BrandTitle`, `MusicBed`, `EqBars` — all from Phase 1, untouched.

**Non-primitives for Stage 2b (explicit):**

- **No `PhoneFrame`** — the flagship's phone-POV beats are replaced with typographic HUD callouts ("GOING LIVE ✓", listener ticker, timestamp). More editorial, no dated phone-bezel look.
- **No `LenaVoice`** — voice is inline via Remotion `<Audio src={staticFile("voice/shoutout-flagship.mp3")} />`. Extract to a primitive at the rule-of-2 boundary (second composition using voice, likely MeetLena in 2c).
- **No `LenaPortrait`** — flagship is voice-only. Built in 2c against MeetLena's real needs.

### ShoutoutFlagship composition

File: `src/compositions/ShoutoutFlagship.tsx`

Duration: 15s = 450 frames @ 30fps. Resolution: 1080×1920.

Storyboard beat-by-beat:

**Beat 1 — Hook (frames 0-15, 0.5s).**
Teal flash (3 frames) → cut to dark. Persistent atmosphere kicks in: `ScanLines`, `FilmGrain`, `EyebrowStrip text="NUMA RADIO · LIVE · LISTENER SHOUTOUT"`, `LiveChip`. All snap in by frame 6.

**Beat 2 — Typing (frames 15-150, 0.5-5s).**
Center: mobile-input card. Wide dark-charcoal card with subtle teal border + blinking teal caret. Small mono label above: "numaradio.com · requests". `TypedText` renders the full α shoutout with variable-speed typing:
- First sentence ("This one's going out to my mom.") — slower, ~2 frames/char (~2s)
- Second ("She listens every morning when she makes coffee.") — faster, ~0.8 frames/char (~1.3s)
- Third ("Tell her hi from the night shift.") — fastest, ~0.6 frames/char (~0.7s)
- Frames 135-150: cursor holds on the complete text.

**Beat 3 — Submit → broadcast → Lena speaks (frames 150-390, 5-13s).**
- Frames 150-160: submit flash (teal pulse around the input card).
- Frames 160-180: input card morphs — text literally collapses downward into a horizontal teal `Waveform` (new primitive; audio-shaped variable-height bars, full-width).
- Frames 180-195: waveform condenses to a centered `PulsingDot`.
- Frames 195-210: dot explodes outward into broadcast visual — `EqBars` + scan-line intensify.
- **Lena voice starts at frame ~160 and plays for ~7s** (α read aloud via Deepgram Luna). Loaded from `voice/shoutout-flagship.mp3`, inline Remotion `<Audio>` component.
- During voice (frames 210-370): HUD callouts fade in:
  - "GOING LIVE ✓" — mono, teal accent, top-center
  - Listener ticker (`27 → 31 → 36`, counts up once per ~1.5s over the voice window). Approximate numbers, static per count.
  - Timestamp "03:27:42" — mono, matches ListenNow's nighttime convention. Static.
- Waveform persists beneath the HUD throughout Lena's speech — literalizes "sound made visible".

**Beat 4 — Payoff (frames 390-450, 13-15s).**
Hard cut to stacked `Wordmark` ("NUMA / RADIO") + teal underline wipe L→R (same mechanic as ListenNow's payoff) + `numaradio.com` mono below. `LiveChip` still visible top-right. Music bed tails from frame 390 over 60 frames.

**Music bed:** `bed-02-rainy-blue-echoes.mp3` — most ambient of the three curated beds, lets Lena's voice dominate without competing. If it doesn't land in preview, swap to `bed-03-ocean-eyes`. Same `MusicBed` primitive as ListenNow with a new envelope: 6 frames fade-in, 384 frames sustain, 60 frames fade-out.

### Frontend-design engagement

This composition builds with `frontend-design` skill invoked during implementation — same as ListenNow's v2 rework, which shipped with atmosphere layers + HUD motion that the initial spec didn't anticipate. The skill is specifically responsible for:

- Polishing Beat 2's mobile-input card so it reads "request form from numaradio.com" without being a literal phone mockup
- Nailing Beat 3's text-to-waveform morph (subtle, punctuated, not cheesy)
- Tuning HUD callout typography and placement so they don't crowd Lena's voice delivery

The plan will have an explicit step that says *"invoke `frontend-design` skill before implementing the composition"*.

### Where to hook into ListenNow refactor

The extraction of 5 shared primitives (ScanLines, FilmGrain, LiveChip, EyebrowStrip, Wordmark) is a net simplification for ListenNow — roughly 80 lines of inline function components move to primitives/, and ListenNow imports them. The refactor:

1. Create `src/primitives/<Name>.tsx` with the exact current ListenNow implementation (copy-paste).
2. Add a `text` prop to `EyebrowStrip` (ListenNow passes its existing "NUMA RADIO · EST. 2026 · 24 / 7" value).
3. Delete the inline functions from `ListenNow.tsx` and replace with imports.
4. Re-render ListenNow — output must be byte-identical or near-identical (minor encoder variance acceptable; no visual change).
5. `npm test` — no new failures.

The spec treats this as part of Stage 2b's primitive task, not a standalone refactor. Net ListenNow diff should show only imports swapped in + inline functions deleted.

## Testing + error handling

**Tests we write:**

- `TypedText.test.ts` — `visibleCharsAtFrame(frame, totalChars, framesPerChar)`:
  - returns 0 before first char reveals
  - returns 1 at frame 1 with `framesPerChar=1`
  - returns N at frame N × framesPerChar
  - caps at totalChars past the end
  - handles zero-char input
- `Waveform.test.ts` — `waveformHeights(frame, barCount, fps)`:
  - returns array of length barCount
  - all values in [0, 1]
  - heights vary across bars at a given frame (not all identical)
  - cycles sensibly over time

**No tests for:**

- Extracted primitives (`ScanLines`, `FilmGrain`, `LiveChip`, `EyebrowStrip`, `Wordmark`) — presentational, no pure function worth isolating, already visually-validated via ListenNow.
- `generate-voice.ts` — pure I/O script, matches `curate-music-beds.ts` and `generate-lena-portrait.ts` no-test convention.
- `ShoutoutFlagship.tsx` — Remotion Studio is the eyeball loop; the render is the final verdict.

**Error handling:**

| Failure | Behavior |
|---|---|
| Deepgram 4xx/5xx on Luna | Retry once with Asteria fallback (matches prod behavior in `workers/queue-daemon/deepgram-tts.ts`) |
| Deepgram total failure | Script exits non-zero, no MP3 written; user sees the error and can retry |
| Missing `DEEPGRAM_API_KEY` | Startup check fails fast with friendly error |
| Empty or whitespace-only text arg | Startup check rejects, exits non-zero |
| Voice MP3 missing at render time | Remotion's native "staticFile not found" error is clear enough |
| Music bed missing | Same — Remotion errors with the missing path |

## Non-goals (explicit)

- **No Prisma / no live data.** Flagship uses a hardcoded string constant. Live data is Phase 3's `ShoutoutOfTheDay` template territory.
- **No Flux Schnell textures.** Flagship reuses ListenNow's atmosphere layer (ScanLines + FilmGrain). Flux Schnell is Phase 3 if ever.
- **No literal phone mockup.** HUD callouts do the "phone-POV" semantic work without the cheesy visual.
- **No Lena's face on screen.** Voice only.
- **No variable shoutouts per render.** One text, one MP3, one video. New variants = new compositions (in 2c or Phase 3).
- **No posting automation.** MP4 drops in `out/`, user uploads manually.
- **No HANDOFF update from 2b alone.** Update once 2b renders end-to-end AND either 2c or Phase 3 also ships — one entry covers "flagship shoutout video now exists" more cleanly than two piecemeal entries.

## Ship sequence (for writing-plans to refine)

Rough order:

1. Voice pipeline — `generate-voice.ts` script + generate + commit the flagship MP3.
2. New primitives — `TypedText` + `Waveform` with TDD on their pure functions.
3. Extract shared primitives — `ScanLines`, `FilmGrain`, `LiveChip`, `EyebrowStrip`, `Wordmark` lifted from ListenNow. ListenNow refactor is part of this step.
4. Smoke: re-render ListenNow, confirm no regression.
5. `ShoutoutFlagship.tsx` composition — invoke `frontend-design` skill at start, iterate in Studio, render.
6. First render of `out/shoutout-flagship.mp4`, user eyeball review.
7. v2 iteration loop based on user feedback (same pattern as ListenNow v1 → v2 → v3).

---

Authored through the superpowers brainstorming skill. Implementation plan comes next via writing-plans.
