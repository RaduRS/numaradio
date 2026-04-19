"use client";

import { useEffect, useState } from "react";

const SEED = 12_418;

export function ListenerCount({
  suffix = "",
  className = "",
}: {
  suffix?: string;
  className?: string;
}) {
  const [n, setN] = useState(SEED);

  useEffect(() => {
    const id = setInterval(() => {
      setN((prev) => {
        const delta = Math.round((Math.random() - 0.45) * 12);
        return Math.max(11_000, prev + delta);
      });
    }, 3_500);
    return () => clearInterval(id);
  }, []);

  return (
    <span className={className}>
      {n.toLocaleString()}
      {suffix}
    </span>
  );
}
