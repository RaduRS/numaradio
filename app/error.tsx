"use client";

// Runtime error boundary. Renders when a page below this segment throws
// during render (server or client). Wraps the page; layout stays mounted.
// Numa pages render their own Nav/Footer (not in layout.tsx), so we
// re-render them here for visual consistency.
//
// Next.js 16 file convention — must be a client component, receives
// {error, reset}.

import { useEffect } from "react";
import Link from "next/link";
import { Nav } from "./_components/Nav";
import { Footer } from "./_components/Footer";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the underlying error to the browser console + Vercel logs.
    // The `digest` is what server-thrown errors get; `message` is for
    // client-thrown ones. Both live for the operator's debugging only —
    // listeners never see the raw error string.
    console.error("[numa-error]", error);
  }, [error]);

  return (
    <>
      <Nav />
      <main className="error-hero error-hero--500">
        <div className="shell error-shell">
          {/* Same dial motif as the 404 page, but in --red-live and with
              a stuttering animation — the needle jitters as if the
              transmission is briefly losing signal. */}
          <div className="error-tuner" aria-hidden>
            <span className="error-tuner-edge" />
            <span className="error-tuner-tick" />
            <span className="error-tuner-tick" />
            <span className="error-tuner-tick error-tuner-tick--strong" />
            <span className="error-tuner-needle" />
            <span className="error-tuner-tick error-tuner-tick--strong" />
            <span className="error-tuner-tick" />
            <span className="error-tuner-tick" />
            <span className="error-tuner-edge" />
          </div>

          <div className="eyebrow">STATIC · STAND BY · ERR 500</div>
          <h1 className="error-headline">
            Signal<br />
            <span className="accent">interrupted.</span>
          </h1>
          <p className="lead">
            Something hiccuped between the booth and your speakers. Lena&apos;s
            still on the mic — try the page again, or head back to the stream.
          </p>

          <div className="error-actions">
            <button
              type="button"
              className="error-cta error-cta--primary"
              onClick={() => reset()}
            >
              Try again
            </button>
            <Link href="/" className="error-cta">
              Back to the stream
            </Link>
          </div>

          {error.digest ? (
            <div className="error-digest" aria-label="Error reference">
              REF · {error.digest}
            </div>
          ) : null}
        </div>
      </main>
      <Footer />
    </>
  );
}
