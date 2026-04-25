import { ImageResponse } from "next/og";

export const contentType = "image/png";
export const size = { width: 180, height: 180 };

/**
 * Apple touch icon — same stacked-rows motif as icon.tsx, scaled for the
 * iOS home-screen with a subtle teal-tinted gradient backdrop so it
 * doesn't look flat on the springboard.
 */
export default function AppleIcon() {
  const ACCENT = "#4fd1c5";
  const BARS = [
    { width: 110, opacity: 1 },
    { width: 86, opacity: 0.75 },
    { width: 110, opacity: 0.55 },
    { width: 64, opacity: 0.4 },
  ];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          backgroundImage: "radial-gradient(circle at 30% 28%, #102826 0%, #0B0C0E 70%)",
        }}
      >
        {BARS.map((b, i) => (
          <div
            key={i}
            style={{
              width: b.width,
              height: 16,
              background: ACCENT,
              opacity: b.opacity,
              borderRadius: 4,
              ...(i === 0 ? { boxShadow: "0 0 24px rgba(79,209,197,0.45)" } : {}),
            }}
          />
        ))}
      </div>
    ),
    { ...size },
  );
}
