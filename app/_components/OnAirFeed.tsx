"use client";
import { useEffect, useState } from "react";
import { mergeOnAirFeed, type TrackItem, type ShoutItem } from "@/lib/on-air/merge";
import { useBroadcast } from "./useBroadcast";

const POLL_MS = 30_000;
const LIMIT = 20;

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
    return () => {
      clearInterval(id);
      window.removeEventListener("numa:shoutout-ended", onEnded);
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
        const initial = (item.requesterName ?? "?").trim()[0]?.toUpperCase() ?? "?";
        return (
          <div key={`s-${item.id}`} className="ep-onair-item shout">
            <div className="ep-onair-avatar">{initial}</div>
            <div className="ep-onair-main">
              <div className="primary">&ldquo;{item.text}&rdquo;</div>
              <div className="secondary">
                {item.requesterName ?? "Anonymous"} · {relativeTime(item.at, now)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
