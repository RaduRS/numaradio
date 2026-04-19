import Link from "next/link";
import { PlayerProvider } from "../_components/PlayerProvider";
import { Nav } from "../_components/Nav";
import { Footer } from "../_components/Footer";
import { ListenLiveButton } from "../_components/ListenLiveButton";

const PLATFORMS = [
  {
    label: "iOS",
    steps: [
      {
        title: "Open numaradio.com",
        body:
          "In Safari on iOS 16.4 or later, Chrome, Edge, Firefox, and Orion all work too.",
      },
      {
        title: "Tap Share",
        body:
          "Square with the up-arrow — bottom of the screen on iPhone, top-right on iPad.",
      },
      {
        title: "Add to Home Screen",
        body: 'Scroll down in the share sheet, tap it, then "Add".',
      },
      {
        title: "Launch",
        body: "Numa opens full-bleed with lock-screen playback controls.",
      },
    ],
  },
  {
    label: "Android",
    steps: [
      {
        title: "Open numaradio.com",
        body:
          "Chrome, Samsung Internet, Edge, Firefox, Opera — all support installing.",
      },
      {
        title: "Look for the install banner",
        body: 'Or open the three-dot menu and pick "Install app".',
      },
      {
        title: "Confirm",
        body: 'Tap "Install" in the prompt that appears.',
      },
      {
        title: "Launch from your drawer",
        body:
          "Numa appears with its icon in your app drawer, indistinguishable from native.",
      },
    ],
  },
  {
    label: "Desktop",
    steps: [
      {
        title: "Open numaradio.com",
        body:
          "Chrome, Edge, Brave, and Arc on Windows / macOS / Linux. Safari 17+ on macOS works too.",
      },
      {
        title: "Click the install icon",
        body:
          "Small monitor-with-arrow icon on the right of the address bar. In Safari it's File → Add to Dock.",
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
  },
];

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

export default function AddToHomeScreen() {
  return (
    <PlayerProvider>
      <Nav />

      <section style={{ padding: "80px 0 60px" }}>
        <div className="shell">
          <Link
            href="/"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "var(--fg-mute)",
              marginBottom: 40,
            }}
          >
            ← Back to Numa Radio
          </Link>

          <div className="eyebrow" style={{ marginBottom: 24 }}>
            Numa Radio · Installable Web App
          </div>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 800,
              fontStretch: "125%",
              fontSize: "clamp(56px, 8vw, 120px)",
              lineHeight: 0.88,
              letterSpacing: "-0.025em",
              textTransform: "uppercase",
              marginBottom: 32,
            }}
          >
            Put Numa<br />on your<br />
            <span
              style={{
                color: "var(--accent)",
                fontStyle: "italic",
                fontStretch: "100%",
              }}
            >
              home screen.
            </span>
          </h1>
          <p
            style={{
              fontSize: 18,
              lineHeight: 1.55,
              color: "var(--fg-dim)",
              maxWidth: 480,
              marginBottom: 40,
            }}
          >
            Numa installs from your browser — no app store, no signup. Once
            it&apos;s on your home screen it behaves like any audio app:
            full-bleed, lock-screen controls, background playback.
          </p>
        </div>
      </section>

      {PLATFORMS.map((p) => (
        <section
          key={p.label}
          style={{ padding: "60px 0", borderTop: "1px solid var(--line)" }}
        >
          <div className="shell">
            <h2
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 800,
                fontStretch: "125%",
                fontSize: "clamp(36px, 4vw, 56px)",
                lineHeight: 0.95,
                letterSpacing: "-0.02em",
                textTransform: "uppercase",
                marginBottom: 32,
              }}
            >
              {p.label}
            </h2>
            <ol
              style={{
                listStyle: "none",
                display: "flex",
                flexDirection: "column",
                gap: 0,
              }}
            >
              {p.steps.map((s, i) => (
                <li
                  key={i}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "56px 1fr",
                    gap: 24,
                    padding: "28px 0",
                    borderTop: "1px solid var(--line)",
                  }}
                >
                  <div
                    style={{
                      fontFamily: "var(--font-display)",
                      fontWeight: 800,
                      fontStretch: "125%",
                      fontSize: 40,
                      lineHeight: 1,
                      color: "var(--fg-mute)",
                      letterSpacing: "-0.02em",
                    }}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </div>
                  <div>
                    <h3
                      style={{
                        fontFamily: "var(--font-display)",
                        fontWeight: 700,
                        fontStretch: "115%",
                        fontSize: 26,
                        lineHeight: 1.05,
                        textTransform: "uppercase",
                        marginBottom: 8,
                      }}
                    >
                      {s.title}
                    </h3>
                    <p
                      style={{
                        color: "var(--fg-dim)",
                        fontSize: 15,
                        lineHeight: 1.5,
                      }}
                    >
                      {s.body}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>
      ))}

      <section style={{ padding: "80px 0 40px", borderTop: "1px solid var(--line)" }}>
        <div className="shell">
          <div className="eyebrow" style={{ marginBottom: 20 }}>
            Questions we get
          </div>
          <h2
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 800,
              fontStretch: "125%",
              fontSize: "clamp(36px, 4.5vw, 56px)",
              lineHeight: 0.95,
              letterSpacing: "-0.02em",
              textTransform: "uppercase",
              marginBottom: 48,
            }}
          >
            Wait,<br />but —
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: 1,
              background: "var(--line)",
              border: "1px solid var(--line)",
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            {FAQS.map((f) => (
              <div
                key={f.q}
                style={{ background: "var(--bg-1)", padding: "24px 28px" }}
              >
                <h4
                  style={{
                    fontSize: 15,
                    fontWeight: 500,
                    marginBottom: 8,
                    color: "var(--fg)",
                  }}
                >
                  {f.q}
                </h4>
                <p
                  style={{
                    fontSize: 14,
                    color: "var(--fg-dim)",
                    lineHeight: 1.55,
                  }}
                >
                  {f.a}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        style={{
          textAlign: "center",
          padding: "80px 0 60px",
          borderTop: "1px solid var(--line)",
        }}
      >
        <div className="shell">
          <h2
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 800,
              fontStretch: "125%",
              fontSize: "clamp(40px, 6vw, 80px)",
              lineHeight: 0.92,
              letterSpacing: "-0.02em",
              textTransform: "uppercase",
              marginBottom: 20,
            }}
          >
            Good to go?<br />
            <span
              style={{
                color: "var(--accent)",
                fontStyle: "italic",
                fontStretch: "100%",
              }}
            >
              press play.
            </span>
          </h2>
          <p
            style={{
              color: "var(--fg-dim)",
              fontSize: 16,
              marginBottom: 32,
            }}
          >
            Lena&apos;s been on the mic for hours. Come listen.
          </p>
          <ListenLiveButton
            label="Listen on numaradio.com"
            style={{ padding: "16px 28px", fontSize: 15 }}
          />
        </div>
      </section>

      <Footer />
    </PlayerProvider>
  );
}
