// Visual-only mock of the mobile expanded-player Listen tab, embedded in the
// "06 — In Your Pocket" marketing section. Static data — picking one real
// track + artwork (Russell Ross — "Ocean Eyes") rather than auto-tracking the
// live broadcast, since the marketing copy doesn't need to change every poll.

import {
  PlayIcon,
  SparklesIcon,
  MegaphoneIcon,
  RadioTowerIcon,
  ThumbsUpIcon,
  ThumbsDownIcon,
  ShareIcon,
} from "./Icons";

const TABS = [
  { label: "Listen", Icon: PlayIcon, active: true },
  { label: "Request", Icon: SparklesIcon },
  { label: "Shout", Icon: MegaphoneIcon },
  { label: "On Air", Icon: RadioTowerIcon },
];

const TRACK_TITLE = "Ocean Eyes";
const TRACK_ARTIST = "Russell Ross";
// Routed through cdn.numaradio.com so every homepage visitor's request
// hits the Cloudflare cache instead of B2 directly. Hardcoding f003.…
// here was a slow drain on the B2 Class B quota — every public
// pageview that hadn't yet been edge-cached cost one B2 download.
const TRACK_ARTWORK =
  "https://cdn.numaradio.com/file/numaradio/stations/numaradio/tracks/cmo8jf20n0007wemtlhrsp6rt/artwork/primary.jpg";

export function Phone1Mockup() {
  const title = TRACK_TITLE;
  const artist = TRACK_ARTIST;
  const cover = TRACK_ARTWORK;

  return (
    <div className="phone">
      <div className="phone-notch" />
      <div className="phone-status">
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
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "14px 10px 10px", gap: 12 }}>
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

        {/* Meta row — clock + listener count, mirrors .ep-listen-meta */}
        <div style={{
          fontFamily: "var(--font-mono)",
          fontSize: 7,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: "var(--fg-mute)",
          display: "flex",
          justifyContent: "space-between",
        }}>
          <span>2:47 PM</span>
          <span>16 listening</span>
        </div>

        {/* Artwork with floating share + vote pills, mirrors .ep-listen-art */}
        <div style={{
          aspectRatio: "1",
          borderRadius: 14,
          background: `url(${cover}) center/cover`,
          position: "relative",
          overflow: "hidden",
          boxShadow: "0 12px 28px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04)",
        }}>
          {/* Floating Share pill, bottom-left */}
          <div style={{
            position: "absolute", left: 6, bottom: 6,
            display: "flex", alignItems: "center", gap: 3,
            padding: "3px 6px", borderRadius: 999,
            background: "rgba(10,13,14,0.7)",
            backdropFilter: "blur(8px)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "var(--fg)", fontSize: 6,
            fontFamily: "var(--font-mono)", letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}>
            <ShareIcon size={8} />
            Share
          </div>
          {/* Floating vote pills, bottom-right */}
          <div style={{
            position: "absolute", right: 6, bottom: 6,
            display: "flex", alignItems: "center", gap: 4,
            padding: "3px 6px", borderRadius: 999,
            background: "rgba(10,13,14,0.7)",
            backdropFilter: "blur(8px)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "var(--fg)",
          }}>
            <ThumbsUpIcon size={8} />
            <ThumbsDownIcon size={8} />
          </div>
        </div>

        {/* Track title + artist — centered, mirrors .ep-listen-track */}
        <div style={{ textAlign: "center" }}>
          <div style={{
            fontFamily: "var(--font-display)",
            fontWeight: 800,
            fontStretch: "115%",
            fontSize: 14,
            lineHeight: 1,
            letterSpacing: "-0.02em",
            textTransform: "uppercase",
            marginBottom: 3,
          }}>{title}</div>
          <div style={{
            fontFamily: "var(--font-mono)",
            fontSize: 7,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "var(--fg-dim)",
          }}>{artist}</div>
        </div>

        {/* Play button — mirrors .ep-listen-play */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            background: "var(--accent)",
            color: "#0A0D0E",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 0 0 1px var(--accent), 0 8px 28px var(--accent-glow)",
          }}>
            <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 14, height: 14 }}>
              <path d="M5 3v14l12-7z" />
            </svg>
          </div>
        </div>

        {/* Lena card — mirrors .ep-listen-lena */}
        <div style={{
          background: "rgba(79,209,197,0.06)",
          border: "1px solid rgba(79,209,197,0.18)",
          borderRadius: 8,
          padding: 8,
        }}>
          <div style={{
            fontFamily: "var(--font-mono)",
            fontSize: 6.5,
            color: "var(--accent)",
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            marginBottom: 3,
          }}>Lena · on the mic</div>
          <div style={{ fontSize: 8, lineHeight: 1.45, color: "var(--fg)" }}>
            &ldquo;Slow and a little heartbroken, coming right up — look out the window.&rdquo;
          </div>
        </div>

        {/* Bottom tab bar — mirrors .ep-tabbar, tabs match TabBar.tsx */}
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
          {TABS.map(({ label, Icon, active }) => (
            <div
              key={label}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 3,
                padding: "4px 2px",
                color: active ? "var(--accent)" : "var(--fg-dim)",
              }}
            >
              <Icon size={11} />
              <div style={{
                fontFamily: "var(--font-mono)",
                fontSize: 6,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                fontWeight: active ? 600 : 400,
              }}>{label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
