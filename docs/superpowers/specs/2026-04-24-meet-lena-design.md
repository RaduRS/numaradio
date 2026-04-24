# MeetLena — Stage 2c.1 of marketing videos

**Status:** brainstormed 2026-04-24, awaiting implementation plan
**Owner:** new composition + 2 new primitives in `~/saas/numaradio-videos/`
**Relates to:** Stage 2c.1 of `docs/superpowers/specs/2026-04-24-marketing-videos-design.md`. Follows Stage 2a (Lena canonical portrait) and Stage 2b (ShoutoutFlagship + voice pipeline). Stage 2c.2 (SongRequestDemo + DayInNuma) brainstormed next, after 2c.1 ships.

## Why

The canonical Lena portrait has existed since Stage 2a but hasn't appeared in any rendered video. MeetLena is the audience's first proper introduction — her face, her voice, her shift structure. It's the character piece that makes followers attach to a person, not just a station. Also: it's the longest launch piece (60s), which establishes that Numa Radio is willing to ask for a full minute of attention when the content earns it.

## What we're making

1. A 60-second vertical composition — `ShoutoutFlagship` is the magic-loop flagship; `MeetLena` is the character flagship. Together they're the two pinned pieces that anchor the profile.
2. Two new primitives — `LenaPortrait` and `ShowPanel` — both reusable in Stage 2c.2 and Phase 3.
3. Six committed voice MP3s — one intro monologue, four show one-liners, one closer.

## The approved monologue

Opening (18s):

> *"I'm Lena. I run the night shift, the morning room, the daylight channel, and prime hours. I read every shoutout you send. I make every song you request. I try to say something worth hearing between tracks."*

Four show one-liners:

- Night Shift: *"Night Shift — for when you can't sleep either."*
- Morning Room: *"Morning Room — first coffee, warmer tones."*
- Daylight Channel: *"Daylight Channel — heads down, eyes up."*
- Prime Hours: *"Prime Hours — request wall runs loudest."*

Closer (~4s):

> *"I don't sleep. Come find me. numaradio.com."*

Same voice model as the flagship (Deepgram Asteria `aura-asteria-en` — user-approved warmer alternative to Luna). All six MP3s generated via the existing `src/scripts/generate-voice.ts` and committed after a one-time audition gate at the end of the voice-generation task.

## Architecture

### Beat-by-beat storyboard

**60s = 1800 frames @ 30fps, 1080×1920.**

**Beat 1 — Portrait reveal (frames 0-120, 0-4s).**
Persistent atmosphere snap-in by frame 6: `ScanLines`, `FilmGrain`, `LiveChip`, `EyebrowStrip text="Numa Radio · Meet Your Host"`. Canonical Lena portrait fades in over frames 0-30 via `LenaPortrait`. Ken Burns zoom scales 1.00 → 1.05 over the full 120 frames. No voice yet — the face earns the dramatic hold.

**Beat 2 — Intro monologue (frames 120-660, 4-22s).**
Portrait continues; Ken Burns continues to 1.10 by frame 660. Light teal color-grade overlay (low opacity, pulses subtly) ties portrait to brand palette. Low-opacity `Waveform` along the bottom visualizes the voice (same vocabulary as flagship). Voice MP3 `voice/meet-lena-intro.mp3` plays at frame 120. Music ducks per the multi-window `musicBedVolume` helper during this voice window.

**Beat 3 — Four-show montage (frames 660-1260, 22-42s).**
Hard-cut panels, 150 frames each. Each panel is a `ShowPanel` with show-specific accent color:

| Show | Frames | Color palette |
|---|---|---|
| Night Shift (00-05) | 660-810 | dim blue — `#1a2332` background, muted cyan accent |
| Morning Room (05-10) | 810-960 | warm amber — `#2a1f15` background, warm cream accent |
| Daylight Channel (10-17) | 960-1110 | neutral — `#1e2024` background, pale grey accent |
| Prime Hours (17-24) | 1110-1260 | saturated teal — `#0a1a1c` background, full brand teal accent |

