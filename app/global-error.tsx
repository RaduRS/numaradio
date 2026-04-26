"use client";

// Last-resort error boundary — fires when even the root layout crashes
// (rare, but Next.js requires its own <html><body> because layout has
// already failed by the time this renders). Inline styles only so it
// works even if app CSS didn't load.
//
// Next.js 16 file convention.

import { useEffect } from "react";

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
          alignItems: "center",
          justifyContent: "center",
          background: "#0A0D0E",
          color: "#E6E9EC",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          padding: "32px",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: 480 }}>
          <div
            style={{
              fontFamily: '"JetBrains Mono", ui-monospace, monospace',
              fontSize: 11,
              letterSpacing: "0.25em",
              textTransform: "uppercase",
              color: "#FF4F57",
              marginBottom: 16,
            }}
          >
            OFF AIR · CRITICAL
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
            The station went silent for a moment.
          </h1>
          <p
            style={{
              fontSize: 16,
              lineHeight: 1.5,
              color: "#9CA3AF",
              margin: "0 0 32px 0",
            }}
          >
            We lost the signal at the deepest layer. Reload to put us back on
            the air.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: "12px 24px",
              borderRadius: 999,
              border: "1px solid #4FD1C5",
              background: "#4FD1C5",
              color: "#0A0D0E",
              fontFamily: '"JetBrains Mono", ui-monospace, monospace',
              fontSize: 11,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
          {error.digest ? (
            <div
              style={{
                marginTop: 32,
                fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                fontSize: 10,
                letterSpacing: "0.2em",
                color: "#6B7280",
              }}
            >
              REF · {error.digest}
            </div>
          ) : null}
        </div>
      </body>
    </html>
  );
}
