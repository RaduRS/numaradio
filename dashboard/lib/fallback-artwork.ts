// Per-show fallback covers, used when OpenRouter (Flux) artwork
// regen fails (no credits, network error, etc.). Source PNGs live at
// repo-root assets/fallback-artwork/{show}.png — rendered in
// numaradio-videos via `npm run video:fallback-artwork`. The dashboard's
// systemd WorkingDirectory is .../numaradio/dashboard, so we climb one
// level out to reach the repo-root assets dir.

import fs from "node:fs/promises";
import path from "node:path";

export type FallbackShow =
  | "night_shift"
  | "morning_room"
  | "daylight_channel"
  | "prime_hours";

const VALID: ReadonlySet<FallbackShow> = new Set([
  "night_shift",
  "morning_room",
  "daylight_channel",
  "prime_hours",
]);

const ASSETS_DIR = path.resolve(process.cwd(), "..", "public", "fallback-artwork");

let cache: Partial<Record<FallbackShow, Buffer>> = {};

export function isFallbackShow(value: unknown): value is FallbackShow {
  return typeof value === "string" && VALID.has(value as FallbackShow);
}

export function fallbackShowOr(value: unknown): FallbackShow {
  return isFallbackShow(value) ? value : "daylight_channel";
}

export async function loadFallbackArtwork(show: FallbackShow): Promise<Buffer> {
  const cached = cache[show];
  if (cached) return cached;
  const file = path.join(ASSETS_DIR, `${show}.png`);
  const bytes = await fs.readFile(file);
  cache[show] = bytes;
  return bytes;
}
