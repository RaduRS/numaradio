"use client";

/**
 * Top-of-page strip — always visible on pages that import it.
 * Shows a closing message to listeners. No longer tied to YouTube
 * broadcast state.
 */
export function LiveOnYouTubeBanner() {
  return (
    <div className="yt-live-banner" style={{ justifyContent: "center" }}>
      <span className="yt-live-banner__dot" aria-hidden />
      <span className="yt-live-banner__label">
        Numa Radio is ending — thank you for being part of it
      </span>
    </div>
  );
}
