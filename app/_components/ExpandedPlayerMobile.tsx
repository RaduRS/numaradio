"use client";
import { useState } from "react";
import { TabBar, type TabId } from "./TabBar";
import { usePlayer } from "./PlayerProvider";
import { useBroadcast } from "./useBroadcast";
import { PauseIcon, PlayIcon, LoadingIcon } from "./Icons";
import { ListenerCount } from "./ListenerCount";

function initials(title: string | undefined): string {
  if (!title) return "··";
  const words = title.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function ListenPane() {
  const { isPlaying, isLoading, toggle } = usePlayer();
  const { nowPlaying } = useBroadcast();
  const live = nowPlaying.isPlaying ? nowPlaying : null;
  const cover = live?.artworkUrl;

  return (
    <div className="ep-listen">
      <div className="ep-listen-meta">
        <span>On Air · Lena</span>
        <span><ListenerCount suffix=" listening" /></span>
      </div>
      <div
        className="ep-listen-art"
        style={
          cover
            ? { backgroundImage: `url(${cover})` }
            : {
                background:
                  "radial-gradient(circle at 30% 20%, #2A4E4B, transparent 60%), radial-gradient(circle at 70% 80%, var(--accent), transparent 55%), linear-gradient(135deg, #1A1E23, #0F1114)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "var(--font-display)",
                fontWeight: 800,
                fontSize: 64,
              }
        }
      >
        {!cover && initials(live?.title)}
      </div>
      <div className="ep-listen-track">
        <div className="ep-listen-title">{live?.title ?? "—"}</div>
        <div className="ep-listen-artist">{live?.artistDisplay ?? "—"}</div>
      </div>
      <button
        className="ep-listen-play"
        type="button"
        onClick={toggle}
        aria-pressed={isPlaying}
        aria-busy={isLoading}
      >
        {isLoading ? <LoadingIcon /> : isPlaying ? <PauseIcon /> : <PlayIcon />}
      </button>
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
          &ldquo;Alright, night owls — that&apos;s Russell sliding into frame.
          Someone in Lisbon asked for slow and a little heartbroken. We&apos;ll
          pick the tempo back up after this one, promise.&rdquo;
        </div>
      </div>
    </div>
  );
}

export function ExpandedPlayerMobile() {
  const [tab, setTab] = useState<TabId>("listen");

  return (
    <div className="ep-mobile">
      <div className="ep-mobile-body">
        {tab === "listen" && <ListenPane />}
        {tab === "request" && <div>Request content — Task 7</div>}
        {tab === "shout" && <div>Shout content — Task 7</div>}
        {tab === "onair" && <div>On Air content — Task 9</div>}
      </div>
      <TabBar active={tab} onChange={setTab} />
    </div>
  );
}
