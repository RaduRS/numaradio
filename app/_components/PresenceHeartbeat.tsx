"use client";

import { useEffect, useRef } from "react";

const HEARTBEAT_MS = 30_000;

// Anonymous site-presence pinger. Generates a sessionId in memory only
// (no cookie, no localStorage — lost the moment the tab closes or
// refreshes) and POSTs /api/presence/heartbeat while the tab is
// visible, so the dashboard can count live visitors without tracking
// anyone.
export function PresenceHeartbeat() {
  const sessionIdRef = useRef<string>("");

  useEffect(() => {
    // Lazily initialize — crypto.randomUUID requires a secure context,
    // fall back to a random-enough id on non-HTTPS dev.
    if (!sessionIdRef.current) {
      if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        sessionIdRef.current = crypto.randomUUID();
      } else {
        sessionIdRef.current =
          "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c === "x" ? r : (r & 0x3) | 0x8;
            return v.toString(16);
          });
      }
    }

    let cancelled = false;
    let timeoutId: number | null = null;

    async function beat() {
      if (cancelled) return;
      // Skip when tab is hidden — counting idle background tabs inflates the
      // number and costs unnecessary DB writes.
      if (document.visibilityState === "visible") {
        try {
          await fetch("/api/presence/heartbeat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: sessionIdRef.current }),
            keepalive: true,
          });
        } catch {
          /* offline / blocked — retry next tick */
        }
      }
      if (!cancelled) {
        timeoutId = window.setTimeout(beat, HEARTBEAT_MS);
      }
    }

    beat();

    function onVisibility() {
      // When the tab comes back into focus, fire immediately instead of
      // waiting up to 30 s for the next scheduled beat.
      if (document.visibilityState === "visible") {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        beat();
      }
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (timeoutId !== null) clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}
