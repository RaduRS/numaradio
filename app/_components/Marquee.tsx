"use client";

import { useEffect, useState } from "react";
import { useNowPlaying } from "./useNowPlaying";

type Item = {
  key: string;
  type: "now" | "soft";
  label: string;
  meta?: string;
};

const STATIC_ITEMS: Item[] = [
  {
    key: "hosted",
    type: "soft",
    label: "Hosted by Lena",
    meta: "24 / 7 / Forever",
  },
  {
    key: "noads",
    type: "soft",
    label: "No ads · one stream",
    meta: "Same for everyone",
  },
  {
    key: "requests",
    type: "soft",
    label: "Requests read on air",
    meta: "Send yours in",
  },
];

function useListenerCount() {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    async function poll() {
      try {
        const r = await fetch("/api/station/listeners", {
          signal: ctrl.signal,
          cache: "no-store",
        });
        if (!r.ok) return;
        const data = (await r.json()) as { withFloor?: number };
        if (typeof data.withFloor === "number") setCount(data.withFloor);
      } catch {
        /* network blip — keep previous value */
      }
    }
    poll();
    const id = setInterval(poll, 10_000);
    return () => {
      clearInterval(id);
      ctrl.abort();
    };
  }, []);
  return count;
}

export function Marquee() {
  const np = useNowPlaying();
  const listeners = useListenerCount();

  const items: Item[] = [];

  if (np.title) {
    items.push({
      key: "now",
      type: "now",
      label: `Now · ${np.title}`,
      meta: np.artistDisplay ?? "",
    });
  } else {
    items.push({
      key: "now-idle",
      type: "now",
      label: "Numa Radio · Always On",
      meta: "Lena on the mic",
    });
  }

  if (listeners !== null) {
    items.push({
      key: "listeners",
      type: "soft",
      label: `${listeners.toLocaleString()} listening right now`,
      meta: "Live worldwide",
    });
  }

  items.push(...STATIC_ITEMS);

  // Render the list twice for a seamless CSS marquee loop.
  const doubled = [...items, ...items];

  return (
    <div className="ticker">
      <div className="ticker-track">
        {doubled.map((item, i) => (
          <span
            // Index suffix keeps React keys unique across the doubled copy.
            key={`${item.key}-${i}`}
            className={`ticker-item ${item.type === "now" ? "now" : ""}`}
          >
            <span
              className="bullet"
              style={item.type === "soft" ? { opacity: 0.5 } : undefined}
            />
            {" "}
            {item.label}
            {item.meta ? (
              <>
                {" "}
                <span className="t-meta">{item.meta}</span>
              </>
            ) : null}
          </span>
        ))}
      </div>
    </div>
  );
}
