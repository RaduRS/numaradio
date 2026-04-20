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
import { VoteButtons } from "./VoteButtons";

function VolumeIcon({ muted, level }: { muted: boolean; level: number }) {
  // Speaker body + varying number of wave arcs based on volume level.
  // When muted or zero, render the speaker with a slash.
  const showWave1 = !muted && level > 0;
  const showWave2 = !muted && level > 0.5;
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      style={{ width: 16, height: 16, opacity: 0.85 }}
    >
      <path d="M3 8v4h3l4 3V5L6 8H3z" />
      {showWave1 && <path d="M12 7.4a3 3 0 010 5.2V7.4z" />}
      {showWave2 && (
        <path d="M14 4.8a6 6 0 010 10.4v-1.6a4.5 4.5 0 000-7.2V4.8z" />
      )}
      {muted && (
        <path
          d="M13 7l5 6M18 7l-5 6"
          stroke="currentColor"
          strokeWidth={1.5}
          fill="none"
        />
      )}
    </svg>
  );
}

function VolumeControl() {
  const { volume, isMuted, setVolume, toggleMute } = usePlayer();
  const displayed = isMuted ? 0 : volume;
  return (
    <div className="vol">
      <button
        type="button"
        onClick={toggleMute}
        className="vol-icon-btn"
        aria-label={isMuted ? "Unmute" : "Mute"}
      >
        <VolumeIcon muted={isMuted} level={volume} />
      </button>
      <div className="vol-bar">
        <div className="fill" style={{ width: `${displayed * 100}%` }} />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={displayed}
          onChange={(e) => setVolume(parseFloat(e.target.value))}
          aria-label="Volume"
          className="vol-range"
        />
      </div>
    </div>
  );
}

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
      </div>

      <div className="now-info">
        {np.shoutout?.active && (
          <div className="shoutout-pill" role="status" aria-live="polite">
            <span className="dot" aria-hidden />
            Lena on air
          </div>
        )}
        <div className="track">{title}</div>
        <div className="artist">{artist.toUpperCase()}</div>
        <div className="now-actions">
          <VoteButtons trackId={np.trackId} />
          <div className="now-shares">
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
        <VolumeControl />
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
