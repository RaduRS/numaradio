# Marketing Videos — Phase 1 (Scaffold + "Never Sleeps") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `~/saas/numaradio-videos` Remotion repo and ship the 15-second "Never sleeps" brand piece rendered end-to-end as `out/listen-now.mp4`. This proves the whole engine — scaffold, TypeScript config, brand tokens, primitives, music-bed pipeline, render wrapper, file output, laptop CPU caps — before investing in the heavier Lena-voice / Lena-portrait pipelines in Phase 2.

**Architecture:** Standalone sibling git repo (no workspaces). Remotion 4.x. React 18. TypeScript strict. Node test runner with `--experimental-strip-types` (same as numaradio). Hard-coded brand tokens mirrored from numaradio's `_design-base.css` (palette + font names) — drift risk is low, cross-repo imports would be worse. Renders run locally under `nice -n 10 --concurrency 4` so Liquidsoap/Icecast/NanoClaw always win CPU.

**Tech Stack:** Remotion 4.x, React 18, TypeScript, `@remotion/google-fonts`, `@remotion/renderer`, `ffmpeg-static`, `@aws-sdk/client-s3` (B2 pulls for music beds), Node `--test` runner.

**Spec:** `docs/superpowers/specs/2026-04-24-marketing-videos-design.md`

---

## Task 1: Scaffold the new repo

**Files:**
- Create: `~/saas/numaradio-videos/package.json`
- Create: `~/saas/numaradio-videos/tsconfig.json`
- Create: `~/saas/numaradio-videos/.gitignore`
- Create: `~/saas/numaradio-videos/.env.local.example`
- Create: `~/saas/numaradio-videos/README.md` (stub)

- [ ] **Step 1: Create the directory and init git**

```bash
mkdir -p ~/saas/numaradio-videos
cd ~/saas/numaradio-videos
git init
```

- [ ] **Step 2: Write package.json**

Create `~/saas/numaradio-videos/package.json`:

```json
{
  "name": "numaradio-videos",
  "version": "0.1.0",
  "private": true,
  "description": "Vertical marketing videos for Numa Radio (TikTok / YouTube Shorts). Remotion-based.",
  "scripts": {
    "studio": "remotion studio",
    "test": "node --test --experimental-strip-types src/**/*.test.ts",
    "render": "tsx src/scripts/render.ts"
  },
  "dependencies": {
    "@aws-sdk/client-s3": "^3.700.0",
    "@remotion/cli": "^4.0.220",
    "@remotion/google-fonts": "^4.0.220",
    "@remotion/renderer": "^4.0.220",
    "ffmpeg-static": "^5.2.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "remotion": "^4.0.220"
  },
  "devDependencies": {
    "@types/node": "^22.9.0",
    "@types/react": "^18.3.12",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3"
  }
}
```

*Note: Remotion requires `remotion`, `@remotion/cli`, `@remotion/renderer` pinned to the same version. `4.0.220` is a known-good line; `npm install` will accept any caret-compatible patch release.*

- [ ] **Step 3: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*", "remotion.config.ts"],
  "exclude": ["node_modules", "out"]
}
```

- [ ] **Step 4: Write .gitignore**

```
node_modules/
out/
.env.local
.env.local.backup
.DS_Store
*.log
dist/
```

- [ ] **Step 5: Write .env.local.example**

```
# Same values as ~/saas/numaradio/.env.local (read-only usage here).
DATABASE_URL=

# OpenRouter — for Phase 2 (Lena portrait, textures). Leave blank for Phase 1.
OPEN_ROUTER_API=
OPENROUTER_IMAGE_MODEL=black-forest-labs/flux.2-pro

# Deepgram — for Phase 2 (Lena TTS). Leave blank for Phase 1.
DEEPGRAM_API_KEY=

# B2 (read-only: we pull music stems here, never write).
B2_BUCKET_NAME=numaradio
B2_REGION=eu-central-003
B2_ENDPOINT=https://s3.eu-central-003.backblazeb2.com
B2_ACCESS_KEY_ID=
B2_SECRET_ACCESS_KEY=
B2_BUCKET_PUBLIC_URL=https://f003.backblazeb2.com/file/numaradio
```

- [ ] **Step 6: Write a minimal stub README.md**

```markdown
# numaradio-videos

Vertical marketing videos for Numa Radio — TikTok / YouTube Shorts (1080×1920).

Full project docs live in the main repo:
`~/saas/numaradio/docs/superpowers/specs/2026-04-24-marketing-videos-design.md`

## Phase 1 status

- [x] Scaffold
- [ ] Brand tokens
- [ ] Primitives (PulsingDot, EqBars, BrandTitle, MusicBed)
- [ ] Music bed curation script
- [ ] Composition: ListenNow
- [ ] Render wrapper
- [ ] End-to-end: `out/listen-now.mp4` renders successfully

## Quick commands (will work after Phase 1 ships)

    npm run studio            # Remotion Studio hot-reload preview
    npm run render ListenNow  # Render the "Never sleeps" 15s piece
    npm test                  # Unit tests (data-picker-style pure functions)
```

- [ ] **Step 7: Install dependencies**

```bash
cd ~/saas/numaradio-videos
npm install
```

Expected: no errors, `node_modules/` populated. `remotion` CLI available at `./node_modules/.bin/remotion`.

- [ ] **Step 8: Copy `.env.local` from numaradio (same values)**

```bash
cp ~/saas/numaradio/.env.local ~/saas/numaradio-videos/.env.local
```

- [ ] **Step 9: Commit**

```bash
cd ~/saas/numaradio-videos
git add -A
git commit -m "scaffold: package.json, tsconfig, .gitignore, env template, stub README"
```

---

## Task 2: Remotion config + Root.tsx + index.ts

**Files:**
- Create: `~/saas/numaradio-videos/remotion.config.ts`
- Create: `~/saas/numaradio-videos/src/index.ts`
- Create: `~/saas/numaradio-videos/src/Root.tsx`

- [ ] **Step 1: Write remotion.config.ts**

```ts
import { Config } from "@remotion/cli/config";

// Vertical video — 9:16 for TikTok / YouTube Shorts / Instagram Reels.
Config.setVideoImageFormat("jpeg");
Config.setCodec("h264");
Config.setConcurrency(4);
Config.setCrf(18);
Config.setPublicDir("src/assets");
```

- [ ] **Step 2: Write src/index.ts (Remotion entry point)**

```ts
import { registerRoot } from "remotion";
import { Root } from "./Root.tsx";

registerRoot(Root);
```

- [ ] **Step 3: Write src/Root.tsx (composition registry)**

```tsx
import { Composition } from "remotion";

