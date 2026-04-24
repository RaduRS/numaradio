# Shoutout Flagship + Voice Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 15-second `ShoutoutFlagship` composition rendered end-to-end as `out/shoutout-flagship.mp4` — featuring the approved composed-in-authentic-voice shoutout typed on screen, morphing into a waveform, with Lena's Deepgram Luna voice reading it over a music bed and broadcast-HUD visuals.

**Architecture:** Deepgram Luna TTS (mirroring production's `deepgram-tts.ts`) generates a committed voice MP3. Two new primitives (`TypedText`, `Waveform`) handle the beat-2 typography-to-audio transformation. Five inline helpers from ListenNow (`ScanLines`, `FilmGrain`, `LiveChip`, `EyebrowStrip`, `Wordmark`) are extracted into reusable primitives so both ListenNow and ShoutoutFlagship share them. The composition is built with the `frontend-design` skill invoked at the start of its task.

**Tech Stack:** Remotion 4.x (already installed), TypeScript, `tsx`, native `fetch` to Deepgram `/v1/speak`, node's `--test` runner via `tsx --test` (same convention as numaradio-videos' existing tests).

**Spec:** `docs/superpowers/specs/2026-04-24-shoutout-flagship-design.md`

---

## Task 1: Voice pipeline — generate-voice.ts + flagship MP3

**Files:**
- Create: `~/saas/numaradio-videos/src/scripts/generate-voice.ts`
- Create: `~/saas/numaradio-videos/src/assets/voice/shoutout-flagship.mp3` (generated + committed)

No unit tests — script is pure I/O, matches the `curate-music-beds.ts` / `generate-lena-portrait.ts` no-test convention.

- [ ] **Step 1: Write `src/scripts/generate-voice.ts`**

Full contents:

```ts
#!/usr/bin/env -S node --experimental-strip-types

import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

config({
  path: resolve(dirname(fileURLToPath(import.meta.url)), "../../.env.local"),
  quiet: true,
});

const DEEPGRAM_URL = "https://api.deepgram.com/v1/speak";
const MODEL_PRIMARY = "aura-2-luna-en";
const MODEL_FALLBACK = "aura-asteria-en";

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not set in .env.local`);
  return v;
}

async function callDeepgram(text: string, model: string, apiKey: string): Promise<Response> {
  return fetch(`${DEEPGRAM_URL}?model=${model}&encoding=mp3`, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });
}

