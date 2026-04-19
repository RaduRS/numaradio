"use client";

import { useEffect, useState } from "react";
import { usePlayer } from "./PlayerProvider";
import { PauseIcon, PlayIcon } from "./Icons";

const SCROLL_TRIGGER = 520; // roughly past the hero

export function MiniPlayer() {
  const { isPlaying, toggle } = usePlayer();
  const [show, setShow] = useState(false);

  useEffect(() => {
    function onScroll() {
      setShow(window.scrollY > SCROLL_TRIGGER);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className={`mini-player ${show ? "show" : ""}`} id="mini-player">
      <button className="mp-btn-play" onClick={toggle} aria-pressed={isPlaying}>
        {isPlaying ? <PauseIcon /> : <PlayIcon />}
      </button>
      <div className="mp-art" />
      <div className="mp-meta">
        <div className="mp-label">On Air · Lena</div>
        {/* TODO Phase 4: render from /api/station/now-playing */}
        <div className="mp-title">
          Slow Fade, Brighter
          <span className="sep"> · </span>
          <span className="artist">Russell Ross</span>
        </div>
      </div>
      <div className="mp-eq eq">
        <span /><span /><span /><span /><span />
      </div>
      <a className="mp-req-btn" href="#requests">Request</a>
    </div>
  );
}
