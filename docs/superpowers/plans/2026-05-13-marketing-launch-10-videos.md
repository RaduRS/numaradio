# Marketing launch 10-videos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce 10 vertical Shorts (1080×1920, 30fps) for `@numaradio`, grounded in the formats the existing channel data proves convert (SongRequestDemo, ShoutoutFlagship, StatHook, ListenNow, MeetLena, HowTo, plus one new `MagicLoop` comp). Each rendered MP4 ships with a per-platform `.captions.md` (IG / YT Shorts / TikTok).

**Architecture:** Reuse the existing two-repo pattern: `numaradio/scripts/export-video-data.ts` queries Prisma and writes `numaradio-videos/src/data/snapshot.json` plus asset files; a new `numaradio-videos/src/scripts/render-launch-10-batch.ts` (modeled on the existing `render-social-v2-batch.ts`) reads the snapshot and drives 10 jobs through `selectComposition` + `renderMedia`. Caption files are written by the same batch script next to each MP4. One new composition (`MagicLoop`) plus prop-driving the existing `SongRequestDemo` are the only Remotion-side code changes.

**Tech Stack:** Remotion 4.x, TypeScript (`tsx` runner), Prisma, Deepgram/Vertex TTS (already wired for shoutout re-synth), `nice -n 10 --concurrency 4` for render politeness.

---

## File Structure

**Modify:**
- `numaradio/scripts/export-video-data.ts` — extend to return `promptedSongs: PromptedSongClip[]` (was singular) + a new `freshCounts: { airedShoutoutsThisMonth, tracksGeneratedToday }` block.
- `numaradio-videos/src/compositions/SongRequestDemo.tsx` — accept `moodPrompt`, `trackTitle`, `trackSrc`, `artworkSrc`, `trackStartSeconds` via props; keep current `meta.json` values as `defaultProps`.
- `numaradio-videos/src/compositions/ListenNow.tsx` — replace cold-open opener line.
- `numaradio-videos/src/compositions/MeetLena.tsx` — replace cold-open opener line.
- `numaradio-videos/src/compositions/HowTo.tsx` — swap closer line in the `shoutout` variant.
- `numaradio-videos/src/Root.tsx` — register the new `MagicLoop` composition.

**Create:**
- `numaradio-videos/src/compositions/MagicLoop.tsx` — new 8-second composition.
- `numaradio-videos/src/scripts/render-launch-10-batch.ts` — orchestrator + per-piece caption writer.
- `numaradio-videos/src/scripts/launch-10-captions.ts` — pure-function caption builders (testable).
- `numaradio-videos/src/scripts/launch-10-captions.test.ts` — unit tests for caption builders.
- `numaradio-videos/out/launch-10/` (created at render time; gitignored already).

---

## Task 1: Extend `export-video-data.ts` for two prompted songs + fresh counts

**Files:**
- Modify: `numaradio/scripts/export-video-data.ts`
- The exporter writes to `numaradio-videos/src/data/snapshot.json` and `numaradio-videos/src/assets/data/`

- [ ] **Step 1: Read the current exporter top-to-bottom** so the change is additive, not destructive.

Run: `wc -l numaradio/scripts/export-video-data.ts && head -200 numaradio/scripts/export-video-data.ts`
Confirm the `Snapshot` interface, the `promptedSong` (singular) export, and that audio policy excludes listener-submitted artist tracks (the listener-prompted Suno/MiniMax-generated tracks are Numa-owned and still in scope).

- [ ] **Step 2: Add `promptedSongs: PromptedSongClip[]` alongside `promptedSong: PromptedSongClip | null`** in the `Snapshot` interface.