// Compositions will be registered here as they're built.
// Phase 1 adds ListenNow in Task 8.
export function Root() {
  return (
    <>
      {/* Placeholder — real compositions registered starting Task 8. */}
    </>
  );
}
```

- [ ] **Step 4: Verify Remotion Studio opens**

```bash
cd ~/saas/numaradio-videos
npx remotion studio --no-open &
STUDIO_PID=$!
sleep 4
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
kill $STUDIO_PID 2>/dev/null
```

Expected: `200`. A `404` or connection-refused means the config didn't load.

- [ ] **Step 5: Commit**

```bash
git add remotion.config.ts src/index.ts src/Root.tsx
git commit -m "remotion: config (1080×1920, h264, crf 18) + Root registry stub"
```

---

## Task 3: Brand tokens module

**Files:**
- Create: `~/saas/numaradio-videos/src/tokens/brand.ts`
- Create: `~/saas/numaradio-videos/src/tokens/brand.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/tokens/brand.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { COLORS, FONTS, TIMING } from "./brand.ts";

test("COLORS mirrors the numaradio palette exactly", () => {
  // These values are pinned to numaradio's app/styles/_design-base.css.
  // If they drift, this test should fail and force a sync.
  assert.equal(COLORS.bg, "#0B0C0E");
  assert.equal(COLORS.fg, "#F2F0EA");
  assert.equal(COLORS.accent, "#4FD1C5");
  assert.equal(COLORS.redLive, "#FF4D4D");
  assert.equal(COLORS.warm, "#E8D9B0");
});

test("FONTS lists the three brand families by their Google Fonts names", () => {
  assert.equal(FONTS.display, "Archivo Black");
  assert.equal(FONTS.body, "Inter Tight");
  assert.equal(FONTS.mono, "JetBrains Mono");
});

test("TIMING exposes frame-rate-based durations for common beats", () => {
  // 30fps baseline. 0.2s = 6 frames, 1.0s = 30 frames.
  assert.equal(TIMING.fps, 30);
  assert.equal(TIMING.beatShort, 6);
  assert.equal(TIMING.beatMed, 15);
  assert.equal(TIMING.beatLong, 30);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/saas/numaradio-videos
node --test --experimental-strip-types src/tokens/brand.test.ts
```

Expected: FAIL with `Cannot find module './brand.ts'` or similar.

- [ ] **Step 3: Write the implementation**

Create `src/tokens/brand.ts`:

```ts
// Brand tokens mirrored from ~/saas/numaradio/app/styles/_design-base.css.
// Duplicated intentionally — cross-repo imports would couple builds.
// If numaradio's palette changes, update here and bump the drift test below.

export const COLORS = {
  bg: "#0B0C0E",
  bg1: "#0F1114",
  bg2: "#14171B",
  bg3: "#1A1E23",
  fg: "#F2F0EA",
  fgDim: "#A8A69D",
  fgMute: "#6B6B68",
  accent: "#4FD1C5",
  accentGlow: "rgba(79, 209, 197, 0.35)",
  accentSoft: "rgba(79, 209, 197, 0.12)",
  redLive: "#FF4D4D",
  warm: "#E8D9B0",
  line: "rgba(255,255,255,0.07)",
  lineStrong: "rgba(255,255,255,0.14)",
} as const;

export const FONTS = {
  display: "Archivo Black",
  body: "Inter Tight",
  mono: "JetBrains Mono",
} as const;

export const TIMING = {
  fps: 30,
  // Common beat durations in frames @30fps.
  beatShort: 6,   // 0.2s
  beatMed: 15,    // 0.5s
  beatLong: 30,   // 1.0s
  beat2s: 60,
  beat15s: 450,
} as const;

export type BrandColor = keyof typeof COLORS;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test --experimental-strip-types src/tokens/brand.test.ts
```

Expected: `pass 3`, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/tokens/
git commit -m "tokens: brand palette + fonts + timing, mirrored from numaradio"
```

---

## Task 4: Font loading via @remotion/google-fonts

**Files:**
- Create: `~/saas/numaradio-videos/src/tokens/fonts.ts`

No test — `@remotion/google-fonts` is a library call, pass-through.

- [ ] **Step 1: Write src/tokens/fonts.ts**

```ts
import { loadFont as loadArchivoBlack } from "@remotion/google-fonts/ArchivoBlack";
import { loadFont as loadInterTight } from "@remotion/google-fonts/InterTight";
import { loadFont as loadJetBrainsMono } from "@remotion/google-fonts/JetBrainsMono";

// Load all three brand families. Call from each composition's top-level.
// Remotion caches by URL, so calling from multiple compositions is cheap.
export function loadBrandFonts(): void {
  loadArchivoBlack();
  loadInterTight({ weights: ["400", "500", "600"] });
  loadJetBrainsMono({ weights: ["400", "500"] });
}
```

- [ ] **Step 2: Verify the import paths resolve**

```bash
cd ~/saas/numaradio-videos
node --experimental-strip-types --input-type=module -e "import('./src/tokens/fonts.ts').then(m => console.log('OK', typeof m.loadBrandFonts))"
```

Expected: `OK function`. If it errors with "Cannot find module '@remotion/google-fonts/ArchivoBlack'", the subpath is off — check `node_modules/@remotion/google-fonts/` for the actual family folder name.

- [ ] **Step 3: Commit**

```bash
git add src/tokens/fonts.ts
git commit -m "tokens: font loader for Archivo Black, Inter Tight, JetBrains Mono"
```

---

## Task 5: Primitive — PulsingDot

**Files:**
- Create: `~/saas/numaradio-videos/src/primitives/PulsingDot.tsx`
- Create: `~/saas/numaradio-videos/src/primitives/PulsingDot.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/primitives/PulsingDot.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { pulsingDotScale, pulsingDotOpacity } from "./PulsingDot.tsx";

// The dot pulses on a 2.2s cycle (from numaradio's --pulseDot keyframes).
// scale ∈ [0.9, 1.0], opacity ∈ [0.5, 1.0], sinusoidal.

test("pulsingDotScale returns 1.0 at cycle start (frame 0)", () => {
  // At frame 0 the dot is at rest (scale 1.0).
  const s = pulsingDotScale(0, 30);
  assert.ok(Math.abs(s - 1.0) < 0.01, `expected ~1.0, got ${s}`);
});

test("pulsingDotScale dips to 0.9 at mid-cycle", () => {
  // 2.2s @30fps = 66 frames. Mid-cycle = frame 33.
  const s = pulsingDotScale(33, 30);
  assert.ok(Math.abs(s - 0.9) < 0.02, `expected ~0.9, got ${s}`);
});

test("pulsingDotOpacity dips to 0.5 at mid-cycle", () => {
  const o = pulsingDotOpacity(33, 30);
  assert.ok(Math.abs(o - 0.5) < 0.02, `expected ~0.5, got ${o}`);
});

test("pulsingDotScale wraps cleanly across cycle boundaries", () => {
  // Frame 66 should equal frame 0 (one full cycle).
  const s0 = pulsingDotScale(0, 30);
  const s66 = pulsingDotScale(66, 30);
  assert.ok(Math.abs(s0 - s66) < 0.01);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test --experimental-strip-types src/primitives/PulsingDot.test.ts
```

Expected: FAIL (`Cannot find module './PulsingDot.tsx'`).

- [ ] **Step 3: Write the implementation**

Create `src/primitives/PulsingDot.tsx`:

```tsx
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { COLORS } from "../tokens/brand.ts";

const CYCLE_SECONDS = 2.2;

/**
 * Pure — given frame + fps, returns the dot scale (0.9 - 1.0).
 * At frame 0: scale 1.0. At mid-cycle: scale 0.9. Cosine ease.
 */
export function pulsingDotScale(frame: number, fps: number): number {
  const cycleFrames = CYCLE_SECONDS * fps;
  const t = (frame % cycleFrames) / cycleFrames; // 0..1
  // cos-based: 1.0 at t=0, 0.9 at t=0.5, 1.0 at t=1.
  return 0.95 + 0.05 * Math.cos(2 * Math.PI * t);
}

/**
 * Pure — opacity envelope. 1.0 at frame 0, 0.5 at mid-cycle.
 */
export function pulsingDotOpacity(frame: number, fps: number): number {
  const cycleFrames = CYCLE_SECONDS * fps;
  const t = (frame % cycleFrames) / cycleFrames;
  return 0.75 + 0.25 * Math.cos(2 * Math.PI * t);
}

export interface PulsingDotProps {
  /** Diameter in pixels. Default 64. */
  size?: number;
  /** Color override. Default brand accent (teal). */
  color?: string;
  /** Horizontal center offset from composition center, px. */
  offsetX?: number;
  /** Vertical center offset from composition center, px. */
  offsetY?: number;
}

export function PulsingDot({
  size = 64,
  color = COLORS.accent,
  offsetX = 0,
  offsetY = 0,
}: PulsingDotProps) {
  const frame = useCurrentFrame();
  const scale = pulsingDotScale(frame, 30);
  const opacity = pulsingDotOpacity(frame, 30);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: color,
          opacity,
          transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})`,
          boxShadow: `0 0 ${size * 0.6}px ${COLORS.accentGlow}`,
        }}
      />
    </AbsoluteFill>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test --experimental-strip-types src/primitives/PulsingDot.test.ts
