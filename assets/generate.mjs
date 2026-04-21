// Numa Radio — social platform asset generator.
// Run: `node assets/generate.mjs`
// Outputs: SVG masters in assets/src/, rasterised PNGs in assets/<platform>/.
// Tokens mirror app/styles/_design-base.css so socials feel native to the site.

import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const OUT = (...p) => path.join(ROOT, ...p);

// ---------- tokens (mirror app/styles/_design-base.css) ----------
const C = {
  bg: "#0B0C0E",
  bg1: "#0F1114",
  bg2: "#14171B",
  bg3: "#1A1E23",
  fg: "#F2F0EA",
  fgDim: "#A8A69D",
  fgMute: "#6B6B68",
  accent: "#4FD1C5",
  accentGlow: "rgba(79,209,197,0.35)",
  accentSoft: "rgba(79,209,197,0.12)",
  red: "#FF4D4D",
  warm: "#E8D9B0",
  line: "rgba(255,255,255,0.10)",
  lineStrong: "rgba(255,255,255,0.18)",
};

// ---------- fonts (base64-embedded into each SVG for reproducible rendering) ----------
const FONTS_DIR = OUT("fonts");
const archivoBlackB64 = fs
  .readFileSync(path.join(FONTS_DIR, "Archivo-Black.ttf"))
  .toString("base64");
const archivoMediumB64 = fs
  .readFileSync(path.join(FONTS_DIR, "Archivo-Medium.ttf"))
  .toString("base64");
const jbMonoB64 = fs
  .readFileSync(path.join(FONTS_DIR, "JetBrainsMono-Regular.ttf"))
  .toString("base64");

// macOS only: also drop the TTFs into ~/Library/Fonts so sharp/libvips's
// fontconfig lookup can find them by family name. Browsers see the embedded
// base64 src in the SVG; libvips ignores @font-face data URIs and matches
// against installed system fonts instead — the PNGs render in fallback weight
// (a thin sans) without this. Idempotent: only copies if the destination is
// missing or older than the source.
if (process.platform === "darwin") {
  const sysFontsDir = path.join(process.env.HOME ?? "", "Library", "Fonts");
  fs.mkdirSync(sysFontsDir, { recursive: true });
  for (const f of ["Archivo-Black.ttf", "Archivo-Medium.ttf", "JetBrainsMono-Regular.ttf"]) {
    const src = path.join(FONTS_DIR, f);
    const dst = path.join(sysFontsDir, f);
    const srcStat = fs.statSync(src);
    let dstStat;
    try { dstStat = fs.statSync(dst); } catch { /* missing */ }
    if (!dstStat || dstStat.mtimeMs < srcStat.mtimeMs) {
      fs.copyFileSync(src, dst);
      console.log(`✓ installed ${f} → ~/Library/Fonts/`);
    }
  }
}

// Use the TTFs' actual family names (as recorded in their `name` tables) so
// both the browser and librsvg/fontconfig pick them up. The browser uses the
// embedded base64 src; sharp/libvips falls back to a system font with the
// same family name (install the TTFs to ~/Library/Fonts/ on macOS).
const fontFaceDefs = `
  <style type="text/css"><![CDATA[
    @font-face {
      font-family: "Archivo Black";
      src: url(data:font/ttf;base64,${archivoBlackB64}) format("truetype");
      font-weight: 900;
    }
    @font-face {
      font-family: "Archivo Medium";
      src: url(data:font/ttf;base64,${archivoMediumB64}) format("truetype");
      font-weight: 500;
    }
    @font-face {
      font-family: "JetBrains Mono";
      src: url(data:font/ttf;base64,${jbMonoB64}) format("truetype");
      font-weight: 400;
    }
  ]]></style>
`;

// ---------- SVG component helpers ----------

/** Outer SVG shell with font embedding + optional viewBox override. */
const svg = (w, h, inner, { viewBox } = {}) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${viewBox ?? `0 0 ${w} ${h}`}">
  <defs>${fontFaceDefs}
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="6" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="glowSm" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="2" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <radialGradient id="heroGlow" cx="50%" cy="0%" r="65%" fx="50%" fy="0%">
      <stop offset="0%" stop-color="${C.accent}" stop-opacity="0.18"/>
      <stop offset="60%" stop-color="${C.accent}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="heroGlowOff" cx="80%" cy="20%" r="45%">
      <stop offset="0%" stop-color="${C.accent}" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="${C.accent}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="accentFade" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0%" stop-color="${C.accent}" stop-opacity="1"/>
      <stop offset="100%" stop-color="${C.accent}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  ${inner}
