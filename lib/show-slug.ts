// Map a `Date` to the four-show enum used by Track.show, song-worker
// rendering, and the per-show fallback artwork PNG. Pure function so
// callers (server-side layout, song-worker) get identical behaviour.
//
// Hours are read in local time of whatever runtime calls this — server
// or client. The public-site layout calls it ONCE server-side at SSR
// and threads the slug through context, so a client-side recompute
// never changes the URL mid-render (no hydration mismatch).

import { showForHour, type ShowBlock } from "./schedule.ts";

export type ShowSlug =
  | "night_shift"
  | "morning_room"
  | "daylight_channel"
  | "prime_hours";

const SLUG_BY_NAME: Record<ShowBlock, ShowSlug> = {
  "Night Shift": "night_shift",
  "Morning Room": "morning_room",
  "Daylight Channel": "daylight_channel",
  "Prime Hours": "prime_hours",
};

export function showSlugFor(d: Date): ShowSlug {
  return SLUG_BY_NAME[showForHour(d.getHours()).name];
}

export function fallbackArtworkSrc(slug: ShowSlug): string {
  return `/fallback-artwork/${slug}.png`;
}
