// Reusable skeleton placeholder. Renders a fixed-dimension rectangle
// with a teal-tinted gradient sweep so the user sees "loading" within
// the first frame, but kept low-luminosity so it doesn't compete with
// the live content around it.
//
// Width/height are inline so callers can match the exact dimensions of
// the real element. The whole point is reserve-the-same-box: when data
// arrives and the real element renders, no layout shifts.
//
// `static` variant drops the animation — used in surfaces where many
// skeletons stack at once (ShoutoutWall) and shimmer would be loud.

import type { CSSProperties } from "react";

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: number;
  variant?: "shimmer" | "static";
  className?: string;
  style?: CSSProperties;
}

export function Skeleton({
  width,
  height,
  radius = 6,
  variant = "shimmer",
  className,
  style,
}: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={`numa-skeleton ${variant}${className ? " " + className : ""}`}
      style={{
        width,
        height,
        borderRadius: radius,
        ...style,
      }}
    />
  );
}
