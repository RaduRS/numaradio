"use client";

// Last-resort error boundary — fires when even the root layout crashes
// (PlayerProvider, MiniPlayer, ExpandedPlayer all live in layout.tsx,
// so a throw there bubbles here, not to app/error.tsx). Next.js 16
// requires this file to render its own <html><body> because the
// layout has already failed.
//
// Constraints:
//   - Inline styles only — app CSS may not have loaded.
//   - No imports from `_components/` or layout — those depend on the
//     thing that just failed.
//   - The "Back to numaradio.com" link is a plain anchor on purpose:
//     works even if React's hydration/router is dead.

import { useEffect } from "react";

const TEAL = "#4FD1C5";
const RED = "#FF4F57";
const BG = "#0A0D0E";
const FG = "#E6E9EC";
const MUTED = "#9CA3AF";
const SUBTLE = "#6B7280";
const MONO = '"JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, monospace';
const SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[numa-global-error]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          background: BG,
          color: FG,
          fontFamily: SANS,
        }}
      >
        {/* Inline keyframes — everything self-contained because external
            CSS may not have loaded. */}
        <style>{`
          @keyframes numa-pulse {
            0%, 100% { opacity: 0.4; }
            50% { opacity: 1; }
          }
          @media (prefers-reduced-motion: reduce) {
            .numa-pulse { animation: none !important; opacity: 0.7 !important; }
          }
        `}</style>
        {/* Lightweight wordmark header — stands in for the missing Nav so
            users still know they're on Numa Radio, not a generic 500. */}
        <header
          style={{
            padding: "20px 24px",
            borderBottom: `1px solid rgba(230, 233, 236, 0.08)`,
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontFamily: MONO,
            fontSize: 12,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
          }}
        >
          <span
            className="numa-pulse"
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: RED,
              animation: "numa-pulse 1.4s ease-in-out infinite",
            }}
            aria-hidden
          />
          <span style={{ color: FG }}>NUMA · RADIO</span>
          <span style={{ color: SUBTLE, marginLeft: "auto" }}>OFF AIR</span>
        </header>

        <main
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 32,
            textAlign: "center",
          }}
        >
          <div style={{ maxWidth: 480 }}>
            <div
              style={{
                fontFamily: MONO,
                fontSize: 11,
                letterSpacing: "0.25em",
                textTransform: "uppercase",
                color: RED,
                marginBottom: 16,
              }}
            >
              OFF AIR · CRITICAL · ERR 500
            </div>
            <h1
              style={{
                fontSize: 40,
                fontWeight: 700,
                lineHeight: 1.05,
                letterSpacing: "-0.02em",
                margin: "0 0 16px 0",
              }}
            >
              The station went silent
              <br />
              <span style={{ color: TEAL }}>for a moment.</span>
            </h1>
            <p
              style={{
                fontSize: 16,
                lineHeight: 1.5,
                color: MUTED,
                margin: "0 0 32px 0",
              }}
            >
              We lost the signal at the deepest layer. Lena&apos;s still on
              the mic — reload to put us back on the air.
            </p>
            <div
              style={{
                display: "flex",
                gap: 12,
                justifyContent: "center",
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                onClick={() => reset()}
                style={{
                  padding: "12px 24px",
                  borderRadius: 999,
                  border: `1px solid ${TEAL}`,
                  background: TEAL,
                  color: BG,
                  fontFamily: MONO,
                  fontSize: 11,
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Reload
              </button>
              {/* Plain anchor — survives even if hydration is dead. */}
              <a
                href="/"
                style={{
                  padding: "12px 24px",
                  borderRadius: 999,
                  border: `1px solid rgba(230, 233, 236, 0.16)`,
                  background: "transparent",
                  color: FG,
                  fontFamily: MONO,
                  fontSize: 11,
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  fontWeight: 600,
                  textDecoration: "none",
                }}
              >
                Back to numaradio.com
              </a>
            </div>
            {error.digest ? (
              <div
                style={{
                  marginTop: 32,
                  fontFamily: MONO,
                  fontSize: 10,
                  letterSpacing: "0.2em",
                  color: SUBTLE,
                }}
              >
                REF · {error.digest}
              </div>
            ) : null}
          </div>
        </main>
      </body>
    </html>
  );
}
