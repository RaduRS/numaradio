"use client";

import { usePlayer } from "./PlayerProvider";
import { useBroadcast } from "./useBroadcast";
import { useNowPlaying } from "./useNowPlaying";
import { PauseIcon, PlayIcon, LoadingIcon } from "./Icons";
import { ShareControls } from "./ShareControls";
import { VolumeControl } from "./VolumeControl";
import { VoteButtons } from "./VoteButtons";
import { OnAirFeed } from "./OnAirFeed";

function initials(title: string | undefined): string {
  if (!title) return "··";
  const words = title.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function ExpandedPlayerDesktop() {
  const { status, isPlaying, isLoading, toggle } = usePlayer();
  const { nowPlaying } = useBroadcast();
  // Prefer useNowPlaying for the track card — its singleton cache is kept
  // warm by MediaSessionSync at layout level, so artwork/title/artist are
  // available instantly on first open. useBroadcast may take ~500ms to
  // populate; we only need it for the feed/upNext/shoutout extras.
  const np = useNowPlaying();

  const live = np.isPlaying
    ? np
    : nowPlaying.isPlaying
      ? nowPlaying
      : null;
  const cover = live?.artworkUrl;
  const title = live?.title ?? "—";
  const artist = live?.artistDisplay ?? "—";

  return (
    <div className="ep-booth">
      {/* Left — Listen view: artwork, track, controls, Lena card.
          Mirrors the mobile Listen tab. */}
      <div className="ep-booth-left">
        <div
          className={`ep-booth-art ${cover ? "" : "ep-booth-art-fallback"}`}
          style={cover ? { backgroundImage: `url(${cover})` } : undefined}
        >
          {!cover && initials(live?.title)}
          <div className="ep-art-share">
            <ShareControls />
          </div>
          <div className="ep-art-vote">
            <VoteButtons trackId={live?.trackId} />
          </div>
        </div>
        <div className="ep-booth-track">
          <div className="ep-booth-title">{title}</div>
          <div className="ep-booth-artist">{artist}</div>
        </div>
        <div className="ep-controls">
          <button
            className="btn-play"
            onClick={toggle}
            aria-pressed={isPlaying}
            aria-busy={isLoading}
            style={{ width: 64, height: 64 }}
          >
            {isLoading ? <LoadingIcon /> : isPlaying ? <PauseIcon /> : <PlayIcon />}
          </button>
          <div className="ep-status">
            <div className="lbl">Streaming · 192kbps</div>
            <div className="val">
              {status === "loading"
                ? "Connecting…"
                : status === "error"
                  ? "Stream error — try again"
                  : "Live"}
            </div>
          </div>
          <VolumeControl />
        </div>
        <div className="ep-booth-lena">
          <div className="tag">Lena · on the mic</div>
          <div className="quote">
            &ldquo;Alright, night owls — that&apos;s Russell sliding into frame.
            Someone in Lisbon asked for slow and a little heartbroken. I heard
            you. We&apos;ll pick the tempo back up after this one,
            promise.&rdquo;
          </div>
        </div>
      </div>

      {/* Right — On Air view: chronological mix of tracks + shoutouts.
          Mirrors the mobile On Air tab. */}
      <div className="ep-booth-right">
        <div className="ep-justplayed-head">The booth, live</div>
        <div className="ep-booth-feed">
          <OnAirFeed />
        </div>
      </div>
    </div>
  );
}
