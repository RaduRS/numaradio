import type { Metadata } from "next";
import Link from "next/link";
import { PlayerProvider } from "../_components/PlayerProvider";
import { Nav } from "../_components/Nav";
import { Footer } from "../_components/Footer";

const SUBMIT_EMAIL = "submit@numaradio.com";

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

export default function SubmitPage() {
  return (
    <PlayerProvider>
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
            who listened to the whole thing. If that sounds like a good home
            for what you make, here&apos;s how to get it in front of us.
          </p>
        </div>
      </section>

      <SubmitBlock eyebrow="01 — Send a file">
        <p>
          Email a high-quality audio file to{" "}
          <a
            href={`mailto:${SUBMIT_EMAIL}`}
            style={{ color: "var(--accent)", textDecoration: "none" }}
          >
            {SUBMIT_EMAIL}
          </a>
          . WAV or 320kbps MP3, please — not a link to Spotify, SoundCloud,
          Suno, or a streaming page. We don&apos;t auto-ingest from any
          platform because we can&apos;t verify rights from a public URL.
        </p>
        <p>
          If the file is too big for email, share a Dropbox / Drive /
          WeTransfer link that lets us download the original.
        </p>
      </SubmitBlock>

      <SubmitBlock eyebrow="02 — Tell us what it is">
        <p>In the email body, keep it short. We want:</p>
        <ul style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 10 }}>
          <li>
            <strong style={{ color: "var(--fg)" }}>Your name</strong> and how
            you&apos;d like to be credited on air.
          </li>
          <li>
            <strong style={{ color: "var(--fg)" }}>Track title</strong> and,
            if part of a release, the album / EP name and year.
          </li>
          <li>
            <strong style={{ color: "var(--fg)" }}>One line</strong> about
            what kind of moment the track is for — late night, morning
            focus, long drive, heartbreak. This helps Lena slot it.
          </li>
          <li>
            A confirmation that you own or control the rights to the
            recording and the composition.
          </li>
        </ul>
      </SubmitBlock>

      <SubmitBlock eyebrow="03 — What happens next">
        <p>
          We listen to everything. It may take a couple of weeks. If it fits
          the station, we add it to the catalog and Lena will start mixing it
          in. If it doesn&apos;t, we&apos;ll usually still reply so you
          aren&apos;t left guessing.
        </p>
        <p>
          We&apos;re small on purpose. Numa Radio launched with about 50
          tracks from one artist — we&apos;ll grow it carefully. That&apos;s
          the whole point.
        </p>
      </SubmitBlock>

      <SubmitBlock eyebrow="04 — What we don't take">
        <p>
          No auto-generated tracks from a public AI music service unless you
          can prove clear, commercial-use rights to the specific generation.
          No tracks with uncleared samples. No content that can&apos;t be
          broadcast 24/7 on an open stream.
        </p>
        <p>
          If any of that rules you out, we&apos;re not the right home. No
          hard feelings.
        </p>
      </SubmitBlock>

      <section className="cta-footer">
        <div className="shell">
          <h2>
            Ready?<br />
            <span className="accent">send it.</span>
          </h2>
          <p>One email. One track per submission, please.</p>
          <a
            href={`mailto:${SUBMIT_EMAIL}`}
            className="btn btn-primary"
            style={{ padding: "16px 28px", fontSize: 15 }}
          >
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              style={{ width: 14, height: 14 }}
            >
              <path d="M2 10l16-7-4 17-4-7-8-3z" />
            </svg>
            Email {SUBMIT_EMAIL}
          </a>
        </div>
      </section>

      <Footer />
    </PlayerProvider>
  );
}

function SubmitBlock({
  eyebrow,
  children,
}: {
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{ padding: "72px 0", borderTop: "1px solid var(--line)" }}
    >
      <div className="shell">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1.6fr",
            gap: 64,
            alignItems: "start",
          }}
          className="about-grid"
        >
          <div className="eyebrow">{eyebrow}</div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 18,
              color: "var(--fg-dim)",
              fontSize: 17,
              lineHeight: 1.55,
              maxWidth: 620,
            }}
          >
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}
