"use client";

import { useRef } from "react";
import { seedNowPlayingCache, type NowPlaying } from "./useNowPlaying";

/**
 * Takes an SSR-fetched now-playing snapshot and seeds the useNowPlaying
 * singleton before any consumer renders. Emits nothing — it's a side-effect
 * shim so the first paint of MiniPlayer / Broadcast / ExpandedPlayer has
 * real data instead of the "— by —" fallback.
 */
export function NowPlayingSeeder({ initial }: { initial: NowPlaying }) {
  const seededRef = useRef(false);
  if (!seededRef.current) {
    seedNowPlayingCache(initial);
    seededRef.current = true;
  }
  return null;
}
