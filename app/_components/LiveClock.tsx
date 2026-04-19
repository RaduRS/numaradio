"use client";

import { useEffect, useState } from "react";

function formatLocalTime(d: Date) {
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  const hh = String(((h + 11) % 12) + 1).padStart(2, "0");
  return `${hh}:${m} ${ampm} · LOCAL`;
}

export function LiveClock({ className = "" }: { className?: string }) {
  const [text, setText] = useState("");

  useEffect(() => {
    const tick = () => setText(formatLocalTime(new Date()));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  // Render an empty span on the server so SSR + first client paint match.
  return <span className={className}>{text}</span>;
}
