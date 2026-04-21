"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePlayer } from "./PlayerProvider";
import { ExpandedPlayerDesktop } from "./ExpandedPlayerDesktop";
import { ExpandedPlayerMobile } from "./ExpandedPlayerMobile";

export function ExpandedPlayer() {
  const { isExpanded, collapse, expandSourceRect } = usePlayer();
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (!isExpanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") collapse();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isExpanded, collapse]);

  useEffect(() => {
    if (!isExpanded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isExpanded]);

  // FLIP: capture source rect on open, set initial transform on the shell,
  // then add `.open` next frame so CSS animates to identity.
  useLayoutEffect(() => {
    if (!isExpanded) {
      setMounted(false);
      return;
    }
    const shell = shellRef.current;
    if (!shell) return;

    if (expandSourceRect) {
      const targetRect = shell.getBoundingClientRect();
      const dx = expandSourceRect.left - targetRect.left;
      const dy = expandSourceRect.top - targetRect.top;
      const sx = expandSourceRect.width / targetRect.width;
      const sy = expandSourceRect.height / targetRect.height;
      shell.style.setProperty(
        "--ep-initial-transform",
        `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`,
      );
    } else {
      shell.style.setProperty("--ep-initial-transform", "scale(0.9)");
    }
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, [isExpanded, expandSourceRect]);

  if (!isExpanded) return null;

  return (
    <div
      className={`ep-root ${mounted ? "open" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Expanded player"
    >
      <div className="ep-shell" ref={shellRef}>
        <div className="ep-topbar">
          <button
            type="button"
            className="ep-chev"
            onClick={collapse}
            aria-label="Close expanded player"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
              <path d="M5 7l5 6 5-6z" />
            </svg>
          </button>
          <div className="ep-topbar-center">● On Air — Lena</div>
          <div style={{ width: 36 }} />
        </div>
        <ExpandedPlayerDesktop />
        <ExpandedPlayerMobile />
      </div>
    </div>
  );
}