Keep the singular field for backwards-compat with `render-social-v2-batch.ts`. The new plural carries up to two records (slate items #1 and #2).

```typescript
interface Snapshot {
  fetchedAt: string;
  counts: CountsBlock;
  shoutouts: ShoutoutClip[];
  promptedSong: PromptedSongClip | null;       // unchanged
  promptedSongs: PromptedSongClip[];           // NEW — up to 2 records
  freshCounts: {                                // NEW
    airedShoutoutsThisMonth: number;
    tracksGeneratedToday: number;
  };
  // …other existing fields untouched
}
```

- [ ] **Step 3: Update the Prisma query** that builds `promptedSong` to fetch the two most recent listener-prompted tracks with a meaningful prompt (≥20 chars, ≤180 chars so it fits the on-screen card), and assign the first to `promptedSong` (backwards-compat) and both to `promptedSongs`.

Query pattern (mirror existing single-record lookup; widen `take` from 1 to 2):
```typescript
const recentPromptedTracks = await prisma.track.findMany({
  where: {
    source: "listener_generated",
    musicSubmission: { is: { promptText: { not: null } } },
    deletedAt: null,
  },
  include: { musicSubmission: true, assets: true },
  orderBy: { createdAt: "desc" },
  take: 4, // overfetch so we can filter by prompt length
});
const usable = recentPromptedTracks
  .filter((t) => {
    const p = t.musicSubmission?.promptText ?? "";
    return p.length >= 20 && p.length <= 180;
  })
  .slice(0, 2);
```

Build the existing `PromptedSongClip` shape for each. Download audio + artwork to `src/assets/data/songs/<trackId>.{mp3,png}` (the existing exporter has this helper — reuse it).

- [ ] **Step 4: Compute `freshCounts`** from Prisma.

```typescript
const monthStart = new Date();
monthStart.setUTCDate(1);
monthStart.setUTCHours(0, 0, 0, 0);

const dayStart = new Date();
dayStart.setUTCHours(0, 0, 0, 0);

const [airedShoutoutsThisMonth, tracksGeneratedToday] = await Promise.all([
  prisma.shoutout.count({ where: { state: "aired", airedAt: { gte: monthStart } } }),
  prisma.track.count({ where: { source: "listener_generated", createdAt: { gte: dayStart } } }),
]);
```

- [ ] **Step 5: Run the exporter and verify the new shape lands in `snapshot.json`.**

Run: `cd numaradio && npx tsx scripts/export-video-data.ts`
Expect: `numaradio-videos/src/data/snapshot.json` updated with non-empty `promptedSongs` (length 1 or 2) and `freshCounts` populated with current numbers. New MP3/PNG files under `numaradio-videos/src/assets/data/songs/`.

- [ ] **Step 6: Commit.**

```bash
cd /home/marku/saas/numaradio
git add scripts/export-video-data.ts
git commit -m "exporter: add promptedSongs + freshCounts for launch-10 batch"
```

---

## Task 2: Make `SongRequestDemo` prop-driven

**Files:**
- Modify: `numaradio-videos/src/compositions/SongRequestDemo.tsx`

- [ ] **Step 1: Add a `SongRequestDemoProps` interface** carrying the variant overrides.

```typescript
export interface SongRequestDemoProps {
  moodPrompt?: string;
  trackTitle?: string;
  /** Path under src/assets/ — e.g. "data/songs/<trackId>.mp3" */
  trackSrc?: string;
  /** Path under src/assets/ — e.g. "data/songs/<trackId>.png" */
  artworkSrc?: string;
  /** Seconds into the source MP3 where the "money beat" starts. */
  trackStartSeconds?: number;
}
```

- [ ] **Step 2: Replace the top-of-file `meta.json` constants** with resolution-from-props-with-fallback.

```typescript
import meta from "../assets/song-request/meta.json";

export function SongRequestDemo(props: SongRequestDemoProps = {}) {
  const moodPrompt = props.moodPrompt ?? (meta.moodPrompt as string);
  const trackTitle = props.trackTitle ?? (meta.title as string);
  const trackStartFrames =
    (props.trackStartSeconds ?? (meta.trackStartSeconds as number)) * TIMING.fps;
  const trackSrc = props.trackSrc ?? "song-request/track.mp3";
  const artworkSrc = props.artworkSrc ?? "song-request/cover.png";
  // …existing body, with staticFile(trackSrc) / staticFile(artworkSrc)
}
```

Replace the existing top-level `MOOD_PROMPT`, `TRACK_TITLE`, `TRACK_START_FRAMES` references inside the component body with `moodPrompt`, `trackTitle`, `trackStartFrames`. Replace the existing `staticFile("song-request/track.mp3")` and `staticFile("song-request/cover.png")` calls with `staticFile(trackSrc)` and `staticFile(artworkSrc)`.

- [ ] **Step 3: Update Root.tsx to register the composition with `defaultProps: {}`** (so Studio still renders the meta.json fallback when no props are passed).

```typescript
<Composition
  id="SongRequestDemo"
  component={SongRequestDemo}
  durationInFrames={SONG_REQUEST_DEMO_DURATION}
  fps={30}
  width={1080}
  height={1920}
  defaultProps={{}}
/>
```

- [ ] **Step 4: Smoke-test that the existing render still works.**

Run: `cd numaradio-videos && rm -rf .remotion && npm run render SongRequestDemo song-request-smoke`
Expect: `out/song-request-smoke.mp4` lands, ffprobe shows 1080×1920 30fps ~30s, content matches the original (mood prompt = whatever's in `meta.json`).

- [ ] **Step 5: Commit.**

```bash
cd /home/marku/saas/numaradio-videos
git add src/compositions/SongRequestDemo.tsx src/Root.tsx
git commit -m "song-request-demo: accept moodPrompt/trackTitle/trackSrc/artworkSrc via props"
```

---

## Task 3: Build `MagicLoop` composition

**Files:**
- Create: `numaradio-videos/src/compositions/MagicLoop.tsx`
- Modify: `numaradio-videos/src/Root.tsx`

- [ ] **Step 1: Create `MagicLoop.tsx`.**

8 seconds @ 30fps = 240 frames. Three beats of 80 frames each. Reuses only existing primitives (`TypedText`, `Waveform`, `Wordmark`, `ScanLines`, `FilmGrain`, `MusicBed`, `LiveChip`).

```typescript
import {
  AbsoluteFill,
  Audio,
  Sequence,
  useCurrentFrame,
  interpolate,
  Easing,
  Img,
  staticFile,
} from "remotion";
import { COLORS, FONTS, TIMING } from "../tokens/brand.ts";
import { loadBrandFonts } from "../tokens/fonts.ts";
import { ScanLines } from "../primitives/ScanLines.tsx";
import { FilmGrain } from "../primitives/FilmGrain.tsx";
import { LiveChip } from "../primitives/LiveChip.tsx";
import { Wordmark } from "../primitives/Wordmark.tsx";
import { Waveform } from "../primitives/Waveform.tsx";
import { TypedText } from "../primitives/TypedText.tsx";
import { MusicBed } from "../primitives/MusicBed.tsx";

loadBrandFonts();

// MagicLoop — 8s (240 frames @ 30fps), 1080×1920.
//
// Beat 1 — "I type"        (0-80):   listener prompt types into a card on the left half.
// Beat 2 — "She reads"     (80-160): Lena portrait + waveform pulses on the right.
// Beat 3 — "Radio responds"(160-240): cut to a player mock; Wordmark + URL stamp.

export const MAGIC_LOOP_DURATION = 8 * TIMING.fps; // 240 frames
const PROMPT_TEXT = "play something for my dad";

export function MagicLoop() {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ background: COLORS.bg }}>
      <MusicBed src={staticFile("music-beds/bed-01-cross-and-loop.mp3")} volume={0.5} />

      <Sequence from={0} durationInFrames={80}>
        <Beat1Type prompt={PROMPT_TEXT} />
      </Sequence>

      <Sequence from={80} durationInFrames={80}>
        <Beat2Reads />
      </Sequence>

      <Sequence from={160} durationInFrames={80}>
        <Beat3Responds />
      </Sequence>

      <ScanLines />
      <FilmGrain />
      <LiveChip />
    </AbsoluteFill>
  );
}

function Beat1Type({ prompt }: { prompt: string }) {
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          width: 880,
          padding: "48px 56px",
          background: "rgba(17, 17, 24, 0.92)",
          border: "1px solid rgba(0, 245, 212, 0.35)",
          borderRadius: 12,
          fontFamily: FONTS.mono,
          fontSize: 56,
          lineHeight: 1.3,
          color: "#E8E8F0",
        }}
      >
        <TypedText text={prompt} startFrame={6} charsPerFrame={0.5} cursor />
      </div>
    </AbsoluteFill>
  );
}

function Beat2Reads() {
  const frame = useCurrentFrame();
  const fade = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  return (
    <AbsoluteFill style={{ opacity: fade, alignItems: "center", justifyContent: "center" }}>
      <Img
        src={staticFile("lena/portrait.png")}
        style={{ width: 720, height: 720, borderRadius: 360, objectFit: "cover" }}
      />
      <div style={{ marginTop: 72, width: 880, height: 200 }}>
        <Waveform color="#00F5D4" />
      </div>
    </AbsoluteFill>
  );
}

function Beat3Responds() {
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 64,
      }}
    >
      <Wordmark />
      <div
        style={{
          fontFamily: FONTS.mono,
          fontSize: 42,
          color: "#00F5D4",
          letterSpacing: 4,
        }}
      >
        numaradio.com
      </div>
    </AbsoluteFill>
  );
}
```

- [ ] **Step 2: Register `MagicLoop` in `Root.tsx`.**

```typescript
import { MagicLoop, MAGIC_LOOP_DURATION } from "./compositions/MagicLoop.tsx";

// inside <Root>:
<Composition
  id="MagicLoop"
  component={MagicLoop}
  durationInFrames={MAGIC_LOOP_DURATION}
  fps={30}
  width={1080}
  height={1920}
/>
```

- [ ] **Step 3: Render once and eyeball.**

Run: `cd numaradio-videos && npm run render MagicLoop magic-loop-smoke`
Open `out/magic-loop-smoke.mp4` on Windows (`cp out/magic-loop-smoke.mp4 /mnt/c/Users/marku/Desktop/`). Check: prompt types out within first 2.5s, Lena beat reads and waveform pulses, end-card lands cleanly with URL visible.

- [ ] **Step 4: Commit.**

```bash
git add src/compositions/MagicLoop.tsx src/Root.tsx
git commit -m "comp: add MagicLoop — 8s input→aired-output capture"
```

---

## Task 4: Tighten cold-opens on ListenNow, MeetLena, HowTo

**Files:**
- Modify: `numaradio-videos/src/compositions/ListenNow.tsx`
- Modify: `numaradio-videos/src/compositions/MeetLena.tsx`
- Modify: `numaradio-videos/src/compositions/HowTo.tsx`

The data shows these three already work — these are micro-edits to the opener line only, not full rewrites.

- [ ] **Step 1: ListenNow opener.**

Find the existing first-beat text (search for the first hardcoded headline string inside the composition). Replace with:

> "There's a radio station that runs itself."

Sub-line / second beat (if present): keep as-is or tighten to "Press play."

- [ ] **Step 2: MeetLena opener.**

Find the existing eyebrow / opening line (probably "MEET YOUR HOST"). Replace the first-beat tagline beneath it with:

> "She's never been to bed."

Keep the body (four-show montage, closer) intact.

- [ ] **Step 3: HowTo (shoutout variant) closer.**

The HowTo composition has 3 numbered steps + a closer. In the `shoutout` variant case, change the closer from whatever it currently says to:

> "No app. No login. Just type."

- [ ] **Step 4: Render all three for visual check.**

```bash
cd numaradio-videos
rm -rf .remotion
npm run render ListenNow listen-now-v2
npm run render MeetLena meet-lena-v2
npm run render HowTo howto-shoutout-v2
```

Eyeball each on Windows desktop. If any opener reads off-tempo, adjust the frame timing in the same file (typically a `<Sequence from=…>` window for the first headline) until it lands by frame 30 (≤1s).

- [ ] **Step 5: Commit.**

```bash
git add src/compositions/ListenNow.tsx src/compositions/MeetLena.tsx src/compositions/HowTo.tsx
git commit -m "comps: tighten cold-opens on ListenNow / MeetLena / HowTo for launch-10"
```

---

## Task 5: Caption builders (pure functions + tests)

**Files:**
- Create: `numaradio-videos/src/scripts/launch-10-captions.ts`
- Create: `numaradio-videos/src/scripts/launch-10-captions.test.ts`

TDD applies — these are pure functions. The Remotion compositions are still eyeballed; only the caption text generators get unit tests.

- [ ] **Step 1: Define the shape and write the failing tests first.**

```typescript
// launch-10-captions.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCaption,
  type CaptionInputs,
} from "./launch-10-captions.ts";

test("song-request caption includes prompt and track title in TT/IG/YT blocks", () => {
  const md = buildCaption({
    slug: "song-broken-drive",
    kind: "song",
    headline: "Someone typed 'broken 2am drive song'. Watch what came back.",
    payload: {
      prompt: "broken 2am drive song",
      trackTitle: "Headlight Hymn",
    },
  });
  assert.match(md, /## Instagram/);
  assert.match(md, /## YouTube Shorts/);
  assert.match(md, /## TikTok/);
  assert.match(md, /broken 2am drive song/);
  assert.match(md, /Headlight Hymn/);
  assert.match(md, /#NumaRadio/);
  assert.match(md, /#fyp/);
  assert.match(md, /#shorts/);
});

test("shoutout caption uses requester name and broadcast text", () => {
  const md = buildCaption({
    slug: "shoutout-mom",
    kind: "shoutout",
    headline: "She typed it. The AI host read it. 8 seconds later.",
    payload: {
      requesterName: "Sara",
      broadcastText: "This one's going out to my mom.",
    },
  });
  assert.match(md, /Sara/);
  assert.match(md, /going out to my mom/);
});

test("stat caption substitutes the live number into all platform blocks", () => {
  const md = buildCaption({
    slug: "stat-shoutouts-fresh",
    kind: "stat",
    headline: "847 shoutouts on air this month.",
    payload: { count: 847, period: "this month", unit: "shoutouts" },
  });
  // The number must appear in IG, YT, and TikTok sections.
  const sections = md.split(/^## /m);
  const ig = sections.find((s) => s.startsWith("Instagram"));
  const yt = sections.find((s) => s.startsWith("YouTube"));
  const tt = sections.find((s) => s.startsWith("TikTok"));
  assert.ok(ig?.includes("847"));
  assert.ok(yt?.includes("847"));
  assert.ok(tt?.includes("847"));
});

test("magic-loop caption highlights the input→output loop", () => {
  const md = buildCaption({
    slug: "magic-loop",
    kind: "loop",
    headline: "I type. She reads. The radio responds.",
    payload: {},
  });
  assert.match(md, /numaradio\.com/);
  assert.match(md, /#NoApp/);
});

test("explainer caption uses headline as IG hook line", () => {
  const md = buildCaption({
    slug: "listen-now-v2",
    kind: "explainer",
    headline: "There's a radio station that runs itself. Press play.",
    payload: {},
  });
  assert.match(md, /radio station that runs itself/);
});
```

- [ ] **Step 2: Run the test file and confirm all five tests fail.**

Run: `cd numaradio-videos && npm test -- --run src/scripts/launch-10-captions.test.ts`
Expected: 5 failures, "buildCaption is not defined".

- [ ] **Step 3: Implement `launch-10-captions.ts`.**

```typescript
export type CaptionKind = "song" | "shoutout" | "stat" | "loop" | "explainer" | "howto";

export interface CaptionInputs {
  slug: string;
  kind: CaptionKind;
  headline: string;
  payload: Record<string, unknown>;
}

const BASE_HASHTAGS = "#NumaRadio #AIRadio #IndieMusic #InternetRadio #LiveRadio #Shoutouts #ListenLive";
const TIKTOK_BASE = "#numaradio #airadio #indiemusic #shoutouts #fyp";

function piecePieceHashtags(kind: CaptionKind): { ig: string; yt: string; tt: string } {
  switch (kind) {
    case "song":
      return { ig: "#AIGeneratedMusic #SongGeneration", yt: "#shorts #aimusic", tt: "#aimusic #songgeneration" };
    case "shoutout":
      return { ig: "#OnAir #LiveRadio", yt: "#shorts #shoutout", tt: "#onair #shoutout" };
    case "stat":
      return { ig: "#RadioStation #AIStation", yt: "#shorts #aiart", tt: "#airadio #radio" };
    case "loop":
      return { ig: "#NoApp #LiveLoop", yt: "#shorts #noapp", tt: "#noapp #liveloop" };
    case "explainer":
      return { ig: "#NewRadio", yt: "#shorts #newradio", tt: "#newradio" };
    case "howto":
      return { ig: "#HowTo", yt: "#shorts #howto", tt: "#howto" };
  }
}

export function buildCaption(input: CaptionInputs): string {
  const { slug, kind, headline, payload } = input;
  const tags = piecePieceHashtags(kind);
  const igBody = buildIgBody(input);
  const ytBody = buildYtBody(input);
  const ttBody = buildTtBody(input);
  return [
    `# ${slug} — captions`,
    "",
    `Hook: ${headline}`,
    "",
    "## Instagram",
    "",
    igBody,
    "",
    "Submit your own track or a shoutout at numaradio.com.",
    "",
    `${BASE_HASHTAGS} ${tags.ig}`,
    "",
    "## YouTube Shorts",
    "",
    `**Title:** ${headline}`,
    "",
    "**Description:**",
    ytBody,
    "",
    `${BASE_HASHTAGS} ${tags.yt}`,
    "",
    "## TikTok",
    "",
    ttBody,
    "",
    "numaradio.com",
    "",
    `${TIKTOK_BASE} ${tags.tt}`,
    "",
  ].join("\n");
}

