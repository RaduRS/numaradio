// Shared anonymous session id — lives in memory only (no cookie, no
// localStorage) and is reused by every client feature that needs to
// identify "this tab" without identifying the user. A fresh tab or a
// page refresh mints a new id.

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

export function getSessionId(): string {
  if (cached) return cached;
  if (typeof window === "undefined") {
    // Never called from the server, but guard anyway so SSR doesn't crash.
    return "00000000-0000-4000-8000-000000000000";
  }
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    cached = crypto.randomUUID();
  } else {
    cached = fallbackUUID();
  }
  return cached;
}
