import { ImageResponse } from "next/og";

export const contentType = "image/png";

type Variant = {
  id: string;
  size: { width: number; height: number };
  alt: string;
  padding: number;
  tileRadius: number;
};

const VARIANTS: Record<string, Variant> = {
  small: {
    id: "small",
    size: { width: 192, height: 192 },
    alt: "Numa Radio",
    padding: 0,
    tileRadius: 42,
  },
  large: {
    id: "large",
    size: { width: 512, height: 512 },
    alt: "Numa Radio",
    padding: 0,
    tileRadius: 112,
  },
  // Maskable icons need a safe zone — OS may crop to any shape.
  maskable: {
    id: "maskable",
    size: { width: 512, height: 512 },
    alt: "Numa Radio",
    padding: 80,
    tileRadius: 0,
  },
};

export function generateImageMetadata() {
  return Object.values(VARIANTS).map((v) => ({
    id: v.id,
    size: v.size,
    alt: v.alt,
    contentType,
  }));
}

export default async function Icon({ id }: { id: Promise<string | number> }) {
  const key = String(await id);
  const v = VARIANTS[key] ?? VARIANTS.small;
  const { width, height } = v.size;
  const inner = Math.min(width, height) - v.padding * 2;
  // Ratios derived from .logo-mark in app/styles/_design-base.css
  // (22px ring, 1.5px border, 8px dot).
  const ring = Math.round(inner * 0.58);
  const border = Math.max(2, Math.round(ring * 0.068));
  const dot = Math.round(ring * 0.36);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#0B0C0E",
          padding: v.padding,
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: v.tileRadius,
            backgroundImage:
              "radial-gradient(circle at 30% 28%, #102826 0%, #0B0C0E 70%)",
          }}
        >
          <div
            style={{
              width: ring,
              height: ring,
              borderRadius: 9999,
              border: `${border}px solid #4FD1C5`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: dot,
                height: dot,
                borderRadius: 9999,
                background: "#4FD1C5",
                boxShadow: `0 0 ${Math.round(dot * 1.5)}px rgba(79, 209, 197, 0.55)`,
              }}
            />
          </div>
        </div>
      </div>
    ),
    { width, height }
  );
}
