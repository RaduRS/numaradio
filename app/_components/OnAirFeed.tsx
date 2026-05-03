"use client";
import { useEffect, useState } from "react";
import { mergeOnAirFeed, type TrackItem, type ShoutItem } from "@/lib/on-air/merge";
import { useBroadcast } from "./useBroadcast";

const POLL_MS = 30_000;
const LIMIT = 20;

// Lucide's Youtube icon (MIT) inlined: lucide-react@1.8 in this repo lacks it.
// Default size = 75% so it fills the parent avatar bubble proportionally
// (the avatar is 42px on the expanded player and ~65px on the 1920x1080
// broadcast page; fixed-pixel sizing looked tiny on the broadcast feed).
// Default suits the ~42px expanded-player avatar. Broadcast mode
// (1920x1080 / 65px avatar) gets bumped up via CSS in
// app/styles/_expanded-player.css — see `.bcast-feed-scroll .ep-onair-avatar svg`.
function YoutubeIcon({ size = "65%" }: { size?: number | string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label="YouTube"
    >
      <path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17" />
      <path d="m10 15 5-3-5-3z" />
    </svg>
  );
}

// `[YT] ` prefix marks shoutouts ingested from YouTube live chat
// (added in app/api/internal/youtube-chat-shoutout/route.ts).
function parseRequester(name: string | undefined): {
  source: "youtube" | "booth";
  clean: string;
} {
  const trimmed = name?.trim() ?? "";
  if (trimmed.startsWith("[YT]")) {
    return { source: "youtube", clean: trimmed.replace(/^\[YT\]\s*/, "") };
  }
  return { source: "booth", clean: trimmed };
}

type ShoutsPayload = {
  shoutouts: Array<{
    id: string;
    text: string;
    requesterName?: string;
    airedAt: string;
  }>;
};

// Module-level cache so reopening the overlay shows the last-known shoutouts
// immediately instead of an empty list while the first fetch is in flight.
let cachedShouts: ShoutItem[] = [];

function relativeTime(fromMs: number, nowMs: number): string {
  const diff = Math.max(0, Math.floor((nowMs - fromMs) / 1000));
  if (diff < 60) return "just now";
  const m = Math.floor(diff / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function OnAirFeed() {
  const { justPlayed, now } = useBroadcast();
  const [shouts, setShouts] = useState<ShoutItem[]>(cachedShouts);

  useEffect(() => {
    const ctrl = new AbortController();
    async function fetchShouts(fresh = false) {
      // Skip while tab is hidden — listener below re-fires on focus.
      // Always run when triggered by a shoutout-ended event though.
      if (
        !fresh &&
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) return;
      try {
        const url = fresh
          ? `/api/station/shoutouts/recent?t=${Date.now()}`
          : "/api/station/shoutouts/recent";
        const r = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
        if (!r.ok) return;
        const json = (await r.json()) as ShoutsPayload;
        cachedShouts = json.shoutouts as ShoutItem[];
        setShouts(cachedShouts);
      } catch {
        /* keep previous */
      }
    }
    fetchShouts();
    const id = setInterval(() => fetchShouts(false), POLL_MS);
    const onEnded = () => window.setTimeout(() => fetchShouts(true), 1_000);
    window.addEventListener("numa:shoutout-ended", onEnded);
    const onVis = () => {
      if (document.visibilityState === "visible") fetchShouts(false);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      window.removeEventListener("numa:shoutout-ended", onEnded);
      document.removeEventListener("visibilitychange", onVis);
      ctrl.abort();
    };
  }, []);

  const tracks: TrackItem[] = justPlayed.map((t) => ({
    trackId: t.trackId,
    title: t.title,
    artistDisplay: t.artistDisplay,
    artworkUrl: t.artworkUrl,
    startedAt: t.startedAt,
    durationSeconds: t.durationSeconds,
  }));

  const items = mergeOnAirFeed(tracks, shouts, LIMIT);

  if (items.length === 0) {
    return (
      <div style={{ color: "var(--fg-mute)", fontSize: 13, padding: "18px 0" }}>
        Nothing on the air log yet — stay tuned.
      </div>
    );
  }

  return (
    <div className="ep-onair">
      {items.map((item) => {
        if (item.kind === "track") {
          return (
            <div key={`t-${item.trackId}-${item.at}`} className="ep-onair-item">
              <div
                className="ep-onair-art"
                style={
                  item.artworkUrl
                    ? { backgroundImage: `url(${item.artworkUrl})` }
                    : undefined
                }
              />
              <div className="ep-onair-main">
                <div className="primary">{item.title}</div>
                <div className="secondary">
                  {item.artistDisplay ?? "—"}
                </div>
              </div>
              <div className="ep-onair-time">{relativeTime(item.at, now)}</div>
            </div>
          );
        }
        const { source, clean } = parseRequester(item.requesterName);
        return (
          <div key={`s-${item.id}`} className="ep-onair-item shout">
            <div className="ep-onair-avatar">
              {source === "youtube" ? (
                <YoutubeIcon />
              ) : (
                (clean[0]?.toUpperCase() ?? "?")
              )}
            </div>
            <div className="ep-onair-main">
              <div className="primary">&ldquo;{item.text}&rdquo;</div>
              <div className="secondary">
                {clean || "Anonymous"} · {relativeTime(item.at, now)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
