import "../lib/load-env";
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";

// Builds a multi-size .ico from public/logo-mark.png and writes it to
// app/favicon.ico. Browsers pick the best size from a single .ico
// reference; including 16/32/48/256 covers tab favicons, taskbars,
// pinned tabs, and high-DPI displays.
//
// PNG-in-ICO is supported by every browser since Chrome 1, FF 41,
// Edge, Safari 9 — no need to convert to BMP.

const SIZES = [16, 32, 48, 256];
const SOURCE = path.join(process.cwd(), "public", "logo-mark.png");
const OUTPUT = path.join(process.cwd(), "app", "favicon.ico");

async function main() {
  const src = await fs.readFile(SOURCE);
  const pngBuffers: Buffer[] = await Promise.all(
    SIZES.map((s) => sharp(src).resize(s, s, { fit: "contain" }).png().toBuffer()),
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
