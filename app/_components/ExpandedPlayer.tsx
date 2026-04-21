"use client";

import { useEffect } from "react";
import { usePlayer } from "./PlayerProvider";

export function ExpandedPlayer() {
  const { isExpanded, collapse } = usePlayer();

  // Esc closes — desktop only really, but cheap everywhere.
  useEffect(() => {
    if (!isExpanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") collapse();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isExpanded, collapse]);

  // Lock body scroll while open so the underlying page doesn't jump.
  useEffect(() => {
    if (!isExpanded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isExpanded]);

  if (!isExpanded) return null;

  return (
    <div
      className="ep-root open"
      role="dialog"
      aria-modal="true"
      aria-label="Expanded player"
    >
      <div className="ep-shell">
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
        {/* body placeholder — Task 3+ fills this */}
        <div style={{ flex: 1 }} />
      </div>
    </div>
  );
}
