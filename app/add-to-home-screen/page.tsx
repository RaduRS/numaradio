"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Nav } from "../_components/Nav";
import { Footer } from "../_components/Footer";
import { ListenLiveButton } from "../_components/ListenLiveButton";

type Platform = "ios" | "android" | "desktop";

// Static placeholder used by every phone mockup on this page. One real track
// is enough — the marketing copy isn't trying to track what's currently
// airing, just to show what the app looks like once installed.
const MOCK_TITLE = "Ocean Eyes";
const MOCK_ARTIST = "Russell Ross";
const MOCK_ARTWORK =
  "https://f003.backblazeb2.com/file/numaradio/stations/numaradio/tracks/cmo8jf20n0007wemtlhrsp6rt/artwork/primary.jpg";

function NumaTile({ size }: { size: number }) {
  return (
    <Image
      src="/logo-mark.png"
      alt="Numa Radio"
      width={size}
      height={size}
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />
  );
}

const WHY = [
  {
    title: "Launches full-bleed",
    body: "No browser chrome, no URL bar. Just Numa.",
  },
  {
    title: "Lock-screen playback",
    body: "Track metadata and controls on your lock screen, same as Apple Music or Spotify.",
  },
  {
    title: "Keeps playing in background",
    body: "Switch apps, lock your phone, take a call. Audio doesn't stop.",
  },
  {
    title: "Instant updates",
    body: "No app store review queue. New features land the moment we ship them.",
  },
];

const STEPS: Record<Platform, { title: string; body: React.ReactNode }[]> = {
  ios: [
    {
      title: "Open numaradio.com",
      body: "In Safari on iOS 16.4 or later, Chrome, Edge, Firefox, and Orion all work too.",
    },
    {
      title: "Tap Share",
      body: "Square with the up-arrow — bottom of the screen on iPhone, top-right on iPad.",
    },
    {
      title: "Add to Home Screen",
      body: (
        <>
          Scroll down in the share sheet, tap it, then{" "}
          <strong style={{ color: "var(--fg)" }}>Add</strong>.
        </>
      ),
    },
    {
      title: "Launch",
      body: "Numa opens full-bleed with lock-screen playback controls.",
    },
  ],
  android: [
    {
      title: "Open numaradio.com",
      body: "Chrome, Samsung Internet, Edge, Firefox, Opera — all support installing.",
    },
    {
      title: "Look for the install banner",
      body: (
        <>
          Or open the three-dot menu and pick{" "}
          <strong style={{ color: "var(--fg)" }}>Install app</strong>.
        </>
      ),
    },
    {
      title: "Confirm",
      body: (
        <>
          Tap <strong style={{ color: "var(--fg)" }}>Install</strong> in the
          prompt that appears.
        </>
      ),
    },
    {
      title: "Launch from your drawer",
      body: "Numa appears with its icon in your app drawer, indistinguishable from native.",
    },
  ],
  desktop: [
    {
      title: "Open numaradio.com",
      body: "Chrome, Edge, Brave, and Arc on Windows / macOS / Linux. Safari 17+ on macOS works too.",
    },
    {
      title: "Click the install icon",
      body: (
        <>
          Small monitor-with-arrow icon on the right of the address bar. In
          Safari it&apos;s <em>File → Add to Dock</em>.
        </>
      ),
    },
    {
      title: "Click Install",
      body: "Numa opens in its own window, lands in Applications / Start menu.",
    },
    {
      title: "Pin it to your dock",
      body: "Clean window, no tabs or URL bar. Background audio works just like Apple Music.",
    },
  ],
};

