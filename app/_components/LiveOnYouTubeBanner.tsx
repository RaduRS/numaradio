"use client";

import { useEffect, useState } from "react";

interface PublicYoutubeState {
  state: "live" | "off" | "error";
  watchUrl: string | null;
}

const POLL_MS = 60_000;

/**
 * Top-of-page strip that appears only while a YouTube broadcast is
 * active. Pulses gently (red dot + subtle glow), links to the watch
 * page in a new tab. Hidden on `/live` itself (would be confusing —
 * you're already watching).
 *
 * Background polling: 60s cadence + browser visibilitychange. Server
 * caches 60s in-process so this is cheap regardless of traffic.
 */
export function LiveOnYouTubeBanner() {
  const [state, setState] = useState<PublicYoutubeState | null>(null);

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();

    async function poll() {
      try {
        const r = await fetch("/api/youtube/state", {
          signal: ctrl.signal,
          cache: "no-store",
        });
        if (!r.ok) return;
        const json = (await r.json()) as PublicYoutubeState;
        if (!cancelled) setState(json);
      } catch {
        /* offline / blocked — try again next tick */
      }
    }

    poll();
    const id = window.setInterval(poll, POLL_MS);

    function onVis() {
      if (document.visibilityState === "visible") poll();
    }
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      ctrl.abort();
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  if (state?.state !== "live" || !state.watchUrl) return null;

  return (
    <a
      href={state.watchUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="yt-live-banner"
      aria-label="Numa Radio is live on YouTube — watch now"
    >
      <span className="yt-live-banner__dot" aria-hidden />
      <span className="yt-live-banner__label">
        We're live on <strong>YouTube</strong> right now
      </span>
      <span className="yt-live-banner__cta">Watch →</span>
    </a>
  );
}
