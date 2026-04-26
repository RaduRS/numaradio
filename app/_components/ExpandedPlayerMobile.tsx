"use client";
import { useState } from "react";
import { TabBar, type TabId } from "./TabBar";
import { usePlayer } from "./PlayerProvider";
import { useBroadcast } from "./useBroadcast";
import { useNowPlaying } from "./useNowPlaying";
import { PauseIcon, PlayIcon, LoadingIcon } from "./Icons";
import { ListenerCount } from "./ListenerCount";
import { RequestForm } from "./RequestForm";
import { OnAirFeed } from "./OnAirFeed";
import { ShareControls } from "./ShareControls";
import { VolumeControl } from "./VolumeControl";
import { VoteButtons } from "./VoteButtons";
import { LiveClock } from "./LiveClock";
import { useFallbackArtworkUrl } from "./FallbackArtworkProvider";
import { Waveform } from "./Waveform";
import { LenaLine } from "./LenaLine";

function ListenPane() {
  const { status, isPlaying, isLoading, toggle } = usePlayer();
  const { nowPlaying } = useBroadcast();
  // Fresh-from-MiniPlayer cache; instant on first open.
  const np = useNowPlaying();
  const fallback = useFallbackArtworkUrl();
  const live = np.isPlaying
    ? np
    : nowPlaying.isPlaying
      ? nowPlaying
      : null;
  const cover = live?.artworkUrl;
  // Fallback only when cover is genuinely missing.
  const coverBg = cover ? `url(${cover})` : `url(${fallback})`;

  return (
    <div className="ep-listen">
      <div className="ep-listen-meta">
        <span><LiveClock /></span>
        <span><ListenerCount suffix=" listening" /></span>
      </div>
      <div className="ep-listen-art" style={{ backgroundImage: coverBg }}>
        <div className="ep-art-share">
          <ShareControls />
        </div>
        <div className="ep-art-vote">
          <VoteButtons trackId={live?.trackId} />
        </div>
      </div>
      <div className="ep-listen-track">
        <div className="ep-listen-title">{live?.title ?? "—"}</div>
        <div className="ep-listen-artist">{live?.artistDisplay ?? "—"}</div>
      </div>
      <Waveform
        hasTrack={Boolean(live)}
        progress={np.progress}
        elapsedSeconds={np.elapsedSeconds}
        durationSeconds={live?.durationSeconds ?? null}
        showTime
      />
      <div className="ep-controls">
        <button
          className="ep-listen-play"
          type="button"
          onClick={toggle}
          aria-pressed={isPlaying}
          aria-busy={isLoading}
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
      <div className="ep-listen-lena">
        <div style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--accent)",
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          marginBottom: 6,
        }}>Lena · on the mic</div>
        <div style={{ fontSize: 13, lineHeight: 1.5 }}>
          <LenaLine layout="quote-only" />
        </div>
      </div>
    </div>
  );
}

const REQUEST_TAB_HEADING: React.CSSProperties = {
  fontFamily: "var(--font-display)",
  fontWeight: 800,
  fontStretch: "115%",
  fontSize: 22,
  lineHeight: 1,
  textTransform: "uppercase",
  marginBottom: 14,
};

export function ExpandedPlayerMobile() {
  const [tab, setTab] = useState<TabId>("listen");

  // The bottom "Request" + "Shout" tabs and the form's "song" / "shout" sub-
  // tabs are two views of the same state. Selecting a sub-tab inside the form
  // updates the bottom tab so the bar always reflects what the user sees.
  const formSubTab: "song" | "shout" = tab === "shout" ? "shout" : "song";
  function setFormSubTab(next: "song" | "shout") {
    setTab(next === "shout" ? "shout" : "request");
  }

  return (
    <div className="ep-mobile">
      <div className="ep-mobile-body">
        {tab === "listen" && <ListenPane />}
        {(tab === "request" || tab === "shout") && (
          <div className="ep-form-pane">
            <h3 style={REQUEST_TAB_HEADING}>
              {tab === "shout" ? <>Say it<br />on air.</> : <>To the<br />booth.</>}
            </h3>
            <RequestForm tab={formSubTab} onTabChange={setFormSubTab} />
          </div>
        )}
        {tab === "onair" && (
          <div className="ep-form-pane">
            <h3 style={REQUEST_TAB_HEADING}>
              The booth,<br />live.
            </h3>
            <OnAirFeed />
          </div>
        )}
      </div>
      <TabBar active={tab} onChange={setTab} />
    </div>
  );
}