function buildIgBody(input: CaptionInputs): string {
  const { kind, headline, payload } = input;
  switch (kind) {
    case "song": {
      const prompt = String(payload.prompt ?? "");
      const trackTitle = String(payload.trackTitle ?? "");
      return [
        headline,
        "",
        `A listener typed "${prompt}".`,
        `Numa generated and aired "${trackTitle}" live, in under two minutes.`,
      ].join("\n");
    }
    case "shoutout": {
      const name = String(payload.requesterName ?? "A listener");
      const text = String(payload.broadcastText ?? "");
      return [headline, "", `${name} typed in. The AI host read it on air.`, "", `"${text}"`].join("\n");
    }
    case "stat": {
      const count = Number(payload.count ?? 0);
      const unit = String(payload.unit ?? "");
      const period = String(payload.period ?? "");
      return [headline, "", `Real listener ${unit} aired by Numa Radio ${period}: ${count.toLocaleString()}.`].join("\n");
    }
    case "loop":
      return [headline, "", "Type a message at numaradio.com. The AI host reads it on air. The station keeps running. No app, no account."].join("\n");
    case "explainer":
      return [headline, "", "Numa Radio is always on. AI host, real listener shoutouts, fresh tracks. Open the URL and press play."].join("\n");
    case "howto":
      return [headline, "", "Three steps. No app. No login. Numa Radio."].join("\n");
  }
}