Each panel layout: large Archivo Black show name, mono time label below (e.g., `00:00 — 05:00`), short description, and Lena's one-liner voice overlay. Voice MP3s `voice/meet-lena-{night-shift,morning-room,daylight-channel,prime-hours}.mp3` play at the start of each 150-frame panel. Music ducks per panel, swells briefly between.

**Beat 4 — Return + closer (frames 1260-1650, 42-55s).**
Hard cut back to `LenaPortrait`. Ken Burns pulls back slightly (scale 1.10 → 1.00) so the closing frame is the same framing as the opening — symmetry. Voice MP3 `voice/meet-lena-closer.mp3` at frame 1260. Music ducks for the closer, then starts its fade-out.

**Beat 5 — Payoff (frames 1650-1800, 55-60s).**
Same pattern as ListenNow and ShoutoutFlagship's payoffs: hard cut → `Wordmark` stacked → teal underline wipe L→R → `numaradio.com` mono below. `LiveChip` persistent top-right. Music bed tail.

### New primitives

**`src/primitives/LenaPortrait.tsx`:**

```ts
interface LenaPortraitProps {
  zoomStart?: number;   // default 1.0
  zoomEnd?: number;     // default 1.05
  tealGrade?: number;   // 0.0 to 1.0, default 0.15
}
```

Wraps `staticFile("lena/lena-v1.png")` in an `AbsoluteFill` with `objectFit: cover`. Interpolates scale from `zoomStart` to `zoomEnd` over the sequence's duration. Optional teal overlay at `tealGrade` opacity using `mixBlendMode: overlay` for color grade. Reusable for any composition needing Lena's face.

Tests: `portraitScale(frame, durationFrames, zoomStart, zoomEnd)` pure function — edge cases for frame=0, frame=duration, middle, negative, over-duration.

**`src/primitives/ShowPanel.tsx`:**

```ts
interface ShowPanelProps {
  name: string;                    // "Night Shift"
  timeLabel: string;               // "00:00 — 05:00"
  description: string;             // "for when you can't sleep either"
  backgroundColor: string;         // "#1a2332"
  accentColor: string;             // "#4a7a9e"
}
```

Full-screen panel: background color fills, Archivo Black display for `name` (very large, centered), mono `timeLabel` below, body-font `description` below that, one atmospheric element (a thin line in accent color, or a small show-specific icon). Entrance: hard cut in, content fades in over 10 frames. No internal animation — simplicity reads as editorial rather than over-designed.

No unit tests — presentational primitive with no testable pure logic beyond what's obvious from props.

### Existing primitives reused

