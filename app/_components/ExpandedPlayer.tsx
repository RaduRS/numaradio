"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePlayer } from "./PlayerProvider";
import { ExpandedPlayerDesktop } from "./ExpandedPlayerDesktop";
import { ExpandedPlayerMobile } from "./ExpandedPlayerMobile";

// Must match the .ep-shell transition duration in _expanded-player.css.
const ANIM_MS = 320;

function flipTransform(source: DOMRect, target: DOMRect): string {
  const dx = source.left - target.left;
  const dy = source.top - target.top;
  const sx = source.width / target.width;
  const sy = source.height / target.height;
  return `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
}

export function ExpandedPlayer() {
  const { isExpanded, collapse, expandSourceRect } = usePlayer();
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [exiting, setExiting] = useState(false);
  const exitTimerRef = useRef<number | null>(null);

  // Wrap collapse so the shell can reverse-animate back to the source rect
  // before unmounting.
  function handleClose() {
    if (exiting) return;
    const shell = shellRef.current;
    if (shell && expandSourceRect) {
      // Apply the source-rect transform with the CSS-defined transition active;
      // the shell visually morphs back over ANIM_MS before we unmount.
      const targetRect = shell.getBoundingClientRect();
      shell.style.transform = flipTransform(expandSourceRect, targetRect);
    }
    setExiting(true);
    exitTimerRef.current = window.setTimeout(() => {
      collapse();
      setExiting(false);
      exitTimerRef.current = null;
    }, ANIM_MS);
  }

  useEffect(() => {
    return () => {
      if (exitTimerRef.current !== null) {
        window.clearTimeout(exitTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isExpanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isExpanded]);

  useEffect(() => {
    if (!isExpanded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isExpanded]);

  // Swipe down to close on touch devices. Threshold 80 px.
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  }
  function onTouchEnd(e: React.TouchEvent) {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dy = t.clientY - start.y;
    const dx = Math.abs(t.clientX - start.x);
    if (dy > 80 && dx < 60) handleClose();
  }

  // Focus the chevron on open so keyboard users can Esc / Enter to dismiss.
  const chevRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!mounted) return;
    chevRef.current?.focus();
  }, [mounted]);

  // FLIP open: render the shell at its identity rect, synchronously apply the
  // inverse transform with transitions disabled, force a reflow, then on the
  // next frame clear the inline styles so the CSS-defined transition takes
  // the shell back to identity. This guarantees the source-rect state is
  // committed before the animation runs.
  useLayoutEffect(() => {
    if (!isExpanded) {
      setMounted(false);
      return;
    }
    const shell = shellRef.current;
    if (!shell) return;

    if (expandSourceRect) {
      const targetRect = shell.getBoundingClientRect();
      shell.style.transition = "none";
      shell.style.transform = flipTransform(expandSourceRect, targetRect);
    } else {
      shell.style.transition = "none";
      shell.style.transform = "scale(0.9)";
    }
    // Force the browser to commit the inverse-transform paint.
    void shell.offsetWidth;

    const id = requestAnimationFrame(() => {
      shell.style.transition = "";
      shell.style.transform = "";
      setMounted(true);
    });
    return () => cancelAnimationFrame(id);
  }, [isExpanded, expandSourceRect]);

  if (!isExpanded) return null;

  const open = mounted && !exiting;

  return (
    <div
      className={`ep-root ${open ? "open" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Expanded player"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="ep-shell" ref={shellRef}>
        <div className="ep-topbar">
          <button
            ref={chevRef}
            type="button"
            className="ep-chev"
            onClick={handleClose}
            aria-label="Close expanded player"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
              <path d="M5 7l5 6 5-6z" />
            </svg>
          </button>
          <div className="onair">On Air — Lena</div>
          <div style={{ width: 36 }} />
        </div>
        <ExpandedPlayerDesktop />
        <ExpandedPlayerMobile />
      </div>
    </div>
  );
}
