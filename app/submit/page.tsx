import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "../_components/Nav";
import { Footer } from "../_components/Footer";
import { SubmitForm } from "../_components/SubmitForm";

const SUBMIT_EMAIL = "hello@numaradio.com";

export const metadata: Metadata = {
  title: "Submit Music — Numa Radio",
  description:
    "Send your music for Lena to consider. We hand-pick every track — no algorithm, no auto-ingest, no random streaming links.",
  alternates: { canonical: "/submit" },
  openGraph: {
    title: "Submit Music — Numa Radio",
    description:
      "Send your music for Lena to consider. We hand-pick every track — no algorithm, no auto-ingest, no random streaming links.",
    url: "https://numaradio.com/submit",
  },
};

const CHECKLIST = [
  {
    title: "An MP3 file",
    body: "Up to 10 MB. Upload directly through the form below — no streaming links.",
  },
  {
    title: "Your name and track title",
    body: "How you'd like to be credited on air, plus album / EP and year if it's part of a release.",
  },
  {
    title: "One line about the moment",
    body: "Late-night, morning focus, long drive, heartbreak — whatever the track is for. Helps Lena slot it.",
  },
  {
    title: "Rights confirmation",
    body: "You own or control the recording and the composition, and it's clear to broadcast.",
  },
];

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2.5}>
      <path d="M4 10l4 4 8-8" />
    </svg>
  );
}

export default function SubmitPage() {
  return (
    <>
      <Nav />

      <section className="install-hero">
        <div className="shell">
          <Link className="back" href="/">
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              style={{ width: 12, height: 12 }}
            >
              <path d="M13 4l-6 6 6 6" />
            </svg>
            Back to Numa Radio
          </Link>
          <div className="eyebrow" style={{ marginBottom: 24 }}>
            For Artists · Submissions
          </div>
          <h1>
            Send Lena<br />your <span className="accent">tracks.</span>
          </h1>
          <p className="lead">
            Numa is hand-curated. Every song that airs was picked by someone
            who listened to the whole thing. One email, one track per
            submission — we read everything.
          </p>
          <p
            style={{
              marginTop: -24,
              marginBottom: 32,
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--fg-mute)",
            }}
          >
            For artists only · Listeners requesting a song →{" "}
            <Link
              href="/#requests"
              style={{ color: "var(--accent)", textDecoration: "none" }}
            >
              use the request form
            </Link>
          </p>
          <SubmitForm />
          <p
            style={{
              marginTop: 18,
              fontSize: 13,
              color: "var(--fg-mute)",
              maxWidth: 620,
            }}
          >
            Or email{" "}
            <a href={`mailto:${SUBMIT_EMAIL}`} style={{ color: "var(--accent)" }}>
              {SUBMIT_EMAIL}
            </a>{" "}
            if you&apos;d rather not use the form.
          </p>
        </div>
      </section>

      {/* 01 — What we need (checklist) */}
      <section
        style={{ padding: "80px 0", borderTop: "1px solid var(--line)" }}
      >
        <div className="shell">
          <div className="about-grid" style={{
            display: "grid",
            gridTemplateColumns: "1fr 1.6fr",
            gap: 64,
            alignItems: "start",
          }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 20 }}>
                01 — What we need
              </div>
              <h2
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 800,
                  fontStretch: "125%",
                  fontSize: "clamp(32px, 4vw, 52px)",
                  lineHeight: 0.95,
                  letterSpacing: "-0.02em",
                  textTransform: "uppercase",
                }}
              >
                The bare minimum.<br />Nothing fancy.
              </h2>
            </div>
            <div className="why-list" style={{ maxWidth: 620 }}>
              {CHECKLIST.map((c) => (
                <div key={c.title} className="why-item">
                  <div className="check">
                    <CheckIcon />
                  </div>
                  <div>
                    <h4>{c.title}</h4>
                    <p>{c.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 02 — What happens next (timeline) */}
      <section
        style={{ padding: "72px 0", borderTop: "1px solid var(--line)" }}
      >
        <div className="shell">
          <div className="eyebrow" style={{ marginBottom: 20 }}>
            02 — What happens next
          </div>
          <h2
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 800,
              fontStretch: "125%",
              fontSize: "clamp(28px, 3.4vw, 44px)",
              lineHeight: 0.95,
              letterSpacing: "-0.02em",
              textTransform: "uppercase",
              marginBottom: 32,
            }}
          >
            Three steps.<br />One reply.
          </h2>

          <div className="submit-timeline">
            <div className="submit-step">
              <span className="step-tag">Step 01</span>
              <span className="step-label">You send</span>
              <span className="step-note">Form + file</span>
            </div>
            <div className="submit-arrow">→</div>
            <div className="submit-step">
              <span className="step-tag">Step 02</span>
              <span className="step-label">We listen</span>
              <span className="step-note">~1 – 2 weeks</span>
            </div>
            <div className="submit-arrow">→</div>
            <div className="submit-step">
              <span className="step-tag">Step 03</span>
              <span className="step-label">We reply</span>
              <span className="step-note">Yes, no, or why</span>
            </div>
          </div>

          <p
            style={{
              marginTop: 28,
              color: "var(--fg-dim)",
              fontSize: 15,
              lineHeight: 1.55,
              maxWidth: 620,
            }}
          >
            We&apos;re small on purpose. Numa launched around one artist
            — we&apos;ll grow it carefully. That&apos;s the whole point.
          </p>
        </div>
      </section>

      {/* 03 — What we don't take */}
      <section
        style={{ padding: "72px 0", borderTop: "1px solid var(--line)" }}
      >
        <div className="shell">
          <div className="about-grid" style={{
            display: "grid",
            gridTemplateColumns: "1fr 1.6fr",
            gap: 64,
            alignItems: "start",
          }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 20 }}>
                03 — What we don&apos;t take
              </div>
              <h2
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 800,
                  fontStretch: "125%",
                  fontSize: "clamp(28px, 3.4vw, 44px)",
                  lineHeight: 0.95,
                  letterSpacing: "-0.02em",
                  textTransform: "uppercase",
                }}
              >
                A short list.<br />We stick to it.
              </h2>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 14,
                color: "var(--fg-dim)",
                fontSize: 15,
                lineHeight: 1.55,
                maxWidth: 620,
                padding: "22px 24px",
                border: "1px dashed var(--line-strong)",
                borderRadius: 12,
                background: "rgba(255,77,77,0.03)",
              }}
            >
              <p>
                No auto-generated tracks from a public AI music service
                unless you can prove clear, commercial-use rights to the
                specific generation.
              </p>
              <p>No tracks with uncleared samples.</p>
              <p>
                No content that can&apos;t be broadcast 24/7 on an open
                stream <strong>or simulcast on YouTube Live</strong>.
                If a label, distributor, or rights deal restricts YouTube
                distribution for the track, this isn&apos;t the right home.
              </p>
              <p style={{ color: "var(--fg-mute)", fontSize: 13 }}>
                If any of that rules you out, we&apos;re not the right home.
                No hard feelings.
              </p>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
