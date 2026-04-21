// Visual-only mock of the mobile expanded-player Request tab. Mirrors the
// real RequestForm — heading, sub-tab pills, three placeholder inputs, send
// button, review rotator line. Static (no live data) since it's marketing
// illustration, but the SHAPE matches what the user sees in the real app.

import { SparklesIcon, MegaphoneIcon, SendIcon } from "./Icons";

const SUB_TABS = [
  { label: "Song request", Icon: SparklesIcon, active: true },
  { label: "Shoutout", Icon: MegaphoneIcon },
];

const INPUTS = [
  "A vibe, a mood, a moment — Numa makes it into a song",
  "Your name or city",
  "Anything for Lena? (optional)",
];

export function Phone2Mockup() {
  return (
    <div className="phone phone-2">
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
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "14px 12px 12px", gap: 12 }}>
        {/* Top bar — chevron + On Air pill, mirrors the real .ep-topbar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{
            width: 18, height: 18, borderRadius: "50%",
            background: "rgba(255,255,255,0.06)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 9, height: 9, color: "var(--fg)" }}>
              <path d="M5 7l5 6 5-6z" />
            </svg>
          </div>
          <div style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
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
            On Air — Lena
          </div>
          <div style={{ width: 18 }} />
        </div>

        {/* Heading — mirrors the .ep-form-pane h3 */}
        <div style={{
          fontFamily: "var(--font-display)",
          fontWeight: 800,
          fontStretch: "115%",
          fontSize: 22,
          lineHeight: 1,
          textTransform: "uppercase",
          letterSpacing: "-0.02em",
        }}>To the<br />booth.</div>

        {/* Sub-tab pills — mirrors .req-types */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 4,
          padding: 4,
          borderRadius: 10,
          background: "rgba(0,0,0,0.35)",
          border: "1px solid var(--line)",
        }}>
          {SUB_TABS.map(({ label, Icon, active }) => (
            <div
              key={label}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 5,
                padding: "6px 4px",
                borderRadius: 6,
                background: active ? "var(--accent)" : "transparent",
                color: active ? "#0A0D0E" : "var(--fg-mute)",
                fontFamily: "var(--font-mono)",
                fontSize: 7,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                fontWeight: active ? 600 : 400,
                boxShadow: active ? "0 0 0 1px var(--accent), 0 4px 12px var(--accent-glow)" : "none",
              }}
            >
              <Icon size={9} />
              {label}
            </div>
          ))}
        </div>

        {/* Inputs — mirrors .req-input-group */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {INPUTS.map((placeholder, i) => (
            <div
              key={i}
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid var(--line)",
                background: "rgba(0,0,0,0.3)",
                fontSize: 8,
                color: "var(--fg-mute)",
                minHeight: i === 2 ? 32 : 0,
                lineHeight: 1.3,
              }}
            >
              {placeholder}
            </div>
          ))}
        </div>

        {/* Send button — mirrors .req-send */}
        <div style={{
          display: "inline-flex",
          alignSelf: "flex-start",
          alignItems: "center",
          gap: 6,
          padding: "8px 14px",
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
          Send to the booth
          <SendIcon size={9} />
        </div>

        {/* Review rotator line — mirrors .req-review */}
        <div style={{
          marginTop: "auto",
          padding: "8px 10px",
          borderRadius: 8,
          background: "rgba(0,0,0,0.25)",
          border: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 7,
          color: "var(--fg-dim)",
          lineHeight: 1.4,
        }}>
          <span style={{
            width: 4,
            height: 4,
            borderRadius: "50%",
            background: "var(--accent)",
            flexShrink: 0,
          }} />
          Requests are reviewed live on air — Lena picks what fits the moment.
        </div>
      </div>
    </div>
  );
}
