"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useNowPlaying } from "./useNowPlaying";
import { useLenaLine, relativeTimeLabel } from "./useLenaLine";
import { useFallbackArtworkUrl } from "./FallbackArtworkProvider";
import { OnAirFeed } from "./OnAirFeed";
import { Waveform } from "./Waveform";
import { ListenerCount } from "./ListenerCount";
import { Logo } from "./Logo";
import { showForHour, timeOfDayFor, type TimeOfDay } from "@/lib/schedule";

type Props = {
  broadcast: boolean;
};

// Numa Radio's YouTube broadcast stage. A purpose-built 16:9 layout that
// shares the in-app expanded player's visual DNA (dark base, teal accent,
// CRT/booth feel) but is tuned for video: bigger Lena portrait, prominent
// wordmark + clock, persistent CTA, atmospheric layers.
//
// Sizing strategy: the stage is always 16:9 and uses container query units
// (cqw/cqh) for everything inside. At 1920×1080 (the encoder's Chromium
// window) and at any preview viewport, proportions are identical.
export function BroadcastStage({ broadcast }: Props) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>("night");
  const [showName, setShowName] = useState<string>("Night Shift");
  const [clockText, setClockText] = useState<string>("");

  // Hard-mute every <audio> tag in the document — the encoder muxes Icecast
  // directly. Defensive against future code that might auto-play.
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

  // Tag the document so the data-broadcast CSS scope kicks in (full-bleed
  // body, no scrollbars, no cursor in encoder mode).
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

  // Tick the clock + show + time-of-day tint every 30s.
  useEffect(() => {
    function tick() {
      const d = new Date();
      const h = d.getHours();
      const m = String(d.getMinutes()).padStart(2, "0");
      setClockText(`${String(h).padStart(2, "0")}:${m}`);
      setShowName(showForHour(h).name);
      setTimeOfDay(timeOfDayFor(h));
    }
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      stageRef.current?.requestFullscreen().catch(() => {});
    }
  }

  return (
    <div className="bcast-root" data-mode={broadcast ? "encoder" : "preview"}>
    <div
      ref={stageRef}
      className="bcast-stage"
      data-mode={broadcast ? "encoder" : "preview"}
      data-tod={timeOfDay}
    >
      {/* ──── Atmospheric layers (decorative, pointer-events: none) ──── */}
      <div className="bcast-bg" aria-hidden />
      <div className="bcast-glow" aria-hidden />
      <div className="bcast-scanlines" aria-hidden />
      <div className="bcast-grain" aria-hidden />
      <div className="bcast-vignette" aria-hidden />

      {/* ──── Header ──── */}
      <header className="bcast-header">
        <div className="bcast-brand">
          <Logo />
        </div>

        <div className="bcast-show">
          <div className="bcast-show-rule" aria-hidden />
          <div className="bcast-show-name">{showName}</div>
          <div className="bcast-show-time">{clockText} GMT</div>
          <div className="bcast-show-rule" aria-hidden />
        </div>

        <div className="bcast-status">
          <div className="bcast-onair">
            <span className="bcast-onair-dot" aria-hidden />
            <span>ON AIR · LIVE</span>
          </div>
          <div className="bcast-listeners">
            <span className="bcast-listener-dot" aria-hidden />
            <ListenerCount suffix=" tuned in" />
          </div>
        </div>
      </header>

      {/* ──── Main 3-column stage ──── */}
      <main className="bcast-main">
        <BroadcastLena />
        <BroadcastNowPlaying />
        <BroadcastFeed />
      </main>

      {/* ──── Footer / CTA ────
          Two CTAs — the encoder ships ?broadcast=1, so YouTube
          viewers see the chat-trigger version; humans browsing
          numaradio.com/live see the website version. Different
          ask, same conversion goal: get them to type something. */}
      <footer className="bcast-footer">
        <div className="bcast-cta-eyebrow">
          <span className="bcast-cta-rule" aria-hidden />
          <span>REQUEST · ON AIR · ALWAYS</span>
          <span className="bcast-cta-rule" aria-hidden />
        </div>
        {broadcast ? (
          <div className="bcast-cta-line">
            Type <strong>@lena</strong>
            <span className="bcast-caret" aria-hidden />
            + a message in chat
            <span className="bcast-cta-tail">— hear her read it on air.</span>
          </div>
        ) : (
          <div className="bcast-cta-line">
            Type a message at <strong>numaradio.com</strong>
            <span className="bcast-caret" aria-hidden />
            <span className="bcast-cta-tail">— hear Lena read it on air.</span>
          </div>
        )}
      </footer>

      {/* ──── Fullscreen toggle (preview only) ──── */}
      {!broadcast && (
        <button
          className="bcast-fullscreen"
          onClick={toggleFullscreen}
          aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          title={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        >
          {fullscreen ? "⤓" : "⛶"}
        </button>
      )}
    </div>
    </div>
  );
}

