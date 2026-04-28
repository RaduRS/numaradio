"use client";

import { useEffect, useRef, useState } from "react";
import { ExpandedPlayerDesktop } from "./ExpandedPlayerDesktop";
import { ListenerCount } from "./ListenerCount";
import { Logo } from "./Logo";

type Props = {
  broadcast: boolean;
};

// Numa Radio's YouTube broadcast stage. Reuses the existing
// ExpandedPlayerDesktop "booth" layout (artwork + Lena + waveform on the
// left, OnAirFeed on the right), wraps it in a fixed 1920x1080 frame, and
// adds broadcast-only chrome:
//   - ON AIR pill (top-left)
//   - listener count + clock (top-right)
//   - REQUEST AT NUMARADIO.COM strip (bottom)
// In broadcast mode (?broadcast=1) the headless Chromium encoder hits this
// page; we hide the fullscreen button and silence any audio the page
// might emit (the encoder pulls audio directly from Icecast).
export function BroadcastStage({ broadcast }: Props) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  // Hard-mute every <audio> tag in the document so the page never doubles up
  // with the Icecast feed the encoder muxes in directly. Defensive — the
  // booth UI doesn't auto-play, but a future change shouldn't be able to
  // smuggle audio onto the broadcast.
  useEffect(() => {
    if (!broadcast) return;
    const mute = () => {
      document.querySelectorAll("audio").forEach((el) => {
        el.muted = true;
        el.volume = 0;
        try { el.pause(); } catch { /* ignore */ }
      });
    };
    mute();
    const id = window.setInterval(mute, 2000);
    return () => window.clearInterval(id);
  }, [broadcast]);

  // Tag the document so the data-broadcast CSS scope kicks in (hides
  // play/volume/share/vote, bumps fonts, etc).
  useEffect(() => {
    document.documentElement.setAttribute(
      "data-broadcast",
      broadcast ? "encoder" : "preview"
    );
    document.body.classList.add("broadcast-body");
    return () => {
      document.documentElement.removeAttribute("data-broadcast");
      document.body.classList.remove("broadcast-body");
    };
  }, [broadcast]);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      stageRef.current?.requestFullscreen().catch(() => {});
    }
  }

  return (
    <div
      ref={stageRef}
      className="broadcast-stage"
      data-mode={broadcast ? "encoder" : "preview"}
    >
      {/* Top-left: ON AIR pill */}
      <div className="bs-onair">
        <span className="bs-onair-dot" aria-hidden />
        <span className="bs-onair-label">ON AIR · LIVE</span>
      </div>

      {/* Top-right: listener pill + wordmark */}
      <div className="bs-topright">
        <div className="bs-listeners">
          <span className="bs-listeners-dot" aria-hidden />
          <ListenerCount suffix=" tuned in" />
        </div>
        <div className="bs-wordmark">
          <Logo />
        </div>
      </div>

      {/* The booth itself — same component the in-app expanded player uses.
          Wrapped in .ep-root.open + .ep-shell so the existing CSS lights up
          (backdrop, content opacity, layout grid). */}
      <div className="bs-booth-wrap">
        <div className="ep-root open" style={{ position: "absolute", inset: 0 }}>
          <div className="ep-shell" style={{ inset: 0, borderRadius: 0, border: "none" }}>
            <ExpandedPlayerDesktop />
          </div>
        </div>
      </div>

      {/* Bottom: persistent request CTA strip — the conversion lever. */}
      <div className="bs-cta">
        <div className="bs-cta-eyebrow">REQUEST · ON AIR · ALWAYS</div>
        <div className="bs-cta-line">
          Type a message at <strong>numaradio.com</strong> — hear Lena read it on air.
        </div>
      </div>

      {/* Fullscreen toggle: only in preview mode (humans browsing /live).
          The encoder runs Chromium in --kiosk so it's already full bleed. */}
      {!broadcast && (
        <button
          className="bs-fullscreen"
          onClick={toggleFullscreen}
          aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          title={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        >
          {fullscreen ? "⤓" : "⛶"}
        </button>
      )}
    </div>
  );
}
