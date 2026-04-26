import "../lib/load-env";
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";

// Regenerates public/logo-mark.png from a perfectly-centered SVG and
// then builds a multi-size .ico (16/32/48/256) into app/favicon.ico.
//
// The original committed logo-mark.png had the ring + dot offset 59 px
// from the left edge of the 512×512 canvas, so every favicon size
// rendered visibly off-centre. Regenerating from SVG guarantees the
// circles are mathematically centred. Proportions mirror the existing
// icon.tsx route (ring at 58 % of canvas, stroke at 6.8 % of ring,
// dot at 36 % of ring) so the favicon and any icon.tsx-rendered icon
// look like the same mark.
//
// PNG-in-ICO is supported by every browser since Chrome 1, FF 41,
// Edge, Safari 9 — no need to convert to BMP.

const SOURCE_SIZE = 512;
const SIZES = [16, 32, 48, 256];
const SOURCE = path.join(process.cwd(), "public", "logo-mark.png");
const OUTPUT = path.join(process.cwd(), "app", "favicon.ico");

const ACCENT = "#4FD1C5";
const BG_OUTER = "#0B0C0E";
const BG_INNER = "#102826";

function buildMarkSvg(size: number): string {
  const cx = size / 2;
  const cy = size / 2;
  const ringDiameter = size * 0.58;
  const stroke = ringDiameter * 0.068;
  // Inset the stroke by half its width so the painted ring stays inside
  // the 58 % envelope (default SVG stroke is centred on the path).
  const ringRadius = ringDiameter / 2 - stroke / 2;
  const dotRadius = (ringDiameter * 0.36) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <radialGradient id="bg" cx="30%" cy="28%" r="80%">
      <stop offset="0%" stop-color="${BG_INNER}" />
      <stop offset="100%" stop-color="${BG_OUTER}" />
    </radialGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#bg)" />
  <circle cx="${cx}" cy="${cy}" r="${ringRadius}" fill="none" stroke="${ACCENT}" stroke-width="${stroke}" />
  <circle cx="${cx}" cy="${cy}" r="${dotRadius}" fill="${ACCENT}" />
</svg>`;
}

async function main() {
  // 1. Regenerate the brand mark from SVG → public/logo-mark.png
  const svg = buildMarkSvg(SOURCE_SIZE);
  const sourcePng = await sharp(Buffer.from(svg)).png().toBuffer();
  await fs.writeFile(SOURCE, sourcePng);
  console.log(`✓ wrote ${SOURCE} (${SOURCE_SIZE}×${SOURCE_SIZE})`);

  // 2. Build the multi-size .ico from the freshly-centred source
  const pngBuffers: Buffer[] = await Promise.all(
    SIZES.map((s) => sharp(sourcePng).resize(s, s, { fit: "contain" }).png().toBuffer()),
  );

  // ICONDIR header: 6 bytes
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = ICO
  header.writeUInt16LE(SIZES.length, 4); // image count

  // Each ICONDIRENTRY is 16 bytes; image data follows after all entries.
  const entries = Buffer.alloc(SIZES.length * 16);
  let imageOffset = 6 + SIZES.length * 16;
  const imageBytes: Buffer[] = [];

  SIZES.forEach((size, i) => {
    const png = pngBuffers[i];
    const off = i * 16;
    entries[off + 0] = size === 256 ? 0 : size; // width (0 = 256)
    entries[off + 1] = size === 256 ? 0 : size; // height (0 = 256)
    entries[off + 2] = 0; // color palette (0 = no palette)
    entries[off + 3] = 0; // reserved
    entries.writeUInt16LE(1, off + 4); // color planes
    entries.writeUInt16LE(32, off + 6); // bits per pixel
    entries.writeUInt32LE(png.length, off + 8); // image data size
    entries.writeUInt32LE(imageOffset, off + 12); // image data offset
    imageOffset += png.length;
    imageBytes.push(png);
  });

  const ico = Buffer.concat([header, entries, ...imageBytes]);
  await fs.writeFile(OUTPUT, ico);
  console.log(`✓ wrote ${OUTPUT} (${SIZES.join(", ")} px, ${(ico.length / 1024).toFixed(1)} KB)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