async function synthesize(text: string, apiKey: string): Promise<Buffer> {
  let res = await callDeepgram(text, MODEL_PRIMARY, apiKey);
  if (!res.ok && [400, 404, 422].includes(res.status)) {
    console.log(`  ↪ ${MODEL_PRIMARY} returned ${res.status}, retrying with ${MODEL_FALLBACK}`);
    res = await callDeepgram(text, MODEL_FALLBACK, apiKey);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`deepgram ${res.status}: ${detail.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function parseArgs(argv: string[]): { name: string; text: string } {
  const args = argv.slice(2);
  if (args.length < 2) {
    console.error(`Usage: npx tsx src/scripts/generate-voice.ts <compositionName> "<text>"`);
    console.error(`Example: npx tsx src/scripts/generate-voice.ts shoutout-flagship "This one's going out to my mom..."`);
    process.exit(2);
  }
  const name = args[0];
  const text = args.slice(1).join(" ").trim();
  if (!text) {
    console.error("Error: empty text");
    process.exit(2);
  }
  return { name, text };
}

async function main(): Promise<void> {
  const apiKey = getEnv("DEEPGRAM_API_KEY");
  const { name, text } = parseArgs(process.argv);

  const here = dirname(fileURLToPath(import.meta.url));
  const outDir = resolve(here, "../assets/voice");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, `${name}.mp3`);

  console.log(`→ Synthesizing voice for "${name}"`);
  console.log(`  model: ${MODEL_PRIMARY} (fallback: ${MODEL_FALLBACK})`);
  console.log(`  text: "${text.slice(0, 90)}${text.length > 90 ? "..." : ""}"`);

  const buf = await synthesize(text, apiKey);
  writeFileSync(outPath, buf);
  console.log(`✓ Wrote ${outPath} (${(buf.length / 1024).toFixed(0)} KB)`);
}

main().catch((err) => {
  console.error("✗", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

- [ ] **Step 2: Type-check**

```bash
cd /home/marku/saas/numaradio-videos
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit the script**

```bash
git add src/scripts/generate-voice.ts
git commit -m "scripts: lena voice generator via deepgram luna"
```

- [ ] **Step 4: Generate the flagship voice MP3**

```bash
cd /home/marku/saas/numaradio-videos
npx tsx src/scripts/generate-voice.ts shoutout-flagship \
  "This one's going out to my mom. She listens every morning when she makes coffee. Tell her hi from the night shift."
```

Expected output (timings vary 2-5s):

```
→ Synthesizing voice for "shoutout-flagship"
  model: aura-2-luna-en (fallback: aura-asteria-en)
  text: "This one's going out to my mom. She listens every morning when she makes coffee. Tell her..."
✓ Wrote /home/marku/saas/numaradio-videos/src/assets/voice/shoutout-flagship.mp3 (NNN KB)
```

Expected MP3 size: 70-150 KB (Deepgram MP3 output for ~7s of speech).

- [ ] **Step 5: Human review — listen to Lena**

Copy the MP3 to the Windows desktop and play it:

```bash
mkdir -p /mnt/c/Users/marku/Desktop/lena-voice-preview
cp /home/marku/saas/numaradio-videos/src/assets/voice/shoutout-flagship.mp3 /mnt/c/Users/marku/Desktop/lena-voice-preview/
```

User listens and either:
- **Approves** ("sounds good" / "Lena is Lena") → proceed to Step 6
- **Rejects** ("too fast" / "wrong energy" / "try Asteria instead") → iterate:
  - If user wants Asteria: temporarily edit the script's `MODEL_PRIMARY` to `"aura-asteria-en"` and rerun Step 4, then restore to Luna (or keep Asteria if it's better)
  - If user wants different text: rerun Step 4 with the new text
  - Delete the old MP3 from Desktop preview folder and re-copy
- DO NOT commit the MP3 until the user has approved it.

- [ ] **Step 6: Commit the approved MP3**

```bash
cd /home/marku/saas/numaradio-videos
git add src/assets/voice/shoutout-flagship.mp3
git commit -m "voice: shoutout-flagship.mp3 (lena luna, approved)"
```

Verify:

```bash
git log --oneline -2
git ls-files src/assets/voice/
```

Expected: commit on top, `src/assets/voice/shoutout-flagship.mp3` tracked.

---

## Task 2: Primitive — TypedText

**Files:**
- Create: `~/saas/numaradio-videos/src/primitives/TypedText.test.ts`
- Create: `~/saas/numaradio-videos/src/primitives/TypedText.tsx`

TDD. The `visibleCharsAtFrame` pure function is the testable core; the React component is a thin wrapper.

- [ ] **Step 1: Write the failing test**

Create `src/primitives/TypedText.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleCharsAtFrame } from "./TypedText.tsx";

test("visibleCharsAtFrame returns 0 before any char has revealed", () => {
  // framesPerChar=2 means char 0 reveals at frame 2, char 1 at frame 4...
  assert.equal(visibleCharsAtFrame(0, 10, 2), 0);
  assert.equal(visibleCharsAtFrame(1, 10, 2), 0);
});

test("visibleCharsAtFrame reveals one char every framesPerChar frames", () => {
  assert.equal(visibleCharsAtFrame(2, 10, 2), 1);
  assert.equal(visibleCharsAtFrame(4, 10, 2), 2);
  assert.equal(visibleCharsAtFrame(10, 10, 2), 5);
});

test("visibleCharsAtFrame clamps at totalChars past the end", () => {
  assert.equal(visibleCharsAtFrame(100, 10, 2), 10);
  assert.equal(visibleCharsAtFrame(20, 10, 2), 10);
});

test("visibleCharsAtFrame handles zero chars", () => {
  assert.equal(visibleCharsAtFrame(50, 0, 2), 0);
});

test("visibleCharsAtFrame handles negative frames", () => {
  assert.equal(visibleCharsAtFrame(-5, 10, 2), 0);
});

test("visibleCharsAtFrame with framesPerChar=1 reveals one char per frame", () => {
  assert.equal(visibleCharsAtFrame(0, 10, 1), 0);
  assert.equal(visibleCharsAtFrame(1, 10, 1), 1);
  assert.equal(visibleCharsAtFrame(5, 10, 1), 5);
});
```

- [ ] **Step 2: Run tests, verify fail**

```bash
cd /home/marku/saas/numaradio-videos
npx tsx --test src/primitives/TypedText.test.ts
```

Expected: FAIL with module not found.

- [ ] **Step 3: Write the implementation**

Create `src/primitives/TypedText.tsx`:

```tsx
import { useCurrentFrame } from "remotion";
import type { CSSProperties } from "react";
import { COLORS } from "../tokens/brand.ts";

/**
 * Pure — number of characters that should be visible at a given frame.
 * Char index i reveals AT frame (i + 1) * framesPerChar, so char 0 appears
 * at frame framesPerChar, char 1 at 2*framesPerChar, etc. Clamped to [0, totalChars].
 */
export function visibleCharsAtFrame(
  frame: number,
  totalChars: number,
  framesPerChar: number,
): number {
  if (frame < 0 || totalChars === 0) return 0;
  const shown = Math.floor(frame / framesPerChar);
  return Math.max(0, Math.min(totalChars, shown));
}

export interface TypedTextProps {
  text: string;
  /** Frames between each character reveal. Default 2 (fast typist). */
  framesPerChar?: number;
  /** Optional style overrides for the outer text container. */
  style?: CSSProperties;
  /** Optional caret color. Default brand accent (teal). */
  caretColor?: string;
  /** Hide the caret (for a "finished typing" held state). Default false. */
  hideCaret?: boolean;
}

/**
 * Letter-by-letter typing animation with a blinking caret.
 * Renders `text.slice(0, visibleCharsAtFrame(...))` plus a blinking pipe at the end.
 */
export function TypedText({
  text,
  framesPerChar = 2,
  style,
  caretColor = COLORS.accent,
  hideCaret = false,
}: TypedTextProps) {
  const frame = useCurrentFrame();
  const visible = visibleCharsAtFrame(frame, text.length, framesPerChar);
  const shown = text.slice(0, visible);
  // Caret blinks on a ~0.5s cycle (15 frames @30fps).
  const caretVisible = !hideCaret && Math.floor(frame / 15) % 2 === 0;

  return (
    <span style={style}>
      {shown}
      <span
        style={{
          display: "inline-block",
          width: "0.6em",
          borderLeft: `3px solid ${caretColor}`,
          marginLeft: "0.08em",
          opacity: caretVisible ? 1 : 0,
          verticalAlign: "text-bottom",
          height: "1em",
        }}
        aria-hidden="true"
      />
    </span>
  );
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npx tsx --test src/primitives/TypedText.test.ts
```

Expected: `pass 6, fail 0`.

- [ ] **Step 5: Type-check everything**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/primitives/TypedText.tsx src/primitives/TypedText.test.ts
git commit -m "primitive: TypedText — letter-by-letter typing with blinking caret"
```

---

## Task 3: Primitive — Waveform

**Files:**
- Create: `~/saas/numaradio-videos/src/primitives/Waveform.test.ts`
- Create: `~/saas/numaradio-videos/src/primitives/Waveform.tsx`

TDD on the `waveformHeights` pure function.

- [ ] **Step 1: Write the failing test**

Create `src/primitives/Waveform.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { waveformHeights } from "./Waveform.tsx";

test("waveformHeights returns an array of length barCount", () => {
  assert.equal(waveformHeights(0, 13, 30).length, 13);
  assert.equal(waveformHeights(50, 7, 30).length, 7);
});

test("waveformHeights returns empty array for barCount=0", () => {
  assert.deepEqual(waveformHeights(10, 0, 30), []);
});

test("waveformHeights values are all in [0.1, 1.0]", () => {
  for (let frame = 0; frame < 120; frame++) {
    const heights = waveformHeights(frame, 13, 30);
    for (const h of heights) {
      assert.ok(h >= 0.1 && h <= 1.0, `frame ${frame} height ${h} out of range`);
    }
  }
});

test("waveformHeights has variance across bars at a given frame", () => {
  // Different bars should have different heights — they have phase offsets.
  const heights = waveformHeights(10, 13, 30);
  const unique = new Set(heights.map((h) => h.toFixed(3)));
  assert.ok(unique.size >= 5, `bars too synchronized: ${unique.size} unique heights`);
});

test("waveformHeights changes over time", () => {
  // Frame 0 vs frame 15 (0.5s later) should yield different height arrays.
  const a = waveformHeights(0, 13, 30);
  const b = waveformHeights(15, 13, 30);
  let differentCount = 0;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > 0.05) differentCount += 1;
  }
  assert.ok(differentCount >= 5, `expected at least 5 bars to change, got ${differentCount}`);
});
```

- [ ] **Step 2: Run tests, verify fail**

```bash
npx tsx --test src/primitives/Waveform.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