const FAQS = [
  {
    q: "Is this a real app?",
    a: "Functionally, yes. It's a Progressive Web App, which means it installs from the browser instead of an app store but behaves like any native audio app — lock-screen controls, background playback, home-screen icon, all of it.",
  },
  {
    q: "Why no App Store version?",
    a: "We'd rather ship updates the day we write them than wait for a review queue. The web gets us there faster, and you get new features sooner.",
  },
  {
    q: "Does it use data when the screen is off?",
    a: "Only while you're actively listening — same as Spotify. Around 60MB per hour at our default 192kbps stream. Lock the phone, keep listening.",
  },
  {
    q: "Can I uninstall it?",
    a: "Same way as any app — long-press and remove. Nothing is stored locally beyond a tiny bit of player state.",
  },
  {
    q: "Do I need to sign up?",
    a: "No. Open it, hit play. Requests and shoutouts work without an account too.",
  },
  {
    q: "What if Add to Home Screen isn't showing?",
    a: "Open the page in your real browser — not in-app browsers like Instagram or X, where the option is hidden.",
  },
];

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2.5}>
      <path d="M4 10l4 4 8-8" />
    </svg>
  );
}

function IosLogo() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}

function AndroidLogo() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 18c0 .55.45 1 1 1h1v3.5a1.5 1.5 0 003 0V19h2v3.5a1.5 1.5 0 003 0V19h1c.55 0 1-.45 1-1V8H6v10zM3.5 8a1.5 1.5 0 00-1.5 1.5v7a1.5 1.5 0 003 0v-7c0-.83-.67-1.5-1.5-1.5zm17 0a1.5 1.5 0 00-1.5 1.5v7a1.5 1.5 0 003 0v-7c0-.83-.67-1.5-1.5-1.5zm-4.97-5.84l1.3-1.3a.5.5 0 00-.7-.7l-1.48 1.48A6 6 0 0012 1a6 6 0 00-2.65.62L7.87.14a.5.5 0 00-.7.7l1.3 1.3A5.99 5.99 0 006 7h12a6 6 0 00-2.47-4.84zM10 5H9V4h1v1zm5 0h-1V4h1v1z" />
    </svg>
  );
}

function DesktopLogo() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <rect x="2.5" y="4" width="19" height="13" rx="1.5" />
      <path d="M7 21h10M12 17v4" />
    </svg>
  );
}

function AppPreview() {
  return (
    <div className="app-preview show">
      <div className="app-header" style={{ marginTop: 24 }}>
        <div className="app-logo">
          Numa<span className="accent">·</span>Radio
        </div>
        <div className="app-live">On Air</div>
      </div>
      <div
        className="app-art"
        style={{
          background: `url(${MOCK_ARTWORK}) center/cover`,
          color: "transparent",
        }}
      >
        <div className="art-meta">
          <div className="track-num">Track · 04</div>
          <div className="eq" style={{ height: 10 }}>
            <span /><span /><span /><span /><span />
          </div>
        </div>
      </div>
      <div className="app-track">
        <div className="tt">{MOCK_TITLE}</div>
        <div className="ta">{MOCK_ARTIST}</div>
      </div>
      <div className="app-progress">
        <div className="fill" />
      </div>
      <div className="app-controls">
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          style={{ width: 14, height: 14, opacity: 0.6 }}
        >
          <path d="M6 4v12L2 10zM18 4v12l-8-6z" />
        </svg>
        <div className="app-play">
          <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 14, height: 14 }}>
            <path d="M4 3v14l12-7z" />
          </svg>
        </div>
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          style={{ width: 14, height: 14, opacity: 0.6 }}
        >
          <path d="M14 4v12l4-6zM2 4v12l8-6z" />
        </svg>
      </div>
    </div>
  );
}