function buildYtBody(input: CaptionInputs): string {
  const { kind, headline, payload } = input;
  switch (kind) {
    case "song": {
      const prompt = String(payload.prompt ?? "");
      const trackTitle = String(payload.trackTitle ?? "");
      return `A listener prompted "${prompt}". Numa Radio's pipeline generated and aired "${trackTitle}" live — under two minutes from prompt to broadcast. Hear it at numaradio.com.`;
    }
    case "shoutout": {
      const name = String(payload.requesterName ?? "A listener");
      const text = String(payload.broadcastText ?? "");
      return `${name} typed a message at numaradio.com. The AI host, Lena, read it on air seconds later. What aired: "${text}". Send your own at numaradio.com.`;
    }
    case "stat": {
      const count = Number(payload.count ?? 0);
      const unit = String(payload.unit ?? "");
      const period = String(payload.period ?? "");
      return `${count.toLocaleString()} real listener ${unit} aired ${period} on Numa Radio. Always-on AI radio at numaradio.com.`;
    }
    case "loop":
      return `Numa Radio is the live loop: you type, the AI host reads it on air, the station responds. No app, no account. numaradio.com.`;
    case "explainer":
      return `Numa Radio is always-on AI radio. Lena hosts, listeners type shoutouts and song prompts that air live. No app, no account. numaradio.com.`;
    case "howto":
      return `Three steps to get on the radio: open numaradio.com, type your shoutout, press send. The AI host reads it on air seconds later.`;
  }
}

