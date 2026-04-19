// TODO Phase 4: pull these from /api/station/now-playing + /api/station/recent
const ITEMS = [
  { type: "now", label: "Now · Slow Fade, Brighter", meta: "Russell Ross" },
  { type: "soft", label: "Up Next · Tunnel 61", meta: "Russell Ross" },
  { type: "soft", label: "Then · Daylight Saving", meta: "Russell Ross" },
  { type: "soft", label: "Request from Lisbon", meta: "· queued" },
  {
    type: "soft",
    label: "Shoutout · Mika from Osaka",
    meta: "\u201chappy birthday lena\u201d",
  },
  { type: "soft", label: "Just Played · Copperline", meta: "Russell Ross" },
];

export function Marquee() {
  // Render the list twice for a seamless loop
  const doubled = [...ITEMS, ...ITEMS];
  return (
    <div className="ticker">
      <div className="ticker-track">
        {doubled.map((item, i) => (
          <span key={i} className={`ticker-item ${item.type === "now" ? "now" : ""}`}>
            <span
              className="bullet"
              style={item.type === "soft" ? { opacity: 0.5 } : undefined}
            />
            {" "}
            {item.label}{" "}
            <span className="t-meta">{item.meta}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
