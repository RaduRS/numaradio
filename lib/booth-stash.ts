// Client-side localStorage helpers for the listener submit flows.
//
// Two independent stashes:
//  - numa.shoutout.last — latest submitted shoutout ID, for focus-time
//    recovery check (catches the rare background-pipeline failure after the
//    server returned optimistic success).
//  - numa.song.pending  — in-flight song request ID + submittedAt, so a
//    tab-switch or page reload doesn't wipe the "Lena's working on it" card.
//
// Both stashes clear themselves on terminal state. All functions are
// SSR/Jest-safe — they no-op when `window.localStorage` is unavailable.

export const SHOUTOUT_STASH_KEY = "numa.shoutout.last";
export const SONG_STASH_KEY = "numa.song.pending";

// The shoutout flow doesn't *need* pending persistence — confirmation is
// one line, dismissed on next navigation. The stash exists only so we can
// notice a late silent failure and tell the user. 5 min is long enough for
// the dashboard internal route to mark failed; beyond that we assume aired.
export const SHOUTOUT_STASH_MAX_AGE_MS = 5 * 60 * 1000;

// Song generation typically takes 60–240s; 10 min covers worst-case retry.
// Beyond that the server has almost certainly timed out and we'd rather
// show a fresh form than a forever-loading card.
export const SONG_STASH_MAX_AGE_MS = 10 * 60 * 1000;

export interface ShoutoutStash {
  shoutoutId: string;
  submittedAt: number;
}

export interface SongStash {
  requestId: string;
  submittedAt: number;
}

export function parseShoutoutStash(raw: string | null): ShoutoutStash | null {
  if (!raw) return null;
  try {
    const obj: unknown = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    const o = obj as Record<string, unknown>;
    if (typeof o.shoutoutId !== "string" || typeof o.submittedAt !== "number") {
      return null;
    }
    return { shoutoutId: o.shoutoutId, submittedAt: o.submittedAt };
  } catch {
    return null;
  }
}

export function parseSongStash(raw: string | null): SongStash | null {
  if (!raw) return null;
  try {
    const obj: unknown = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    const o = obj as Record<string, unknown>;
    if (typeof o.requestId !== "string" || typeof o.submittedAt !== "number") {
      return null;
    }
    return { requestId: o.requestId, submittedAt: o.submittedAt };
  } catch {
    return null;
  }
}

export function isFresh(submittedAt: number, maxAgeMs: number, now = Date.now()): boolean {
  return now - submittedAt < maxAgeMs;
}

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readShoutoutStash(): ShoutoutStash | null {
  const ls = getLocalStorage();
  if (!ls) return null;
  try {
    return parseShoutoutStash(ls.getItem(SHOUTOUT_STASH_KEY));
  } catch {
    return null;
  }
}

export function writeShoutoutStash(shoutoutId: string, now = Date.now()): void {
  const ls = getLocalStorage();
  if (!ls) return;
  try {
    ls.setItem(
      SHOUTOUT_STASH_KEY,
      JSON.stringify({ shoutoutId, submittedAt: now }),
    );
  } catch {
    // quota / private-mode / locked — silently skip
  }
}

export function clearShoutoutStash(): void {
  const ls = getLocalStorage();
  if (!ls) return;
  try {
    ls.removeItem(SHOUTOUT_STASH_KEY);
  } catch {
    // no-op
  }
}

export function readSongStash(): SongStash | null {
  const ls = getLocalStorage();
  if (!ls) return null;
  try {
    return parseSongStash(ls.getItem(SONG_STASH_KEY));
  } catch {
    return null;
  }
}

export function writeSongStash(requestId: string, now = Date.now()): void {
  const ls = getLocalStorage();
  if (!ls) return;
  try {
    ls.setItem(
      SONG_STASH_KEY,
      JSON.stringify({ requestId, submittedAt: now }),
    );
  } catch {
    // no-op
  }
}

export function clearSongStash(): void {
  const ls = getLocalStorage();
  if (!ls) return;
  try {
    ls.removeItem(SONG_STASH_KEY);
  } catch {
    // no-op
  }
}