// ─── Lena column ─────────────────────────────────────────────────────────
// Big portrait + tag + live quote. Reuses the same hook as the in-app
// LenaLine component so on-air freshness syncs perfectly.
function BroadcastLena() {
  const line = useLenaLine();
  const isFresh = line?.source === "live" || line?.source === "context";
  const freshLabel =
    isFresh && line && "atIso" in line ? relativeTimeLabel(line.atIso) : null;

  return (
    <section className="bcast-col bcast-col-lena">
      <div className={`bcast-lena-portrait-wrap ${isFresh ? "is-fresh" : ""}`}>
        <div className="bcast-lena-halo" aria-hidden />
        <div className="bcast-lena-portrait">
          <Image
            src="/lena/portrait.png"
            alt="Lena, Numa Radio's AI host"
            width={600}
            height={600}
            priority
            sizes="(max-width: 1920px) 18vw, 360px"
            style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 38%" }}
          />
        </div>
      </div>

      <div className="bcast-lena-meta">
        <div className="bcast-lena-name">Lena</div>
        <div className="bcast-lena-label">
          Host · Live{freshLabel ? ` · ${freshLabel}` : ""}
        </div>
      </div>

      <div className="bcast-lena-quote" key={line?.script ?? "loading"}>
        {line ? (
          <span className="lena-text-anim">&ldquo;{line.script}&rdquo;</span>
        ) : (
          <span className="bcast-lena-quote-loading">tuning in…</span>
        )}
      </div>
    </section>
  );
}

// ─── Now-playing column ──────────────────────────────────────────────────
// Big artwork, title in display type, artist in mono caps, waveform.
function BroadcastNowPlaying() {
  const np = useNowPlaying();
  const fallback = useFallbackArtworkUrl();
  const cover = np.artworkUrl ?? fallback;
  const title = np.title ?? "—";
  const artist = np.artistDisplay ?? "—";

  return (
    <section className="bcast-col bcast-col-now">
      <div className="bcast-now-eyebrow">
        <span className="bcast-eye-dot" aria-hidden />
        <span>NOW PLAYING</span>
      </div>

      <div className="bcast-now-art-wrap">
        <div
          className="bcast-now-art"
          style={{ backgroundImage: cover ? `url(${cover})` : undefined }}
          aria-label={`Cover art for ${title}`}
        />
        <div className="bcast-now-art-glow" aria-hidden />
      </div>

      <div className="bcast-now-meta">
        <div className="bcast-now-title">{title}</div>
        <div className="bcast-now-artist">{artist}</div>
      </div>

      <div className="bcast-now-wave">
        <Waveform
          hasTrack={Boolean(np.isPlaying)}
          progress={np.progress}
          elapsedSeconds={np.elapsedSeconds}
          durationSeconds={np.durationSeconds ?? null}
          showTime
        />
      </div>
    </section>
  );
}

// ─── Feed column ─────────────────────────────────────────────────────────
// Reuses OnAirFeed (recently played + recent shoutouts merged chronologically).
function BroadcastFeed() {
  return (
    <section className="bcast-col bcast-col-feed">
      <div className="bcast-feed-eyebrow">
        <span className="bcast-eye-dot" aria-hidden />
        <span>THE BOOTH · LIVE</span>
      </div>
      <div className="bcast-feed-scroll">
        <OnAirFeed />
      </div>
    </section>
  );
}
