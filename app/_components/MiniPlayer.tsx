"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { usePlayer } from "./PlayerProvider";
import { LoadingIcon, PauseIcon, PlayIcon } from "./Icons";
import { useNowPlaying } from "./useNowPlaying";

const SCROLL_TRIGGER = 520; // roughly past the hero

export function MiniPlayer() {
  const { isPlaying, isLoading, toggle } = usePlayer();
  const np = useNowPlaying();
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > SCROLL_TRIGGER);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Home page has a full hero player — show mini only after scrolling past
  // it, otherwise the two players overlap. On every other route the
  // mini-player is the only controls on screen, so show it straight away.
  const isHome = pathname === "/";
  const show = isHome ? scrolled : true;

  return (
    <div className={`mini-player ${show ? "show" : ""}`} id="mini-player">
      <button
        className="mp-btn-play"
        onClick={toggle}
        aria-pressed={isPlaying}
        aria-busy={isLoading}
      >
        {isLoading ? (
          <LoadingIcon />
        ) : isPlaying ? (
          <PauseIcon />
        ) : (
          <PlayIcon />
        )}
      </button>
      <div
        className="mp-art"
        style={
          np.artworkUrl
            ? {
                backgroundImage: `url(${np.artworkUrl})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : undefined
        }
      />
      <div className="mp-meta">
        <div className="mp-label">
          {np.shoutout?.active ? (
            <span className="shoutout-pill inline">
              <span className="dot" aria-hidden />
              Lena on air
            </span>
          ) : (
            "On Air · Lena"
          )}
        </div>
        <div className="mp-title">
          {np.title ?? "—"}
          <span className="sep"> · </span>
          <span className="artist">{np.artistDisplay ?? "—"}</span>
        </div>
      </div>
      <div className="mp-eq eq">
        <span /><span /><span /><span /><span />
      </div>
      <a className="mp-req-btn" href="#requests">Request</a>
    </div>
  );
}
