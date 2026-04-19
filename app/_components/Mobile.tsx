import Link from "next/link";
import { ListenLiveButton } from "./ListenLiveButton";
import { ChevronUpRightArrow } from "./Icons";

// The two phone mockups are a lot of inline SVG + gradient markup. Kept close
// to the design HTML intentionally — JSX is a mechanical translation, not a
// rewrite. Don't refactor into deeper components.

export function Mobile() {
  return (
    <section className="mobile-showcase">
      <div className="shell">
        <div className="section-head">
          <div>
            <div className="eyebrow" style={{ marginBottom: 20 }}>
              06 — In Your Pocket
            </div>
            <h2>
              Open it in<br />a browser.<br />Or don&apos;t.
            </h2>
          </div>
          <p className="lead">
            Numa lives on the open web — no app store, no download, no
            gatekeeping. Open the site on your phone and hit play. Want it on
            your home screen? Tap <em>Add to Home Screen</em> and it behaves
            like any other app: full-bleed, lock-screen controls, instant
            launch.
          </p>
        </div>

        <div className="mobile-grid">
          <div className="mobile-copy">
            <div className="mobile-feats">
              <div className="mobile-feat">
                <div className="mobile-feat-num">01</div>
                <div className="mobile-feat-body">
                  <h4>Open and play</h4>
                  <p>
                    No install, no signup. Visit numaradio.com on any phone and
                    the play button is the first thing you see.
                  </p>
                </div>
              </div>
              <div className="mobile-feat">
                <div className="mobile-feat-num">02</div>
                <div className="mobile-feat-body">
                  <h4>Add to Home Screen</h4>
                  <p>
                    Save Numa to your home screen and it launches full-bleed, no
                    browser chrome. Feels like an app. Isn&apos;t one.
                  </p>
                </div>
              </div>
              <div className="mobile-feat">
                <div className="mobile-feat-num">03</div>
                <div className="mobile-feat-body">
                  <h4>Keeps playing in the background</h4>
                  <p>
                    Lock your phone, switch tabs, check a text. Audio keeps
                    going, with track metadata on your lock screen.
                  </p>
                </div>
              </div>
            </div>
            <div className="hero-ctas" style={{ marginBottom: 0 }}>
              <ListenLiveButton label="Open numaradio.com" />
              <Link className="btn btn-ghost" href="/add-to-home-screen">
                <ChevronUpRightArrow className="btn-icon" />
                How to Add to Home Screen
              </Link>
            </div>
          </div>

          <div className="phones">
            {/* Phone 1 — Listen / player */}
            <div className="phone">
              <div className="phone-notch" />
              <div className="phone-status">
                <span>2:47</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <svg viewBox="0 0 14 10" fill="currentColor" style={{ width: 13, height: 9 }}>
                    <path d="M0 8h2v2H0zM3 6h2v4H3zM6 4h2v6H6zM9 2h2v8H9zM12 0h2v10h-2z" />
                  </svg>
                  <svg viewBox="0 0 16 10" fill="none" stroke="currentColor" strokeWidth="1" style={{ width: 14, height: 9 }}>
                    <path d="M1 5a7 7 0 0114 0M3 6.5a5 5 0 0110 0M5 8a3 3 0 016 0" />
                  </svg>
                  <svg viewBox="0 0 24 10" fill="none" stroke="currentColor" strokeWidth="1" style={{ width: 18, height: 9 }}>
                    <rect x="1" y="1" width="19" height="8" rx="1.5" />
                    <rect x="2.5" y="2.5" width="14" height="5" rx="0.5" fill="currentColor" />
                    <path d="M21 4v2h1V4z" fill="currentColor" />
                  </svg>
                </span>
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "14px 10px 10px", gap: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div className="logo" style={{ fontSize: 11 }}>
                    <span className="logo-mark" />
                    <span>
                      Numa<span style={{ color: "var(--accent)" }}>·</span>Radio
                    </span>
                  </div>
                  <div style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "3px 7px",
                    borderRadius: 999,
                    border: "1px solid rgba(255,107,107,0.35)",
                    background: "rgba(255,107,107,0.08)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 7,
                    color: "var(--red-live)",
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                  }}>
                    <span style={{
                      width: 4,
                      height: 4,
                      borderRadius: "50%",
                      background: "var(--red-live)",
                      boxShadow: "0 0 4px var(--red-live)",
                      animation: "pulseDot 1.6s ease-in-out infinite",
                    }} />
                    Live
                  </div>
                </div>

                <div style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 7,
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  color: "var(--fg-mute)",
                  display: "flex",
                  justifyContent: "space-between",
                }}>
                  <span>On Air · Lena</span>
                  <span>12,418 listening</span>
                </div>

                <div style={{
                  aspectRatio: "1",
                  borderRadius: 14,
                  background:
                    "radial-gradient(circle at 30% 20%, #2A4E4B, transparent 60%), radial-gradient(circle at 70% 80%, var(--accent), transparent 55%), linear-gradient(135deg, #1A1E23, #0F1114)",
                  position: "relative",
                  overflow: "hidden",
                  boxShadow: "0 12px 28px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04)",
                }}>
                  <div style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: "var(--font-display)",
                    fontWeight: 800,
                    fontSize: 48,
                    color: "var(--fg)",
                    letterSpacing: "-0.03em",
                    fontStretch: "125%",
                  }}>SF</div>
                </div>

                <div>
                  <div style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 700,
                    fontStretch: "115%",
                    fontSize: 15,
                    lineHeight: 1,
                    textTransform: "uppercase",
                    letterSpacing: "-0.01em",
                    marginBottom: 3,
                  }}>Slow Fade, Brighter</div>
                  <div style={{ fontSize: 9, color: "var(--fg-dim)" }}>
                    Russell Ross — Nightshore EP
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "0 10px", position: "relative" }}>
                  <button style={{
                    width: 52,
                    height: 52,
                    borderRadius: "50%",
                    background: "var(--accent)",
                    color: "#0A0D0E",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 0 0 1px var(--accent), 0 8px 28px var(--accent-glow)",
                  }}>
                    <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 17, height: 17 }}>
                      <rect x="6" y="4" width="3" height="12" rx="0.5" />
                      <rect x="11" y="4" width="3" height="12" rx="0.5" />
                    </svg>
                  </button>
                </div>

                {/* Bottom tab bar */}
                <div style={{
                  marginTop: "auto",
                  marginLeft: -10,
                  marginRight: -10,
                  marginBottom: -10,
                  padding: "10px 6px 8px",
                  borderTop: "1px solid var(--line)",
                  background: "rgba(0,0,0,0.4)",
                  backdropFilter: "blur(10px)",
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: 2,
                }}>
                  {[
                    { label: "Listen", active: true },
                    { label: "Request" },
                    { label: "Shout" },
                    { label: "Queue" },
                  ].map((t) => (
                    <div
                      key={t.label}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 3,
                        padding: "4px 2px",
                        color: t.active ? "var(--accent)" : "var(--fg-dim)",
                      }}
                    >
                      <div style={{ width: 14, height: 14, opacity: 0.8 }} />
                      <div style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 6,
                        letterSpacing: "0.16em",
                        textTransform: "uppercase",
                        fontWeight: t.active ? 600 : 400,
                      }}>{t.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Phone 2 — Request form */}
            <div className="phone phone-2">
              <div className="phone-notch" />
              <div className="phone-status">
                <span>2:47</span>
                <span>●●● ▲</span>
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "14px 10px", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 8,
                    letterSpacing: "0.15em",
                    textTransform: "uppercase",
                    color: "var(--fg-dim)",
                  }}>← Back</div>
                  <div style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 8,
                    letterSpacing: "0.15em",
                    textTransform: "uppercase",
                    color: "var(--fg-dim)",
                  }}>Step 1 / 2</div>
                </div>

                <div>
                  <div style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "3px 8px",
                    borderRadius: 999,
                    border: "1px solid rgba(79,209,197,0.3)",
                    background: "rgba(79,209,197,0.07)",
                    marginBottom: 8,
                  }}>
                    <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 9, height: 9, color: "var(--accent)" }}>
                      <path d="M17 3v10.2a3 3 0 11-2-2.8V6l-7 2v7.2a3 3 0 11-2-2.8V5l11-2z" />
                    </svg>
                    <div style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 7,
                      letterSpacing: "0.2em",
                      textTransform: "uppercase",
                      color: "var(--accent)",
                      fontWeight: 600,
                    }}>Song request</div>
                  </div>
                  <div style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 800,
                    fontStretch: "120%",
                    fontSize: 22,
                    lineHeight: 0.92,
                    textTransform: "uppercase",
                    letterSpacing: "-0.015em",
                  }}>To the<br />booth.</div>
                </div>

                {[
                  { label: "Track or vibe", value: "Morning Room — Russell Ross" },
                  { label: "From", value: "Reza — Tehran" },
                ].map((f) => (
                  <div key={f.label} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <label style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 6.5,
                      letterSpacing: "0.2em",
                      textTransform: "uppercase",
                      color: "var(--fg-mute)",
                    }}>{f.label}</label>
                    <div style={{
                      padding: "9px 10px",
                      borderRadius: 8,
                      border: "1px solid var(--line)",
                      background: "rgba(0,0,0,0.3)",
                      fontSize: 9,
                      color: "var(--fg)",
                    }}>{f.value}</div>
                  </div>
                ))}

                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <label style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 6.5,
                    letterSpacing: "0.2em",
                    textTransform: "uppercase",
                    color: "var(--fg-mute)",
                  }}>
                    Note for Lena <span style={{ color: "var(--fg-mute)", opacity: 0.6 }}>(optional)</span>
                  </label>
                  <div style={{
                    padding: "9px 10px",
                    borderRadius: 8,
                    border: "1px solid var(--accent)",
                    background: "rgba(79,209,197,0.04)",
                    fontSize: 9,
                    color: "var(--fg)",
                    minHeight: 48,
                    lineHeight: 1.4,
                  }}>
                    first sunlight here—something that sounds like the city waking up.
                  </div>
                </div>

                <button style={{
                  padding: 11,
                  background: "var(--accent)",
                  color: "#0A0D0E",
                  borderRadius: 999,
                  fontFamily: "var(--font-mono)",
                  fontSize: 8,
                  fontWeight: 600,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  boxShadow: "0 0 0 1px var(--accent), 0 6px 18px var(--accent-glow)",
                }}>
                  Send to Lena
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
