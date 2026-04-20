import { ImageResponse } from "next/og";

export const alt = "Numa Radio — Always On";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "#0B0C0E",
          backgroundImage:
            "radial-gradient(circle at 18% 22%, #123331 0%, #0B0C0E 65%)",
          color: "#E8EAED",
          fontFamily:
            "system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 9999,
              border: "2.5px solid #4FD1C5",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: 16,
                height: 16,
                borderRadius: 9999,
                background: "#4FD1C5",
                boxShadow: "0 0 18px rgba(79, 209, 197, 0.6)",
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 22,
              fontWeight: 800,
              letterSpacing: "0.02em",
              textTransform: "uppercase",
            }}
          >
            <span>Numa</span>
            <span style={{ color: "#4FD1C5" }}>·</span>
            <span>Radio</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div
            style={{
              display: "flex",
              fontSize: 28,
              color: "#4FD1C5",
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              fontFamily: "monospace",
            }}
          >
            ● On Air · 24 / 7 / Forever
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: 112,
              fontWeight: 900,
              lineHeight: 0.92,
              letterSpacing: "-0.035em",
              textTransform: "uppercase",
            }}
          >
            <div style={{ display: "flex" }}>The station that</div>
            <div style={{ display: "flex", gap: 24 }}>
              <span style={{ color: "#4FD1C5", fontStyle: "italic" }}>
                never
              </span>
              <span>sleeps.</span>
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            fontSize: 22,
            color: "#9AA0A6",
          }}
        >
          <div style={{ display: "flex", maxWidth: 820 }}>
            Always-on AI radio — fresh tracks, live energy, listener requests.
            Hosted by Lena.
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: "monospace",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              fontSize: 18,
              color: "#E8EAED",
            }}
          >
            numaradio.com
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