function IosPhone({ step }: { step: number }) {
  const showShareSheet = step === 2 || step === 3;
  const showHome = step === 4;
  return (
    <div className="phone-frame">
      <div className="phone-frame-notch" />
      <div className="phone-inner">
        <div className="phone-stat">
          <span>2:47</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <svg viewBox="0 0 14 10" fill="currentColor" style={{ width: 13, height: 9 }}>
              <path d="M0 8h2v2H0zM3 6h2v4H3zM6 4h2v6H6zM9 2h2v8H9zM12 0h2v10h-2z" />
            </svg>
            <svg viewBox="0 0 24 10" fill="none" stroke="currentColor" strokeWidth="1" style={{ width: 18, height: 9 }}>
              <rect x="1" y="1" width="19" height="8" rx="1.5" />
              <rect x="2.5" y="2.5" width="14" height="5" rx="0.5" fill="currentColor" />
              <path d="M21 4v2h1V4z" fill="currentColor" />
            </svg>
          </span>
        </div>

        {step === 1 && (
          <div className="browser-chrome" style={{ top: 40 }}>
            <div className="dot-row">
              <span /><span /><span />
            </div>
            <div className="url">
              <span className="lock">●</span>numaradio.com
            </div>
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.3}
              style={{ width: 12, height: 12, color: "var(--fg-dim)", flexShrink: 0 }}
            >
              <path d="M10 3v10m0 0l-4-4m4 4l4-4M4 17h12" />
            </svg>
          </div>
        )}

        {!showHome && <AppPreview />}

        <div className={`share-sheet${showShareSheet ? " show" : ""}`}>
          <div style={{ fontSize: 11, fontWeight: 500, marginBottom: 10 }}>
            numaradio.com
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                background: "rgba(255,255,255,0.06)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                style={{ width: 18, height: 18, color: "var(--fg-dim)" }}
              >
                <path d="M10 4l6 6h-4v5H8v-5H4z" />
              </svg>
            </div>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                background: "rgba(255,255,255,0.06)",
              }}
            />
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                background: "rgba(255,255,255,0.06)",
              }}
            />
          </div>
          <div className="share-row">
            <span>Copy</span>
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              style={{ width: 14, height: 14, opacity: 0.6 }}
            >
              <rect x="5" y="5" width="12" height="12" rx="1" />
              <path d="M3 13V5a2 2 0 012-2h8" />
            </svg>
          </div>
          <div className="share-row">
            <span>Add to Reading List</span>
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              style={{ width: 14, height: 14, opacity: 0.6 }}
            >
              <rect x="5" y="5" width="12" height="12" rx="1" />
            </svg>
          </div>
          <div className="share-row highlight">
            <span>Add to Home Screen</span>
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              style={{ width: 14, height: 14 }}
            >
              <rect x="4" y="4" width="12" height="12" rx="2" />
              <path d="M10 6v8M6 10h8" />
            </svg>
          </div>
          <div className="share-row">
            <span>Markup</span>
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              style={{ width: 14, height: 14, opacity: 0.6 }}
            >
              <path d="M4 16L14 6l2 2L6 18z" />
            </svg>
          </div>
        </div>

        <div className={`home-screen${showHome ? " show" : ""}`}>
          {["Messages", "Maps", "Photos", "Settings", "Safari", "Mail", "Calendar"].map((label) => (
            <div key={label} className="hs-icon">
              <div className="tile" />
              <div className="tile-label">{label}</div>
            </div>
          ))}
          <div className="hs-icon numa">
            <div className="tile" style={{ overflow: "hidden", padding: 0 }}>
              <NumaTile size={48} />
            </div>
            <div className="tile-label">Numa Radio</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AndroidPhone({ step }: { step: number }) {
  const showBanner = step === 2 || step === 3;
  const showHome = step === 4;
  return (
    <div className="phone-frame">
      <div className="phone-frame-notch" />
      <div className="phone-inner">
        <div className="phone-stat">
          <span>2:47</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <svg viewBox="0 0 14 10" fill="currentColor" style={{ width: 13, height: 9 }}>
              <path d="M0 8h2v2H0zM3 6h2v4H3zM6 4h2v6H6zM9 2h2v8H9zM12 0h2v10h-2z" />
            </svg>
            <svg viewBox="0 0 24 10" fill="none" stroke="currentColor" strokeWidth="1" style={{ width: 18, height: 9 }}>
              <rect x="1" y="1" width="19" height="8" rx="1.5" />
              <rect x="2.5" y="2.5" width="14" height="5" rx="0.5" fill="currentColor" />
              <path d="M21 4v2h1V4z" fill="currentColor" />
            </svg>
          </span>
        </div>

        {step === 1 && (
          <div className="browser-chrome" style={{ top: 40 }}>
            <div className="url">
              <span className="lock">●</span>numaradio.com
            </div>
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              style={{ width: 14, height: 14, color: "var(--fg-dim)", flexShrink: 0 }}
            >
              <circle cx="10" cy="4" r="1.5" />
              <circle cx="10" cy="10" r="1.5" />
              <circle cx="10" cy="16" r="1.5" />
            </svg>
          </div>
        )}

        {!showHome && <AppPreview />}

        {showBanner && (
          <div
            className="share-sheet show"
            style={{ bottom: 60, top: "auto" }}
          >
            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  overflow: "hidden",
                }}
              >
                <NumaTile size={36} />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 500 }}>
                  Install Numa Radio
                </div>
                <div
                  style={{
                    fontSize: 9,
                    color: "var(--fg-dim)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  numaradio.com
                </div>
              </div>
            </div>
            <div
              style={{
                display: "flex",
                gap: 6,
                justifyContent: "flex-end",
              }}
            >
              <div style={{ padding: "6px 12px", fontSize: 10, color: "var(--fg-dim)" }}>
                Not now
              </div>
              <div
                style={{
                  padding: "6px 12px",
                  fontSize: 10,
                  background: "var(--accent)",
                  color: "#0A0D0E",
                  borderRadius: 4,
                  fontWeight: 600,
                }}
              >
                Install
              </div>
            </div>
          </div>
        )}

        <div className={`home-screen${showHome ? " show" : ""}`}>
          {["Phone", "Gmail", "Maps", "Chrome", "Photos", "Play", "Camera"].map((label) => (
            <div key={label} className="hs-icon">
              <div className="tile" />
              <div className="tile-label">{label}</div>
            </div>
          ))}
          <div className="hs-icon numa">
            <div className="tile" style={{ overflow: "hidden", padding: 0 }}>
              <NumaTile size={48} />
            </div>
            <div className="tile-label">Numa Radio</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DesktopPreview() {
  return (
    <div className="phone-preview" style={{ maxWidth: "none" }}>
      <div
        className="phone-frame"
        style={{
          aspectRatio: "16 / 11",
          maxWidth: "none",
          borderRadius: 14,
          borderWidth: 10,
        }}
      >
        <div className="phone-inner" style={{ padding: 0 }}>
          <div
            className="browser-chrome"
            style={{ position: "static", borderRadius: 0 }}
          >
            <div className="dot-row">
              <span /><span /><span />
            </div>
            <div className="url">
              <span className="lock">●</span>numaradio.com{" "}
              <span style={{ marginLeft: "auto", color: "var(--accent)" }}>⊕</span>
            </div>
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              style={{ width: 12, height: 12, color: "var(--fg-dim)", flexShrink: 0 }}
            >
              <circle cx="10" cy="4" r="1.5" />
              <circle cx="10" cy="10" r="1.5" />
              <circle cx="10" cy="16" r="1.5" />
            </svg>
          </div>
          <div className="install-prompt show">
            <div className="ip-title">Install Numa Radio?</div>
            <div className="ip-url">numaradio.com</div>
            <div className="ip-actions">
              <div className="ip-btn ghost">Cancel</div>
              <div className="ip-btn primary">Install</div>
            </div>
          </div>
          <div
            style={{
              flex: 1,
              display: "grid",
              gridTemplateColumns: "1fr 1.4fr",
              gap: 16,
              padding: 20,
            }}
          >
            <div
              style={{
                aspectRatio: "1",
                borderRadius: 12,
                background: `url(${MOCK_ARTWORK}) center/cover`,
              }}
            />
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                gap: 10,
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 9,
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  color: "var(--red-live)",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: "var(--red-live)",
                    boxShadow: "0 0 4px var(--red-live)",
                  }}
                />
                On Air · Lena
              </div>
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 800,
                  fontSize: 22,
                  lineHeight: 1,
                  textTransform: "uppercase",
                  letterSpacing: "-0.01em",
                }}
              >
                {MOCK_TITLE}
              </div>
              <div style={{ fontSize: 11, color: "var(--fg-dim)" }}>
                {MOCK_ARTIST}
              </div>
              <div
                style={{
                  height: 3,
                  borderRadius: 2,
                  background: "rgba(255,255,255,0.1)",
                  position: "relative",
                  marginTop: 6,
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: "62%",
                    background: "var(--accent)",
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AddToHomeScreen() {
  const [platform, setPlatform] = useState<Platform>("ios");
  const [step, setStep] = useState<Record<Platform, number>>({
    ios: 1,
    android: 1,
    desktop: 1,
  });

  const activeStep = step[platform];
  const steps = STEPS[platform];

  function selectStep(n: number) {
    setStep((s) => ({ ...s, [platform]: n }));
  }

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
          <div className="install-grid">
            <div>
              <div className="eyebrow" style={{ marginBottom: 24 }}>
                Numa Radio · Installable Web App
              </div>
              <h1>
                Put Numa<br />on your<br />
                <span className="accent">home screen.</span>
              </h1>
              <p className="lead">
                Numa installs from your browser — no app store, no signup. Once
                it&apos;s on your home screen it behaves like any audio app:
                full-bleed, lock-screen controls, background playback.
              </p>
            </div>
            <div className="why-list">
              {WHY.map((w) => (
                <div key={w.title} className="why-item">
                  <div className="check">
                    <CheckIcon />
                  </div>
                  <div>
                    <h4>{w.title}</h4>
                    <p>{w.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="platform-section">
        <div className="shell">
          <div className="platform-head">
            <h2>
              Pick your<br />device.
            </h2>
            <p>
              Three short steps on whatever you use. The destination is the
              same: Numa, one tap away, every time.
            </p>
          </div>

          <div className="platform-tabs" role="tablist">
            <button
              className={`ptab${platform === "ios" ? " active" : ""}`}
              onClick={() => setPlatform("ios")}
              role="tab"
              aria-selected={platform === "ios"}
            >
              <IosLogo />
              iOS
            </button>
            <button
              className={`ptab${platform === "android" ? " active" : ""}`}
              onClick={() => setPlatform("android")}
              role="tab"
              aria-selected={platform === "android"}
            >
              <AndroidLogo />
              Android
            </button>
            <button
              className={`ptab${platform === "desktop" ? " active" : ""}`}
              onClick={() => setPlatform("desktop")}
              role="tab"
              aria-selected={platform === "desktop"}
            >
              <DesktopLogo />
              Desktop
            </button>
          </div>

          <div
            className="steps-wrap"
            style={
              platform === "desktop"
                ? { gridTemplateColumns: "1fr 1.2fr" }
                : undefined
            }
          >
            <div className="steps-list">
              {steps.map((s, i) => {
                const n = i + 1;
                return (
                  <div
                    key={i}
                    className={`step-row${activeStep === n ? " active" : ""}`}
                    onClick={() => selectStep(n)}
                  >
                    <div className="step-num-lg">
                      {String(n).padStart(2, "0")}
                    </div>
                    <div className="step-body">
                      <h3>{s.title}</h3>
                      <p>{s.body}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {platform === "ios" && (
              <div className="phone-preview">
                <IosPhone step={activeStep} />
              </div>
            )}
            {platform === "android" && (
              <div className="phone-preview">
                <AndroidPhone step={activeStep} />
              </div>
            )}
            {platform === "desktop" && <DesktopPreview />}
          </div>
        </div>
      </section>

      <section className="faq-section">
        <div className="shell">
          <div className="faq-head">
            <div className="eyebrow" style={{ marginBottom: 20 }}>
              Questions we get
            </div>
            <h2>
              Wait,<br />but —
            </h2>
          </div>
          <div className="faq-grid">
            {FAQS.map((f) => (
              <div key={f.q} className="faq-item">
                <h4>{f.q}</h4>
                <p>{f.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="cta-footer">
        <div className="shell">
          <h2>
            Good to go?<br />
            <span className="accent">press play.</span>
          </h2>
          <p>Lena&apos;s been on the mic for hours. Come listen.</p>
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
