"use client";

import Image from "next/image";
import { useLenaLine, relativeTimeLabel } from "./useLenaLine";
import { Skeleton } from "./Skeleton";

export interface LenaLineProps {
  /** Override the wrapper className. Caller supplies the card chrome
   *  (border, padding, layout); this component only renders the
   *  internal label + body + optional fresh-timestamp pill. */
  className?: string;
  /** "card" (full layout: avatar + label + body + meta) or "quote-only"
   *  (just the body text — used inline where the surrounding component
   *  already provides the chrome). */
  layout?: "card" | "quote-only";
  /** Avatar size in px. 36 (default) for in-card use, 96+ for feature
   *  surfaces (about page, future hero placements). The portrait is
   *  rendered through next/image which serves an optimized variant for
   *  the requested size. */
  avatarSize?: number;
}

/**
 * Dynamic Lena line. Reads from the shared useLenaLine hook so all four
 * surfaces stay in sync. Two render shapes:
 *
 *   layout="card"         (default — used in PlayerCard + About hero):
 *     ┌────────────────────────────────────┐
 *     │ [portrait]  Lena  Host · Live · …  │
 *     │             "It's quiet here, …"   │
 *     └────────────────────────────────────┘
 *
 *   layout="quote-only":
 *     "It's quiet here, the way…"
 *     (caller wraps with their own chrome)
 *
 * The avatar is the canonical Lena portrait (public/lena/portrait.png).
 * A red live-dot in the bottom-right indicates broadcast presence; it
 * pulses when the source is "live" or "context" (real fresh chatter)
 * and stays static for "pool" lines.
 */
export function LenaLine({ className, layout = "card", avatarSize = 36 }: LenaLineProps) {
  const line = useLenaLine();
  // "live" = audio chatter the daemon just aired (≤5 min)
  // "context" = generated text from real station state (≤30 min)
  // Both deserve the fresh "just now / X min ago" pill + dot pulse.
  const isFresh = line?.source === "live" || line?.source === "context";
  const freshLabel = isFresh && line && "atIso" in line ? relativeTimeLabel(line.atIso) : null;

  if (layout === "quote-only") {
    if (!line) {
      return (
        <span className={className}>
          <Skeleton width="80%" height={14} />
        </span>
      );
    }
    return (
      <span className={className}>
        &ldquo;{line.script}&rdquo;
      </span>
    );
  }

  return (
    <div className={`lena-card ${className ?? ""}`.trim()}>
      <div
        className={`lena-avatar ${isFresh ? "lena-avatar--fresh" : ""}`}
        style={{ width: avatarSize, height: avatarSize }}
      >
        {/* Inner frame holds the circular clip (overflow:hidden) so the
            outer wrapper stays open for the live-dot to extend past
            its corner. The image is scaled 1.5× with a face-anchored
            origin so we get a tight head-and-shoulders crop without
            chopping the top of the head. */}
        <div className="lena-avatar-frame">
          <Image
            src="/lena/portrait.png"
            alt="Lena, Numa Radio's AI host"
            width={avatarSize * 2}
            height={avatarSize * 2}
            style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 35%" }}
            priority={avatarSize >= 96}
          />
        </div>
      </div>
      <div className="lena-content">
        <div className="lena-head">
          <span className="lena-name">Lena</span>
          <span className="lena-label">
            Host · Live{freshLabel ? ` · ${freshLabel}` : ""}
          </span>
        </div>
        <div className="lena-text">
          {line ? (
            <>&ldquo;{line.script}&rdquo;</>
          ) : (
            <>
              <Skeleton width="92%" height={14} style={{ marginBottom: 6 }} />
              <Skeleton width="78%" height={14} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