```

Expected: `pass 4`, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/primitives/
git commit -m "primitive: PulsingDot — teal brand mark with 2.2s breathing cycle"
```

---

## Task 6: Primitive — EqBars

**Files:**
- Create: `~/saas/numaradio-videos/src/primitives/EqBars.tsx`
- Create: `~/saas/numaradio-videos/src/primitives/EqBars.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/primitives/EqBars.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { eqBarHeight } from "./EqBars.tsx";

// EQ bars use the same visual as numaradio's .eq: 5 bars, each with its
// own phase offset. Heights ∈ [0.3, 1.0] (proportional, not absolute).

test("eqBarHeight returns a value in [0.3, 1.0] for any frame", () => {
  for (let frame = 0; frame < 120; frame++) {
    for (let barIndex = 0; barIndex < 5; barIndex++) {
      const h = eqBarHeight(frame, barIndex, 30);
      assert.ok(h >= 0.3 && h <= 1.0, `frame ${frame} bar ${barIndex} height ${h} out of range`);
    }
  }
});

test("eqBarHeight gives different bars different values at the same frame", () => {
  const heights = [0, 1, 2, 3, 4].map((i) => eqBarHeight(10, i, 30));
  const unique = new Set(heights.map((h) => h.toFixed(3)));
  // At least 3 of 5 should differ — phase offsets should desync them.
  assert.ok(unique.size >= 3, `bars too synchronized: ${[...unique].join(", ")}`);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test --experimental-strip-types src/primitives/EqBars.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

Create `src/primitives/EqBars.tsx`:

```tsx
import { useCurrentFrame } from "remotion";
import { COLORS } from "../tokens/brand.ts";

const CYCLE_SECONDS = 1.0;
// Per-bar phase offsets (fraction of cycle). Mirrors numaradio's .eq:nth-child delays.
const BAR_PHASES = [-0.2, -0.5, -0.1, -0.7, -0.3];
// Height bias per bar (makes the silhouette look less square).
const BAR_BIAS = [0.8, 1.0, 0.6, 0.9, 0.7];

/**
 * Pure — returns normalized height [0.3, 1.0] for bar `barIndex` at `frame`.
 */
export function eqBarHeight(frame: number, barIndex: number, fps: number): number {
  const cycleFrames = CYCLE_SECONDS * fps;
  const phase = BAR_PHASES[barIndex % BAR_PHASES.length];
  const bias = BAR_BIAS[barIndex % BAR_BIAS.length];
  const t = (frame / cycleFrames + phase + 1) % 1; // 0..1
  // Triangle-ish envelope clamped to [0.3, 1.0].
  const raw = 0.3 + 0.7 * Math.abs(Math.sin(Math.PI * t));
  return Math.max(0.3, Math.min(1.0, raw * bias + (1 - bias) * 0.65));
}

export interface EqBarsProps {
  /** Total width across all bars, px. Default 120. */
  width?: number;
  /** Peak bar height, px. Default 180. */
  height?: number;
  color?: string;
  /** Number of bars. Default 5 (matches numaradio's .eq). */
  count?: number;
}