Create `src/primitives/Waveform.tsx`:

```tsx
import { useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS } from "../tokens/brand.ts";

const CYCLE_SECONDS = 0.6; // Faster than EqBars (1.0s) — waveforms feel more active.

/**
 * Pure — returns an array of normalized bar heights [0.1, 1.0] for a horizontal
 * audio-waveform visualization. Each bar has a unique phase offset so the shape
 * is perceived as audio, not a synchronized grid.
 */
export function waveformHeights(
  frame: number,
  barCount: number,
  fps: number,
): number[] {
  if (barCount === 0) return [];
  const cycleFrames = CYCLE_SECONDS * fps;
  const heights: number[] = [];
  for (let i = 0; i < barCount; i++) {
    // Unique phase per bar via a prime-ish stride.
    const phase = (i * 0.37) % 1;
    const t = (frame / cycleFrames + phase) % 1;
    // Double-sine gives waveform-ish shape (two peaks per cycle) — feels like audio.
    const raw = 0.55 + 0.45 * Math.sin(2 * Math.PI * t) * Math.cos(Math.PI * t);
    heights.push(Math.max(0.1, Math.min(1.0, raw)));
  }
  return heights;
}

export interface WaveformProps {
  /** Total width in px. */
  width: number;
  /** Peak height in px. */
  height: number;
  /** Number of bars. Default 13 (odd number reads cleaner). */
  barCount?: number;
  /** Bar color. Default brand accent (teal). */
  color?: string;
}

/**
 * Horizontal audio-waveform visualization. Variable bar heights with unique
 * phase per bar so it reads as audio rather than a synchronized grid.
 */
export function Waveform({
  width,
  height,
  barCount = 13,
  color = COLORS.accent,
}: WaveformProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const heights = waveformHeights(frame, barCount, fps);
  const gap = 6;
  const barWidth = (width - gap * (barCount - 1)) / barCount;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: `${gap}px`,
        width,
        height,
      }}
    >
      {heights.map((h, i) => (
        <div
          key={i}
          style={{
            width: barWidth,
            height: `${h * 100}%`,
            background: color,
            borderRadius: 2,
            boxShadow: `0 0 ${h * 18}px ${COLORS.accentGlow}`,
          }}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npx tsx --test src/primitives/Waveform.test.ts
```

