"use client";

import { usePlayer } from "./PlayerProvider";
import { LoadingIcon, PauseIcon, PlayIcon } from "./Icons";
import { LiveClock } from "./LiveClock";
import { Waveform } from "./Waveform";
import { useNowPlaying } from "./useNowPlaying";
import { VoteButtons } from "./VoteButtons";
import { VolumeControl } from "./VolumeControl";
import { ShareControls } from "./ShareControls";
import { useFallbackArtworkUrl } from "./FallbackArtworkProvider";

export function PlayerCard() {
  const { status, isPlaying, isLoading, toggle, expand } = usePlayer();
  const np = useNowPlaying();
  const fallback = useFallbackArtworkUrl();

  const title = np.title ?? "—";
  const artist = np.artistDisplay ?? "—";
  const cover = np.artworkUrl;
  // Fallback PNG is a TRUE failsafe — only shown when the track
  // genuinely has no artworkUrl. Earlier we stacked it as a CSS
  // background under the real cover so it filled the brief B2 load
  // gap, but that meant every track-change flashed the placeholder
  // while the new image fetched. Now: real artwork → real artwork
  // only (brief dark box during loads is acceptable). Missing
  // artwork → fallback.
  const backgroundImage = cover ? `url(${cover})` : `url(${fallback})`;

  return (
    <div
      className="player-card"
      onClick={(e) => expand(e.currentTarget)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          expand(e.currentTarget);
        }
      }}
    >
      <div className="player-head">
        <div className="onair">
          {np.shoutout?.active ? "On Air" : "On Air — Lena"}
        </div>
        <div className="player-time"><LiveClock /></div>
      </div>

      <div
        className="now-art"
        style={{
          backgroundImage,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />

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
          <span onClick={(e) => e.stopPropagation()}>
            <VoteButtons trackId={np.trackId} />
          </span>
          <span onClick={(e) => e.stopPropagation()}>
            <ShareControls />
          </span>
        </div>
      </div>

      <Waveform
        hasTrack={np.isPlaying}
        progress={np.progress}
        elapsedSeconds={np.elapsedSeconds}
        durationSeconds={np.durationSeconds}
        showTime
      />

      <div className="player-controls">
        <button
          className="btn-play"
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
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
        <span onClick={(e) => e.stopPropagation()}>
          <VolumeControl />
        </span>
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
