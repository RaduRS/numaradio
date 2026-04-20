// Shared anonymous session id — one random UUID per browser, persisted
// to localStorage so a returning visitor keeps seeing their own vote
// state. Disclosed on /privacy. Never leaves the browser except as an
// opaque beacon used for dedupe on the presence counter and for
// matching "my vote" on the track-vote endpoint. Not linked to any
// personally-identifying information.

const STORAGE_KEY = "numa.sid";
let cached: string | null = null;

function fallbackUUID(): string {
  // RFC4122 v4-ish fallback for non-secure contexts (e.g. localhost
  // without HTTPS where crypto.randomUUID is undefined).
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function newUUID(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return fallbackUUID();
}

export function getSessionId(): string {
  if (cached) return cached;
  if (typeof window === "undefined") {
    // Never called from the server, but guard anyway so SSR doesn't crash.
    return "00000000-0000-4000-8000-000000000000";
  }
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing && /^[0-9a-f-]{36}$/i.test(existing)) {
      cached = existing;
      return cached;
    }
    const minted = newUUID();
    window.localStorage.setItem(STORAGE_KEY, minted);
    cached = minted;
    return cached;
  } catch {
    // Private-mode / storage blocked — fall back to memory-only for
    // this page load. Heartbeats and votes still work, just don't
    // persist across visits.
    cached = newUUID();
    return cached;
  }
}