Expected: `pass 5, fail 0`.

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/primitives/Waveform.tsx src/primitives/Waveform.test.ts
git commit -m "primitive: Waveform — horizontal audio-waveform visualization"
```

---

## Task 4: Extract 5 primitives from ListenNow + refactor

**Files:**
- Create: `~/saas/numaradio-videos/src/primitives/ScanLines.tsx`
- Create: `~/saas/numaradio-videos/src/primitives/FilmGrain.tsx`
- Create: `~/saas/numaradio-videos/src/primitives/LiveChip.tsx`
- Create: `~/saas/numaradio-videos/src/primitives/EyebrowStrip.tsx`
- Create: `~/saas/numaradio-videos/src/primitives/Wordmark.tsx`
- Modify: `~/saas/numaradio-videos/src/compositions/ListenNow.tsx` — remove inline helpers, import from primitives

No unit tests — these are presentational wrappers without testable pure logic. ListenNow's visual output is itself the regression check (re-render + eyeball).

- [ ] **Step 1: Create `src/primitives/ScanLines.tsx`**

```tsx
import { AbsoluteFill, useCurrentFrame } from "remotion";

/**
 * CRT-style horizontal overlay with subtle vertical drift. Always-on texture.
 * No props — behavior is uniform across all consumers.
 */
export function ScanLines() {
  const frame = useCurrentFrame();
  const drift = (frame * 0.5) % 4;
  return (
    <AbsoluteFill
      style={{
        backgroundImage: `repeating-linear-gradient(
          0deg,
          rgba(255,255,255,0.04) 0px,
          rgba(255,255,255,0.04) 1px,
          transparent 1px,
          transparent 4px
        )`,
        backgroundPosition: `0 ${drift}px`,
        pointerEvents: "none",
        mixBlendMode: "overlay",
      }}
    />
  );
}
```

- [ ] **Step 2: Create `src/primitives/FilmGrain.tsx`**

```tsx
import { AbsoluteFill } from "remotion";

/**
 * Subtle SVG noise texture overlay. Adds film-grain character without
 * distracting from composition content. No props, uniform across consumers.
 */
export function FilmGrain() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2"/><feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.1 0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>`;
  return (
    <AbsoluteFill
      style={{
        backgroundImage: `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`,
        opacity: 0.18,
        pointerEvents: "none",
        mixBlendMode: "overlay",
      }}
    />
  );
}
```

- [ ] **Step 3: Create `src/primitives/LiveChip.tsx`**

```tsx
import { useCurrentFrame } from "remotion";
import { COLORS, FONTS } from "../tokens/brand.ts";

/**
 * Top-right red "LIVE" chip with a breathing red dot.
 * Fixed position (top: 56px, right: 56px). No props — brand-uniform.
 */
export function LiveChip() {
  const frame = useCurrentFrame();
  const dotOpacity = 0.55 + 0.45 * Math.abs(Math.sin((frame / 48) * Math.PI));
  return (
    <div
      style={{
        position: "absolute",
        top: 56,
        right: 56,
        padding: "10px 20px",
        borderRadius: 999,
        background: "rgba(255,77,77,0.14)",
        border: `1px solid ${COLORS.redLive}`,
        display: "flex",
        alignItems: "center",
        gap: 12,
        fontFamily: `"${FONTS.mono}", ui-monospace, monospace`,
        fontSize: 22,
        letterSpacing: "0.22em",
        color: COLORS.fg,
        textTransform: "uppercase",
      }}
    >
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: COLORS.redLive,
          boxShadow: `0 0 14px ${COLORS.redLive}`,
          opacity: dotOpacity,
        }}
      />
      Live
    </div>
  );
}
```

- [ ] **Step 4: Create `src/primitives/EyebrowStrip.tsx`**

```tsx
import { COLORS, FONTS } from "../tokens/brand.ts";

export interface EyebrowStripProps {
  /** The full text to display. Typically "NUMA RADIO · <metadata>". */
  text: string;
}

/**
 * Top-left mono metadata strip — broadcast chyron style. Each composition
 * passes its own text to set the context (e.g. "NUMA RADIO · EST. 2026 · 24 / 7"
 * for ListenNow, "NUMA RADIO · LIVE · LISTENER SHOUTOUT" for ShoutoutFlagship).
 */