- `ScanLines`, `FilmGrain`, `LiveChip`, `EyebrowStrip`, `Wordmark` — Stage 2b extracted, all reused as-is.
- `Waveform` — used in Beat 2 (ambient under Lena's monologue).
- Neither `BrandTitle` nor `TypedText` nor `PulsingDot` nor `EqBars` nor `MusicBed` are used directly in MeetLena; the `ShowPanel` renders its own typography via direct JSX rather than going through `BrandTitle` (which has its own reveal animation that would fight the panel's static feel).

### Voice pipeline

Six Deepgram Asteria TTS generations via `generate-voice.ts`. Names:

- `voice/meet-lena-intro.mp3`
- `voice/meet-lena-night-shift.mp3`
- `voice/meet-lena-morning-room.mp3`
- `voice/meet-lena-daylight-channel.mp3`
- `voice/meet-lena-prime-hours.mp3`
- `voice/meet-lena-closer.mp3`

Generation workflow: plan task runs the script six times, copies all six MP3s to Windows desktop in one batch, user auditions them as a batch (one gate for all six, not six separate gates). If any sound wrong, we iterate on that specific one; the rest hold. All six commit together once user approves.

### Music bed

`music-beds/bed-03-ocean-eyes.mp3` — the third and final curated bed (bed-01 is ListenNow, bed-02 is flagship). Rotating the full set means the launch trio has distinct sonic identities.

Multi-window ducking via a `musicBedVolume(frame)` helper in the composition file. Duck windows (all in comp-frames):

| Voice segment | Duck from | Duck start | Ducked end | Duck to |
|---|---|---|---|---|
| Intro monologue | 1.0 | 110 | 675 | 0.25 |
| Night Shift one-liner | 1.0 | 660 | 795 | 0.25 |
| Morning Room one-liner | 1.0 | 810 | 945 | 0.25 |
| Daylight Channel one-liner | 1.0 | 960 | 1095 | 0.25 |
| Prime Hours one-liner | 1.0 | 1110 | 1245 | 0.25 |
| Closer | 1.0 | 1255 | 1440 | 0.25 |

500ms fade (15 frames) into and out of each duck. Between consecutive ducks (e.g. between Night Shift and Morning Room) there's only 15 frames of non-ducked space — in practice the music stays at 0.25 across the entire montage. That's intentional — the montage reads as one continuous voiced segment, not four separate ones.

Simpler alternative the implementation can adopt: duck flat to 0.25 across the entire voice region (frame 110 to frame 1440) in one continuous window, then ramp back up for the payoff. Same perceptual result, much cleaner function. **Prefer this simpler version unless preview suggests the per-segment pumping actually improves listenability.**

## Testing + error handling

### Tests we write

- `LenaPortrait.test.ts` — `portraitScale(frame, duration, zoomStart, zoomEnd)`:
  - returns zoomStart at frame 0
  - returns zoomEnd at frame duration
  - linear interpolation at midpoint
  - clamps before/after range
  - handles zoomStart == zoomEnd (no-op zoom)

~5 tests.

### No tests for

- `ShowPanel.tsx` — presentational, no logic.
- `MeetLena.tsx` — Studio is the eyeball loop.
- Voice pipeline — it reuses the already-tested generate-voice.ts; no new script.

### Error handling

| Failure | Behavior |
|---|---|
| Any voice MP3 missing at render | Remotion's native "staticFile not found" — clear enough |
| Lena portrait missing | Same — file not found on staticFile("lena/lena-v1.png") |
| Deepgram failure during voice gen | generate-voice.ts already handles Luna → Asteria fallback (though Asteria is primary now, so the fallback is now moot — MODEL_FALLBACK matches MODEL_PRIMARY). Not blocking. |

## Non-goals (explicit)

- **No Prisma / no live DB data.** Show one-liners are scripted, not pulled from real aired shoutouts. Phase 3 can layer real data on top.
- **No Flux Schnell textures.** Show panels use typography + color only.
- **No cover art, no album mocks.** MeetLena doesn't need them.
- **No audio primitive extraction.** Voice plays via inline `<Audio>` (same precedent as flagship). Rule-of-2 would trigger extraction if a third composition needed bespoke audio handling.
- **No LenaPortrait prop for rotation / skew / fancy transforms.** Just zoom and optional teal tint. Simpler.
- **No HANDOFF.md update for 2c.1 alone.** Updates once 2c.2 also ships — single cleaner entry.

## Ship sequence (for writing-plans to refine)

Rough order:

1. Voice pipeline — generate + audition all 6 MP3s, user approves, commit.
2. `LenaPortrait` primitive — TDD on the pure function.
3. `ShowPanel` primitive — no tests, direct implementation.
4. `MeetLena.tsx` composition — invoke `frontend-design` skill at task start, iterate in Studio, render.
5. First render of `out/meet-lena.mp4` + user eyeball checkpoint.
6. v2+ iteration loop per Studio preview feedback — same pattern as ListenNow / ShoutoutFlagship.

---

Authored through the superpowers brainstorming skill. Implementation plan next via writing-plans.