export function EqBars({
  width = 120,
  height = 180,
  color = COLORS.accent,
  count = 5,
}: EqBarsProps) {
  const frame = useCurrentFrame();
  const gap = 6;
  const barWidth = (width - gap * (count - 1)) / count;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: `${gap}px`,
        height,
        width,
      }}
    >
      {Array.from({ length: count }, (_, i) => {
        const h = eqBarHeight(frame, i, 30);
        return (
          <div
            key={i}
            style={{
              width: barWidth,
              height: `${h * 100}%`,
              background: color,
              borderRadius: 2,
              transition: "none",
            }}
          />
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test --experimental-strip-types src/primitives/EqBars.test.ts
```

Expected: `pass 2`, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/primitives/EqBars.tsx src/primitives/EqBars.test.ts
git commit -m "primitive: EqBars — 5-bar pulsing visualizer matching numaradio's .eq"
```

---

## Task 7: Primitive — BrandTitle

**Files:**
- Create: `~/saas/numaradio-videos/src/primitives/BrandTitle.tsx`
- Create: `~/saas/numaradio-videos/src/primitives/BrandTitle.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/primitives/BrandTitle.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { wordsVisibleAtFrame } from "./BrandTitle.tsx";

test("wordsVisibleAtFrame reveals words at the given cadence", () => {
  const words = ["THE", "STATION", "THAT", "NEVER", "SLEEPS"];
  const framesPerWord = 15;
  // Frame 0: no words visible (first word reveals AT frame framesPerWord).
  assert.equal(wordsVisibleAtFrame(0, words.length, framesPerWord), 0);
  // Frame 15: first word visible.
  assert.equal(wordsVisibleAtFrame(15, words.length, framesPerWord), 1);
  // Frame 45: three words visible.
  assert.equal(wordsVisibleAtFrame(45, words.length, framesPerWord), 3);
  // Past the end: all visible, capped.
  assert.equal(wordsVisibleAtFrame(200, words.length, framesPerWord), 5);
});

test("wordsVisibleAtFrame handles zero-word case", () => {
  assert.equal(wordsVisibleAtFrame(50, 0, 15), 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test --experimental-strip-types src/primitives/BrandTitle.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

Create `src/primitives/BrandTitle.tsx`:

```tsx
import { useCurrentFrame, interpolate, Easing } from "remotion";
import { COLORS, FONTS } from "../tokens/brand.ts";

/**
 * Pure — how many words should be visible at a given frame.
 * First word reveals AT `framesPerWord` (so a short lead-in is possible).
 */
export function wordsVisibleAtFrame(
  frame: number,
  totalWords: number,
  framesPerWord: number,
): number {
  if (totalWords === 0) return 0;
  const shown = Math.floor(frame / framesPerWord);
  return Math.max(0, Math.min(totalWords, shown));
}

export interface BrandTitleProps {
  /** The phrase, one word per array entry (renders one-per-line). */
  words: string[];
  /** Frames between each word's reveal. Default 15 (0.5s @30fps). */
  framesPerWord?: number;
  /** Font size in px. Default 180. */
  fontSize?: number;
  color?: string;
}

/**
 * Display-weight Archivo Black block. Reveals one word per beat.
 * Used for the "NEVER SLEEPS" hero shot in ListenNow.
 */
export function BrandTitle({
  words,
  framesPerWord = 15,
  fontSize = 180,
  color = COLORS.fg,
}: BrandTitleProps) {
  const frame = useCurrentFrame();
  const visible = wordsVisibleAtFrame(frame, words.length, framesPerWord);

  return (
    <div
      style={{
        fontFamily: `"${FONTS.display}", system-ui, sans-serif`,
        fontSize,
        lineHeight: 0.92,
        letterSpacing: "-0.02em",
        textTransform: "uppercase",
        color,
        fontWeight: 800,
        fontStretch: "125%",
        textAlign: "center",
      }}
    >
      {words.map((w, i) => {
        const shown = i < visible;
        // Fade-in over the last 6 frames of this word's reveal window.
        const revealStart = i * framesPerWord;
        const fadeOpacity = shown
          ? interpolate(
              frame,
              [revealStart, revealStart + 6],
              [0, 1],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) },
            )
          : 0;
        const translate = shown
          ? interpolate(
              frame,
              [revealStart, revealStart + 8],
              [12, 0],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) },
            )
          : 12;
        return (
          <div
            key={i}
            style={{
              opacity: fadeOpacity,
              transform: `translateY(${translate}px)`,
            }}
          >
            {w}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test --experimental-strip-types src/primitives/BrandTitle.test.ts
```

Expected: `pass 2`, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/primitives/BrandTitle.tsx src/primitives/BrandTitle.test.ts
git commit -m "primitive: BrandTitle — Archivo Black word-by-word reveal"
```

---

## Task 8: Primitive — MusicBed

**Files:**
- Create: `~/saas/numaradio-videos/src/primitives/MusicBed.tsx`
- Create: `~/saas/numaradio-videos/src/primitives/MusicBed.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/primitives/MusicBed.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { musicBedVolume } from "./MusicBed.tsx";

// MusicBed applies a volume envelope: fade-in, sustain, fade-out.

test("musicBedVolume returns 0 before fade-in starts", () => {
  assert.equal(musicBedVolume(0, { fadeInFrames: 30, sustainFrames: 300, fadeOutFrames: 60 }), 0);
});

test("musicBedVolume ramps from 0 to 1.0 during fade-in", () => {
  const env = { fadeInFrames: 30, sustainFrames: 300, fadeOutFrames: 60 };
  assert.equal(musicBedVolume(0, env), 0);
  assert.ok(Math.abs(musicBedVolume(15, env) - 0.5) < 0.01);
  assert.equal(musicBedVolume(30, env), 1.0);
});

test("musicBedVolume holds at 1.0 during sustain", () => {
  const env = { fadeInFrames: 30, sustainFrames: 300, fadeOutFrames: 60 };
  assert.equal(musicBedVolume(100, env), 1.0);
  assert.equal(musicBedVolume(329, env), 1.0);
});

test("musicBedVolume ramps from 1.0 to 0 during fade-out", () => {
  const env = { fadeInFrames: 30, sustainFrames: 300, fadeOutFrames: 60 };
  // Fade-out starts at fadeInFrames + sustainFrames = 330.
  assert.equal(musicBedVolume(330, env), 1.0);
  assert.ok(Math.abs(musicBedVolume(360, env) - 0.5) < 0.01);
  assert.equal(musicBedVolume(390, env), 0);
});

test("musicBedVolume stays at 0 after envelope ends", () => {
  const env = { fadeInFrames: 30, sustainFrames: 300, fadeOutFrames: 60 };
  assert.equal(musicBedVolume(500, env), 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test --experimental-strip-types src/primitives/MusicBed.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

Create `src/primitives/MusicBed.tsx`:

```tsx
import { Audio, staticFile } from "remotion";

export interface VolumeEnvelope {
  fadeInFrames: number;
  sustainFrames: number;
  fadeOutFrames: number;
}

/**
 * Pure — volume [0, 1] at a given frame under a fade-in / sustain / fade-out envelope.
 */
export function musicBedVolume(frame: number, env: VolumeEnvelope): number {
  const { fadeInFrames, sustainFrames, fadeOutFrames } = env;
  if (frame < 0) return 0;
  if (frame < fadeInFrames) {
    return fadeInFrames === 0 ? 1 : frame / fadeInFrames;
  }
  const sustainEnd = fadeInFrames + sustainFrames;
  if (frame < sustainEnd) {
    return 1;
  }
  const fadeEnd = sustainEnd + fadeOutFrames;
  if (frame < fadeEnd) {
    return fadeOutFrames === 0 ? 0 : 1 - (frame - sustainEnd) / fadeOutFrames;
  }
  return 0;
}

export interface MusicBedProps {
  /** Path relative to src/assets/ (Remotion publicDir). e.g. "music-beds/neon-fever.mp3". */
  src: string;
  /** Volume envelope. Durations in frames @30fps. */
  envelope: VolumeEnvelope;
}

/**
 * Loads a pre-trimmed MP3 from src/assets/music-beds/ and applies a volume envelope.
 * The MP3 should already be the right length — this primitive only shapes volume.
 */
export function MusicBed({ src, envelope }: MusicBedProps) {
  return (
    <Audio
      src={staticFile(src)}
      volume={(frame) => musicBedVolume(frame, envelope)}
    />
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test --experimental-strip-types src/primitives/MusicBed.test.ts
```

Expected: `pass 5`, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/primitives/MusicBed.tsx src/primitives/MusicBed.test.ts
git commit -m "primitive: MusicBed — Audio component with fade-in/sustain/fade-out envelope"
```

---

## Task 9: Music bed curation script

**Files:**
- Create: `~/saas/numaradio-videos/src/scripts/curate-music-beds.ts`
- Create: `~/saas/numaradio-videos/src/scripts/music-bed-pool.json`
- Create: `~/saas/numaradio-videos/src/assets/music-beds/.gitkeep`

Goal: pick 3-5 Numa tracks, download from B2, trim + fade each to ~20s, save to `src/assets/music-beds/`.

- [ ] **Step 1: Write the hand-picked source list**

Create `src/scripts/music-bed-pool.json`:

```json
{
  "beds": [
    {
      "id": "bed-01-neon",
      "b2Key": "stations/numaradio/tracks/REPLACE_WITH_REAL_KEY_01.mp3",
      "startSeconds": 30,
      "durationSeconds": 20,
      "fadeInSeconds": 1,
      "fadeOutSeconds": 2
    },
    {
      "id": "bed-02-ambient",
      "b2Key": "stations/numaradio/tracks/REPLACE_WITH_REAL_KEY_02.mp3",
      "startSeconds": 45,
      "durationSeconds": 20,
      "fadeInSeconds": 1,
      "fadeOutSeconds": 2
    },
    {
      "id": "bed-03-warm",
      "b2Key": "stations/numaradio/tracks/REPLACE_WITH_REAL_KEY_03.mp3",
      "startSeconds": 20,
      "durationSeconds": 20,
      "fadeInSeconds": 1,
      "fadeOutSeconds": 2
    }
  ]
}
```

*The `REPLACE_WITH_REAL_KEY_*` placeholders will be filled in before running the script — see Step 4. Committing the placeholder skeleton first is fine.*

- [ ] **Step 2: Write the .gitkeep for the assets folder**

```bash
mkdir -p src/assets/music-beds
touch src/assets/music-beds/.gitkeep
```

- [ ] **Step 3: Write the curation script**

Create `src/scripts/curate-music-beds.ts`:

```ts
#!/usr/bin/env -S node --experimental-strip-types

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import ffmpegPath from "ffmpeg-static";
import { config } from "dotenv";

// Load env from .env.local (script runs outside Remotion so no auto-load).
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../.env.local") });

interface BedConfig {
  id: string;
  b2Key: string;
  startSeconds: number;
  durationSeconds: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
}

interface PoolConfig {
  beds: BedConfig[];
}

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not set in .env.local`);
  return v;
}

function s3(): S3Client {
  return new S3Client({
    region: getEnv("B2_REGION"),
    endpoint: getEnv("B2_ENDPOINT"),
    credentials: {
      accessKeyId: getEnv("B2_ACCESS_KEY_ID"),
      secretAccessKey: getEnv("B2_SECRET_ACCESS_KEY"),
    },
  });
}

async function downloadFromB2(key: string, toPath: string): Promise<void> {
  const res = await s3().send(
    new GetObjectCommand({ Bucket: getEnv("B2_BUCKET_NAME"), Key: key }),
  );
  if (!res.Body) throw new Error(`B2 ${key}: empty body`);
  const chunks: Buffer[] = [];
  // @ts-expect-error Node stream typing noise
  for await (const chunk of res.Body) chunks.push(Buffer.from(chunk));
  writeFileSync(toPath, Buffer.concat(chunks));
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((res, rej) => {
    if (!ffmpegPath) return rej(new Error("ffmpeg-static binary not found"));
    const p = spawn(ffmpegPath, args, { stdio: "inherit" });
    p.on("error", rej);
    p.on("close", (code) =>
      code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}`)),
    );
  });
}

async function trimAndFade(
  sourcePath: string,
  outPath: string,
  bed: BedConfig,
): Promise<void> {
  // ffmpeg -ss <start> -t <duration> -i in.mp3 -af "afade=t=in:st=0:d=X,afade=t=out:st=Y:d=Z" out.mp3
  const fadeOutStart = bed.durationSeconds - bed.fadeOutSeconds;
  await runFfmpeg([
    "-y",
    "-ss", String(bed.startSeconds),
    "-t", String(bed.durationSeconds),
    "-i", sourcePath,
    "-af",
    `afade=t=in:st=0:d=${bed.fadeInSeconds},afade=t=out:st=${fadeOutStart}:d=${bed.fadeOutSeconds}`,
    "-codec:a", "libmp3lame",
    "-b:a", "192k",
    outPath,
  ]);
}

async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const poolPath = resolve(here, "music-bed-pool.json");
  const outDir = resolve(here, "../assets/music-beds");
  const tmpDir = resolve(here, "../../.tmp-music");

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

  const pool: PoolConfig = JSON.parse(readFileSync(poolPath, "utf8"));

  for (const bed of pool.beds) {
    if (bed.b2Key.includes("REPLACE_WITH_REAL_KEY")) {
      console.log(`→ Skipping ${bed.id}: placeholder B2 key not set`);
      continue;
    }
    const tmpPath = resolve(tmpDir, `${bed.id}.raw.mp3`);
    const outPath = resolve(outDir, `${bed.id}.mp3`);
    console.log(`→ ${bed.id}: downloading ${bed.b2Key}`);
    await downloadFromB2(bed.b2Key, tmpPath);
    console.log(`→ ${bed.id}: trimming ${bed.startSeconds}s +${bed.durationSeconds}s, fade ${bed.fadeInSeconds}/${bed.fadeOutSeconds}`);
    await trimAndFade(tmpPath, outPath, bed);
    console.log(`✓ ${bed.id} → ${outPath}`);
  }

  console.log("\nDone. Beds written to src/assets/music-beds/.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

*Note: this script needs `dotenv` installed. Add it in Step 4.*

- [ ] **Step 4: Add dotenv + populate real B2 keys**

```bash
cd ~/saas/numaradio-videos
npm install --save-dev dotenv
```

Then, **before running the script**, the user or executing agent must replace the `REPLACE_WITH_REAL_KEY_*` placeholders in `music-bed-pool.json` with actual `b2Key` paths from the Numa catalog. To find candidates, from `~/saas/numaradio`:

```bash
# Show recent aired tracks and their B2 keys (run in numaradio/, not videos/):
cd ~/saas/numaradio
npx tsx -e "
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const tracks = await db.track.findMany({
  where: { source: 'external_import', trackKind: { not: 'request_only' } },
  include: { assets: true },
  orderBy: { createdAt: 'desc' },
  take: 30,
});
for (const t of tracks) {
  const mp3 = t.assets.find(a => a.kind === 'mp3');
  console.log(t.title, '—', t.artist, '—', mp3?.storageKey);
}
await db.\$disconnect();
"
```

Pick 3 tracks that are low-vocal / ambient / not-too-busy — those make the best underscore. Copy their `storageKey` values into the JSON. Re-run the script in the next step.

- [ ] **Step 5: Run the curation script**

```bash
cd ~/saas/numaradio-videos
npx tsx src/scripts/curate-music-beds.ts
```

Expected output per bed: `✓ bed-01-neon → …/src/assets/music-beds/bed-01-neon.mp3`. If all 3 placeholders were filled, 3 MP3s land in `src/assets/music-beds/`.

Verify:

```bash
ls -lh src/assets/music-beds/
# Expected: 3 .mp3 files, each ~400-500 KB (20s @192kbps).
```

- [ ] **Step 6: Remove .tmp-music and commit**

```bash
rm -rf .tmp-music
# Add .tmp-music to .gitignore (defensive — script creates it).
echo ".tmp-music/" >> .gitignore
git add src/scripts/ src/assets/music-beds/ .gitignore package.json package-lock.json
git commit -m "music-beds: curation script + 3 trimmed/faded stems from Numa catalog"
```

*Note: the MP3s themselves are our IP (generated via MiniMax in the main repo's pipeline), so committing them to the videos repo is fine. They're small (~1.5 MB total).*

---

## Task 10: Composition — ListenNow ("Never Sleeps")

**Files:**
- Create: `~/saas/numaradio-videos/src/compositions/ListenNow.tsx`
- Modify: `~/saas/numaradio-videos/src/Root.tsx`

No unit test — per the spec, compositions are Studio-preview-verified, not unit-tested.

- [ ] **Step 1: Write the composition**

Create `src/compositions/ListenNow.tsx`:

```tsx
import { AbsoluteFill, Sequence, useCurrentFrame, interpolate, Easing } from "remotion";
import { COLORS, FONTS, TIMING } from "../tokens/brand.ts";
import { loadBrandFonts } from "../tokens/fonts.ts";
import { PulsingDot } from "../primitives/PulsingDot.tsx";
import { EqBars } from "../primitives/EqBars.tsx";
import { BrandTitle } from "../primitives/BrandTitle.tsx";
import { MusicBed } from "../primitives/MusicBed.tsx";

loadBrandFonts();

// ListenNow — 15s (450 frames @ 30fps), 1080×1920.
// Storyboard:
//   0-3s   black frame, teal radial glow swells in
//   3-10s  "THE STATION THAT NEVER SLEEPS" unfolds word-by-word (Archivo Black)
//   10-13s hard cut to EQ bars + pulsing dot
//   13-15s wordmark + URL + faint waveform tail

export const LISTEN_NOW_DURATION = 15 * TIMING.fps; // 450 frames

export function ListenNow() {
  return (
    <AbsoluteFill style={{ background: COLORS.bg }}>
      {/* Music bed for the full duration, faded in/out. */}
      <MusicBed
        src="music-beds/bed-01-neon.mp3"
        envelope={{
          fadeInFrames: 30,    // 1.0s in
          sustainFrames: 360,  // 12s sustain
          fadeOutFrames: 60,   // 2s fade out
        }}
      />

      {/* Beat 1: 0-3s — teal radial glow swells */}
      <Sequence from={0} durationInFrames={90}>
        <RadialGlow />
      </Sequence>

      {/* Beat 2: 3-10s — NEVER SLEEPS typography */}
      <Sequence from={90} durationInFrames={210}>
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
          <BrandTitle
            words={["THE", "STATION", "THAT", "NEVER", "SLEEPS"]}
            framesPerWord={30}
            fontSize={150}
          />
        </AbsoluteFill>
        <LiveChipFlicker />
      </Sequence>

      {/* Beat 3: 10-13s — EQ bars + pulsing dot full-screen */}
      <Sequence from={300} durationInFrames={90}>
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
          <EqBars width={240} height={360} />
        </AbsoluteFill>
        <PulsingDot size={96} offsetX={0} offsetY={-220} />
      </Sequence>

      {/* Beat 4: 13-15s — wordmark + URL */}
      <Sequence from={390} durationInFrames={60}>
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", gap: 40 }}>
          <Wordmark />
          <div
            style={{
              fontFamily: `"${FONTS.mono}", ui-monospace, monospace`,
              fontSize: 36,
              letterSpacing: "0.18em",
              color: COLORS.fgDim,
              textTransform: "uppercase",
            }}
          >
            numaradio.com
          </div>
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
}

function RadialGlow() {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 60, 90], [0, 0.7, 0.5], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse 70% 50% at 50% 40%, ${COLORS.accentGlow}, transparent 70%)`,
        opacity,
      }}
    />
  );
}

function LiveChipFlicker() {
  // Small red LIVE chip in the top-right corner, appears at ~frame 60 of this sequence.
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [60, 75], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        top: 80,
        right: 64,
        padding: "12px 24px",
        borderRadius: 999,
        background: "rgba(255,77,77,0.12)",
        border: `1px solid ${COLORS.lineStrong}`,
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontFamily: `"${FONTS.mono}", ui-monospace, monospace`,
        fontSize: 24,
        letterSpacing: "0.18em",
        color: COLORS.fg,
        textTransform: "uppercase",
        opacity,
      }}
    >
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: COLORS.redLive,
          boxShadow: `0 0 12px ${COLORS.redLive}`,
        }}
      />
      Live
    </div>
  );
}

function Wordmark() {
  return (
    <div
      style={{
        fontFamily: `"${FONTS.display}", system-ui, sans-serif`,
        fontSize: 120,
        letterSpacing: "-0.02em",
        textTransform: "uppercase",
        color: COLORS.fg,
        fontWeight: 800,
        fontStretch: "125%",
        lineHeight: 0.92,
      }}
    >
      Numa Radio
    </div>
  );
}
```

- [ ] **Step 2: Register the composition in Root.tsx**

Replace the contents of `src/Root.tsx`:

```tsx
import { Composition } from "remotion";
import { ListenNow, LISTEN_NOW_DURATION } from "./compositions/ListenNow.tsx";

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
    </>
  );
}
```

- [ ] **Step 3: Preview in Remotion Studio**

```bash
cd ~/saas/numaradio-videos
npx remotion studio
```

Open the URL printed (typically http://localhost:3000), click `ListenNow` in the sidebar, scrub through the timeline. Checklist:

- [ ] Beat 1 (0-3s): teal radial glow fades in from black
- [ ] Beat 2 (3-10s): each of the 5 words appears one-per-second, Archivo Black, centered
- [ ] Beat 2 also: LIVE chip appears top-right after ~2s
- [ ] Beat 3 (10-13s): EQ bars + pulsing dot replace the text
- [ ] Beat 4 (13-15s): NUMA RADIO wordmark + numaradio.com URL
- [ ] Music bed audibly fades in/out

If any beat looks wrong, adjust the composition before committing. This is the eyeball loop the spec calls out.

- [ ] **Step 4: Commit**

```bash
git add src/compositions/ src/Root.tsx
git commit -m "composition: ListenNow — 15s 'never sleeps' brand piece"
```

---

## Task 11: Render wrapper (`npm run render`)

**Files:**
- Create: `~/saas/numaradio-videos/src/scripts/render.ts`

- [ ] **Step 1: Write the render script**

Create `src/scripts/render.ts`:

```ts
#!/usr/bin/env -S node --experimental-strip-types

import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

interface Args {
  compositionId: string;
  outputName?: string;
}

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: npm run render <CompositionId> [outputName]");
    console.error("Example: npm run render ListenNow listen-now");
    process.exit(2);
  }
  return { compositionId: args[0], outputName: args[1] };
}

async function main(): Promise<void> {
  const { compositionId, outputName } = parseArgs(process.argv);

  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const outDir = resolve(repoRoot, "out");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const outName = outputName ?? compositionId.toLowerCase();
  const outputPath = resolve(outDir, `${outName}.mp4`);

  console.log(`→ Bundling Remotion project...`);
  const bundleStart = Date.now();
  const bundleLocation = await bundle({
    entryPoint: resolve(repoRoot, "src/index.ts"),
    webpackOverride: (cfg) => cfg,
  });
  console.log(`  bundled in ${((Date.now() - bundleStart) / 1000).toFixed(1)}s`);

  console.log(`→ Selecting composition ${compositionId}...`);
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: compositionId,
  });

  const durationSeconds = composition.durationInFrames / composition.fps;
  console.log(
    `→ Rendering ${compositionId} (${durationSeconds.toFixed(1)}s, ${composition.width}×${composition.height}, ${composition.fps}fps)...`,
  );

  const renderStart = Date.now();
  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: "h264",
    outputLocation: outputPath,
    crf: 18,
    concurrency: 4,
    x264Preset: "slow",
  });

  const sizeMb = (statSync(outputPath).size / 1_048_576).toFixed(1);
  const renderSeconds = ((Date.now() - renderStart) / 1000).toFixed(0);
  console.log(
    `✓ Rendered to ${outputPath} (${sizeMb} MB, ${durationSeconds.toFixed(1)}s) in ${renderSeconds}s`,
  );
}

main().catch((err) => {
  console.error("✗", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

- [ ] **Step 2: Update package.json to use nice on the render script**

Edit `~/saas/numaradio-videos/package.json` — update the `"render"` script entry:

```json
"scripts": {
  "studio": "remotion studio",
  "test": "node --test --experimental-strip-types src/**/*.test.ts",
  "render": "nice -n 10 tsx src/scripts/render.ts"
}
```

*The `nice -n 10` prefix keeps Liquidsoap/Icecast at higher CPU priority during the render. On Linux/WSL2 this is just the `nice` binary; on macOS it also works. Windows native wouldn't but we're always on WSL2.*

- [ ] **Step 3: Render ListenNow end-to-end**

```bash
cd ~/saas/numaradio-videos
npm run render ListenNow listen-now
```

Expected output (times approximate):

```
→ Bundling Remotion project...
  bundled in 8.4s
→ Selecting composition ListenNow...
→ Rendering ListenNow (15.0s, 1080×1920, 30fps)...
✓ Rendered to .../numaradio-videos/out/listen-now.mp4 (8.2 MB, 15.0s) in 52s
```

- [ ] **Step 4: Verify the MP4 plays and is the right shape**

```bash
# Check file exists and duration
ffprobe -v error -show_entries format=duration:stream=width,height,r_frame_rate \
  -of default=noprint_wrappers=1 out/listen-now.mp4
```

Expected:

```
width=1080
height=1920
r_frame_rate=30/1
duration=15.000000
```

Open it:

```bash
# On WSL2, open in Windows' default player:
explorer.exe out/listen-now.mp4
# (or: cp out/listen-now.mp4 /mnt/c/Users/marku/Desktop/ and open from there)
```

Watch it once. Does it match the storyboard? If not, go back to Task 10 Step 3, tweak the composition, re-render. Iterate until it's right.

- [ ] **Step 5: Commit the render script**

```bash
git add src/scripts/render.ts package.json
git commit -m "render: npm run render <comp> wrapper, nice+concurrency-capped"
```

*Do NOT commit `out/listen-now.mp4` — it's already in `.gitignore`.*

---

## Task 12: Finalize README + Phase 1 wrap

**Files:**
- Modify: `~/saas/numaradio-videos/README.md`

- [ ] **Step 1: Flesh out the README**

Replace the Phase 1 status stub with a real README:

```markdown
# numaradio-videos

Vertical marketing videos for Numa Radio — TikTok / YouTube Shorts (1080×1920, 30fps).

Built with Remotion 4.x. Renders happen locally under `nice -n 10 --concurrency 4` so Liquidsoap/Icecast/NanoClaw on the same machine never lose CPU priority.

**Full design spec:** `~/saas/numaradio/docs/superpowers/specs/2026-04-24-marketing-videos-design.md`

## Setup

1. Install deps: `npm install`
2. Copy env from numaradio: `cp ~/saas/numaradio/.env.local .env.local`
3. Run `npm run studio` to preview compositions in Remotion Studio

## Phase status

- [x] **Phase 1:** Scaffold + primitives (PulsingDot, EqBars, BrandTitle, MusicBed) + music-bed pipeline + `ListenNow` brand piece
- [ ] **Phase 2:** Lena portrait (Flux Pro) + voice pipeline (Deepgram Luna) + texture pipeline (Flux Schnell) + ShoutoutFlagship, SongRequestDemo, MeetLena, DayInNuma
- [ ] **Phase 3:** Prisma sharing + data pickers + ShoutoutOfTheDay / SongOfTheWeek templates + ops wrappers (`npm run video:shoutout`, `video:song`)

## Commands

```bash
npm run studio                    # Remotion Studio hot-reload preview
npm run render ListenNow          # Render the "Never sleeps" brand piece to out/
npm test                          # Run the pure-function unit tests
```

## Rendering

Output lands in `out/<name>.mp4` (gitignored). A 15s ListenNow piece takes ~1-2 minutes to render on modern hardware. The `nice -n 10` prefix and `concurrency: 4` cap mean Liquidsoap's ~8ms audio buffer won't underrun while renders run.

## Repo structure

```
src/
├── Root.tsx              Composition registry
├── index.ts              Remotion entry point (registerRoot)
├── compositions/         Bespoke launch pieces (one file each)
├── primitives/           Reusable motion building blocks (tested pure fns + React)
├── tokens/               brand.ts (colors/fonts/timing), fonts.ts (Google Fonts loader)
├── scripts/              Asset generation + render CLIs
└── assets/               music-beds/, and in Phase 2: lena/, textures/, voice/
```

## Brand tokens

All colors + font names are mirrored from numaradio's `app/styles/_design-base.css` into `src/tokens/brand.ts`. Duplicated intentionally — cross-repo imports would couple builds. If numaradio's palette changes, update `brand.ts` and its drift test will surface if mirrored values differ.

## Testing philosophy

Unit tests cover the **pure functions** inside primitives (envelopes, scale cycles, word-reveal timing) and will cover the data pickers in Phase 3. Compositions themselves are **not** tested — Remotion Studio is the eyeball loop, and a failing render is the final verdict.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: phase 1 complete — listen-now.mp4 renders end-to-end"
```

- [ ] **Step 3: Run the full test suite**

```bash
cd ~/saas/numaradio-videos
npm test
```

Expected: all primitive unit tests pass (roughly 15-20 tests total across 4 primitive test files).

- [ ] **Step 4: Update numaradio's HANDOFF.md with a pointer to the new repo**

Edit `~/saas/numaradio/docs/HANDOFF.md`. Add a new section at the top (after the "Last updated" line) under `---`:

```markdown
## Marketing videos — PHASE 1 SHIPPED (2026-04-24)

New sibling repo `~/saas/numaradio-videos` renders vertical videos for
TikTok / YouTube Shorts. Phase 1 delivers the scaffold, four primitives
(`PulsingDot`, `EqBars`, `BrandTitle`, `MusicBed`), the music-bed
curation pipeline, and the first composition — `ListenNow`, a 15-second
"The Station That Never Sleeps" brand piece.

**Verify:** `cd ~/saas/numaradio-videos && npm run render ListenNow`
produces `out/listen-now.mp4` (~8 MB, 15s, 1080×1920@30fps). Opens
in Windows' default player via `explorer.exe out/listen-now.mp4`.

Spec: `docs/superpowers/specs/2026-04-24-marketing-videos-design.md`
Plan: `docs/superpowers/plans/2026-04-24-marketing-videos-phase1.md`

**Next:** Phase 2 (Lena voice/portrait pipelines + 4 more compositions)
— planned once Phase 1 is reviewed. Phase 3 (templated daily/weekly
series + `npm run video:shoutout`) after that.
```

And bump the "Last updated" line to `2026-04-24 afternoon`.

- [ ] **Step 5: Commit the handoff update in numaradio**

```bash
cd ~/saas/numaradio
git add docs/HANDOFF.md
git commit -m "handoff: marketing videos phase 1 shipped — new sibling repo"
git push
```

---

## Phase 1 Done-Definition

All of the following must be true before declaring Phase 1 complete:

1. `~/saas/numaradio-videos/` is a standalone git repo with its own history.
2. `npm install` completes cleanly.
3. `npm run studio` opens Remotion Studio and shows `ListenNow` in the sidebar.
4. `npm run render ListenNow` produces `out/listen-now.mp4` (1080×1920, 30fps, 15.0s).
5. `ffprobe` confirms the output dimensions, fps, and duration.
6. The rendered video plays and matches the storyboard (all 4 beats present, music bed fades correctly).
7. `npm test` passes all primitive unit tests.
8. `numaradio`'s `HANDOFF.md` is updated with a pointer + verification recipe.

When all 8 are green, we'll brainstorm/plan Phase 2 in a new session.

---

## Known deferrals (explicit for Phase 1)

- **No voice/Lena.** That's Phase 2 — wiring Deepgram Luna into the composition layer and generating the canonical Lena portrait via Flux Pro.
- **No data pickers / Prisma.** That's Phase 3 — we only need DB reads for the templated series.
- **No other launch pieces.** ShoutoutFlagship, SongRequestDemo, MeetLena, DayInNuma all come in Phase 2, built on top of the Phase 1 primitives.
- **No auto-publish.** User uploads MP4s manually — automation is a future spec entirely.

---

## Self-review notes

- [x] Every step has concrete content — no "TODO", no "add tests similar to above".
- [x] File paths are absolute where the shell needs them (`~/saas/numaradio-videos/...`) and explicit relative paths inside each file's edits.
- [x] Types used downstream match definitions upstream: `VolumeEnvelope` defined in MusicBed, used in ListenNow; `COLORS`/`FONTS`/`TIMING` defined in tokens/brand, used everywhere; `pulsingDotScale`/`eqBarHeight`/`wordsVisibleAtFrame` are each defined once, tested, and used by their React wrapper in the same file.
- [x] TDD discipline where it adds value (pure-function primitives); no test theater for visual compositions (explicitly called out).
- [x] Frequent commits — each task ends with a commit. Reviewer can step through history if something breaks.
- [x] Phase scope fits one executable plan — no sub-subsystems hidden inside tasks.
