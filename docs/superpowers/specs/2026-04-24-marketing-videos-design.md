# Marketing videos — Remotion pipeline for TikTok / YouTube Shorts

**Status:** brainstormed 2026-04-24, awaiting implementation plan
**Owner:** new sibling repo `~/saas/numaradio-videos` (standalone git)
**Relates to:** reuses `numaradio`'s Prisma schema, B2 bucket, Deepgram + OpenRouter credentials

## Why

Numa Radio is real, live, and interesting — but social channels are empty. TikTok / YouTube Shorts is where the audience for a personality-led AI radio station lives, and we have three native stories that work in 9:16 short form: the shoutout loop (type a message → Lena reads it live), the song-request loop (describe a mood → full track airs in minutes), and Lena herself as a 24/7 personality.

This spec designs a **Remotion-based vertical-video project** that:

1. Produces ~5 highly-polished **launch pieces** covering all three pillars plus brand/listen-now.
2. Ships a **reusable template engine** so "shoutout of the day" and "song of the week" become near-free daily content (drop new DB data → new MP4).
3. Stays **laptop-local** (renders on Orion / this WSL2 machine, no cloud rendering) while not starving the live stream.
4. Is **operationally self-service**: in 3 days, "make a shoutout video" means `npm run video:shoutout`, one command.

Defer (scope-boxed out): full auto-publish to TikTok/YouTube APIs. That's a separate future spec once the manual flow proves the format.

## What we're making

### Launch burst (hand-authored, 5 videos)

| # | Piece | Duration | Audio | Purpose |
|---|---|---|---|---|
| 1 | **Shoutout flagship** | 15s | Lena voice + music bed | The magic loop: type → Lena speaks → live. Flagship. |
| 2 | **Song-request demo** | 30s | Generated track snippet + Lena intro | The WOW. Hear a real listener-generated track. |
| 3 | **Meet Lena** | 45-60s | Lena narrates | Character piece. Canonical Flux Pro portrait front-and-center. |
| 4 | **"Never sleeps"** brand piece | 15s | Music bed only (ambient Numa track) | Pinned-video / profile-video / pure mood. |
| 5 | **Day in Numa Radio** | 30s | Music + Lena one-liners | Four-show montage (Night Shift → Morning Room → Daylight Channel → Prime Hours). |

### Templated series (data-driven, ongoing)

| Template | Cadence | Data source |
|---|---|---|
| **Shoutout of the Day** | Daily on demand | `Shoutout` rows from last 24h, filter by length + not-rejected + has `broadcastText` |
| **Song of the Week** | Weekly on demand | Listener-generated `Track` rows from last 7d, top by vote count |

Both inherit the visual DNA of pieces #1 and #2 respectively. New content = new DB pull + re-render, no code changes.

### Storyboard notes (beat-level)

**1. Shoutout flagship (15s):**
0-2s mobile input, shoutout types letter-by-letter. 2-4s submit flash, text collapses into teal waveform. 4-9s waveform → pulsing dot → NUMA RADIO wordmark; Lena voice reads the actual shoutout. 9-13s phone-POV "going live" overlay, red LIVE chip, listener count ticks up. 13-15s hard cut to `numaradio.com / REQUESTS`.

**2. Song-request demo (30s):**
0-4s typing a mood prompt. 4-6s "Lena is making your track…" loader (reusing the `.req-pending` card treatment from the real site). 6-10s Flux Schnell cover art fades in, Lena voice announces it. 10-22s the actual track plays loud (money beat). 22-28s typographic callout "Your song, on air in 4 minutes." 28-30s wordmark + URL.

**3. Meet Lena (45-60s):**
0-4s canonical portrait fades in, subtle Ken Burns, teal rim-light grade. 4-20s Lena narrates a character intro. 20-40s four-show montage, one Lena one-liner per show. 40-55s back to portrait, closing line. 55-60s wordmark.

**4. "Never sleeps" brand piece (15s):**
0-3s black frame, teal radial swells. 3-10s `THE STATION THAT NEVER SLEEPS` unfolds word-by-word in Archivo Black, red LIVE chip flickers alive. 10-13s EQ bars fill frame, pulsing dot. 13-15s wordmark + URL.