function buildTtBody(input: CaptionInputs): string {
  const { kind, payload } = input;
  switch (kind) {
    case "song": {
      const prompt = String(payload.prompt ?? "");
      const trackTitle = String(payload.trackTitle ?? "");
      return [
        `a listener typed "${prompt}".`,
        `numa made "${trackTitle}" and aired it live.`,
        `two minutes from prompt to on-air. ↓`,
      ].join("\n");
    }
    case "shoutout": {
      const name = String(payload.requesterName ?? "").toLowerCase() || "a listener";
      const text = String(payload.broadcastText ?? "");
      return [`${name} typed it.`, `the ai host read it on air ↓`, `"${text}"`].join("\n");
    }
    case "stat": {
      const count = Number(payload.count ?? 0);
      const period = String(payload.period ?? "").toLowerCase();
      const unit = String(payload.unit ?? "").toLowerCase();
      return [`${count.toLocaleString()} real ${unit} ${period}.`, `live on numa radio ↓`].join("\n");
    }
    case "loop":
      return ["i type.", "she reads.", "the radio responds. ↓"].join("\n");
    case "explainer":
      return ["a radio station that runs itself.", "ai host. listener shoutouts. live. ↓"].join("\n");
    case "howto":
      return ["how to get on the radio.", "3 steps. no app. ↓"].join("\n");
  }
}
```

- [ ] **Step 4: Run the tests until they pass.**

Run: `cd numaradio-videos && npm test -- src/scripts/launch-10-captions.test.ts`
Expected: 5/5 pass.

- [ ] **Step 5: Commit.**

```bash
git add src/scripts/launch-10-captions.ts src/scripts/launch-10-captions.test.ts
git commit -m "captions: pure builders + tests for launch-10 IG/YT/TikTok blocks"
```

---

## Task 6: Batch render script

**Files:**
- Create: `numaradio-videos/src/scripts/render-launch-10-batch.ts`
- Modify: `numaradio-videos/package.json` (add `"video:launch-10": "nice -n 10 tsx src/scripts/render-launch-10-batch.ts"` to `scripts`)

- [ ] **Step 1: Write the batch script** (parallels the existing `render-social-v2-batch.ts` shape).

```typescript
#!/usr/bin/env -S node --experimental-strip-types