</svg>`;

/** Full-bleed dark background with teal radial glows, matching body CSS. */
const bgFill = (w, h) => `
  <rect width="${w}" height="${h}" fill="${C.bg}"/>
  <rect width="${w}" height="${h}" fill="url(#heroGlow)"/>
  <rect width="${w}" height="${h}" fill="url(#heroGlowOff)"/>
`;

/** Logo mark — ring + pulsing dot + soft halo. Scales via size param. */
const logoMark = (cx, cy, size, { halo = true } = {}) => {
  const r = size / 2;
  const strokeW = Math.max(1.5, size / 14);
  const dotR = size * 0.185;
  const haloR = size * 0.62;
  return `
    ${halo ? `<circle cx="${cx}" cy="${cy}" r="${haloR}" fill="${C.accent}" opacity="0.10"/>` : ""}
    <circle cx="${cx}" cy="${cy}" r="${r - strokeW / 2}" fill="none"
            stroke="${C.accent}" stroke-width="${strokeW}"/>
    <circle cx="${cx}" cy="${cy}" r="${dotR}" fill="${C.accent}" filter="url(#glowSm)"/>
  `;
};

/** "NUMA·RADIO" wordmark — matches the navbar's rendered output: the .logo
   class applies text-transform: uppercase to "Numa·Radio", so on screen the
   user sees CAPS with a mint-accent middle dot. We emit caps directly here
   since SVG text-transform support is patchy.

   `anchor` controls how (x,y) is interpreted:
   - "start"  — (x,y) is the baseline at the LEFT edge of the text
   - "middle" — (x,y) is the baseline at the HORIZONTAL CENTER of the text
   - "end"    — (x,y) is the baseline at the RIGHT edge of the text

   Use "middle" whenever you want the text centered on a column — that way
   SVG handles the math instead of us estimating glyph widths. */
const wordmark = (
  x,
  y,
  size,
  { color = C.fg, tracking = "0.04em", anchor = "start" } = {},
) => `
  <text x="${x}" y="${y}" fill="${color}"
        font-family="Archivo Black" font-size="${size}"
        letter-spacing="${tracking}" text-anchor="${anchor}"
        dominant-baseline="alphabetic">NUMA<tspan fill="${C.accent}">·</tspan>RADIO</text>
`;

/** Mono eyebrow text. */
const eyebrow = (x, y, size, text, { color = C.fgDim, anchor = "start" } = {}) => `
  <text x="${x}" y="${y}" fill="${color}"
        font-family="JetBrains Mono" font-size="${size}"
        letter-spacing="0.22em" text-anchor="${anchor}"
        dominant-baseline="alphabetic">${text}</text>