**5. Day in Numa Radio (30s):**
Clock ticks 00:00 → 06:00 → 12:00 → 18:00, ~6s per show block using that show's color palette, library music bed snippet, and a real-aired fragment from that time window (templated). Closes on "Always on. numaradio.com."

## Architecture

### Repo shape

```
~/saas/numaradio-videos/
├── package.json              remotion, @remotion/cli, prisma-client, ffmpeg-static,
│                             @deepgram/sdk, openrouter fetch helpers
├── tsconfig.json
├── remotion.config.ts        1080×1920, 30fps, H.264 slow, CRF 18
├── .env.local                DATABASE_URL, OPENROUTER_API_KEY, DEEPGRAM_API_KEY,
│                             B2_* (read-only pulls), INTERNAL_API_SECRET (optional)
├── src/
│   ├── Root.tsx              registers all compositions with Remotion
│   ├── compositions/         bespoke launch pieces (one file each)
│   │   ├── ShoutoutFlagship.tsx
│   │   ├── SongRequestDemo.tsx
│   │   ├── MeetLena.tsx
│   │   ├── ListenNow.tsx
│   │   └── DayInNuma.tsx
│   ├── templates/            parameterized, data-driven series compositions
│   │   ├── ShoutoutOfTheDay.tsx
│   │   └── SongOfTheWeek.tsx
│   ├── primitives/           reusable motion building blocks
│   │   ├── PulsingDot.tsx
│   │   ├── Waveform.tsx
│   │   ├── EqBars.tsx
│   │   ├── TypedText.tsx
│   │   ├── PhoneFrame.tsx
│   │   ├── LenaPortrait.tsx
│   │   ├── BrandTitle.tsx
│   │   └── MusicBed.tsx
│   ├── tokens/brand.ts       color + font + timing constants (mirrored from numaradio)
│   ├── data/
│   │   ├── prisma.ts         read-only Prisma client
│   │   ├── pickShoutout.ts
│   │   └── pickSongOfWeek.ts
│   ├── assets/
│   │   ├── lena/             canonical Flux Pro portrait(s), versioned (v1, v2...)
│   │   ├── music-beds/       curated Numa tracks (video_safe), trimmed + faded
│   │   ├── textures/         Flux Schnell generations, cached per composition
│   │   └── voice/            Deepgram TTS renders, regeneratable
│   └── scripts/
│       ├── generate-lena-portrait.ts    one-shot, Flux Pro, prompt candidates
│       ├── curate-music-beds.ts         B2 pull + ffmpeg trim
│       ├── generate-texture.ts          Flux Schnell on-demand for a composition
│       ├── generate-voice.ts            Deepgram Luna per-composition
│       └── render-*.ts                  thin wrappers around @remotion/renderer
├── out/                      rendered MP4s (gitignored)
├── prisma/                   symlink or copied schema.prisma from numaradio
└── README.md
```

### Key architectural choices

- **Prisma reused, read-only.** The videos repo uses the same `DATABASE_URL` and reads the generated client. Discipline-only read-only (no Prisma-level enforcement — we just never call mutations and never add migrations here). When `numaradio`'s schema changes, `prisma generate` in the videos repo picks it up.
- **Brand tokens duplicated, not cross-imported.** A tiny `src/tokens/brand.ts` hard-codes the palette and font names that live in `numaradio`'s `_design-base.css`. Low drift risk (the palette is stable), zero cross-repo coupling.
- **Compositions vs. templates.** `compositions/` are bespoke launch pieces; `templates/` are parameterized series engines. Video #6, #7… are new data, not new code (or in the worst case, a new template that composes existing primitives).
- **Primitives carry the reuse.** Every visually-interesting element lives in `primitives/` as a pure React component with a stable prop interface. A new composition is mostly *composing primitives* — which is how "reusable" becomes a property of the code, not just the data.

### Render pipeline (laptop-only, CPU-capped)

Remotion CLI + Remotion Studio on this machine. Renders run:

