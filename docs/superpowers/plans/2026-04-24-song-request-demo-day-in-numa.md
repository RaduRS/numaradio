# SongRequestDemo + DayInNuma Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the two 30-second launch pieces `SongRequestDemo` (type a mood → MiniMax makes a fresh track → 16-second money beat) and `DayInNuma` (24-hour show-block montage with rephrased Lena voice-overs), finishing the 5-piece launch set.

**Architecture:** Five tasks. (1) Extend `bed-01-midnight-drive.mp3` from 20s to 35s so it covers DayInNuma. (2) Generate a MiniMax music-2.6 track + OpenRouter Flux cover art by copying numaradio's existing song-worker helpers into the videos repo as a one-off orchestrator — user auditions + commits both assets. (3) Batch-generate 5 new Helena voice clips via the existing `generate-voice.ts` (1 for SongRequestDemo announce, 4 rephrased show one-liners for DayInNuma) with a single audition gate. (4) Build `SongRequestDemo.tsx` with `frontend-design` skill invoked first. (5) Build `DayInNuma.tsx` with same pattern. Both register in `Root.tsx`, both render end-to-end.

**Tech Stack:** Remotion 4.x, TypeScript, `tsx`, existing Deepgram/MiniMax/OpenRouter patterns from numaradio, node's `--test` runner.

**Spec:** `docs/superpowers/specs/2026-04-24-song-request-demo-day-in-numa-design.md`

---

## Task 1: Extend bed-01 music bed to 35s

**Files:**
- Modify: `~/saas/numaradio-videos/src/scripts/music-bed-pool.json`
- Regenerate: `~/saas/numaradio-videos/src/assets/music-beds/bed-01-midnight-drive.mp3`
  (side effect: bed-02 and bed-03 also get re-encoded since the script iterates all three, but their durations stay at 20s/55s respectively — content identical)

No unit tests — same pattern as earlier music-bed work.

- [ ] **Step 1: Edit `src/scripts/music-bed-pool.json`**

Find the bed-01 entry (first entry in the `beds` array). Change its `durationSeconds` field from `20` to `35`. Leave all other fields (id, b2Key, startSeconds, fadeInSeconds, fadeOutSeconds) and the bed-02/bed-03 entries untouched.

Verify:
```bash
cd /home/marku/saas/numaradio-videos
grep -A 6 "bed-01-midnight-drive" src/scripts/music-bed-pool.json | grep "durationSeconds"
```

Expected: `"durationSeconds": 35,`

- [ ] **Step 2: Regenerate the beds**

```bash
cd /home/marku/saas/numaradio-videos
npx tsx src/scripts/curate-music-beds.ts
```

Expected: all 3 beds re-encode (~30-60s total). Completion line `✓ 3/3 beds written`.

- [ ] **Step 3: Verify bed-01 is now 35s**

```bash
./node_modules/@remotion/compositor-linux-x64-gnu/ffprobe -v error -show_entries format=duration \
  src/assets/music-beds/bed-01-midnight-drive.mp3
```

Expected: `duration≈35.0` (35.0 to 35.1 acceptable; ffmpeg pads to frame boundary).

- [ ] **Step 4: Commit**

```bash
cd /home/marku/saas/numaradio-videos
git add src/scripts/music-bed-pool.json \
  src/assets/music-beds/bed-01-midnight-drive.mp3 \
  src/assets/music-beds/bed-02-rainy-blue-echoes.mp3 \
  src/assets/music-beds/bed-03-ocean-eyes.mp3
git commit -m "music-beds: extend bed-01 to 35s for DayInNuma coverage"
```

Verify:
```bash
git log --oneline -1
git status
```

Expected: one new commit, tree clean.

---

## Task 2: Generate SongRequestDemo track + cover art (MiniMax music-2.6 + Flux)

