// Per-show fallback covers, used when OpenRouter (Flux) artwork
// generation fails (no credits, network error, etc.) AND as a
// CSS-fallback placeholder on the public site while real artwork
// loads. Source PNGs are rendered in numaradio-videos via
// `npm run video:fallback-artwork` and committed at
// public/fallback-artwork/{show}.png — public/ so Next.js auto-serves
// them at /fallback-artwork/{show}.png. 1024×1024 matches Flux output,
// so library thumbnails render identically.

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

// Resolve relative to the repo root so callers in workers/ and
// dashboard/ both find the same files. The dashboard runs as a Next
// app whose cwd at runtime is the dashboard/ subdir on Vercel — we
// climb out of dashboard/ when needed.
function repoRoot(): string {
  const cwd = process.cwd();
  if (cwd.endsWith("/dashboard")) return path.dirname(cwd);
  return cwd;
}

let cache: Partial<Record<FallbackShow, Buffer>> = {};

export function isFallbackShow(value: unknown): value is FallbackShow {
  return typeof value === "string" && VALID.has(value as FallbackShow);
}

export async function loadFallbackArtwork(show: FallbackShow): Promise<Buffer> {
  const cached = cache[show];
  if (cached) return cached;
  const file = path.join(repoRoot(), "public", "fallback-artwork", `${show}.png`);
  const bytes = await fs.readFile(file);
  cache[show] = bytes;
  return bytes;
}

// Pick a sensible default when the show isn't known (e.g. a regen call
// on a track whose `show` column is null). Daylight is the most
// neutral palette.
export function fallbackShowOr(value: unknown): FallbackShow {
  return isFallbackShow(value) ? value : "daylight_channel";
}
