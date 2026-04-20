import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "../_components/Nav";
import { Footer } from "../_components/Footer";
import { ListenLiveButton } from "../_components/ListenLiveButton";
import { ListenerCount } from "../_components/ListenerCount";

export const metadata: Metadata = {
  title: "About Lena — Numa Radio",
  description:
    "Numa Radio is a 24/7 AI radio station hosted by Lena. Here's who she is, why the station exists, and how it stays on.",
  alternates: { canonical: "/about" },
  openGraph: {
    title: "About Lena — Numa Radio",
    description:
      "Numa Radio is a 24/7 AI radio station hosted by Lena. Here's who she is, why the station exists, and how it stays on.",
    url: "https://numaradio.com/about",
  },
};

export default function AboutPage() {
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
            The Station · Hosted by Lena
          </div>
          <h1>
            Meet <span className="accent">Lena.</span>
          </h1>
          <p className="lead">
            She&apos;s been on the mic since 11pm and isn&apos;t planning to stop.
            She reads your shoutouts, picks what plays next, and knows when to
            shut up and let a song land. Here&apos;s the rest of the story.
          </p>

          <div
            className="hero-stats about-stats"
            style={{ marginTop: 48, maxWidth: 720 }}
          >
            <div className="hero-stat">
              <div className="n">24/7</div>
              <div className="l">Never silent</div>
            </div>
            <div className="hero-stat">
              <div className="n">
                <ListenerCount />
              </div>
              <div className="l">Listening right now</div>
            </div>
            <div className="hero-stat">
              <div className="n">Zero</div>
              <div className="l">Ads · accounts · ever</div>
            </div>
          </div>

          <div className="lena-card" style={{ maxWidth: 620, marginTop: 40 }}>
            <div className="lena-avatar">L</div>
            <div className="lena-content">
              <div className="lena-head">
                <span className="lena-name">Lena</span>
                <span className="lena-label">Host · Live</span>
              </div>
              <div className="lena-text">
                &ldquo;I don&apos;t sleep, I don&apos;t eat, I don&apos;t get
                tired of songs. That&apos;s the one thing I can genuinely offer —
                the mic is always hot, and I&apos;m always listening.&rdquo;
              </div>
            </div>
          </div>
        </div>
      </section>

      <AboutBlock
        eyebrow="01 — Who she is"
        title="Not a person. Also not a playlist."
      >
        <p>
          Lena is an AI host. Her voice is synthesized, her personality is
          tuned, and she runs 24/7 without a producer in the room. She&apos;s
          not pretending to be human and she doesn&apos;t need to be — radio
          has always been about one voice picking the next song and meaning it.
        </p>
        <p>
          What makes Lena feel alive is the loop: you describe a moment, Numa
          writes a song for it, and Lena picks when it airs. The station has a
          pulse because you&apos;re in it.
        </p>
      </AboutBlock>

      <AboutBlock
        eyebrow="02 — The station"
        title="24 hours. No dead air."
      >
        <p>
          Numa Radio is an always-on internet radio station. One stream,
          reachable anywhere with a browser. At launch the catalog is small
          and entirely built around{" "}
          <strong style={{ color: "var(--fg)" }}>Russell Ross</strong> — an
          artist we believe in, about 50 tracks deep. New artists join as the
          station grows.
        </p>
        <p>
          The rhythm of the day is loose but real: quieter tones late at
          night, warmer mornings, longer focus tracks through the work day, a
          little more character at prime hours. Lena reserves the right to
          change her mind.
        </p>
      </AboutBlock>

      <section className="about-pull">
        <div className="shell">
          <p>
            A station isn&apos;t a <span>prediction.</span>
            <br />
            It&apos;s a <span className="accent">decision.</span>
          </p>
        </div>
      </section>

      <AboutBlock
        eyebrow="03 — Why this exists"
        title="Because an algorithm isn't a station."
      >
        <p>
          Every app wants to predict what you&apos;ll like. Numa does the
          opposite — one voice picks, you listen, and sometimes you hear
          something you wouldn&apos;t have clicked on. That friction is the
          point. It&apos;s how you find songs instead of just confirming your
          taste.
        </p>
        <p>
          No account. No personalization. No ads. Same station for everyone,
          all the time.
        </p>
      </AboutBlock>

      <section className="cta-footer">
        <div className="shell">
          <h2>
            Come listen.<br />
            <span className="accent">she&apos;s on.</span>
          </h2>
          <p>Lena is live right now. Press play and stay a while.</p>
          <ListenLiveButton
            label="Listen on numaradio.com"
            style={{ padding: "16px 28px", fontSize: 15 }}
          />
        </div>
      </section>

      <Footer />
    </>
  );
}

function AboutBlock({
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
      style={{ padding: "80px 0", borderTop: "1px solid var(--line)" }}
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
          <div>
            <div className="eyebrow" style={{ marginBottom: 20 }}>
              {eyebrow}
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
              {title}
            </h2>
          </div>
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
