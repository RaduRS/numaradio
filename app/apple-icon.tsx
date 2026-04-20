import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Proportions from .logo-mark in app/styles/_design-base.css.
const RING = 104;
const BORDER = 7;
const DOT = 38;

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundImage:
            "radial-gradient(circle at 30% 28%, #102826 0%, #0B0C0E 70%)",
        }}
      >
        <div
          style={{
            width: RING,
            height: RING,
            borderRadius: 9999,
            border: `${BORDER}px solid #4FD1C5`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: DOT,
              height: DOT,
              borderRadius: 9999,
              background: "#4FD1C5",
              boxShadow: "0 0 56px rgba(79, 209, 197, 0.6)",
            }}
          />
        </div>
      </div>
    ),
    { ...size }
  );
}