export function EyebrowStrip({ text }: EyebrowStripProps) {
  return (
    <div
      style={{
        position: "absolute",
        top: 64,
        left: 56,
        fontFamily: `"${FONTS.mono}", ui-monospace, monospace`,
        fontSize: 22,
        letterSpacing: "0.28em",
        color: COLORS.fgDim,
        textTransform: "uppercase",
      }}
    >
      {text}
    </div>
  );
}
```

- [ ] **Step 5: Create `src/primitives/Wordmark.tsx`**

```tsx
import { COLORS, FONTS } from "../tokens/brand.ts";

/**
 * The stacked "NUMA / RADIO" Archivo Black display block. Used in the
 * payoff beats of ListenNow and ShoutoutFlagship. No props — brand-identical.
 */
export function Wordmark() {
  return (
    <div
      style={{
        fontFamily: `"${FONTS.display}", system-ui, sans-serif`,
        fontSize: 200,
        letterSpacing: "-0.02em",
        textTransform: "uppercase",
        color: COLORS.fg,
        fontWeight: 800,
        fontStretch: "125%",
        lineHeight: 0.9,
        textAlign: "center",
      }}
    >
      Numa
      <br />
      Radio
    </div>
  );
}
```

- [ ] **Step 6: Refactor `src/compositions/ListenNow.tsx` to consume the new primitives**

Open `src/compositions/ListenNow.tsx`. Apply these changes:

1. Add five new imports near the top, after the existing primitive imports:

```tsx
import { ScanLines } from "../primitives/ScanLines.tsx";
import { FilmGrain } from "../primitives/FilmGrain.tsx";
import { LiveChip } from "../primitives/LiveChip.tsx";
import { EyebrowStrip } from "../primitives/EyebrowStrip.tsx";
import { Wordmark } from "../primitives/Wordmark.tsx";
```

2. Update the `EyebrowStrip` usage to pass text as a prop (it was previously hardcoded inside the inline function). The existing inline `EyebrowStrip` is rendered inside a `<Sequence from={6}>` — change that to:

```tsx
<Sequence from={6}>
  <EyebrowStrip text="Numa Radio · Est. 2026 · 24 / 7" />
  <LiveChip />
</Sequence>
```

3. Delete the inline function declarations at the bottom of the file:
   - `function ScanLines() { ... }` — delete
   - `function FilmGrain() { ... }` — delete
   - `function EyebrowStrip() { ... }` — delete
   - `function LiveChip() { ... }` — delete
   - `function Wordmark() { ... }` — delete

4. In the payoff beat, `<Wordmark />` is already rendered as a JSX element — no change needed there, the import simply replaces the inline function.

5. Keep the existing inline functions that are NOT being extracted: `TealFlash`, `RadialGlow`, `NeverSleepsTitle`, `BroadcastBeat`, `RadiatingDot`, `BroadcastTimecode`, `BroadcastMarquee`, `PayoffBeat`. These are one-composition-use and stay inline.

- [ ] **Step 7: Type-check**

```bash
cd /home/marku/saas/numaradio-videos
npx tsc --noEmit
```

Expected: zero errors. If there's an error about unused imports or missing types, check step 6's delete list.

- [ ] **Step 8: Run tests**

```bash
npm test
```

Expected: all tests pass (21 total now — previous 16 + 6 from TypedText + 5 from Waveform = 27, actually; confirm pass count is 27 after the new primitives landed). No new failures from extraction (which has no tests).

*Actually recount: Phase 1 had 16 tests (brand 3 + PulsingDot 4 + EqBars 2 + BrandTitle 2 + MusicBed 5). Adding TypedText's 6 and Waveform's 5 = 27. Expected `pass 27` after this task.*

- [ ] **Step 9: Re-render ListenNow to verify no visual regression**

```bash
npm run render ListenNow listen-now
```

Expected: MP4 renders cleanly, similar file size to before (~2.2 MB), same ~15s render time.

Copy to desktop and eyeball:

```bash
cp out/listen-now.mp4 /mnt/c/Users/marku/Desktop/listen-now-refactor-check.mp4
```

User opens and confirms: the refactored ListenNow looks **identical** to before. No visual regression. If anything looks off (positions shifted, text missing, colors wrong), investigate — something about the extraction diverged from the inline.

- [ ] **Step 10: Commit**

```bash
cd /home/marku/saas/numaradio-videos
git add src/primitives/ScanLines.tsx \
  src/primitives/FilmGrain.tsx \
  src/primitives/LiveChip.tsx \
  src/primitives/EyebrowStrip.tsx \
  src/primitives/Wordmark.tsx \
  src/compositions/ListenNow.tsx
