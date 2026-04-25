import { ImageResponse } from "next/og";

export const contentType = "image/png";
export const size = { width: 64, height: 64 };

/**
 * Operator dashboard favicon — stacked horizontal rows in the Numa Radio
 * teal, evoking the queue/library views. Distinct from the public-site
 * icon (teal ring + dot) and the Suno-studio icon (gold EQ bars) so
 * all three Numa tabs are identifiable at a glance.
 */
export default function Icon() {
  const ACCENT = "#4fd1c5";
  const BG = "#0b0c0e";
  // Four bars at descending opacity — a "queue" silhouette
  const BARS = [
    { width: 38, opacity: 1 },
    { width: 30, opacity: 0.75 },
    { width: 38, opacity: 0.55 },
    { width: 22, opacity: 0.4 },
  ];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: BG,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 5,
        }}
      >
        {BARS.map((b, i) => (
          <div
            key={i}
            style={{
              width: b.width,
              height: 6,
              background: ACCENT,
              opacity: b.opacity,
              borderRadius: 1.5,
            }}
          />
        ))}
      </div>
    ),
    { ...size },
  );
}
