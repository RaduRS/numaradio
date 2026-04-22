"use client";

import { useNowPlaying } from "./useNowPlaying";

type Item = {
  key: string;
  type: "now" | "soft";
  label: string;
  meta?: string;
};

const STATIC_ITEMS: Item[] = [
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

export function Marquee() {
  const np = useNowPlaying();

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
