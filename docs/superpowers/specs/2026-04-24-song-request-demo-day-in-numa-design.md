# SongRequestDemo + DayInNuma — Stage 2c.2 of marketing videos

**Status:** brainstormed 2026-04-24, awaiting implementation plan
**Owner:** two new compositions in `~/saas/numaradio-videos/`
**Relates to:** Stage 2c.2 of `docs/superpowers/specs/2026-04-24-marketing-videos-design.md`. Follows 2c.1 (MeetLena). Closes the launch set.

## Why

These are the two remaining launch pieces from the parent spec. `SongRequestDemo` sells the station's biggest WOW feature — describe a mood, hear the song on air in minutes. `DayInNuma` sells the 24/7 rhythm by walking the viewer through all four show blocks in 30 seconds. Together with ListenNow, ShoutoutFlagship, and MeetLena, these complete the 5-piece launch set.

Bundled into one spec because they share infrastructure (voice pipeline, atmosphere primitives, ShowPanel, payoff pattern) and neither is large enough to warrant its own spec/plan cycle. Each is independently testable and shippable — one plan with two composition tasks.

## What we're making

| Composition | Duration | Pitch |
|---|---|---|
| `SongRequestDemo` | 30s | Type a mood, watch Lena make a fresh song, hear the money beat. |
| `DayInNuma` | 30s | 24 hours in 30 seconds — four show blocks with Lena's voice. |