import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCaption, type CaptionKind } from "./launch-10-captions.ts";

interface PromptedSongClip {
  trackId: string;
  prompt: string;
  artistName: string;
  title: string;
  genre: string | null;
  audioFile: string;
  artworkFile: string | null;
  durationSeconds: number | null;
  airedAt: string | null;
}

interface ShoutoutClip {
  id: string;
  rawText: string;
  broadcastText: string;
  requesterName: string | null;
  airedAt: string;
  audioFile: string;
}

interface BedTrack {
  trackId: string;
  title: string;
  audioFile: string;
}

interface Snapshot {
  fetchedAt: string;
  counts: { totalTracks: number; airedShoutouts: number; acceptedArtists: number };
  shoutouts: ShoutoutClip[];
  promptedSongs: PromptedSongClip[];
  freshCounts: { airedShoutoutsThisMonth: number; tracksGeneratedToday: number };
  beds: BedTrack[];
}

interface Job {
  slug: string;
  compositionId: string;
  inputProps: Record<string, unknown>;
  caption: { kind: CaptionKind; headline: string; payload: Record<string, unknown> };
}

function loadSnapshot(repoRoot: string): Snapshot {
  const path = resolve(repoRoot, "src/data/snapshot.json");
  if (!existsSync(path)) {
    throw new Error(
      `snapshot.json missing — run \`npx tsx scripts/export-video-data.ts\` from the numaradio repo first.`,
    );
  }
  return JSON.parse(readFileSync(path, "utf8")) as Snapshot;
}

function bedByTitle(snap: Snapshot, title: string): BedTrack {
  return snap.beds.find((b) => b.title.toLowerCase() === title.toLowerCase()) ?? snap.beds[0];
}

function shortName(raw: string | null): string {
  if (!raw) return "A listener";
  const trimmed = raw.replace(/^\[YT\]\s*@?/i, "").trim();
  return trimmed.length > 24 ? `${trimmed.slice(0, 23)}…` : trimmed || "A listener";
}

