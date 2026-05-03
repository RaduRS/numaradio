"use client";
import { useEffect, useRef, useState } from "react";

interface Props {
  src: string | null | undefined;
  alt?: string;
  /** Class for the small thumbnail. */
  thumbClassName?: string;
  /** Pixel size of the enlarged preview. */
  previewSize?: number;
  /** Children render inside the thumbnail wrapper — used for status badges or
   *  loading overlays the parent wants on top of the image. */
  children?: React.ReactNode;
}

/**
 * Thumbnail that opens a larger floating preview on hover (desktop) and tap
 * (mobile). Tap a second time, click outside, or press Escape to close.
 *
 * The floating preview uses `position: fixed` with viewport-relative coords
 * computed from the trigger's bounding box. Without this, ancestors with
 * `overflow: hidden` (the table wrapper, scroll containers, etc.) clip the
 * preview no matter how high z-index goes.
 */
export function ArtworkPreview({
  src,
  alt = "",
  thumbClassName,
  previewSize = 280,
  children,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function computePos() {
      const el = wrapperRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      // Default: to the right of the thumb, vertically centred.
      let left = r.right + 12;
      let top = r.top + r.height / 2 - previewSize / 2;
      // Flip to the left side if the preview would overflow on the right.
      if (left + previewSize > window.innerWidth - 8) {
        left = r.left - previewSize - 12;
      }
      // Clamp vertically inside the viewport.
      top = Math.max(8, Math.min(top, window.innerHeight - previewSize - 8));
      setPos({ top, left });
    }
    computePos();
    const onDocClick = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onScrollOrResize = () => setOpen(false);
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onEsc);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onEsc);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, previewSize]);

  return (
    <span
      ref={wrapperRef}
      className="relative inline-block"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={(e) => {
        // Touch devices fire click, no hover. Toggle.
        e.stopPropagation();
        setOpen((o) => !o);
      }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className={thumbClassName} />
      ) : (
        <span className={thumbClassName} aria-hidden />
      )}
      {children}
      {open && src && pos && (
        <span
          role="img"
          aria-label={alt || "Artwork preview"}
          className="fixed z-[9999] pointer-events-none rounded-lg overflow-hidden border border-line shadow-2xl shadow-black/70 bg-bg-1"
          style={{ top: pos.top, left: pos.left, width: previewSize, height: previewSize }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" className="w-full h-full object-cover" />
        </span>
      )}
    </span>
  );
}
