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
 */
export function ArtworkPreview({
  src,
  alt = "",
  thumbClassName,
  previewSize = 280,
  children,
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

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
      {open && src && (
        <span
          role="img"
          aria-label={alt || "Artwork preview"}
          className="absolute left-full top-1/2 ml-3 -translate-y-1/2 z-50 pointer-events-none rounded-lg overflow-hidden border border-line shadow-2xl shadow-black/70 bg-bg-1"
          style={{ width: previewSize, height: previewSize }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" className="w-full h-full object-cover" />
        </span>
      )}
    </span>
  );
}