Plus:
- One fresh MiniMax-generated track (committed MP3 + Flux cover art).
- One new Lena voice clip (song announcement, via existing `generate-voice.ts`).
- Regenerated `bed-01-midnight-drive.mp3` at 35s durationSeconds (the 20s version won't cover DayInNuma).

## Architecture

### Shared mechanics

- **Atmosphere always on** via `ScanLines`, `FilmGrain`, `LiveChip`, `EyebrowStrip` — reused from 2b/2c.1.
- **Voice pipeline** — Helena (`aura-2-helena-en`) via existing `src/scripts/generate-voice.ts`.
- **Music ducking** — existing `musicBedVolume(frame)` helper pattern, tuned per composition.
- **Payoff** — Wordmark + teal underline wipe + `numaradio.com`, same mechanic as ListenNow / ShoutoutFlagship / MeetLena.
- **Frontend-design skill invocation** — required at the start of each composition task (same policy as ShoutoutFlagship and MeetLena).

### SongRequestDemo — beat-by-beat

**30s = 900 frames @ 30fps, 1080×1920.** No music bed — the generated track is the audio during its money beat.

**Beat 1 — Type the mood (frames 0-120, 0-4s).**
Atmosphere snap-in by frame 6. Eyebrow "Numa Radio · Song Request", LiveChip top-right. Mobile-input card (same visual vocabulary as ShoutoutFlagship's Beat 2 input card) with `TypedText` showing the approved mood prompt *"late-night drive, warm synths, 95 bpm, a little melancholy"* (~58 chars at framesPerChar=2 = ~116 frames). Teal caret blinks. No audio — silence sells the input moment.

**Beat 2 — "Lena is making your track…" loader (frames 120-180, 4-6s).**
Card fades/collapses. Loader state replaces it for 2 seconds (snappier than a 4s hold — viewers on TikTok don't wait):
- Centered: pulsing teal `PulsingDot` inside a ring with emanating waves (reuse `RadiatingDot` pattern from ListenNow)
- Below: mono "LENA IS MAKING YOUR TRACK" (letter-spacing 0.32em)
- Below that: ticking timecode progress (e.g. "0:01" → "0:06", mono — ticks 5 seconds over 2 actual seconds, implying compressed time for the "making")
Still no audio — building suspense briefly.

**Beat 3 — Cover art reveal + Lena announcement (frames 180-300, 6-10s).**
Hard cut. Flux-generated cover art fades in with subtle Ken Burns (inline `CoverArt` component, same pattern as `LenaPortrait` but for an album cover at full-bleed). Title overlay: the track's actual name from MiniMax (e.g. "Nightwarm") in Archivo Black at upper third, mono sublabel "LISTENER REQUEST · NOW PLAYING". Lena voice plays at frame 180: *"Here's your late-night drive. Fresh track, on Numa Radio."* (~5s).

**Beat 4 — Money beat (frames 300-780, 10-26s).**
**The generated track plays at full volume for 16 seconds.** This is the TikTok retention hook — anyone still watching by frame 300 is invested, so reward them with as much real polished song as we can fit. The extra 2 seconds from the shortened Beat 2 went here. Visuals continue:
- Cover art Ken Burns continues
- Low-opacity `Waveform` across the bottom
- Listener count ticker: "LISTENING: 27 → 31 → 38 → 44" (one tick per ~4s, mono)
Lena is silent — the track owns this section.

**Beat 5 — Typographic callout (frames 780-840, 26-28s).**
Track volume ducks slightly (0.25 via `musicBedVolume` helper applied to the track `<Audio>`). Archivo Black callout: *"YOUR SONG · ON AIR IN 4 MINUTES"* punches in centered, holds.

**Beat 6 — Payoff (frames 840-900, 28-30s).**
Hard cut to `Wordmark` + teal underline wipe + `numaradio.com` mono. Track tails. LiveChip persistent.

### DayInNuma — beat-by-beat

**30s = 900 frames @ 30fps, 1080×1920.** Music bed: `bed-01-midnight-drive.mp3` (regenerated at 35s) plays throughout with no ducking needed — the Lena clips are short one-liners overlaying the bed.

**Beat 0 — Open (frames 0-60, 0-2s).**
Atmosphere snap-in. Eyebrow "Numa Radio · 24 / 7". LiveChip top-right. Big centered mono clock: *"00:00"* in 180px JetBrains Mono, pulses once.

**Beats 1-4 — Four show panels (frames 60-780, 24s = 6s each).**

| Panel | Frames | Clock | Show | Voice MP3 (new, rephrased) | Voice text | "Now playing" fragment |
|---|---|---|---|---|---|---|
| 1 | 60-240 | 00:00 | Night Shift | `day-in-numa-night-shift.mp3` | *"Night Shift. Quiet hours, wide spaces."* | "Now playing: 'Blue Hours' — request from Mira" |
| 2 | 240-420 | 06:00 | Morning Room | `day-in-numa-morning-room.mp3` | *"Morning Room. Coffee's on, softer tones."* | "Now playing: 'First Light' — request from Jakob" |
| 3 | 420-600 | 12:00 | Daylight Channel | `day-in-numa-daylight-channel.mp3` | *"Daylight Channel. Focus music, longer tracks."* | "Now playing: 'Focus Hours' — anonymous" |
| 4 | 600-780 | 18:00 | Prime Hours | `day-in-numa-prime-hours.mp3` | *"Prime Hours. Dinner to midnight, louder music."* | "Now playing: 'Heavy Weather' — request from Sana" |

Each panel uses `ShowPanel` primitive (same palette as MeetLena). Layered on top of the ShowPanel: a big clock in mono at top-center, and the "Now playing" mono strip at the bottom. Lena voice clip plays at the start of each 180-frame panel (panels are 6s, clips are ~4s, leaving ~2s of musical breathing room before the next panel).

The DayInNuma clips are **intentionally rephrased** from MeetLena's versions, not verbatim. Same core meaning (each show's vibe) but different phrasing, so a viewer who's seen both compositions hears consistency-without-repetition. Generated via the same `generate-voice.ts` + Helena pipeline.

**Beat 5 — Close (frames 780-900, 26-30s).**
Hard cut to `Wordmark` + teal underline wipe + `numaradio.com` + small mono "ALWAYS ON · 24 / 7" below the URL. Music bed tails over the final 60 frames.

### New assets (one-time generation)

1. **MiniMax-generated track for SongRequestDemo.**
   - Prompt: *"late-night drive, warm synths, 95 bpm, a little melancholy"* (via the production song pipeline).
   - Output: ~2-3 min MP3 + Flux-generated cover art.
   - Trim to a ~20s segment (startSeconds chosen to hit a strong section, covers Beats 3-6 with comfortable margin).
   - Commit: `src/assets/song-request/track.mp3` + `src/assets/song-request/cover.png`.
   - Cost: ~$0.30-0.50, ~60s wait.

2. **New Lena voice clips — 5 total.**
   - `src/assets/voice/song-request-announce.mp3`: *"Here's your late-night drive. Fresh track, on Numa Radio."*
   - `src/assets/voice/day-in-numa-night-shift.mp3`: *"Night Shift. Quiet hours, wide spaces."*
   - `src/assets/voice/day-in-numa-morning-room.mp3`: *"Morning Room. Coffee's on, softer tones."*
   - `src/assets/voice/day-in-numa-daylight-channel.mp3`: *"Daylight Channel. Focus music, longer tracks."*
   - `src/assets/voice/day-in-numa-prime-hours.mp3`: *"Prime Hours. Dinner to midnight, louder music."*
   - All via existing `generate-voice.ts` — Helena, same pattern as 2c.1. One batch audition gate (same shape as MeetLena's 6-clip audition).

3. **Extended bed-01 music bed.**
   - Edit `src/scripts/music-bed-pool.json`: change bed-01's `durationSeconds` from 20 to 35.
   - Re-run `curate-music-beds.ts` (re-encodes all three beds; bed-02 and bed-03 stay same length, bed-01 gets longer).
   - Commit the updated JSON + the new bed-01 MP3.

### New primitives

**None.** Rule-of-2 applied:
- `CoverArt` for SongRequestDemo Beat 3 — inline (first consumer). Extract in Phase 3 if Song-of-the-Week template also uses it.
- `ClockTicker` for DayInNuma — inline (first consumer). Simple component per panel, just changes the `time` label prop.
- `NowPlayingStrip` for DayInNuma — inline per panel.

### Composition file structure

- `src/compositions/SongRequestDemo.tsx` — new
- `src/compositions/DayInNuma.tsx` — new
- `src/Root.tsx` — modify, add two new `<Composition>` registrations (total 5 compositions after this)
- `src/scripts/music-bed-pool.json` — modify (bed-01 durationSeconds 20 → 35)
- `src/assets/voice/song-request-announce.mp3` — new
- `src/assets/music-beds/bed-01-midnight-drive.mp3` — regenerated (longer)
- `src/assets/song-request/track.mp3` — new (MiniMax-generated, committed)
- `src/assets/song-request/cover.png` — new (Flux-generated, committed)

### MiniMax track generation — implementation notes

The production song pipeline lives at `~/saas/numaradio/workers/song-worker/`. For this one-off, we'll either:
- **Option 1 (preferred):** Write a small one-off script `src/scripts/generate-song-request-track.ts` in the videos repo that calls MiniMax music-2.6 + OpenRouter Flux artwork directly with our chosen prompt, commits the outputs. Avoids coupling to numaradio's full pipeline.
- **Option 2:** Trigger the numaradio production pipeline via a listener-shoutout style submission, then manually copy the resulting MP3 + cover from B2 into the videos repo.

The plan will choose based on what's cleanest at implementation time. Either way, both MP3 and PNG are committed to the videos repo so renders are reproducible and offline-safe.

## Testing + error handling

**Tests we write:** none new. All pure-function primitives (TypedText, Waveform, etc.) are already tested from prior stages. The inline `CoverArt`, `ClockTicker`, `NowPlayingStrip` components are presentational and don't need tests.

**Error handling:** Remotion's native "staticFile not found" errors are clear enough if any asset goes missing. Script-level generation already handles Deepgram/MiniMax/Flux failures via existing patterns.

## Non-goals (explicit)

- **No Prisma / no live DB data.** DayInNuma's "now playing" fragments are scripted text, not DB queries. SongRequestDemo uses a hardcoded MiniMax output.
- **No Flux Schnell texture generation per video.** SongRequestDemo's cover art is a one-time Flux Pro/Schnell generation during the MiniMax pipeline call, committed. No per-render Flux calls.
- **No audio primitive extraction.** Voice still plays via inline `<Audio>` (same as 2b/2c.1). Rule-of-2 threshold not yet met.
- **No new LenaPortrait cameos.** Neither composition needs her face — they're about features + rhythm.
- **Rephrased voice lines for DayInNuma, not verbatim.** We generate 4 new Helena clips with slightly different phrasing (same meaning as MeetLena's show one-liners, different words). Consistency-without-repetition.
- **No HANDOFF.md update after just 2c.2.** Ships with the post-2c.2 wrap — one clean entry covering all five launch pieces rather than piecemeal entries per stage.

## Ship sequence (for writing-plans)

Rough order:

1. Regenerate bed-01 at 35s (pool JSON edit + curate script run + commit).
2. Generate SongRequestDemo track + cover via a one-off script (MiniMax + Flux). User auditions, approves, commits.
3. Generate the new Lena announcement voice clip. User auditions, approves, commits.
4. Build `SongRequestDemo.tsx` composition with frontend-design skill invocation. Render. User eyeballs. Iterate if needed.
5. Build `DayInNuma.tsx` composition with frontend-design skill invocation. Render. User eyeballs. Iterate if needed.
6. Register both in `Root.tsx`. Final renders of both.
7. After both approved, final session wrap: update `HANDOFF.md` in the main repo with the full 5-piece launch set.

---

Authored through the superpowers brainstorming skill. Implementation plan next via writing-plans.
