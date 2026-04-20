"use client";

import { useEffect } from "react";
import { getSessionId } from "./session-id";

const HEARTBEAT_MS = 30_000;

// Anonymous site-presence pinger. Reuses the shared in-memory sessionId
// (no cookie, no localStorage — lost the moment the tab closes or
// refreshes) and POSTs /api/presence/heartbeat while the tab is
// visible, so the dashboard can count live visitors without tracking
// anyone.
export function PresenceHeartbeat() {
  useEffect(() => {
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
            body: JSON.stringify({ sessionId: getSessionId() }),
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
