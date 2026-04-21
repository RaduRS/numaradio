"use client";

import { usePlayer } from "./PlayerProvider";
import { useBroadcast } from "./useBroadcast";
import { PauseIcon, PlayIcon, LoadingIcon } from "./Icons";

function fmtDuration(totalSeconds: number | undefined): string {
  if (!totalSeconds || !Number.isFinite(totalSeconds)) return "—";
  const s = Math.max(0, Math.round(totalSeconds));
  const mm = Math.floor(s / 60).toString().padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

function relativeMinutes(fromIso: string, nowMs: number): string {
  const t = new Date(fromIso).getTime();
  const diff = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (diff < 60) return "just now";
  const m = Math.floor(diff / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function initials(title: string | undefined): string {
  if (!title) return "··";
  const words = title.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function ExpandedPlayerDesktop() {
  const { isPlaying, isLoading, toggle } = usePlayer();
  const { nowPlaying, justPlayed, now } = useBroadcast();

  const live = nowPlaying.isPlaying ? nowPlaying : null;
  const cover = live?.artworkUrl;
  const title = live?.title ?? "—";
  const artist = live?.artistDisplay ?? "—";

  return (
    <div className="ep-booth">
      {/* Left — artwork + controls */}
      <div className="ep-booth-left">
        <div
          className={`ep-booth-art ${cover ? "" : "ep-booth-art-fallback"}`}
          style={cover ? { backgroundImage: `url(${cover})` } : undefined}
        >
          {!cover && initials(live?.title)}
        </div>
        <div className="ep-booth-track">
          <div className="ep-booth-title">{title}</div>
          <div className="ep-booth-artist">{artist}</div>
        </div>
        <div className="ep-booth-controls">
          <button
            className="btn-play"
            onClick={toggle}
            aria-pressed={isPlaying}
            aria-busy={isLoading}
            style={{ width: 64, height: 64 }}
          >
            {isLoading ? <LoadingIcon /> : isPlaying ? <PauseIcon /> : <PlayIcon />}
          </button>
        </div>
      </div>

      {/* Right — Lena card + Just Played */}
      <div className="ep-booth-right">
        <div className="ep-booth-lena">
          <div className="tag">Lena · on the mic</div>
          <div className="quote">
            &ldquo;Alright, night owls — that&apos;s Russell sliding into frame.
            Someone in Lisbon asked for slow and a little heartbroken. I heard
            you. We&apos;ll pick the tempo back up after this one,
            promise.&rdquo;
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div className="ep-justplayed-head">Just Played</div>
          <div className="ep-justplayed-list">
            {justPlayed.map((item) => (
              <div key={`${item.trackId}-${item.startedAt}`} className="ep-jp-row">
                <div
                  className="ep-jp-art"
                  style={
                    item.artworkUrl
                      ? { backgroundImage: `url(${item.artworkUrl})` }
                      : undefined
                  }
                />
                <div>
                  <div className="ep-jp-title">{item.title}</div>
                  <div className="ep-jp-meta">
                    {item.artistDisplay ?? "—"}
                  </div>
                </div>
                <div className="ep-jp-time">
                  {relativeMinutes(item.startedAt, now)}
                  {item.durationSeconds ? ` · ${fmtDuration(item.durationSeconds)}` : ""}
                </div>
              </div>
            ))}
            {justPlayed.length === 0 && (
              <div
                style={{ color: "var(--fg-mute)", fontSize: 13, padding: 16 }}
              >
                Nothing logged yet — stay tuned.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