git commit -m "primitives: extract ScanLines, FilmGrain, LiveChip, EyebrowStrip, Wordmark from ListenNow"
```

Verify:

```bash
git log --oneline -1
git status
```

Expected: commit on top, tree clean.

---

## Task 5: ShoutoutFlagship composition + first render

**Files:**
- Create: `~/saas/numaradio-videos/src/compositions/ShoutoutFlagship.tsx`
- Modify: `~/saas/numaradio-videos/src/Root.tsx` — register the new composition

**REQUIRED SKILL INVOCATION:** Before writing ShoutoutFlagship's code, invoke the `frontend-design` skill. ListenNow v1 was corporate-feeling on first pass; the v2 rework via `frontend-design` was what made it snap. Do NOT skip this — the user has an explicit durable preference ("invoke frontend-design during implementation of any Numa Radio UI component") and the spec documents it.

- [ ] **Step 1: Invoke the `frontend-design` skill**

From the implementer agent, invoke the `frontend-design` skill with a briefing on:
- The spec's beat-by-beat storyboard (Task 5 context includes it below)
- The aesthetic already established by ListenNow v3 (late-night pirate-radio broadcast, dark, scan-lined, hard cuts, punchy)
- The mandate to match that aesthetic while adapting the specific beats for the shoutout loop (typing → submit → broadcast → payoff)

The skill's output informs the beat-level treatment decisions in Step 2. Don't skip reading its guidance.

- [ ] **Step 2: Write `src/compositions/ShoutoutFlagship.tsx`**

Full contents. This is the v1 — expect to iterate to v2+ after user review (see Task 6).

```tsx
import { AbsoluteFill, Audio, Sequence, useCurrentFrame, interpolate, Easing, staticFile } from "remotion";
import { COLORS, FONTS, TIMING } from "../tokens/brand.ts";
import { loadBrandFonts } from "../tokens/fonts.ts";
import { MusicBed } from "../primitives/MusicBed.tsx";
import { ScanLines } from "../primitives/ScanLines.tsx";
import { FilmGrain } from "../primitives/FilmGrain.tsx";
import { LiveChip } from "../primitives/LiveChip.tsx";
import { EyebrowStrip } from "../primitives/EyebrowStrip.tsx";
import { Wordmark } from "../primitives/Wordmark.tsx";
import { TypedText } from "../primitives/TypedText.tsx";
import { Waveform } from "../primitives/Waveform.tsx";
import { PulsingDot } from "../primitives/PulsingDot.tsx";
import { EqBars } from "../primitives/EqBars.tsx";

loadBrandFonts();

// ShoutoutFlagship — 15s (450 frames @ 30fps), 1080×1920.
// Aesthetic: pirate-radio broadcast, hard cuts, atmosphere always on.
// See spec: docs/superpowers/specs/2026-04-24-shoutout-flagship-design.md

export const SHOUTOUT_FLAGSHIP_DURATION = 15 * TIMING.fps; // 450 frames

const SHOUTOUT_TEXT =
  "This one's going out to my mom. She listens every morning when she makes coffee. Tell her hi from the night shift.";

export function ShoutoutFlagship() {
  return (
    <AbsoluteFill style={{ background: COLORS.bg }}>
      <MusicBed
        src="music-beds/bed-02-rainy-blue-echoes.mp3"
        envelope={{ fadeInFrames: 6, sustainFrames: 384, fadeOutFrames: 60 }}
      />

      {/* Lena's voice. Starts at the moment the shoutout "submits" (frame 150). */}
      <Sequence from={150}>
        <Audio src={staticFile("voice/shoutout-flagship.mp3")} />
      </Sequence>

      {/* Atmosphere — always on. */}
      <ScanLines />
      <FilmGrain />

      {/* Beat 1: Hook flash */}
      <TealFlash />

      {/* Persistent HUD from frame 6 */}
      <Sequence from={6}>
        <EyebrowStrip text="Numa Radio · Live · Listener Shoutout" />
        <LiveChip />
      </Sequence>

      {/* Beat 2: Typing (frames 15-150) */}
      <Sequence from={15} durationInFrames={135}>
        <InputCard />
      </Sequence>

      {/* Beat 3: Submit → broadcast → voice (frames 150-390) */}
      <Sequence from={150} durationInFrames={240}>
        <BroadcastBeat />
      </Sequence>

      {/* Beat 4: Payoff (frames 390-450) */}
      <Sequence from={390} durationInFrames={60}>
        <PayoffBeat />
      </Sequence>
    </AbsoluteFill>
  );
}

// --- Atmosphere -------------------------------------------------------------

function TealFlash() {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 3, 9], [1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  if (opacity <= 0) return null;
  return <AbsoluteFill style={{ background: COLORS.accent, opacity }} />;
}

// --- Beat 2: Input card with typing text ------------------------------------

