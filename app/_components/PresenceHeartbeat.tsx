"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { getSessionId } from "./session-id";

const HEARTBEAT_MS = 30_000;

// Anonymous site-presence pinger. Reuses the shared in-memory sessionId
// (no cookie, no localStorage — lost the moment the tab closes or
// refreshes) and POSTs /api/presence/heartbeat while the tab is
// visible, so the dashboard can count live visitors without tracking
// anyone.
export function PresenceHeartbeat() {
  const pathname = usePathname();
  // The /live broadcast page is hit by the headless YouTube encoder. We
  // don't want that single Chromium tab inflating the visitor count
  // forever.
  const isBroadcast = pathname === "/live";

  useEffect(() => {
    // POLLING DISABLED — DB is down, no live data.
    // if (isBroadcast) return;
    // let cancelled = false;
    // let timeoutId: number | null = null;
    // async function beat() {
    //   if (cancelled) return;
    //   if (document.visibilityState === "visible") {
    //     try {
    //       await fetch("/api/presence/heartbeat", {
    //         method: "POST",
    //         headers: { "Content-Type": "application/json" },
    //         body: JSON.stringify({ sessionId: getSessionId() }),
    //         keepalive: true,
    //       });
    //     } catch { /* offline / blocked */ }
    //   }
    //   if (!cancelled) { timeoutId = window.setTimeout(beat, HEARTBEAT_MS); }
    // }
    // beat();
    // function onVisibility() {
    //   if (document.visibilityState === "visible") {
    //     if (timeoutId !== null) { clearTimeout(timeoutId); timeoutId = null; }
    //     beat();
    //   }
    // }
    // document.addEventListener("visibilitychange", onVisibility);
    // return () => {
    //   cancelled = true;
    //   if (timeoutId !== null) clearTimeout(timeoutId);
    //   document.removeEventListener("visibilitychange", onVisibility);
    // };
  }, [isBroadcast]);

  return null;
}