`;

/** Red pill "● LIVE" badge. */
const liveChip = (x, y, scale = 1) => {
  const h = 36 * scale;
  const w = 92 * scale;
  return `
    <g transform="translate(${x},${y})">
      <rect width="${w}" height="${h}" rx="${h / 2}" fill="rgba(255,77,77,0.12)"
            stroke="${C.red}" stroke-opacity="0.55" stroke-width="${1 * scale}"/>
      <circle cx="${16 * scale}" cy="${h / 2}" r="${5 * scale}" fill="${C.red}" filter="url(#glowSm)"/>
      <text x="${30 * scale}" y="${h / 2 + 4.5 * scale}" fill="${C.fg}"
            font-family="JetBrains Mono" font-size="${12 * scale}"
            letter-spacing="0.22em">LIVE</text>
    </g>
  `;
};

/** EQ bars — 5 accent bars at staggered heights. */
const eqBars = (x, y, barW, maxH, heights = [0.6, 1.0, 0.5, 0.85, 0.7]) => {
  const gap = barW * 0.9;
  return heights
    .map((ratio, i) => {
      const bh = maxH * ratio;
      const bx = x + i * (barW + gap);
      const by = y + (maxH - bh);
      return `<rect x="${bx}" y="${by}" width="${barW}" height="${bh}" rx="${barW / 2}" fill="${C.accent}"/>`;
    })
    .join("");
};

/** Horizontal lockup: mark + wordmark. Returns SVG inner. */
const horizontalLockup = (cx, cy, markSize, wordSize, { color = C.fg } = {}) => {
  const gap = markSize * 0.45;
  const totalW = markSize + gap + wordSize * 5.5;
  const left = cx - totalW / 2;
  const markCx = left + markSize / 2;
  const wordX = left + markSize + gap;
  const wordY = cy + wordSize * 0.36;
  return `
    ${logoMark(markCx, cy, markSize, { halo: false })}
    ${wordmark(wordX, wordY, wordSize, { color })}
  `;
};

/** Stacked lockup: mark on top, wordmark below, the whole group centered on
   (cx, cy). Returns the wordmark baseline as `wordBaselineY` so callers can
   anchor follow-up elements (e.g. an eyebrow) below it without guessing.

   The wordmark uses text-anchor="middle" anchored at cx, so SVG centers it
   exactly — no glyph-width estimation. */
const CAP_HEIGHT_RATIO = 0.72; // Archivo Black ascender→baseline ≈ 0.72em
const stackedLockup = (cx, cy, markSize, wordSize, { color = C.fg, gap } = {}) => {
  const stackGap = gap ?? wordSize * 0.9;
  const capHeight = wordSize * CAP_HEIGHT_RATIO;
  const totalHeight = markSize + stackGap + capHeight;
  const top = cy - totalHeight / 2;
  const markCy = top + markSize / 2;
  const wordBaselineY = top + markSize + stackGap + capHeight;
  return {
    wordBaselineY,
    svg: `
      ${logoMark(cx, markCy, markSize, { halo: true })}
      ${wordmark(cx, wordBaselineY, wordSize, { color, anchor: "middle" })}
    `,
  };
};

// ---------- platform compositions ----------

const masters = {};

// Logo mark alone (square, for favicon + apple touch)
masters.markSquare = (size) =>
  svg(
    size,
    size,
    `${bgFill(size, size)}
     ${logoMark(size / 2, size / 2, size * 0.62)}`
  );

// Logo mark with transparent bg (for use on any background)
masters.markTransparent = (size) =>
  svg(
    size,
    size,
    logoMark(size / 2, size / 2, size * 0.72, { halo: false })
  );

// Horizontal lockup card — fills whatever size, centred
masters.lockupHorizontal = (w, h) =>
  svg(
    w,
    h,
    `${bgFill(w, h)}
     ${horizontalLockup(w / 2, h / 2, Math.min(w, h) * 0.26, Math.min(w, h) * 0.12)}`
  );

// Stacked lockup — profile pics where both mark and wordmark fit a square.
// No eyebrow tagline — at avatar size the wordmark is the brand and any
// caption becomes mush. Real broadcaster channel art (BBC, NPR, Spotify)
// works the same way.
masters.lockupStacked = (size) =>
  svg(
    size,
    size,
    `${bgFill(size, size)}
     ${stackedLockup(size / 2, size / 2, size * 0.38, size * 0.085).svg}`
  );

// YouTube banner (2560x1440) — editorial two-column layout inside the
// 1546x423 safe area (visible on mobile + everywhere). Left column carries
// the brand stack (mark above wordmark). Right column carries the hero
// statement, mirroring the homepage rhythm: small mono eyebrow, big display
// headline with NEVER in mint, URL caption beneath. A single hairline
// separator divides the columns. Outside the safe area only the LIVE chip
// shows (top-right) — no duplicated EQ bars, no top-left brand pin (it would
// just repeat the safe-area lockup).
masters.youtubeBanner = () => {
  const w = 2560,
    h = 1440;
  const safeW = 1546,
    safeH = 423;
  const sx = (w - safeW) / 2,
    sy = (h - safeH) / 2;

  // Column geometry inside the safe area
  const colMidX = sx + safeW / 2; // separator x (canvas coords)
  const leftMidX = sx + safeW * 0.27; // brand stack center
  const rightStartX = sx + safeW * 0.55; // right column left edge
  const safeMidY = sy + safeH / 2;

  // Headline rhythm — three lines, NEVER tinted accent. Compute everything
  // from the headline cap top instead of the baseline, so gaps above (eyebrow)
  // and below (URL) are visually correct rather than off by one cap height.
  const headSize = 84;
  const headLineH = 88;
  const headCapHeight = headSize * CAP_HEIGHT_RATIO;
  // Center the three-line headline block on safeMidY.
  const headlineBlockHeight = headCapHeight + headLineH * 2;
  const headCapTopY = safeMidY - headlineBlockHeight / 2;
  const headBaseline = (i) => headCapTopY + headCapHeight + headLineH * i;

  // Eyebrow sits with a real gap above the headline cap top.
  const eyebrowSize = 20;
  const eyebrowGap = 36;
  const eyebrowBaselineY = headCapTopY - eyebrowGap;

  // URL sits with a real gap below the last headline baseline.
  const urlSize = 22;
  const urlGap = 38;
  const urlBaselineY = headBaseline(2) + urlGap + urlSize * CAP_HEIGHT_RATIO;

  return svg(
    w,
    h,
    `${bgFill(w, h)}

     <!-- LEFT column: brand stack centered in its half -->
     ${stackedLockup(leftMidX, safeMidY, 230, 64, { gap: 36 }).svg}

     <!-- vertical hairline separator between the two columns -->
     <line x1="${colMidX}" y1="${sy + 60}" x2="${colMidX}" y2="${sy + safeH - 60}"
           stroke="${C.lineStrong}" stroke-width="1" />

     <!-- RIGHT column: editorial hero stack, left-aligned at rightStartX -->
     <text x="${rightStartX}" y="${eyebrowBaselineY}" fill="${C.fgDim}"
           font-family="JetBrains Mono" font-size="${eyebrowSize}" letter-spacing="0.28em"
           dominant-baseline="alphabetic">EST. 2026  ·  REQUESTS ON AIR</text>

     <text x="${rightStartX}" y="${headBaseline(0)}" fill="${C.fg}"
           font-family="Archivo Black" font-size="${headSize}"
           letter-spacing="-0.005em">THE STATION</text>
     <text x="${rightStartX}" y="${headBaseline(1)}" fill="${C.fg}"
           font-family="Archivo Black" font-size="${headSize}"
           letter-spacing="-0.005em">THAT <tspan fill="${C.accent}">NEVER</tspan></text>
     <text x="${rightStartX}" y="${headBaseline(2)}" fill="${C.fg}"
           font-family="Archivo Black" font-size="${headSize}"
           letter-spacing="-0.005em">SLEEPS.</text>

     <text x="${rightStartX}" y="${urlBaselineY}" fill="${C.fg}"
           font-family="JetBrains Mono" font-size="${urlSize}" letter-spacing="0.22em"
           dominant-baseline="alphabetic">NUMARADIO.COM</text>

     <!-- LIVE chip top-right (TV/desktop area only) -->
     ${liveChip(w - 260, 120, 1.4)}`
  );
};

// Twitch banner 1200x480 — channel header shown above panels
masters.twitchBanner = () => {
  const w = 1200,
    h = 480;
  return svg(
    w,
    h,
    `${bgFill(w, h)}
     <g transform="translate(${w / 2},${h / 2 - 30})">
       ${horizontalLockup(0, 0, 120, 72)}
     </g>
     ${eyebrow(w / 2, h / 2 + 70, 16, "LIVE 24/7  ·  REQUEST SHOUTOUTS  ·  AI RADIO", { anchor: "middle" })}
     ${eqBars(w / 2 - 90, h - 90, 10, 50, [0.5, 0.9, 0.7, 1.0, 0.6, 0.85])}
     ${eqBars(w / 2 + 10, h - 90, 10, 50, [0.7, 0.4, 0.9, 0.55, 1.0, 0.65])}`
  );
};

// X (Twitter) header 1500x500 — asymmetric editorial treatment
masters.xHeader = () => {
  const w = 1500,
    h = 500;
  return svg(
    w,
    h,
    `${bgFill(w, h)}
     <!-- giant wordmark to the left, mark to the right -->
     <text x="80" y="${h / 2 - 10}" fill="${C.fg}"
           font-family="Archivo Black" font-size="168"
           letter-spacing="-0.01em">NUMA</text>
     <text x="80" y="${h / 2 + 140}" fill="${C.accent}"
           font-family="Archivo Black" font-size="168"
           letter-spacing="-0.01em">RADIO</text>
     ${logoMark(w - 220, h / 2, 260, { halo: true })}
     ${eyebrow(w - 220, h - 80, 16, "AI RADIO · ALWAYS ON", { anchor: "middle" })}
     ${liveChip(80, 60)}`
  );
};

// Instagram post template 1080x1080 — "now playing" card
masters.igPostTemplate = () => {
  const s = 1080;
  return svg(
    s,
    s,
    `${bgFill(s, s)}
     <!-- top brand row -->
     <g transform="translate(80,80)">
       ${logoMark(28, 28, 56, { halo: false })}
       <text x="76" y="40" fill="${C.fg}" font-family="Archivo Black"
             font-size="28" letter-spacing="0.04em">NUMA RADIO</text>
     </g>
     ${liveChip(s - 180, 70)}
     <!-- central now-playing slot (editorial placeholder) -->
     ${eyebrow(s / 2, s / 2 - 160, 22, "NOW PLAYING", { anchor: "middle" })}
     <rect x="${s / 2 - 320}" y="${s / 2 - 120}" width="640" height="4" fill="${C.accent}" opacity="0.6"/>
     <text x="${s / 2}" y="${s / 2 - 20}" fill="${C.fg}" text-anchor="middle"
           font-family="Archivo Black" font-size="84" letter-spacing="-0.01em">TRACK TITLE</text>
     <text x="${s / 2}" y="${s / 2 + 60}" fill="${C.fgDim}" text-anchor="middle"
           font-family="Archivo Medium" font-size="42">Artist Name</text>
     <rect x="${s / 2 - 320}" y="${s / 2 + 116}" width="640" height="4" fill="${C.accent}" opacity="0.6"/>
     <!-- footer EQ + url -->
     <g transform="translate(${s / 2 - 100},${s - 200})">${eqBars(0, 0, 14, 80)}</g>
     ${eyebrow(s / 2, s - 80, 22, "NUMARADIO.COM", { anchor: "middle", color: C.fg })}`
  );
};

// Instagram story template 1080x1920 — vertical 9:16
masters.igStoryTemplate = () => {
  const w = 1080,
    h = 1920;
  return svg(
    w,
    h,
    `${bgFill(w, h)}
     <!-- top brand stack -->
     <g transform="translate(${w / 2},300)">
       ${stackedLockup(0, 0, 240, 80).svg}
     </g>
     ${liveChip(w / 2 - 46, 600)}
     <!-- mid slot -->
     ${eyebrow(w / 2, h / 2 + 40, 26, "NOW PLAYING", { anchor: "middle" })}
     <rect x="${w / 2 - 340}" y="${h / 2 + 90}" width="680" height="4" fill="${C.accent}" opacity="0.6"/>
     <text x="${w / 2}" y="${h / 2 + 210}" fill="${C.fg}" text-anchor="middle"
           font-family="Archivo Black" font-size="92" letter-spacing="-0.01em">TRACK TITLE</text>
     <text x="${w / 2}" y="${h / 2 + 290}" fill="${C.fgDim}" text-anchor="middle"
           font-family="Archivo Medium" font-size="46">Artist Name</text>
     <rect x="${w / 2 - 340}" y="${h / 2 + 340}" width="680" height="4" fill="${C.accent}" opacity="0.6"/>
     <!-- bottom CTA -->
     <g transform="translate(${w / 2 - 120},${h - 500})">${eqBars(0, 0, 18, 120)}</g>
     ${eyebrow(w / 2, h - 320, 30, "NUMARADIO.COM", { anchor: "middle", color: C.fg })}
     ${eyebrow(w / 2, h - 260, 22, "TAP TO LISTEN", { anchor: "middle" })}`
  );
};

// TikTok vertical overlay 1080x1920 (solid bg - use as static TikTok "cover" / vertical promo)
masters.tiktokCover = () => {
  const w = 1080,
    h = 1920;
  return svg(
    w,
    h,
    `${bgFill(w, h)}
     <g transform="translate(${w / 2},${h / 2 - 140})">
       ${stackedLockup(0, 0, 320, 100).svg}
     </g>
     ${liveChip(w / 2 - 64, h / 2 + 220, 1.3)}
     ${eyebrow(w / 2, h - 240, 28, "AI RADIO · ALWAYS ON", { anchor: "middle" })}
     ${eyebrow(w / 2, h - 180, 22, "NUMARADIO.COM", { anchor: "middle", color: C.fg })}`
  );
};

// YouTube video thumbnail template 1280x720 — editorial split.
// Left column: compact horizontal brand lockup pinned top-left, a vertical
// hairline separator continues down to anchor the brand column visually.
// Right column: episode eyebrow top-right, two-line "VIDEO / TITLE"
// placeholder right-aligned, accent underline, LIVE chip bottom-right. The
// previous layout split the brand across opposite corners (mark top-left,
// wordmark bottom-left), which read as two separate marks rather than one.
masters.youtubeThumbnail = () => {
  const w = 1280,
    h = 720;
  const padX = 64;
  const colSplitX = w * 0.32;
  const titleSize = 116;
  const titleLineH = 124;
  const titleCapHeight = titleSize * CAP_HEIGHT_RATIO;
  const titleBlockHeight = titleCapHeight + titleLineH;
  const titleCapTopY = h / 2 - titleBlockHeight / 2;
  const titleBaseline = (i) => titleCapTopY + titleCapHeight + titleLineH * i;

  return svg(
    w,
    h,
    `${bgFill(w, h)}

     <!-- LEFT brand column: compact horizontal lockup top-left -->
     <g transform="translate(${padX},${padX + 8})">
       ${logoMark(22, 22, 44, { halo: false })}
       <text x="60" y="30" fill="${C.fg}"
             font-family="Archivo Black" font-size="26" letter-spacing="0.04em"
             dominant-baseline="alphabetic">NUMA<tspan fill="${C.accent}">·</tspan>RADIO</text>
     </g>
     <!-- vertical hairline anchoring the brand column -->
     <line x1="${colSplitX}" y1="${padX + 30}" x2="${colSplitX}" y2="${h - padX - 30}"
           stroke="${C.lineStrong}" stroke-width="1"/>

     <!-- RIGHT title column -->
     <text x="${w - padX}" y="${titleCapTopY - 24}" fill="${C.fgDim}" text-anchor="end"
           font-family="JetBrains Mono" font-size="20" letter-spacing="0.28em"
           dominant-baseline="alphabetic">EP. 001 · TITLE GOES HERE</text>

     <text x="${w - padX}" y="${titleBaseline(0)}" fill="${C.fg}" text-anchor="end"
           font-family="Archivo Black" font-size="${titleSize}" letter-spacing="-0.02em">VIDEO</text>
     <text x="${w - padX}" y="${titleBaseline(1)}" fill="${C.fg}" text-anchor="end"
           font-family="Archivo Black" font-size="${titleSize}" letter-spacing="-0.02em">TITLE</text>

     <!-- accent underline anchored to the right edge under the title block -->
     <rect x="${w - padX - 320}" y="${titleBaseline(1) + 24}" width="320" height="4" fill="${C.accent}"/>

     ${liveChip(w - 200, h - padX - 8, 1.1)}`
  );
};

// Offline card — shared across YouTube / Twitch "be right back" screens.
// Editorial: brand stack centered as the calm focal point, an "OFF AIR"
// status pill (amber-toned to read as paused, not error), a mono URL caption
// underneath. No EQ bars — we're off air, no signal to visualize.
masters.offlineCard = () => {
  const w = 1920,
    h = 1080;
  const cx = w / 2,
    cy = h / 2;
  const stack = stackedLockup(cx, cy - 60, 240, 76, { gap: 38 });
  const pillW = 180,
    pillH = 44,
    pillY = stack.wordBaselineY + 70;
  return svg(
    w,
    h,
    `${bgFill(w, h)}
     ${stack.svg}

     <!-- OFF AIR status pill, amber-toned (not red — we're paused, not broken) -->
     <g transform="translate(${cx - pillW / 2},${pillY})">
       <rect width="${pillW}" height="${pillH}" rx="${pillH / 2}"
             fill="rgba(232,217,176,0.10)" stroke="${C.warm}" stroke-opacity="0.55" stroke-width="1"/>
       <circle cx="22" cy="${pillH / 2}" r="5" fill="${C.warm}"/>
       <text x="40" y="${pillH / 2 + 5}" fill="${C.fg}"
             font-family="JetBrains Mono" font-size="14" letter-spacing="0.25em">OFF AIR</text>
     </g>

     <text x="${cx}" y="${pillY + pillH + 56}" fill="${C.fgDim}" text-anchor="middle"
           font-family="JetBrains Mono" font-size="20" letter-spacing="0.28em"
           dominant-baseline="alphabetic">BE RIGHT BACK  ·  NUMARADIO.COM</text>`
  );
};

// Live-stream OBS overlay 1920x1080 — transparent bg over video. Three
// pieces only: brand pill top-left, LIVE chip top-right, lower-third
// "now playing" card bottom-left. The bottom-right URL was dropped — the
// brand pill already implies the URL and the corner clutter pulled the eye
// off the actual video content the overlay is supposed to sit on top of.
masters.liveOverlay = () => {
  const w = 1920,
    h = 1080;
  const pillW = 360,
    pillH = 68;
  return svg(
    w,
    h,
    `<!-- transparent bg intentional -->

     <!-- top-left brand pill -->
     <g transform="translate(48,48)">
       <rect x="0" y="0" width="${pillW}" height="${pillH}" rx="${pillH / 2}"
             fill="rgba(11,12,14,0.78)" stroke="${C.line}" stroke-width="1"/>
       ${logoMark(pillH / 2, pillH / 2, pillH * 0.72, { halo: false })}
       <text x="${pillH + 16}" y="${pillH / 2 + 7}" fill="${C.fg}"
             font-family="Archivo Black" font-size="22" letter-spacing="0.04em"
             dominant-baseline="alphabetic">NUMA<tspan fill="${C.accent}">·</tspan>RADIO</text>
     </g>

     <!-- top-right live chip -->
     ${liveChip(w - 160, 60, 1.2)}

     <!-- bottom-left lower-third "now playing" card -->
     <g transform="translate(48,${h - 168})">
       <rect x="0" y="0" width="760" height="120" rx="16"
             fill="rgba(11,12,14,0.82)" stroke="${C.line}" stroke-width="1"/>
       ${eqBars(28, 30, 10, 60, [0.6, 1.0, 0.5, 0.85, 0.7])}
       <text x="124" y="50" fill="${C.fgDim}"
             font-family="JetBrains Mono" font-size="13" letter-spacing="0.22em"
             dominant-baseline="alphabetic">NOW PLAYING</text>
       <text x="124" y="92" fill="${C.fg}"
             font-family="Archivo Black" font-size="28" letter-spacing="0.01em"
             dominant-baseline="alphabetic">TRACK <tspan fill="${C.fgDim}">·</tspan> ARTIST</text>
     </g>`
  );
};

// Twitch panel — generic 320x100 panel with customisable title
masters.twitchPanel = (title) => {
  const w = 640,
    h = 200; // render at 2x for retina, Twitch downscales
  return svg(
    w,
    h,
    `<rect width="${w}" height="${h}" fill="${C.bg1}"/>
     <rect x="0" y="0" width="4" height="${h}" fill="${C.accent}"/>
     <text x="40" y="90" fill="${C.fg}"
           font-family="Archivo Black" font-size="48" letter-spacing="0.04em">${title.toUpperCase()}</text>
     <text x="40" y="140" fill="${C.fgDim}"
           font-family="JetBrains Mono" font-size="20" letter-spacing="0.18em">NUMA RADIO</text>
     <rect x="0" y="${h - 1}" width="${w}" height="1" fill="${C.line}"/>`
  );
};

// Open Graph card 1200x630
masters.ogImage = () => {
  const w = 1200,
    h = 630;
  return svg(
    w,
    h,
    `${bgFill(w, h)}
     <g transform="translate(${w / 2},${h / 2 - 40})">
       ${horizontalLockup(0, 0, 140, 92)}
     </g>
     ${eyebrow(w / 2, h / 2 + 90, 20, "AI RADIO · ALWAYS ON · NUMARADIO.COM", { anchor: "middle" })}
     ${liveChip(w / 2 - 46, h - 120)}`
  );
};

// ---------- render plan ----------
// [svgFn, outputSvgPath, [{ png, size | w,h }]]
const plan = [
  // shared favicon + touch
  [() => masters.markTransparent(512), "src/logo-mark.svg", [
    { png: "shared/favicon-16.png", w: 16, h: 16 },
    { png: "shared/favicon-32.png", w: 32, h: 32 },
    { png: "shared/favicon-48.png", w: 48, h: 48 },
    { png: "shared/favicon-64.png", w: 64, h: 64 },
    { png: "shared/favicon-256.png", w: 256, h: 256 },
  ]],
  [() => masters.markSquare(1024), "src/logo-mark-square.svg", [
    { png: "shared/apple-touch-icon-180.png", w: 180, h: 180 },
    { png: "shared/icon-512.png", w: 512, h: 512 },
  ]],
  [() => masters.lockupHorizontal(2400, 800), "src/lockup-horizontal.svg", [
    { png: "shared/lockup-horizontal-1200.png", w: 1200, h: 400 },
  ]],
  [() => masters.lockupStacked(1024), "src/lockup-stacked.svg", [
    { png: "shared/lockup-stacked-1024.png", w: 1024, h: 1024 },
  ]],
  [() => masters.ogImage(), "src/og-image.svg", [
    { png: "shared/og-image-1200x630.png", w: 1200, h: 630 },
  ]],

  // YouTube
  [() => masters.lockupStacked(1024), "youtube/profile.svg", [
    { png: "youtube/profile-800.png", w: 800, h: 800 },
  ]],
  [() => masters.youtubeBanner(), "youtube/banner.svg", [
    { png: "youtube/banner-2560x1440.png", w: 2560, h: 1440 },
  ]],
  [() => masters.youtubeThumbnail(), "youtube/thumbnail-template.svg", [
    { png: "youtube/thumbnail-1280x720.png", w: 1280, h: 720 },
  ]],
  [() => masters.offlineCard(), "youtube/offline.svg", [
    { png: "youtube/offline-1920x1080.png", w: 1920, h: 1080 },
  ]],
  [() => masters.liveOverlay(), "youtube/live-overlay.svg", [
    { png: "youtube/live-overlay-1920x1080.png", w: 1920, h: 1080 },
  ]],

  // Twitch
  [() => masters.lockupStacked(1024), "twitch/profile.svg", [
    { png: "twitch/profile-256.png", w: 256, h: 256 },
    { png: "twitch/profile-512.png", w: 512, h: 512 },
  ]],
  [() => masters.twitchBanner(), "twitch/banner.svg", [
    { png: "twitch/banner-1200x480.png", w: 1200, h: 480 },
  ]],
  [() => masters.offlineCard(), "twitch/offline.svg", [
    { png: "twitch/offline-1920x1080.png", w: 1920, h: 1080 },
  ]],
  [() => masters.liveOverlay(), "twitch/live-overlay.svg", [
    { png: "twitch/live-overlay-1920x1080.png", w: 1920, h: 1080 },
  ]],
  [() => masters.twitchPanel("About"), "twitch/panels/about.svg", [
    { png: "twitch/panels/about-320x100.png", w: 320, h: 100 },
  ]],
  [() => masters.twitchPanel("Schedule"), "twitch/panels/schedule.svg", [
    { png: "twitch/panels/schedule-320x100.png", w: 320, h: 100 },
  ]],
  [() => masters.twitchPanel("Commands"), "twitch/panels/commands.svg", [
    { png: "twitch/panels/commands-320x100.png", w: 320, h: 100 },
  ]],

  // TikTok
  [() => masters.lockupStacked(1024), "tiktok/profile.svg", [
    { png: "tiktok/profile-400.png", w: 400, h: 400 },
    { png: "tiktok/profile-1080.png", w: 1080, h: 1080 },
  ]],
  [() => masters.tiktokCover(), "tiktok/cover.svg", [
    { png: "tiktok/cover-1080x1920.png", w: 1080, h: 1920 },
  ]],

  // Instagram
  [() => masters.lockupStacked(1024), "instagram/profile.svg", [
    { png: "instagram/profile-500.png", w: 500, h: 500 },
    { png: "instagram/profile-1080.png", w: 1080, h: 1080 },
  ]],
  [() => masters.igPostTemplate(), "instagram/post-template.svg", [
    { png: "instagram/post-template-1080.png", w: 1080, h: 1080 },
  ]],
  [() => masters.igStoryTemplate(), "instagram/story-template.svg", [
    { png: "instagram/story-template-1080x1920.png", w: 1080, h: 1920 },
  ]],

  // X (Twitter)
  [() => masters.lockupStacked(1024), "x/profile.svg", [
    { png: "x/profile-400.png", w: 400, h: 400 },
  ]],
  [() => masters.xHeader(), "x/header.svg", [
    { png: "x/header-1500x500.png", w: 1500, h: 500 },
  ]],
];

// ---------- execute ----------
async function run() {
  const results = [];
  for (const [fn, svgPath, pngs] of plan) {
    const svgStr = fn();
    const svgAbs = OUT(svgPath);
    fs.mkdirSync(path.dirname(svgAbs), { recursive: true });
    fs.writeFileSync(svgAbs, svgStr);
    for (const { png, w, h } of pngs) {
      const pngAbs = OUT(png);
      fs.mkdirSync(path.dirname(pngAbs), { recursive: true });
      await sharp(Buffer.from(svgStr)).resize(w, h, { fit: "fill" }).png().toFile(pngAbs);
      results.push({ png, w, h, bytes: fs.statSync(pngAbs).size });
    }
  }
  return results;
}

const results = await run();
console.log(`✓ ${results.length} PNGs written`);
for (const r of results) {
  console.log(`  ${r.png.padEnd(48)} ${r.w}x${r.h}  ${Math.round(r.bytes / 1024)}KB`);
}