function InputCard() {
  const frame = useCurrentFrame();
  // Card fades in first 6 frames.
  const cardOpacity = interpolate(frame, [0, 6], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // Submit flash (teal pulse) fires in the last 10 frames of this sequence.
  const flashOpacity = interpolate(frame, [125, 130, 135], [0, 0.4, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      {/* Label above the card: "numaradio.com · requests" */}
      <div
        style={{
          fontFamily: `"${FONTS.mono}", ui-monospace, monospace`,
          fontSize: 22,
          letterSpacing: "0.26em",
          color: COLORS.fgDim,
          textTransform: "uppercase",
          marginBottom: 32,
          opacity: cardOpacity,
        }}
      >
        numaradio.com · requests
      </div>

      {/* The mobile-input card */}
      <div
        style={{
          width: 900,
          minHeight: 360,
          padding: "44px 48px",
          borderRadius: 24,
          background: COLORS.bg2,
          border: `1.5px solid ${COLORS.accent}`,
          boxShadow: `0 0 60px ${COLORS.accentGlow}`,
          fontFamily: `"${FONTS.body}", system-ui, sans-serif`,
          fontSize: 52,
          lineHeight: 1.35,
          color: COLORS.fg,
          opacity: cardOpacity,
          position: "relative",
        }}
      >
        <TypedText text={SHOUTOUT_TEXT} framesPerChar={1} />

        {/* Submit flash overlay on the card */}
        <div
          style={{
            position: "absolute",
            inset: -6,
            borderRadius: 28,
            background: COLORS.accent,
            opacity: flashOpacity,
            pointerEvents: "none",
          }}
        />
      </div>
    </AbsoluteFill>
  );
}

// --- Beat 3: Broadcast + HUD ------------------------------------------------

function BroadcastBeat() {
  const frame = useCurrentFrame();
  // Staggered entrance: waveform → dot pulse → EqBars; HUD callouts over Lena's voice.
  const waveformOpacity = interpolate(frame, [10, 30], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const dotOpacity = interpolate(frame, [30, 45, 60, 75], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const eqOpacity = interpolate(frame, [45, 70], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const hudOpacity = interpolate(frame, [60, 90], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill>
      {/* Waveform across the middle — persistent through the beat, literalizes Lena's voice. */}
      <div
        style={{
          position: "absolute",
          top: 840,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          opacity: waveformOpacity,
        }}
      >
        <Waveform width={900} height={200} barCount={17} />
      </div>

      {/* Brief PulsingDot between waveform condensation and EqBars reveal. */}
      <div
        style={{
          position: "absolute",
          top: 520,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          opacity: dotOpacity,
        }}
      >
        <PulsingDot size={160} />
      </div>

      {/* EqBars below — takes over once the dot fades. */}
      <div
        style={{
          position: "absolute",
          top: 520,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          opacity: eqOpacity,
        }}
      >
        <EqBars width={360} height={240} />
      </div>

      {/* HUD callouts — broadcast chrome over Lena's voice. */}
      <div
        style={{
          position: "absolute",
          top: 1140,
          left: 0,
          right: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 26,
          opacity: hudOpacity,
        }}
      >
        <GoingLiveCallout />
        <ListenerTicker />
        <BroadcastTimecode />
      </div>
    </AbsoluteFill>
  );
}

function GoingLiveCallout() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        fontFamily: `"${FONTS.mono}", ui-monospace, monospace`,
        fontSize: 28,
        letterSpacing: "0.28em",
        color: COLORS.accent,
        textTransform: "uppercase",
      }}
    >
      <span>Going Live</span>
      <span style={{ color: COLORS.accent }}>✓</span>
    </div>
  );
}

function ListenerTicker() {
  const frame = useCurrentFrame();
  // Tick 27 → 31 → 36 → 42 → 48 over beat 3's ~210 frames.
  // Each tick every ~42 frames (1.4s).
  const ticks = [27, 31, 36, 42, 48];
  const idx = Math.min(ticks.length - 1, Math.floor(frame / 42));
  const count = ticks[idx];
  return (
    <div
      style={{
        fontFamily: `"${FONTS.mono}", ui-monospace, monospace`,
        fontSize: 44,
        letterSpacing: "0.04em",
        color: COLORS.fg,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {count} <span style={{ color: COLORS.fgDim, fontSize: 26, letterSpacing: "0.22em", textTransform: "uppercase" }}>listeners</span>
    </div>
  );
}

function BroadcastTimecode() {
  // Matches ListenNow's nighttime vibe: starts at 03:27:42, ticks once per second.
  const frame = useCurrentFrame();
  const seedSeconds = 3 * 3600 + 27 * 60 + 42;
  const elapsed = Math.floor(frame / 30);
  const total = (seedSeconds + elapsed) % (24 * 3600);
  const hh = String(Math.floor(total / 3600)).padStart(2, "0");
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return (
    <div
      style={{
        fontFamily: `"${FONTS.mono}", ui-monospace, monospace`,
        fontSize: 26,
        letterSpacing: "0.16em",
        color: COLORS.fgDim,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {hh}:{mm}:{ss}
    </div>
  );
}

// --- Beat 4: Payoff ---------------------------------------------------------

function PayoffBeat() {
  const frame = useCurrentFrame();
  const wordmarkOpacity = interpolate(frame, [0, 8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const underlineWidth = interpolate(frame, [10, 36], [0, 540], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const urlOpacity = interpolate(frame, [36, 54], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column" }}>
      <div style={{ opacity: wordmarkOpacity }}>
        <Wordmark />
      </div>
      <div
        style={{
          width: underlineWidth,
          height: 4,
          background: COLORS.accent,
          boxShadow: `0 0 24px ${COLORS.accentGlow}`,
          marginTop: 42,
          marginBottom: 42,
        }}
      />
      <div
        style={{
          fontFamily: `"${FONTS.mono}", ui-monospace, monospace`,
          fontSize: 44,
          letterSpacing: "0.24em",
          color: COLORS.fgDim,
          textTransform: "uppercase",
          opacity: urlOpacity,
        }}
      >
        numaradio.com
      </div>
    </AbsoluteFill>
  );
}
```

- [ ] **Step 3: Register in `src/Root.tsx`**

Add imports and composition registration. The resulting `Root.tsx` should look like this (current contents plus the ShoutoutFlagship addition):

```tsx
import { Composition } from "remotion";
import { ListenNow, LISTEN_NOW_DURATION } from "./compositions/ListenNow.tsx";
import { ShoutoutFlagship, SHOUTOUT_FLAGSHIP_DURATION } from "./compositions/ShoutoutFlagship.tsx";

export function Root() {
  return (
    <>
      <Composition
        id="ListenNow"
        component={ListenNow}
        durationInFrames={LISTEN_NOW_DURATION}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="ShoutoutFlagship"
        component={ShoutoutFlagship}
        durationInFrames={SHOUTOUT_FLAGSHIP_DURATION}
        fps={30}
        width={1080}
        height={1920}
      />
    </>
  );
}
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

Expected output (two compositions listed):

```
ListenNow           30      1080x1920      450 (15.00 sec)
ShoutoutFlagship    30      1080x1920      450 (15.00 sec)
```

- [ ] **Step 6: Commit the composition + Root registration**

```bash
git add src/compositions/ShoutoutFlagship.tsx src/Root.tsx
git commit -m "composition: ShoutoutFlagship v1 — 15s flagship shoutout piece"
```

- [ ] **Step 7: Render**

```bash
npm run render ShoutoutFlagship shoutout-flagship
```

Expected output (timings vary 15-60s):

```
→ Bundling Remotion project...
  bundled in ~1s
→ Selecting composition ShoutoutFlagship...
→ Rendering ShoutoutFlagship (15.0s, 1080×1920, 30fps)...
✓ Rendered to /home/marku/saas/numaradio-videos/out/shoutout-flagship.mp4 (X.X MB, 15.0s) in Xs
```

Expected MP4 size: 2-4 MB (larger than ListenNow because of Lena's voice + waveform rendering).

- [ ] **Step 8: Stage for user eyeball review**

```bash
cp /home/marku/saas/numaradio-videos/out/shoutout-flagship.mp4 /mnt/c/Users/marku/Desktop/
```

Report the MP4 path to the user and stop. **v2+ iteration loop follows based on user feedback — same pattern as ListenNow v1 → v2 → v3. Do NOT declare Phase 2b complete on v1 — the user must eyeball and approve before we declare done.**

---

## Definition of Done for Stage 2b

1. `src/scripts/generate-voice.ts` exists, produces committable MP3s via Deepgram Luna.
2. `src/assets/voice/shoutout-flagship.mp3` is committed and contains user-approved Lena voice.
3. `TypedText`, `Waveform` primitives exist with passing unit tests.
4. `ScanLines`, `FilmGrain`, `LiveChip`, `EyebrowStrip`, `Wordmark` are extracted into `src/primitives/`; ListenNow consumes them; ListenNow re-renders without visual regression.
5. `npm test` passes all 27 tests (16 prior + 6 TypedText + 5 Waveform).
6. `npx tsc --noEmit` clean.
7. `npx remotion compositions` lists both `ListenNow` and `ShoutoutFlagship` at 1080×1920 @ 30fps, 450 frames.
8. `out/shoutout-flagship.mp4` renders cleanly (2-4 MB, 15s, correct dimensions/fps).
9. User has visually approved the rendered video (at whatever version — v1, v2+, whatever the iteration settles at).
10. `git status` clean.

When all 10 hold, Stage 2b is shipped. Next is Stage 2c (MeetLena, SongRequestDemo, DayInNuma compositions, building on these primitives + the voice pipeline). HANDOFF.md update in numaradio also happens at the end of 2c rather than after each individual stage — cleaner single entry.

---

## Explicit non-goals (reminders — do not drift into these)

- **No Prisma integration.** Flagship uses a hardcoded `SHOUTOUT_TEXT` constant. Live data is Phase 3.
- **No Flux Schnell textures.** Composition reuses existing atmosphere layers.
- **No literal phone-bezel mockup.** Mobile-input card + HUD callouts handle the phone-POV semantic without the cheesy visual.
- **No Lena's face.** Voice only. Portrait comes back in 2c's MeetLena.
- **No variable shoutouts per render.** One text, one MP3, one video.
- **No HANDOFF.md update yet.** Ships with 2c.
