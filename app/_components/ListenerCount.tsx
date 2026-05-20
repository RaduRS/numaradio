"use client";
// POLLING DISABLED — DB is down, no live data.

import { useEffect, useState } from "react";
import { Skeleton } from "./Skeleton";

// Static placeholder for presentation mode
export function ListenerCount({
  suffix = "",
  className = "",
}: {
  suffix?: string;
  className?: string;
}) {
  const [n] = useState<number | null>(0);

  if (n === null) {
    return (
      <span className={className}>
        <Skeleton width={32} height={12} radius={3} />
        {suffix}
      </span>
    );
  }
  return (
    <span className={className}>
      {n.toLocaleString()}
      {suffix}
    </span>
  );
}