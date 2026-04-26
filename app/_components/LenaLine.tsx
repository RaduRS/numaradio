"use client";

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
  /** Avatar character override; defaults to "L". card layout only. */
  avatar?: string;
}

/**
 * Dynamic Lena line. Reads from the shared useLenaLine hook so all four
 * surfaces stay in sync. Two render shapes:
 *
 *   layout="card"         (default — used in About page Lena block):
 *     ┌──────────────────────────────────┐
 *     │ ⓛ  Lena  Host · Live · just now  │
 *     │    "It's quiet here, the way…"   │
 *     └──────────────────────────────────┘
 *
 *   layout="quote-only":
 *     "It's quiet here, the way…"
 *     (caller wraps with their own chrome)
 *
 * On first paint with no cache, renders Skeleton placeholders so the
 * card never collapses to zero height (no layout shift when the line
 * loads).
 */
export function LenaLine({ className, layout = "card", avatar = "L" }: LenaLineProps) {
  const line = useLenaLine();
  // `live` (real on-air audio chatter) and `context` (every-10-min
  // truthful state-aware line) both deserve the fresh "just now / X
  // min ago" pill — the listener doesn't need to know whether it was
  // spoken or written, only that it's fresh.
  const isFresh = line?.source === "live" || line?.source === "context";
  const freshLabel = isFresh && "atIso" in line ? relativeTimeLabel(line.atIso) : null;

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
      <div className="lena-avatar">{avatar}</div>
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
