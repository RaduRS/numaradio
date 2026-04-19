"use client";

import { usePlayer } from "./PlayerProvider";
import {
  CopyIcon,
  LoadingIcon,
  PauseIcon,
  PlayIcon,
  ShareIcon,
} from "./Icons";
import { LiveClock } from "./LiveClock";
import { Waveform } from "./Waveform";
import { useNowPlaying } from "./useNowPlaying";

function initials(title: string | undefined): string {
  if (!title) return "··";
  const words = title.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function PlayerCard() {
  const { status, isPlaying, isLoading, toggle } = usePlayer();
  const np = useNowPlaying();

  const title = np.title ?? "—";
  const artist = np.artistDisplay ?? "—";
  const cover = np.artworkUrl;
  const coverInitials = initials(np.title);

  return (
    <div className="player-card">
      <div className="player-head">
        <div className="onair">On Air — Lena</div>
        <div className="player-time"><LiveClock /></div>
      </div>

      <div
        className="now-art"
        style={
          cover
            ? {
                backgroundImage: `url(${cover})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : undefined
        }
      >
        {!cover && <div className="art-inner">{coverInitials}</div>}
        <div className="art-overlay" />
        <div className="art-meta">
          <div className="track-no">{np.isPlaying ? "Now Airing" : "Off Air"}</div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 9,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: "var(--accent)",
              }}
            >
              Live
            </span>
            <div className="eq eq-lg">
              <span /><span /><span /><span /><span />
            </div>
          </div>
        </div>
      </div>

      <div className="now-info">
        <div className="track">{title}</div>
        <div className="artist">{artist.toUpperCase()}</div>
        <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
          <button className="share-pill" aria-label="Copy link">
            <CopyIcon className="" />
            Copy link
          </button>
          <button className="share-pill" aria-label="Share">
            <ShareIcon className="" />
            Share
          </button>
        </div>
      </div>

      <Waveform />

      <div className="player-controls">
        <button
          className="btn-play"
          onClick={toggle}
          aria-pressed={isPlaying}
          aria-busy={isLoading}
        >
          {isLoading ? (
            <LoadingIcon />
          ) : isPlaying ? (
            <PauseIcon />
          ) : (
            <PlayIcon />
          )}
        </button>
        <div className="ctrl-info">
          <div className="lbl">Streaming · 192kbps</div>
          <div className="val">
            <span style={{ color: "var(--fg-dim)" }}>
              {status === "loading"
                ? "Connecting…"
                : status === "error"
                  ? "Stream error — try again"
                  : "Live"}
            </span>
          </div>
        </div>
        <div className="vol">
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            style={{ width: 16, height: 16, opacity: 0.7 }}
          >
            <path d="M3 8v4h3l4 3V5L6 8H3zm11 2a3 3 0 00-1.5-2.6v5.2A3 3 0 0014 10zm-1.5-5.5v1.5A5 5 0 0116 10a5 5 0 01-3.5 4.8v1.5A6.5 6.5 0 0018 10a6.5 6.5 0 00-5.5-5.5z" />
          </svg>
          <div className="vol-bar"><div className="fill" /></div>
        </div>
      </div>

      <div className="lena-card">
        <div className="lena-avatar">L</div>
        <div className="lena-content">
          <div className="lena-head">
            <span className="lena-name">Lena</span>
            <span className="lena-label">Host · Live</span>
          </div>
          <div className="lena-text">
            &ldquo;Alright, night owls — that&apos;s Russell sliding into frame.
            Someone in Lisbon asked for slow and a little heartbroken. I heard
            you. We&apos;ll pick the tempo back up after this one, promise.&rdquo;
          </div>
        </div>
      </div>
    </div>
  );
}