function buildJobs(snap: Snapshot): Job[] {
  if (snap.promptedSongs.length < 2) {
    throw new Error(
      `snapshot has only ${snap.promptedSongs.length} promptedSongs; need 2 — re-run exporter or pad`,
    );
  }
  if (snap.shoutouts.length < 2) {
    throw new Error(`snapshot has only ${snap.shoutouts.length} shoutouts; need ≥2`);
  }

  const song1 = snap.promptedSongs[0];
  const song2 = snap.promptedSongs[1];
  const sx1 = snap.shoutouts[0];
  const sx2 = snap.shoutouts[1];

  return [
    {
      slug: "song-broken-drive",
      compositionId: "SongRequestDemo",
      inputProps: {
        moodPrompt: song1.prompt,
        trackTitle: song1.title,
        trackSrc: song1.audioFile,
        artworkSrc: song1.artworkFile ?? "song-request/cover.png",
      },
      caption: {
        kind: "song",
        headline: `Someone typed "${song1.prompt}". Watch what came back.`,
        payload: { prompt: song1.prompt, trackTitle: song1.title },
      },
    },
    {
      slug: "song-rainy-lisbon",
      compositionId: "SongRequestDemo",
      inputProps: {
        moodPrompt: song2.prompt,
        trackTitle: song2.title,
        trackSrc: song2.audioFile,
        artworkSrc: song2.artworkFile ?? "song-request/cover.png",
      },
      caption: {
        kind: "song",
        headline: "An AI radio made a song for one listener. Live. In 2 minutes.",
        payload: { prompt: song2.prompt, trackTitle: song2.title },
      },
    },
    {
      slug: "shoutout-mom",
      compositionId: "ShoutoutFlagship",
      inputProps: {
        text: sx1.rawText,
        voiceFile: sx1.audioFile,
        bedSrc: bedByTitle(snap, "Eight People").audioFile,
        bedStartFrom: 600,
        eyebrowText: `Numa Radio · Live · From ${shortName(sx1.requesterName)}`,
      },
      caption: {
        kind: "shoutout",
        headline: "She typed it. The AI host read it. 8 seconds later.",
        payload: {
          requesterName: shortName(sx1.requesterName),
          broadcastText: sx1.broadcastText,
        },
      },
    },
    {
      slug: "shoutout-dad",
      compositionId: "ShoutoutFlagship",
      inputProps: {
        text: sx2.rawText,
        voiceFile: sx2.audioFile,
        bedSrc: bedByTitle(snap, "Hold It There").audioFile,
        bedStartFrom: 600,
        eyebrowText: `Numa Radio · Live · From ${shortName(sx2.requesterName)}`,
      },
      caption: {
        kind: "shoutout",
        headline: "Listener: 'play something for my dad'. What aired ↓",
        payload: {
          requesterName: shortName(sx2.requesterName),
          broadcastText: sx2.broadcastText,
        },
      },
    },
    {
      slug: "stat-shoutouts-fresh",
      compositionId: "StatHook",
      inputProps: {
        variant: "shoutouts",
        target: snap.freshCounts.airedShoutoutsThisMonth,
        caption: "Shoutouts aired this month.",
        bedSrc: bedByTitle(snap, "Glass Door").audioFile,
      },
      caption: {
        kind: "stat",
        headline: `${snap.freshCounts.airedShoutoutsThisMonth.toLocaleString()} shoutouts on air this month.`,
        payload: {
          count: snap.freshCounts.airedShoutoutsThisMonth,
          period: "this month",
          unit: "shoutouts",
        },
      },
    },
    {
      slug: "stat-tracks-tonight",
      compositionId: "StatHook",
      inputProps: {
        variant: "tracks",
        target: snap.freshCounts.tracksGeneratedToday,
        caption: "Tracks generated tonight.",
        bedSrc: bedByTitle(snap, "Low Gear").audioFile,
      },
      caption: {
        kind: "stat",
        headline: `${snap.freshCounts.tracksGeneratedToday.toLocaleString()} tracks generated tonight.`,
        payload: {
          count: snap.freshCounts.tracksGeneratedToday,
          period: "tonight",
          unit: "tracks",
        },
      },
    },
    {
      slug: "listen-now-v2",
      compositionId: "ListenNow",
      inputProps: {},
      caption: {
        kind: "explainer",
        headline: "There's a radio station that runs itself. Press play.",
        payload: {},
      },
    },
    {
      slug: "meet-lena-v2",
      compositionId: "MeetLena",
      inputProps: {},
      caption: {
        kind: "explainer",
        headline: "Meet the host. She's never been to bed.",
        payload: {},
      },
    },
    {
      slug: "howto-shoutout-noapp",
      compositionId: "HowTo",
      inputProps: { variant: "shoutout" },
      caption: {
        kind: "howto",
        headline: "How to get on the radio. 3 steps. No app.",
        payload: {},
      },
    },
    {
      slug: "magic-loop",
      compositionId: "MagicLoop",
      inputProps: {},
      caption: {
        kind: "loop",
        headline: "I type. She reads. The radio responds.",
        payload: {},
      },
    },
  ];
}

async function main(): Promise<void> {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const outDir = resolve(repoRoot, "out/launch-10");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const snap = loadSnapshot(repoRoot);
  const jobs = buildJobs(snap);

  const filter = process.argv[2];
  const todo = filter ? jobs.filter((j) => j.slug.includes(filter)) : jobs;
  if (todo.length === 0) {
    console.error(`No jobs matched filter: ${filter}`);
    process.exit(2);
  }

  console.log(`→ Bundling Remotion project...`);
  const bundleStart = Date.now();
  const bundleLocation = await bundle({
    entryPoint: resolve(repoRoot, "src/index.ts"),
    webpackOverride: (cfg) => cfg,
    publicDir: resolve(repoRoot, "src/assets"),
  });
  console.log(`  bundled in ${((Date.now() - bundleStart) / 1000).toFixed(1)}s\n`);

  for (const job of todo) {
    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: job.compositionId,
      inputProps: job.inputProps,
    });
    const outputPath = resolve(outDir, `${job.slug}.mp4`);
    const captionPath = resolve(outDir, `${job.slug}.captions.md`);
    const start = Date.now();
    const durationSeconds = composition.durationInFrames / composition.fps;
    process.stdout.write(
      `→ ${job.slug.padEnd(28)} (${durationSeconds.toFixed(0)}s) ... `,
    );
    await renderMedia({
      composition,
      serveUrl: bundleLocation,
      codec: "h264",
      outputLocation: outputPath,
      inputProps: job.inputProps,
      crf: 18,
      concurrency: 4,
      x264Preset: "slow",
    });

    const md = buildCaption({
      slug: job.slug,
      kind: job.caption.kind,
      headline: job.caption.headline,
      payload: job.caption.payload,
    });
    writeFileSync(captionPath, md);

    const sizeMb = (statSync(outputPath).size / 1_048_576).toFixed(1);
    const ms = Date.now() - start;
    console.log(`✓  ${sizeMb} MB  ${(ms / 1000).toFixed(0)}s`);
  }
  console.log(`\nAll done. ${todo.length} video(s) + captions under ${outDir}`);
}

