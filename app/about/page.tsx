import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "../_components/Nav";
import { Footer } from "../_components/Footer";
import { ListenLiveButton } from "../_components/ListenLiveButton";
import { ListenerCount } from "../_components/ListenerCount";
import { LenaLine } from "../_components/LenaLine";
import { SHOW_SCHEDULE } from "@/lib/schedule";

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

const WHO_CHECKLIST = [
  {
    title: "Synthesized voice, tuned personality",
    body: "Lena is an AI host. She doesn't pretend to be human — radio has always been about one voice picking the next song and meaning it.",
  },
  {
    title: "24/7 with no producer in the room",
    body: "She runs around the clock, picks what plays next, reads your shoutouts, and knows when to let a song land.",
  },
  {
    title: "The loop: you describe → Numa writes → Lena picks",
    body: "Describe a moment, our system writes a song for it, and Lena slots it into the rotation. The station has a pulse because you're in it.",
  },
  {
    title: "Russell Ross at the core",
    body: "We launched around one artist we believe in. New artists join carefully as the station grows.",
  },
];

const DONT_LIST = [
  "No accounts. Open the URL, press play.",
  "No personalization. Same station for everyone, all the time.",
  "No ads. Ever.",
  "No tracking that follows you off the page.",
];

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2.5}>
      <path d="M4 10l4 4 8-8" />
    </svg>
  );
}

const SECTION_PAD = "80px 0";
const SECTION_BORDER = "1px solid var(--line)";
const TITLE_STYLE: React.CSSProperties = {
  fontFamily: "var(--font-display)",
  fontWeight: 800,
  fontStretch: "125%",
  fontSize: "clamp(32px, 4vw, 52px)",
  lineHeight: 0.95,
  letterSpacing: "-0.02em",
  textTransform: "uppercase",
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

          {/* Live Lena quote with the canonical portrait at feature size. */}
          <LenaLine className="lena-card--feature" avatarSize={240} />
        </div>
      </section>

      {/* 01 — Who she is — title-left + checklist-right (matches /submit) */}
      <section style={{ padding: SECTION_PAD, borderTop: SECTION_BORDER }}>
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
                01 — Who she is
              </div>
              <h2 style={TITLE_STYLE}>Not a person.<br />Also not a playlist.</h2>
            </div>
            <div className="why-list" style={{ maxWidth: 620 }}>
              {WHO_CHECKLIST.map((c) => (
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

      {/* 02 — The station — full-width 4-show grid (anchors abstract
          "rhythm of the day" with concrete shows from lib/schedule). */}
      <section style={{ padding: SECTION_PAD, borderTop: SECTION_BORDER }}>
        <div className="shell">
          <div className="eyebrow" style={{ marginBottom: 20 }}>
            02 — The station
          </div>
          <h2 style={{ ...TITLE_STYLE, marginBottom: 16 }}>
            24 hours.<br />No dead air.
          </h2>
          <p
            style={{
              color: "var(--fg-dim)",
              fontSize: 17,
              lineHeight: 1.55,
              maxWidth: 760,
              marginBottom: 28,
            }}
          >
            One always-on stream. The rhythm of the day is loose but real —
            Lena reserves the right to change her mind.
          </p>
          <div className="about-shows">
            {SHOW_SCHEDULE.map((s) => (
              <div key={s.name} className="about-show-card">
                <span className="show-time">{s.timeLabel}</span>
                <span className="show-name">{s.name}</span>
                <span className="show-blurb">{s.description}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="about-pull">
        <div className="shell">
          <p>
            A station isn&apos;t a <span>prediction.</span>
            <br />
            It&apos;s a <span className="accent">decision.</span>
          </p>
        </div>
      </section>

      {/* 03 — Why this exists — title-left + dashed-red "no" list right
          (matches /submit's "Short list we stick to" chrome). */}
      <section style={{ padding: SECTION_PAD, borderTop: SECTION_BORDER }}>
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
                03 — Why this exists
              </div>
              <h2 style={TITLE_STYLE}>
                Because an algorithm<br />isn&apos;t a station.
              </h2>
              <p
                style={{
                  marginTop: 18,
                  color: "var(--fg-dim)",
                  fontSize: 15,
                  lineHeight: 1.55,
                  maxWidth: 420,
                }}
              >
                Every app wants to predict what you&apos;ll like. Numa does the
                opposite — one voice picks, you listen, and sometimes you hear
                something you wouldn&apos;t have clicked on. That friction is
                the point.
              </p>
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
              {DONT_LIST.map((line) => (
                <p key={line} style={{ margin: 0 }}>
                  {line}
                </p>
              ))}
              <p style={{ margin: 0, color: "var(--fg-mute)", fontSize: 13 }}>
                Same station for everyone, all the time. That&apos;s the whole
                deal.
              </p>
            </div>
          </div>
        </div>
      </section>

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