**Files:**
- Create: `~/saas/numaradio-videos/src/scripts/song-request/minimax.ts` (copy from numaradio's song-worker, minor adaptation)
- Create: `~/saas/numaradio-videos/src/scripts/song-request/openrouter.ts` (copy from numaradio's song-worker)
- Create: `~/saas/numaradio-videos/src/scripts/song-request/generate.ts` (new orchestrator)
- Create: `~/saas/numaradio-videos/src/assets/song-request/track.mp3` (MiniMax output, ~3-4MB)
- Create: `~/saas/numaradio-videos/src/assets/song-request/cover.png` (Flux output, ~1-2MB)
- Create: `~/saas/numaradio-videos/src/assets/song-request/meta.json` (track title, lyrics snippet, prompt used — for reference)

- [ ] **Step 1: Inspect numaradio's song-worker for the API shapes you'll adapt**

Read these three files (read-only, don't modify):
- `/home/marku/saas/numaradio/workers/song-worker/minimax.ts` — MiniMax music_generation + polling pattern
- `/home/marku/saas/numaradio/workers/song-worker/openrouter.ts` — Flux artwork generation
- `/home/marku/saas/numaradio/workers/song-worker/pipeline.ts` — orchestration (just for reference on how they chain)

The MiniMax music endpoint is `https://api.minimax.io/v1/music_generation`, model `music-2.6`, auth via `MINIMAX_API_KEY`. The response can be either synchronous (audio URL in body) or async (task_id that polls at `?task_id=` to integer statuses 1=queued, 2=in-progress, 4=succeeded, others=failed). Retrieval gets audio as a hex-encoded or URL payload — same extraction logic as numaradio's minimax.ts.

The Flux endpoint is OpenRouter's chat/completions at `https://openrouter.ai/api/v1/chat/completions` with `modalities: ["image"]`, env var `OPEN_ROUTER_API`, model `black-forest-labs/flux.2-pro`. Same pattern as `generate-lena-portrait.ts` in this repo.

- [ ] **Step 2: Copy minimax.ts into videos repo**

```bash
cd /home/marku/saas/numaradio-videos
mkdir -p src/scripts/song-request
cp /home/marku/saas/numaradio/workers/song-worker/minimax.ts src/scripts/song-request/minimax.ts
```

Open the copy, verify it's self-contained (no imports from numaradio-specific modules). It should import only Node builtins + fetch. If it imports anything else (e.g. a shared types file), EITHER copy that too OR inline the types directly into this file. Aim to make `src/scripts/song-request/minimax.ts` standalone.

- [ ] **Step 3: Copy openrouter.ts into videos repo**

```bash
cp /home/marku/saas/numaradio/workers/song-worker/openrouter.ts src/scripts/song-request/openrouter.ts
```

Same verification — standalone, no cross-repo imports.

- [ ] **Step 4: Write the orchestrator script**

Create `src/scripts/song-request/generate.ts`:

```ts
#!/usr/bin/env -S node --experimental-strip-types

import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { generateMusic } from "./minimax.ts";
import { generateArtwork } from "./openrouter.ts";

config({
  path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env.local"),
  quiet: true,
});

// The approved mood prompt from the 2c.2 spec — typed on screen AND fed to MiniMax.
const MOOD_PROMPT = "late-night drive, warm synths, 95 bpm, a little melancholy";

// Minimal instrumental lyrics — music-2.6 sizes songs by lyrics length, and we
// want a short-ish track (~40-60s) since we only use ~16s of it. Very sparse.
const LYRICS = `[verse 1]
Empty roads at night
Streetlights fade behind
Stereo glow, quiet drive
Thinking of nothing at all

[chorus]
Late-night warm, late-night long
Synths hum a quiet song
Miles ahead, nothing wrong
Just drive until the morning

[verse 2]
Rain on the windshield slow
Radio turned down low
Everywhere I want to go
Starts with this road

[chorus]
Late-night warm, late-night long
Synths hum a quiet song
Miles ahead, nothing wrong
Just drive until the morning

[bridge]
Headlights carve the dark
Nothing but the quiet part

[chorus]
Late-night warm, late-night long
Synths hum a quiet song
Miles ahead, nothing wrong
Just drive until the morning`;

// Title — MiniMax doesn't name tracks, we choose one. Used on screen in Beat 3.
const TRACK_TITLE = "Nightwarm";

// Flux cover art prompt, brand-aligned.
const COVER_PROMPT = `Album cover artwork for a song titled "${TRACK_TITLE}". Late-night empty highway, warm analog synth aesthetic, dark sky with a soft teal glow on the horizon, subtle grain, cinematic wide composition, no text, no logos, painterly and tasteful. Moody, hopeful, slightly melancholy.`;

async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const outDir = resolve(here, "../../assets/song-request");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  console.log(`→ Generating SongRequestDemo track + cover`);
  console.log(`  mood prompt: "${MOOD_PROMPT}"`);
  console.log(`  track title: "${TRACK_TITLE}"\n`);

  // Step A: MiniMax music generation (can take 30-90s).
  console.log(`→ MiniMax music-2.6 (this may take 60-90s)...`);
  const audioBuf = await generateMusic({ lyrics: LYRICS, prompt: MOOD_PROMPT });
  const trackPath = resolve(outDir, "track.mp3");
  writeFileSync(trackPath, audioBuf);
  console.log(`✓ Track: ${trackPath} (${(audioBuf.length / 1_048_576).toFixed(1)} MB)`);

  // Step B: Flux cover art.
  console.log(`\n→ OpenRouter Flux cover art...`);
  const coverBuf = await generateArtwork(COVER_PROMPT);
  const coverPath = resolve(outDir, "cover.png");
  writeFileSync(coverPath, coverBuf);
  console.log(`✓ Cover: ${coverPath} (${(coverBuf.length / 1024).toFixed(0)} KB)`);

  // Step C: write meta.json for later reference.
  const metaPath = resolve(outDir, "meta.json");
  writeFileSync(
    metaPath,
    JSON.stringify(
      {
        title: TRACK_TITLE,
        moodPrompt: MOOD_PROMPT,
        coverPrompt: COVER_PROMPT,
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(`✓ Meta: ${metaPath}`);

  console.log(`\nNext: audition the track + view the cover on Desktop, then commit.`);
}

main().catch((err) => {
  console.error("✗", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

**Note:** The imports assume numaradio's `minimax.ts` exports a `generateMusic({ lyrics, prompt })` function and `openrouter.ts` exports `generateArtwork(prompt)`. After Step 2/3 you may need to check the actual exports and adjust function names/signatures. Inspect the copied files — if the exported names differ, rename the import statements in `generate.ts` to match. The goal is a working end-to-end script; signatures don't matter as long as it works.

- [ ] **Step 5: Type-check**

```bash
cd /home/marku/saas/numaradio-videos
npx tsc --noEmit
```

Expected: zero errors. If the copied files have type errors (e.g. they reference a type that doesn't exist in videos-repo), either copy the type definition too or inline it. Goal: tsc clean.

- [ ] **Step 6: Run the generator**

```bash
cd /home/marku/saas/numaradio-videos
npx tsx src/scripts/song-request/generate.ts
```

Expected: 60-120 seconds of runtime. Final output at `src/assets/song-request/track.mp3` (~3-4 MB, 40-90s duration) and `src/assets/song-request/cover.png` (~1-2 MB, 1024×1024).

If MiniMax fails (rate limit, bad lyrics, etc.), the script throws with the API error. Retry after a minute. If Flux fails, the MP3 is still saved — you can re-run and the generator writes both again.

- [ ] **Step 7: Stage both assets on Windows desktop for user audition**

```bash
mkdir -p /mnt/c/Users/marku/Desktop/song-request-preview
cp /home/marku/saas/numaradio-videos/src/assets/song-request/track.mp3 \
   /home/marku/saas/numaradio-videos/src/assets/song-request/cover.png \
   /mnt/c/Users/marku/Desktop/song-request-preview/
ls -lh /mnt/c/Users/marku/Desktop/song-request-preview/
```

Expected: 2 files — track.mp3 + cover.png.

- [ ] **Step 8: HUMAN AUDITION GATE**

User listens to `track.mp3` and views `cover.png`. Three possible responses:

- **Both approved** → proceed to Step 9.
- **Track no good, cover fine** → re-run Step 6 (generator regenerates both; cover changes too but user is approving audio specifically — if the new cover is worse we can regenerate just the cover via the orchestrator adapted).
- **Cover no good, track fine** → edit the `COVER_PROMPT` in generate.ts, run a cover-only regeneration. For this iteration you may want a scoped re-run: comment out the MiniMax music block and just call `generateArtwork`, or add a `--cover-only` flag. Simplest: accept re-running both and the user re-auditions.
- **Neither great** → tune `MOOD_PROMPT` or `LYRICS`, re-run.

Iterate until user approves both.

**Note:** the track's actual title (as used on screen in the composition) is controlled by `TRACK_TITLE` in generate.ts — currently `"Nightwarm"`. If the user wants a different title, edit the constant. No regeneration needed for a title change; composition reads it from `meta.json`.

- [ ] **Step 9: Commit (after user approval)**

```bash
cd /home/marku/saas/numaradio-videos
git add src/scripts/song-request/ \
  src/assets/song-request/track.mp3 \
  src/assets/song-request/cover.png \
  src/assets/song-request/meta.json
git commit -m "song-request: generate track + cover via minimax + flux (approved)"
```

Verify:
```bash
git log --oneline -1
git status
```

Expected: new commit, tree clean. `src/scripts/song-request/` now contains 3 TS files (minimax.ts, openrouter.ts, generate.ts), `src/assets/song-request/` contains 3 files (track.mp3, cover.png, meta.json).

---

## Task 3: Generate 5 Helena voice clips

**Files produced:**
- `~/saas/numaradio-videos/src/assets/voice/song-request-announce.mp3`
- `~/saas/numaradio-videos/src/assets/voice/day-in-numa-night-shift.mp3`
- `~/saas/numaradio-videos/src/assets/voice/day-in-numa-morning-room.mp3`
- `~/saas/numaradio-videos/src/assets/voice/day-in-numa-daylight-channel.mp3`
- `~/saas/numaradio-videos/src/assets/voice/day-in-numa-prime-hours.mp3`

No new code. Uses existing `src/scripts/generate-voice.ts` with Helena (`aura-2-helena-en`) already set as `MODEL_PRIMARY`.

- [ ] **Step 1: Generate song-request-announce.mp3**

```bash
cd /home/marku/saas/numaradio-videos
npx tsx src/scripts/generate-voice.ts song-request-announce \
  "Here's your late-night drive. Fresh track, on Numa Radio."
```

Expected: ~2-3s runtime, MP3 ~25-35 KB (~5s audio).

- [ ] **Step 2: Generate day-in-numa-night-shift.mp3**

```bash
npx tsx src/scripts/generate-voice.ts day-in-numa-night-shift \
  "Night Shift. Quiet hours, wide spaces."
```

Expected: ~14-18 KB (~3-4s audio).

- [ ] **Step 3: Generate day-in-numa-morning-room.mp3**

```bash
npx tsx src/scripts/generate-voice.ts day-in-numa-morning-room \
  "Morning Room. Coffee's on, softer tones."
```

- [ ] **Step 4: Generate day-in-numa-daylight-channel.mp3**

```bash
npx tsx src/scripts/generate-voice.ts day-in-numa-daylight-channel \
  "Daylight Channel. Focus music, longer tracks."
```

- [ ] **Step 5: Generate day-in-numa-prime-hours.mp3**

```bash
npx tsx src/scripts/generate-voice.ts day-in-numa-prime-hours \
  "Prime Hours. Dinner to midnight, louder music."
```

- [ ] **Step 6: Stage all 5 on Windows desktop for batch audition**

```bash
mkdir -p /mnt/c/Users/marku/Desktop/day-in-numa-voice-preview
cp /home/marku/saas/numaradio-videos/src/assets/voice/song-request-announce.mp3 \
   /home/marku/saas/numaradio-videos/src/assets/voice/day-in-numa-*.mp3 \
   /mnt/c/Users/marku/Desktop/day-in-numa-voice-preview/
ls -lh /mnt/c/Users/marku/Desktop/day-in-numa-voice-preview/
```

Expected: 5 files on desktop.

- [ ] **Step 7: HUMAN AUDITION GATE**

User listens to all 5. Standard three-option response:

- **All approved** → proceed to Step 8.
- **Regenerate specific N** → rerun the Step (1-5) for that clip with same text.
- **Rewrite text for N** → rerun with new text. Update the spec's voice-line table if the change is permanent.

DO NOT commit until user approves all 5.

- [ ] **Step 8: Commit the 5 MP3s**

```bash
cd /home/marku/saas/numaradio-videos
git add src/assets/voice/song-request-announce.mp3 \
  src/assets/voice/day-in-numa-night-shift.mp3 \
  src/assets/voice/day-in-numa-morning-room.mp3 \
  src/assets/voice/day-in-numa-daylight-channel.mp3 \
  src/assets/voice/day-in-numa-prime-hours.mp3
git commit -m "voice: 5 new helena clips for SongRequestDemo + DayInNuma"
```

Verify clean tree.

---

## Task 4: SongRequestDemo composition + render

**Files:**
- Create: `~/saas/numaradio-videos/src/compositions/SongRequestDemo.tsx`
- Modify: `~/saas/numaradio-videos/src/Root.tsx` — add fourth `<Composition>`

**REQUIRED SKILL INVOCATION:** The implementer's FIRST action is to invoke the `frontend-design` skill. Same policy as ShoutoutFlagship and MeetLena — the first-pass visual without it ships corporate-feeling, the v2 with it is what you want to keep. Do NOT skip.

- [ ] **Step 1: Invoke `frontend-design` skill**

Brief it with:
- 30-second composition, TikTok/Shorts vertical 1080×1920
- Aesthetic already locked: late-night pirate-radio broadcast, dark (#0A0A0F), scan-lined, film-grained, hard cuts, atmosphere via ScanLines/FilmGrain/LiveChip/EyebrowStrip (all available primitives)
- Beat-by-beat storyboard (include it verbatim from the spec below)
- Approved mood prompt: *"late-night drive, warm synths, 95 bpm, a little melancholy"*
- Approved Lena announcement: *"Here's your late-night drive. Fresh track, on Numa Radio."*
- Track title: read dynamically from `src/assets/song-request/meta.json` (field `title`) at composition load time — currently "Nightwarm" but the composition should display whatever's in meta.json
- Existing visual vocabulary to match: ShoutoutFlagship's "Signal Intercepted" card treatment in Beat 1, MeetLena's RadiatingDot/BroadcastTimecode patterns, all four prior compositions' payoff pattern (Wordmark + teal underline wipe + numaradio.com)

Adopt its guidance for specific visual treatments of each beat. Small refinements fine; fundamental beat-structure rewrites → escalate BLOCKED.

- [ ] **Step 2: Write `src/compositions/SongRequestDemo.tsx`**

Baseline scaffold — adapt per frontend-design, keep the beat structure locked:

```tsx
import {
  AbsoluteFill,
  Audio,
  Sequence,
  useCurrentFrame,
  interpolate,
  Easing,
  staticFile,
} from "remotion";
import { COLORS, FONTS, TIMING } from "../tokens/brand.ts";
import { loadBrandFonts } from "../tokens/fonts.ts";
import { ScanLines } from "../primitives/ScanLines.tsx";
import { FilmGrain } from "../primitives/FilmGrain.tsx";
import { LiveChip } from "../primitives/LiveChip.tsx";
import { EyebrowStrip } from "../primitives/EyebrowStrip.tsx";
import { Wordmark } from "../primitives/Wordmark.tsx";
import { Waveform } from "../primitives/Waveform.tsx";
import { PulsingDot } from "../primitives/PulsingDot.tsx";
import { TypedText } from "../primitives/TypedText.tsx";
import meta from "../assets/song-request/meta.json" with { type: "json" };

loadBrandFonts();

export const SONG_REQUEST_DEMO_DURATION = 30 * TIMING.fps; // 900 frames

const MOOD_PROMPT = meta.moodPrompt as string; // "late-night drive, warm synths, 95 bpm, a little melancholy"
const TRACK_TITLE = meta.title as string;       // "Nightwarm" (or whatever's in meta.json)

export function SongRequestDemo() {
  return (
    <AbsoluteFill style={{ background: COLORS.bg }}>
      {/* The generated track plays starting Beat 3 (frame 180). Volume 1.0 during
          money beat, ducks to 0.25 during the Beat 5 callout. */}
      <Sequence from={180}>
        <Audio
          src={staticFile("song-request/track.mp3")}
          volume={(frame) => trackVolume(frame)}
        />
      </Sequence>

      {/* Lena announcement voice at start of Beat 3 (frame 180), volume 1.2x. */}
      <Sequence from={180}>
        <Audio src={staticFile("voice/song-request-announce.mp3")} volume={1.2} />
      </Sequence>

      {/* Atmosphere — always on */}
      <ScanLines />
      <FilmGrain />

      {/* Persistent HUD from frame 6 */}
      <Sequence from={6}>
        <EyebrowStrip text="Numa Radio · Song Request" />
        <LiveChip />
      </Sequence>

      {/* Beat 1: Type the mood (frames 0-120) */}
      <Sequence from={0} durationInFrames={120}>
        <MoodInputBeat />
      </Sequence>

      {/* Beat 2: Loader (frames 120-180) */}
      <Sequence from={120} durationInFrames={60}>
        <LoaderBeat />
      </Sequence>

      {/* Beat 3: Cover reveal + Lena voice (frames 180-300) */}
      <Sequence from={180} durationInFrames={120}>
        <CoverRevealBeat />
      </Sequence>

      {/* Beat 4: Money beat (frames 300-780) */}
      <Sequence from={300} durationInFrames={480}>
        <MoneyBeat />
      </Sequence>

      {/* Beat 5: Typographic callout (frames 780-840) */}
      <Sequence from={780} durationInFrames={60}>
        <CalloutBeat />
      </Sequence>

      {/* Beat 6: Payoff (frames 840-900) */}
      <Sequence from={840} durationInFrames={60}>
        <PayoffBeat />
      </Sequence>
    </AbsoluteFill>
  );
}

// Track volume envelope. Frame is SEQUENCE-local to the Audio's <Sequence from={180}>.
// So frame 0 = comp frame 180 (Beat 3 start). Track plays from here through end of comp (frame 900 = seq 720).
// During money beat (comp 300-780 = seq 120-600): full volume 1.0.
// During callout (comp 780-840 = seq 600-660): duck to 0.25 so the Archivo Black callout reads.
// During payoff (comp 840-900 = seq 660-720): fade out over 60 frames.
function trackVolume(seqFrame: number): number {
  if (seqFrame < 120) return 1.0;                                   // Beat 3 announce over track intro
  if (seqFrame < 600) return 1.0;                                   // Beat 4 money beat
  if (seqFrame < 615) return 1.0 - ((seqFrame - 600) / 15) * 0.75;  // duck down for callout
  if (seqFrame < 660) return 0.25;                                  // callout sustain
  if (seqFrame < 720) return 0.25 - (seqFrame - 660) / 60 * 0.25;   // fade out through payoff
  return 0;
}

// Inline helpers for each beat — authored per frontend-design guidance.
function MoodInputBeat() { /* TypedText input card with MOOD_PROMPT, TypedText framesPerChar=2 */ return <></>; }
function LoaderBeat() { /* RadiatingDot + "LENA IS MAKING YOUR TRACK" mono + ticking timecode */ return <></>; }
function CoverRevealBeat() { /* Flux cover art with Ken Burns + TRACK_TITLE overlay + "LISTENER REQUEST · NOW PLAYING" sublabel */ return <></>; }
function MoneyBeat() { /* Cover art continues, Waveform bottom, listener ticker "LISTENING: 27→31→38→44" */ return <></>; }
function CalloutBeat() { /* "YOUR SONG · ON AIR IN 4 MINUTES" Archivo Black punch-in */ return <></>; }
function PayoffBeat() { /* Wordmark + underline wipe + numaradio.com — same as other payoffs */ return <></>; }
```

The six inline helper stubs are placeholders. Fill each one per the spec's beat storyboard + frontend-design guidance. Reference existing compositions for concrete patterns:
- `MoodInputBeat` → steal ShoutoutFlagship's `InputCard` structure (same mobile-input card treatment)
- `LoaderBeat` → adapt MeetLena's `RadiatingDot` pattern + add mono loader strip + ticking timecode
- `CoverRevealBeat` → LenaPortrait-style Ken Burns on the cover PNG (use `<Img src={staticFile("song-request/cover.png")} />` inside an AbsoluteFill with scale interpolation); title overlay in Archivo Black
- `MoneyBeat` → cover continues, layered with a horizontal Waveform at the bottom and a listener-count ticker similar to ShoutoutFlagship's
- `CalloutBeat` → big Archivo Black "YOUR SONG · ON AIR IN 4 MINUTES" centered, scale-bounces in
- `PayoffBeat` → same as the Wordmark + underline wipe pattern in prior compositions (copy from MeetLena or ShoutoutFlagship)

Remember the JSX-ordering gotcha from the README: if any beat renders a full-bleed opaque element (like the cover art), put any overlay/HUD elements AFTER it in JSX order.

- [ ] **Step 3: Register in `src/Root.tsx`**

Add import + composition. Resulting file registers 4 compositions:

```tsx
import { Composition } from "remotion";
import { ListenNow, LISTEN_NOW_DURATION } from "./compositions/ListenNow.tsx";
import { ShoutoutFlagship, SHOUTOUT_FLAGSHIP_DURATION } from "./compositions/ShoutoutFlagship.tsx";
import { MeetLena, MEET_LENA_DURATION } from "./compositions/MeetLena.tsx";
import { SongRequestDemo, SONG_REQUEST_DEMO_DURATION } from "./compositions/SongRequestDemo.tsx";

export function Root() {
  return (
    <>
      <Composition id="ListenNow" component={ListenNow} durationInFrames={LISTEN_NOW_DURATION} fps={30} width={1080} height={1920} />
      <Composition id="ShoutoutFlagship" component={ShoutoutFlagship} durationInFrames={SHOUTOUT_FLAGSHIP_DURATION} fps={30} width={1080} height={1920} />
      <Composition id="MeetLena" component={MeetLena} durationInFrames={MEET_LENA_DURATION} fps={30} width={1080} height={1920} />
      <Composition id="SongRequestDemo" component={SongRequestDemo} durationInFrames={SONG_REQUEST_DEMO_DURATION} fps={30} width={1080} height={1920} />
    </>
  );
}
```

- [ ] **Step 4: Type-check**

```bash
cd /home/marku/saas/numaradio-videos
npx tsc --noEmit
```

Expected: zero errors. The `import meta from ... with { type: "json" }` syntax requires `resolveJsonModule: true` in tsconfig (already enabled from Phase 1 scaffold). If that import fails, fall back to `import meta from "../assets/song-request/meta.json"` (without assertion) or dynamically `readFileSync` at module load.

- [ ] **Step 5: Verify composition registers**

```bash
npx remotion compositions
```

Expected: 4 compositions listed — `ListenNow`, `ShoutoutFlagship`, `MeetLena` (53s), `SongRequestDemo` (30s / 900 frames).

- [ ] **Step 6: Commit**

```bash
cd /home/marku/saas/numaradio-videos
git add src/compositions/SongRequestDemo.tsx src/Root.tsx
git commit -m "composition: SongRequestDemo v1 — 30s song-generation demo"
```

- [ ] **Step 7: Render (force fresh bundle per README gotcha)**

```bash
rm -rf .remotion/
rm -f out/song-request-demo.mp4
npm run render SongRequestDemo song-request-demo
```

Expected: ~60-120s render, MP4 ~15-25 MB.

- [ ] **Step 8: Stage on Windows desktop for user eyeball**

```bash
cp /home/marku/saas/numaradio-videos/out/song-request-demo.mp4 /mnt/c/Users/marku/Desktop/
```

Report the path. v2+ iteration loop follows per user feedback — do NOT declare Task 4 done on v1. User must approve before moving to Task 5.

---

## Task 5: DayInNuma composition + render

**Files:**
- Create: `~/saas/numaradio-videos/src/compositions/DayInNuma.tsx`
- Modify: `~/saas/numaradio-videos/src/Root.tsx` — add fifth `<Composition>`

**REQUIRED SKILL INVOCATION:** Same as Task 4. Invoke `frontend-design` first.

- [ ] **Step 1: Invoke `frontend-design` skill**

Brief it with:
- 30-second composition, TikTok/Shorts 1080×1920
- Aesthetic locked (pirate-radio broadcast, atmosphere always on)
- Beat structure: 2s open with centered clock → four 6s ShowPanels with show-specific palettes + big clock ticks + "Now playing" fragments + Lena one-liner voices → 4s close payoff
- Use existing `ShowPanel` primitive directly; don't rebuild the panel treatment
- Music bed `bed-01-midnight-drive.mp3` (35s, committed in Task 1) plays throughout without ducking — Lena's show one-liners are short and ride over the music

Adopt its guidance. Small refinements fine; rewrites → escalate BLOCKED.

- [ ] **Step 2: Write `src/compositions/DayInNuma.tsx`**

Baseline scaffold:

```tsx
import {
  AbsoluteFill,
  Audio,
  Sequence,
  useCurrentFrame,
  interpolate,
  Easing,
  staticFile,
} from "remotion";
import { COLORS, FONTS, TIMING } from "../tokens/brand.ts";
import { loadBrandFonts } from "../tokens/fonts.ts";
import { ScanLines } from "../primitives/ScanLines.tsx";
import { FilmGrain } from "../primitives/FilmGrain.tsx";
import { LiveChip } from "../primitives/LiveChip.tsx";
import { EyebrowStrip } from "../primitives/EyebrowStrip.tsx";
import { Wordmark } from "../primitives/Wordmark.tsx";
import { ShowPanel } from "../primitives/ShowPanel.tsx";

loadBrandFonts();

export const DAY_IN_NUMA_DURATION = 30 * TIMING.fps; // 900 frames

export function DayInNuma() {
  return (
    <AbsoluteFill style={{ background: COLORS.bg }}>
      {/* Music bed throughout. bed-01 is 35s, covers the 30s composition. */}
      <Audio
        src={staticFile("music-beds/bed-01-midnight-drive.mp3")}
        volume={(frame) => musicVolume(frame)}
      />

      {/* Four Lena voice clips, one per panel */}
      <Sequence from={60}>
        <Audio src={staticFile("voice/day-in-numa-night-shift.mp3")} volume={1.2} />
      </Sequence>
      <Sequence from={240}>
        <Audio src={staticFile("voice/day-in-numa-morning-room.mp3")} volume={1.2} />
      </Sequence>
      <Sequence from={420}>
        <Audio src={staticFile("voice/day-in-numa-daylight-channel.mp3")} volume={1.2} />
      </Sequence>
      <Sequence from={600}>
        <Audio src={staticFile("voice/day-in-numa-prime-hours.mp3")} volume={1.2} />
      </Sequence>

      {/* Atmosphere */}
      <ScanLines />
      <FilmGrain />

      {/* Persistent HUD */}
      <Sequence from={6}>
        <EyebrowStrip text="Numa Radio · 24 / 7" />
        <LiveChip />
      </Sequence>

      {/* Beat 0: Open clock (frames 0-60, 2s) */}
      <Sequence from={0} durationInFrames={60}>
        <OpenClockBeat />
      </Sequence>

      {/* Beat 1: Night Shift (frames 60-240) */}
      <Sequence from={60} durationInFrames={180}>
        <ShowPanelWithOverlays
          showName="Night Shift"
          timeLabel="00:00"
          description="Quiet-hours rotation. Low-BPM, spacious, voices that don't shout."
          backgroundColor="#1a2332"
          accentColor="#a8c5e0"
          nowPlaying="Now playing: 'Blue Hours' — request from Mira"
        />
      </Sequence>

      {/* Beat 2: Morning Room (frames 240-420) */}
      <Sequence from={240} durationInFrames={180}>
        <ShowPanelWithOverlays
          showName="Morning Room"
          timeLabel="06:00"
          description="First coffee energy. Warmer tones, field recordings."
          backgroundColor="#2a1f15"
          accentColor="#e8d9b0"
          nowPlaying="Now playing: 'First Light' — request from Jakob"
        />
      </Sequence>

      {/* Beat 3: Daylight Channel (frames 420-600) */}
      <Sequence from={420} durationInFrames={180}>
        <ShowPanelWithOverlays
          showName="Daylight Channel"
          timeLabel="12:00"
          description="Focus-hours programming. Longer tracks, fewer host breaks."
          backgroundColor="#1e2024"
          accentColor="#d0d2d6"
          nowPlaying="Now playing: 'Focus Hours' — anonymous"
        />
      </Sequence>

      {/* Beat 4: Prime Hours (frames 600-780) */}
      <Sequence from={600} durationInFrames={180}>
        <ShowPanelWithOverlays
          showName="Prime Hours"
          timeLabel="18:00"
          description="Dinner to midnight. Louder, stranger, more character."
          backgroundColor="#0a1a1c"
          accentColor="#4fd1c5"
          nowPlaying="Now playing: 'Heavy Weather' — request from Sana"
        />
      </Sequence>

      {/* Beat 5: Close payoff (frames 780-900) */}
      <Sequence from={780} durationInFrames={120}>
        <PayoffBeat />
      </Sequence>
    </AbsoluteFill>
  );
}

// Music volume envelope. Simple fade-in, sustain, fade-out. No ducking — voice clips are
// short and overlap music naturally. At 1.2x voice volume and 1.0 music, voice reads fine.
function musicVolume(frame: number): number {
  if (frame < 6) return frame / 6;                  // fade-in
  if (frame < 840) return 1.0;                      // sustain through panels
  if (frame < 900) return 1.0 - (frame - 840) / 60; // fade-out over payoff
  return 0;
}

// Inline helpers — author per frontend-design guidance.
function OpenClockBeat() { /* Big mono "00:00" centered, pulses once, atmospheric */ return <></>; }

interface ShowPanelWithOverlaysProps {
  showName: string;
  timeLabel: string;
  description: string;
  backgroundColor: string;
  accentColor: string;
  nowPlaying: string;
}
function ShowPanelWithOverlays(props: ShowPanelWithOverlaysProps) {
  /* Render ShowPanel (primitive) with two overlays:
     - Big clock mono at top (e.g. "06:00" huge centered, y~200)
     - "Now playing: ..." mono strip at bottom (y~1500)
     Both overlays fade in over frames 0-15 of the sequence. */
  return <></>;
}

function PayoffBeat() {
  /* Wordmark + underline wipe + numaradio.com + small "ALWAYS ON · 24 / 7" mono below.
     Same pattern as ListenNow / ShoutoutFlagship / MeetLena. */
  return <></>;
}
```

Fill in the three inline helpers per frontend-design guidance:
- `OpenClockBeat` → big 180px JetBrains Mono "00:00" centered, pulses once via scale 1.0→1.05→1.0 over frame 0-30, holds 30-60
- `ShowPanelWithOverlays` → renders `<ShowPanel {...props} />` (primitive handles show name/time/description/palette), PLUS an additional big mono clock at top (y=~200, fontSize 120) with the `timeLabel` prop, PLUS a "Now playing" mono strip at bottom (y=~1500, fontSize 28, `nowPlaying` prop). Both overlays fade in frames 0-15 sequence-local.
- `PayoffBeat` → exact same structure as MeetLena's PayoffBeat (Wordmark + teal underline wipe + `numaradio.com` mono), plus a small "ALWAYS ON · 24 / 7" mono line below the URL

JSX ordering: overlays (clock, nowPlaying) must render AFTER ShowPanel inside `ShowPanelWithOverlays` to draw on top.

- [ ] **Step 3: Register in `src/Root.tsx`**

Add DayInNuma composition to the Root registry (5th composition total):

```tsx
import { DayInNuma, DAY_IN_NUMA_DURATION } from "./compositions/DayInNuma.tsx";
// ... inside Root():
<Composition id="DayInNuma" component={DayInNuma} durationInFrames={DAY_IN_NUMA_DURATION} fps={30} width={1080} height={1920} />
```

- [ ] **Step 4: Type-check**

```bash
cd /home/marku/saas/numaradio-videos
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 5: Verify composition registers**

```bash
npx remotion compositions
```

Expected: 5 compositions listed — ListenNow, ShoutoutFlagship, MeetLena, SongRequestDemo, DayInNuma.

- [ ] **Step 6: Commit**

```bash
cd /home/marku/saas/numaradio-videos
git add src/compositions/DayInNuma.tsx src/Root.tsx
git commit -m "composition: DayInNuma v1 — 30s day-in-numa montage"
```

- [ ] **Step 7: Render (force fresh bundle)**

```bash
rm -rf .remotion/
rm -f out/day-in-numa.mp4
npm run render DayInNuma day-in-numa
```

Expected: ~60-120s render, MP4 ~10-18 MB.

- [ ] **Step 8: Stage on Windows desktop**

```bash
cp /home/marku/saas/numaradio-videos/out/day-in-numa.mp4 /mnt/c/Users/marku/Desktop/
```

Report path. v2+ iteration loop follows per user feedback.

---

## Definition of Done for Stage 2c.2

1. `bed-01-midnight-drive.mp3` is 35s (per ffprobe).
2. `src/assets/song-request/track.mp3` + `cover.png` + `meta.json` committed (user-approved).
3. 5 Helena voice clips committed (user-approved).
4. `SongRequestDemo.tsx` + `DayInNuma.tsx` both exist and register in Root.
5. `npx tsc --noEmit` clean.
6. `npx remotion compositions` lists all 5 launch pieces at 1080×1920 @ 30fps.
7. `out/song-request-demo.mp4` renders cleanly (~15-25 MB, 30s).
8. `out/day-in-numa.mp4` renders cleanly (~10-18 MB, 30s).
9. User has visually approved BOTH final videos (at whatever version the iteration settles at).
10. `git status` clean.

After all 10 hold, the 5-piece launch set is complete. Final post-2c.2 session wrap: update `HANDOFF.md` in `~/saas/numaradio` with one entry covering all 5 launch pieces + pointer to the videos repo.

---

## Explicit non-goals (reminders — do not drift into)

- **No Prisma, no DB data.** DayInNuma's "now playing" fragments are scripted strings; SongRequestDemo's track is a one-time committed MP3.
- **No per-render MiniMax / Flux calls.** Assets generated once, committed, used forever. Phase 3 is where per-render generation lives (Shoutout-of-the-Day, Song-of-the-Week templates).
- **No new primitives.** CoverArt, ClockTicker, NowPlayingStrip all inline at first-consumer. Rule-of-2 would trigger extraction in Phase 3 if the templated series uses them.
- **No verbatim reuse of MeetLena voice clips** — DayInNuma gets 4 new Helena clips with rephrased text.
- **No HANDOFF.md update until both compositions ship.** Single clean entry for all 5 launch pieces.