main().catch((err) => {
  console.error("✗", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

- [ ] **Step 2: Wire the npm script** in `package.json`.

```json
"scripts": {
  …existing…
  "video:launch-10": "nice -n 10 tsx src/scripts/render-launch-10-batch.ts"
}
```

- [ ] **Step 3: Smoke-render a single piece** to validate end-to-end before the full batch.

```bash
cd numaradio-videos
rm -rf .remotion
npm run video:launch-10 stat-shoutouts-fresh
```

Expected: `out/launch-10/stat-shoutouts-fresh.mp4` lands (1080×1920 30fps), and `out/launch-10/stat-shoutouts-fresh.captions.md` exists with IG / YT Shorts / TikTok blocks and the live count substituted in.

- [ ] **Step 4: Commit.**

```bash
git add src/scripts/render-launch-10-batch.ts package.json
git commit -m "batch: launch-10 render orchestrator + npm script"
```

---

## Task 7: Full batch render + verification + final commit/push

**Files:** No code changes — only artifact production and one final commit.

- [ ] **Step 1: Re-run the data export to refresh the snapshot** (the numbers move every hour).

```bash
cd /home/marku/saas/numaradio
npx tsx scripts/export-video-data.ts
```

Confirm: `numaradio-videos/src/data/snapshot.json` has fresh `fetchedAt`, populated `promptedSongs` (length ≥ 2), and current `freshCounts`.

- [ ] **Step 2: Render the full batch.**

```bash
cd /home/marku/saas/numaradio-videos
rm -rf .remotion
npm run video:launch-10
```

Expected: 10 MP4s + 10 caption files under `out/launch-10/`. Total render time ~5-10 minutes (depends on machine). Liquidsoap audio must not glitch during this — verify by listening to `https://api.numaradio.com/stream` for ≥30 seconds during the render. If audio glitches, check `nice -n 10` ran and `concurrency: 4` is honored.

- [ ] **Step 3: ffprobe each output to confirm spec compliance.**

```bash
cd /home/marku/saas/numaradio-videos
for f in out/launch-10/*.mp4; do
  echo "=== $f ==="
  ./node_modules/@remotion/compositor-linux-x64-gnu/ffprobe -v error -show_entries format=duration:stream=width,height,r_frame_rate -of default=noprint_wrappers=1 "$f"
done
```

Expected for every MP4: `width=1080`, `height=1920`, `r_frame_rate=30/1`, `duration` between 8.0 and 30.5 seconds.

- [ ] **Step 4: Copy to Windows desktop for eyeball pass.**

```bash
mkdir -p /mnt/c/Users/marku/Desktop/numaradio-launch-10
cp out/launch-10/*.mp4 /mnt/c/Users/marku/Desktop/numaradio-launch-10/
cp out/launch-10/*.captions.md /mnt/c/Users/marku/Desktop/numaradio-launch-10/
```

Watch each one once. Sanity checks per piece:
- `song-broken-drive` / `song-rainy-lisbon`: real listener prompt is on-screen, real generated track audible during the money-beat window.
- `shoutout-mom` / `shoutout-dad`: real listener text is on-screen, Lena re-synth audio reads it aloud at the right beat.
- `stat-shoutouts-fresh` / `stat-tracks-tonight`: the live count animates and lands; matches what `snapshot.json freshCounts` says.
- `listen-now-v2` / `meet-lena-v2` / `howto-shoutout-noapp`: openers land by frame 30 (≤1s), no stutter.
- `magic-loop`: three beats clearly read; prompt → portrait+waveform → URL stamp; total ≤8s.

- [ ] **Step 5: If any piece fails eyeball pass, re-render just that one** (don't re-do the whole batch). The slug filter on the batch script makes this cheap:

```bash
rm -rf .remotion out/launch-10/<slug>.mp4
npm run video:launch-10 <slug>
```

Iterate until all 10 look right.

- [ ] **Step 6: Final commit (in numaradio repo where the spec + plan + exporter live) and push.**

The MP4s themselves are gitignored (out/ in both repos). Commit the plan execution evidence (this plan file is already committed; nothing new should remain uncommitted in either repo except maybe an updated `snapshot.json` which is also gitignored).

```bash
cd /home/marku/saas/numaradio
git status
# Should be clean. If not, review and commit anything intentional.
git push origin main

cd /home/marku/saas/numaradio-videos
git status
git push origin main
```

- [ ] **Step 7: Hand off to operator with the next-actions list.**

The 10 MP4s + caption files are now on the Windows desktop at `numaradio-launch-10/`. Operator action:
- Post in the cadence from the spec (Mon/Wed/Fri starting next business day).
- Highest-confidence pieces first (#1 `song-broken-drive`, #3 `shoutout-mom`, #5 `stat-shoutouts-fresh`).
- Don't re-upload any of the 21 dead livestream VODs as fresh content — they hurt channel SEO.
- Hide or unlist underperforming Shorts older than 60 days from the public channel grid (optional; the algo doesn't punish but the grid does for a first-visit subscriber decision).