```bash
nice -n 10 npx remotion render <comp> out/<name>.mp4 \
  --concurrency 4 --crf 18 --preset slow --codec h264
```

- `nice -n 10` so Liquidsoap + Icecast + NanoClaw keep CPU priority — the live stream must never glitch from a render.
- `--concurrency 4` caps Chromium workers (don't peg all cores).
- 1080×1920 @ 30fps, H.264 slow, CRF 18 — high-polish baseline.
- Expected render times: ~2-5 min per minute of video on modern hardware. Acceptable.

### Data flow

1. Template composition declares it needs `inputProps` matching a TypeScript interface (e.g., `{ shoutoutText: string; listenerName?: string; airedAt: Date }`).
2. A `src/scripts/render-shoutout-of-day.ts` wrapper:
   - Calls `pickShoutout()` → returns the qualifying row or throws `NoValidContentError`.
   - Generates Deepgram voice for that shoutout's text → `src/assets/voice/shoutout-of-day.mp3`.
   - (Optionally generates a fresh Flux Schnell texture per piece.)
   - Invokes `@remotion/renderer` with composition id + inputProps + asset paths.
   - Prints start line, then `✓ Rendered to out/shoutout-2026-04-27.mp4 (17.8 MB, 15.0s)`.
3. On failure, writes a line to `out/render-failures.log` and exits non-zero.

### Asset pipelines

- **Lena canonical portrait.** Run `npx tsx src/scripts/generate-lena-portrait.ts` once. Script hits OpenRouter Flux Pro with 3-5 candidate prompts (editorial / moody / dark backdrop / teal rim light), writes `src/assets/lena/candidate-{1..5}.png`. User reviews, renames the keeper to `lena-v1.png`, commits. Never overwritten — a hypothetical v2 would be `lena-v2.png`.
- **Music beds.** Run `npx tsx src/scripts/curate-music-beds.ts` once (pass a JSON array of Track ids). Script downloads MP3s from B2, uses `ffmpeg-static` to trim to 30-60s clips with 1s fade-in / 2s fade-out, writes to `src/assets/music-beds/<title>-<id>.mp3`. Commits (our IP).
- **Textures.** `generate-texture.ts` takes a `(compositionName, prompt)` pair, hits OpenRouter's cheap-tier Flux (Schnell / Klein 4B — whichever benchmarks best at setup time), saves to `src/assets/textures/<name>-<hash>.png`. Cached: a composition always re-uses the same texture unless its prompt hash changes. Kontext is available for image-edit ops when we later need a pose variant of Lena while preserving identity.
- **Lena's TTS voice lines.** `generate-voice.ts` takes `(compositionName, text)`, hits Deepgram Luna (same pipeline as prod), saves to `src/assets/voice/<name>.mp3`. Regeneratable any time.

## Operational workflow (the "3-days-later" surface)

From `~/saas/numaradio-videos`:

```bash
# Templated pulls (most common future workflow)
npm run video:shoutout          # shoutout of the day
npm run video:song              # song of the week

# Launch pieces (rendered rarely, mostly during initial burst)
npm run render ShoutoutFlagship
npm run render SongRequestDemo
npm run render MeetLena
npm run render ListenNow
npm run render DayInNuma

# Preview / iterate
npm run studio                  # Remotion Studio hot-reload

# Asset scripts (run during setup)
npm run assets:lena             # one-time: generate Lena portrait candidates
npm run assets:music            # one-time: curate music bed pool
```

Success output format:

```
→ Pulling shoutout from Neon (last 24h, filter: length>20, approved, has broadcastText)...
→ Selected row 2026-04-27T14:32Z: "shoutout to my mom, she listens every morning" (47 chars)
→ Generating Deepgram voice (Luna)...
→ Rendering ShoutoutOfTheDay (15.0s, 1080×1920, 30fps)...
✓ Rendered to out/shoutout-2026-04-27.mp4 (17.8 MB, 15.0s) in 3m 12s
```

Failure output:

```
✗ No shoutouts meet the bar in the last 24h (found: 3 candidates, all < 20 chars).
  Check dashboard.numaradio.com/shoutouts or try again later.
```

**Memory entry I'll save during implementation:** a reference memory mapping "make a shoutout video" / "make a song video" to the exact commands + expected output folder, so a future session starts executing immediately instead of re-exploring the repo.

## Testing + error handling

### What we test

Unit tests on the data pickers only, because they carry the real edge-case risk:

- `pickShoutout`: returns nothing when no qualifying rows; returns nothing when all too short; returns nothing when all rejected; returns the right row when multiple qualify (newest wins).
- `pickSongOfWeek`: returns nothing when no listener-generated tracks in last 7d; returns top-voted when multiple qualify; ties broken by most-recent.

~6-10 tests total with a faked Prisma client (hand-rolled or via `vitest-mock-extended` style). Same Node test runner convention as `numaradio` (`node --test --experimental-strip-types`).

### What we don't test

- Compositions themselves. Remotion Studio is the eyeball loop. Automated "did this look right" is not a thing.
- Asset generation scripts (they make network calls; test the pickers, not the I/O).
- Render CLI wrappers (too thin to test meaningfully).

### Error handling

| Failure | Behavior |
|---|---|
| Data picker returns no qualifying row | Throw `NoValidContentError`; render script prints friendly message, exits 1. |
| Flux / Deepgram / OpenRouter API transient error | Retry once after 5s; second failure: write to `out/render-failures.log`, exit 1. |
| Lena portrait asset missing | Startup check in render scripts: "Lena portrait not generated. Run `npm run assets:lena` first." Exit 1. |
| Music bed not curated | Same pattern — friendly "run `npm run assets:music` first". |
| Prisma connection error | Let it bubble — it'll be obvious, usually indicates `.env.local` not set. |

## What this doesn't do (explicit non-goals)

- **No auto-publish.** We render MP4s. User uploads to TikTok / YouTube manually. Automation is a future spec.
- **No illustrated / animated Lena character.** One canonical Flux Pro portrait (photorealistic-editorial style). If audience response demands a cartoon Lena, separate spec.
- **No Remotion Lambda.** Local renders only. Migration path is clean if cadence ever demands it, but not now.
- **No per-video custom music licensing.** Music beds come from the Numa catalog only (or MiniMax-generated as fallback).
- **No tests for compositions.** Studio preview is the verification.
- **No monorepo / workspaces.** Sibling repo, standalone.
- **Videos repo does not write to Neon or B2.** Read-only for DB; B2 reads only to pull music stems and (later) listener-song cover art for the Song-of-the-Week template.

## Open implementation questions (for the plan, not this spec)

- Exact Prisma-client sharing mechanism: symlink `schema.prisma`, or copy-on-setup, or publish as a private package? The implementation plan should decide.
- Exact CLI/script framework: plain `tsx`, or `commander`, or just `npm run` wrappers. Simplest viable wins.
- Font loading: Archivo Black + Inter Tight + JetBrains Mono via `@remotion/google-fonts`, or via local font files in `src/assets/fonts/`. Implementation plan to choose.
- Output file naming scheme for templated series — ISO date vs. epoch vs. source-row-id. Minor.

## Ship sequence (rough)

This sequence is for the plan skill to refine. The order roughly is:

1. Scaffold repo, Remotion init, brand tokens, Prisma sharing.
2. Primitives: `PulsingDot`, `Waveform`, `EqBars`, `TypedText`, `BrandTitle`. Studio-preview as we go.
3. Asset scripts: Lena portrait generation (user picks keeper), music bed curation.
4. Launch piece #4 "Never sleeps" — smallest, pure brand, best primitive stress-test.
5. Launch piece #1 "Shoutout flagship" — adds Lena voice pipeline.
6. Launch pieces #2, #3, #5.
7. Data pickers + unit tests.
8. Templated series #1 Shoutout of the Day.
9. Templated series #2 Song of the Week.
10. `npm run` wrappers + README + memory entry.

---

Design authored through the superpowers brainstorming skill. Implementation plan comes next via the writing-plans skill.
