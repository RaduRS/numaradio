import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "./_components/Nav";
import { Footer } from "./_components/Footer";

export const metadata: Metadata = {
  title: "Off the dial — Numa Radio",
  description: "This URL isn't on the air. Tune back to the stream.",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <>
      <Nav />
      <main className="error-hero">
        <div className="shell error-shell">
          {/* Tuner dial — needle drifts between marks. Pure CSS, no JS.
              Visual metaphor: this URL isn't on any frequency. */}
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

          <div className="eyebrow">OFF THE DIAL · ERR 404</div>
          <h1 className="error-headline">
            Between<br />
            <span className="accent">frequencies.</span>
          </h1>
          <p className="lead">
            This URL isn&apos;t broadcasting. Either it never aired, or someone
            retuned the dial. Lena&apos;s still on — the stream hasn&apos;t moved.
          </p>

          <div className="error-actions">
            <Link href="/" className="error-cta error-cta--primary">
              Back to the stream
            </Link>
            <Link href="/about" className="error-cta">
              Meet Lena
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
