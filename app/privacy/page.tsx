import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "../_components/Nav";
import { Footer } from "../_components/Footer";

export const metadata: Metadata = {
  title: "Privacy — Numa Radio",
  description:
    "What Numa Radio stores, why, and what it doesn't. One anonymous ID per browser, no tracking, no third parties.",
  alternates: { canonical: "/privacy" },
  openGraph: {
    title: "Privacy — Numa Radio",
    description:
      "What Numa Radio stores, why, and what it doesn't. One anonymous ID per browser, no tracking, no third parties.",
    url: "https://numaradio.com/privacy",
  },
};

export default function PrivacyPage() {
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
            Housekeeping · Privacy
          </div>
          <h1>
            What we<br />
            <span className="accent">store.</span>
          </h1>
          <p className="lead">
            Short version: one anonymous ID in your browser. No accounts, no
            tracking, no ads, no third parties. Here&apos;s the whole list.
          </p>
        </div>
      </section>

      <PrivacyBlock
        eyebrow="01 — What we store on your device"
        title="One random ID. That's it."
      >
        <p>
          When you open the site, your browser saves a single random UUID in
          localStorage under the key{" "}
          <code
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 14,
              color: "var(--fg)",
            }}
          >
            numa.sid
          </code>
          . That&apos;s the only thing. No profile, no history, no preference
          bag.
        </p>
        <p>
          The ID is a string like{" "}
          <code
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 14,
              color: "var(--fg-dim)",
            }}
          >
            c1a4e9f8-...-38a2
          </code>{" "}
          — it has no connection to you as a person. If you clear your
          browser data, the ID is gone and a new one is minted the next time
          you visit.
        </p>
      </PrivacyBlock>

      <PrivacyBlock
        eyebrow="02 — What we do with it"
        title="Two things. Both honest."
      >
        <p>
          <strong style={{ color: "var(--fg)" }}>Counting visitors.</strong>{" "}
          Every 30 seconds, while the tab is visible, your browser pings our
          server with that UUID so the operator dashboard can show a live
          count of how many people have the site open. Because the UUID is
          one-per-browser (not one-per-tab), opening the site in three tabs
          still counts as one person. The server keeps a row per UUID with
          a timestamp; rows older than five minutes are deleted.
        </p>
        <p>
          <strong style={{ color: "var(--fg)" }}>Remembering your votes.</strong>{" "}
          When you thumbs-up or thumbs-down a track, the server records{" "}
          <em>(track, your UUID, up or down)</em>. If you come back later
          and the same track is on, we use that row to show the button you
          already pressed, and to stop the count from double-incrementing if
          you click again.
        </p>
        <p>That&apos;s the full list of things we use your ID for.</p>
      </PrivacyBlock>

      <PrivacyBlock
        eyebrow="03 — What we don't do"
        title="No ads. No accounts. No profiling."
      >
        <ul
          style={{
            paddingLeft: 20,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <li>No accounts. You can&apos;t sign up. There&apos;s nothing to log into.</li>
          <li>No ads. No tracking pixels. No third-party analytics.</li>
          <li>No IP addresses or locations saved beyond standard server access logs, which rotate.</li>
          <li>No selling, sharing, or exporting your ID.</li>
          <li>
            No fingerprinting — we don&apos;t read your canvas, fonts, audio
            context, or anything else the browser lets sites inspect.
          </li>
        </ul>
      </PrivacyBlock>

      <PrivacyBlock
        eyebrow="04 — Your ID, your call"
        title="Clear it whenever you want."
      >
        <p>
          Browser settings → clear site data for numaradio.com, and both the
          UUID in your browser and its related rows on our side (after the
          5-minute presence sweep, and the next time you don&apos;t re-vote
          on a track) stop being associated with you.
        </p>
        <p>
          If you want something specific deleted and you can tell us which
          UUID you used (devtools → Application → Local Storage), email{" "}
          <a
            href="mailto:hello@numaradio.com"
            style={{ color: "var(--accent)", textDecoration: "none" }}
          >
            hello@numaradio.com
          </a>{" "}
          and we&apos;ll wipe it by hand.
        </p>
      </PrivacyBlock>

      <Footer />
    </>
  );
}

function PrivacyBlock({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{ padding: "72px 0", borderTop: "1px solid var(--line)" }}
    >
      <div className="shell">
        <div
          className="about-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1.6fr",
            gap: 64,
            alignItems: "start",
          }}
        >
          <div>
            <div className="eyebrow" style={{ marginBottom: 20 }}>
              {eyebrow}
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
              {title}
            </h2>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 16,
              color: "var(--fg-dim)",
              fontSize: 16,
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
