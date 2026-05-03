"use client";

import { useEffect, useRef, useState } from "react";
import { useFallbackArtworkUrl } from "./FallbackArtworkProvider";
import { Skeleton } from "./Skeleton";
import { Waveform } from "./Waveform";
import { ShareControls } from "./ShareControls";
import { VoteButtons } from "./VoteButtons";

type TrackSummary = {
  trackId: string;
  title: string;
  artistDisplay?: string;
  artworkUrl?: string;
};

type NowPlayingPayload =
  | { isPlaying: false }
  | ({
      isPlaying: true;
      startedAt: string;
      durationSeconds?: number;
    } & TrackSummary);

type UpNextPayload = (TrackSummary & { reasonCode?: string }) | null;

type JustPlayedItem = TrackSummary & {
  startedAt: string;
  durationSeconds?: number;
};

type ShoutoutPayload =
  | { active: false }
  | { active: true; startedAt: string; expectedEndAt: string };

type BroadcastPayload = {
  nowPlaying: NowPlayingPayload;
  upNext: UpNextPayload;
  justPlayed: JustPlayedItem[];
  shoutout: ShoutoutPayload;
};

// Base polling — fast enough that a fresh request or track change shows up
// within a few seconds, slow enough not to hammer the CDN.
const POLL_MS = 6_000;
// Ramp up polling near the expected track boundary so the now-playing swap
// feels instant instead of "we'll catch it in 6s". Widened window so more
// boundary moments fall inside it.
const BOUNDARY_POLL_MS = 1_000;
const BOUNDARY_WINDOW_MS = 30_000;
// When we first see a new trackId, fire one follow-up request ~1s later to
// catch any lag between NowPlaying being written and PlayHistory catching
// up (they're one transaction but the CDN can cache them separately).
const TRACK_CHANGE_FOLLOWUP_MS = 1_000;
const TICK_MS = 1_000;

function initials(title: string): string {
  const words = title.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "··";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function formatMinSec(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const mm = Math.floor(s / 60).toString().padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

function relativeMinutes(fromIso: string, now: number): string {
  const t = new Date(fromIso).getTime();
  const diff = Math.max(0, Math.floor((now - t) / 1000));
  if (diff < 60) return "just now";
  const m = Math.floor(diff / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function useBroadcastFeed() {
  const [data, setData] = useState<BroadcastPayload>({
    nowPlaying: { isPlaying: false },
    upNext: null,
    justPlayed: [],
    shoutout: { active: false },
  });
  // Distinguish "still loading the first response" from "loaded but
  // queue is genuinely empty". Without this, the broadcast list can't
  // show skeleton rows on first paint without also showing them in
  // the (rare) genuinely-empty state.
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState<number>(() => Date.now());
  const mounted = useRef(true);
  const dataRef = useRef<BroadcastPayload>(data);
  dataRef.current = data;
  const lastTrackIdRef = useRef<string | null>(null);
  const followUpIdRef = useRef<number | null>(null);
  const lastShoutoutActiveRef = useRef<boolean>(false);

  useEffect(() => {
    mounted.current = true;
    const ctrl = new AbortController();

    async function poll() {
      // Skip while tab is hidden — visibility listener below re-fires
      // poll() the moment the tab comes back. The boundary scheduler
      // also reschedules from the latest data, so the dynamic cadence
      // self-heals on resume.
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      try {
        const r = await fetch("/api/station/broadcast", {
          signal: ctrl.signal,
          cache: "no-store",
        });
        if (!r.ok) return;
        const json = (await r.json()) as BroadcastPayload;
        if (!mounted.current) return;
        setData(json);
        setLoaded(true);

        // Track-change detection: if the trackId just flipped, schedule
        // one extra fetch in a second to pick up any downstream updates
        // (e.g. the new row's PlayHistory insertion that was cached
        // separately).
        const nextId = json.nowPlaying.isPlaying
          ? json.nowPlaying.trackId
          : null;
        if (
          lastTrackIdRef.current !== null &&
          nextId !== null &&
          lastTrackIdRef.current !== nextId
        ) {
          if (followUpIdRef.current !== null) {
            clearTimeout(followUpIdRef.current);
          }
          followUpIdRef.current = window.setTimeout(() => {
            followUpIdRef.current = null;
            if (mounted.current) poll();
          }, TRACK_CHANGE_FOLLOWUP_MS);
        }
        lastTrackIdRef.current = nextId;

        // Shoutout-end detection: when the overlay flips from active → inactive
        // the DB has just written deliveryStatus='aired'. Fire a window event
        // so the ShoutoutWall can refetch without waiting for its own 30s
        // poll cycle.
        const isActive = json.shoutout.active;
        if (lastShoutoutActiveRef.current && !isActive) {
          window.dispatchEvent(new CustomEvent("numa:shoutout-ended"));
        }
        lastShoutoutActiveRef.current = isActive;
      } catch {
        /* network blip — keep prior */
      }
    }

    // Dynamic polling: tight (2s) within the last 20s of a track so the
    // now-playing swap catches up fast; relaxed (6s) otherwise.
    function scheduleNext() {
      const current = dataRef.current.nowPlaying;
      let delay = POLL_MS;
      if (current.isPlaying && current.durationSeconds) {
        const endsAt =
          new Date(current.startedAt).getTime() +
          current.durationSeconds * 1000;
        const msUntilEnd = endsAt - Date.now();
        if (msUntilEnd <= BOUNDARY_WINDOW_MS) {
          delay = BOUNDARY_POLL_MS;
        }
      }
      return window.setTimeout(async () => {
        if (!mounted.current) return;
        await poll();
        if (!mounted.current) return;
        timeoutId = scheduleNext();
      }, delay);
    }

    poll();
    let timeoutId = scheduleNext();

    const tickId = window.setInterval(() => {
      if (mounted.current) setNow(Date.now());
    }, TICK_MS);

    const onVis = () => {
      if (document.visibilityState === "visible" && mounted.current) poll();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      mounted.current = false;
      clearTimeout(timeoutId);
      if (followUpIdRef.current !== null) clearTimeout(followUpIdRef.current);
      clearInterval(tickId);
      document.removeEventListener("visibilitychange", onVis);
      ctrl.abort();
    };
  }, []);

  return { data, now, loaded };
}

export function Broadcast() {
  const { data, now, loaded } = useBroadcastFeed();
  const { nowPlaying, upNext, justPlayed } = data;

  const live = nowPlaying.isPlaying ? nowPlaying : null;

  let elapsedSeconds = 0;
  let progress = 0;
  if (live?.startedAt && live.durationSeconds) {
    elapsedSeconds = Math.max(
      0,
      Math.min(
        live.durationSeconds,
        (now - new Date(live.startedAt).getTime()) / 1000,
      ),
    );
    progress = live.durationSeconds
      ? Math.min(1, elapsedSeconds / live.durationSeconds)
      : 0;
  }

  const title = live?.title ?? "Warming up";
  const artist = live?.artistDisplay ?? "Numa Radio";
  const art = live?.artworkUrl;
  const fallback = useFallbackArtworkUrl();
  // Fallback only when art is genuinely missing — see PlayerCard for
  // the rationale. Stacking the fallback under live artwork made
  // every track change flash the placeholder.
  const artBg = art ? `url(${art})` : `url(${fallback})`;

  return (
    <section className="broadcast" id="now">
      <div className="shell">
        <div className="broadcast-head">
          <div className="eyebrow">04 — Live Queue</div>
          <h2>The booth.</h2>
          <p className="broadcast-sub">
            On air right now, plus the last handful of tracks Lena put
            through it.
          </p>
        </div>

        <div className="broadcast-grid">
          <div className="broadcast-now">
            <div
              className="broadcast-art"
              style={{
                backgroundImage: artBg,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            >
              <span className="art-share">
                <ShareControls />
              </span>
              <span className="art-vote">
                <VoteButtons trackId={live?.trackId} />
              </span>
            </div>
            <div className="now-track-lg">
              <div className="title">
                {live ? title : <Skeleton width="70%" height={42} radius={4} />}
              </div>
              <div className="sub">
                {live ? (
                  <span>{artist}</span>
                ) : (
                  <Skeleton width="50%" height={18} radius={4} />
                )}
              </div>
            </div>
            <div style={{ marginTop: 28 }}>
              <Waveform
                hasTrack={Boolean(live)}
                progress={progress}
                elapsedSeconds={elapsedSeconds}
                durationSeconds={live?.durationSeconds ?? null}
                showTime
              />
            </div>
          </div>

          <div className="broadcast-next">
            <div className="up-next-head">
              <h3>{upNext ? "Up Next" : "Just Played"}</h3>
            </div>
            <div className="queue-list">
              {upNext && (
                <div className="queue-item lena-row">
                  <div className="q-pos">—</div>
                  <div
                    className="q-art"
                    style={
                      upNext.artworkUrl
                        ? {
                            backgroundImage: `url(${upNext.artworkUrl})`,
                            backgroundSize: "cover",
                            backgroundPosition: "center",
                          }
                        : undefined
                    }
                  >
                    {!upNext.artworkUrl && initials(upNext.title)}
                  </div>
                  <div className="q-info">
                    <div className="q-title">
                      <span className="q-tag">Up next · request</span>
                      {upNext.title}
                    </div>
                    <div className="q-artist">
                      {upNext.artistDisplay ?? "—"}
                    </div>
                  </div>
                  <div className="q-dur">queued</div>
                  <div />
                </div>
              )}

              {upNext && justPlayed.length > 0 && (
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    color: "var(--fg-mute)",
                    padding: "12px 18px 4px",
                  }}
                >
                  Just played
                </div>
              )}

              {justPlayed.length === 0 && !upNext && loaded && (
                <div
                  style={{
                    padding: "28px 18px",
                    color: "var(--fg-mute)",
                    fontSize: 14,
                  }}
                >
                  Nothing logged yet — stay tuned.
                </div>
              )}

              {!loaded && justPlayed.length === 0 && !upNext && (
                <>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div key={i} className="queue-item" aria-hidden="true">
                      <div className="q-pos">
                        <Skeleton width={20} height={11} radius={3} />
                      </div>
                      <div className="q-art">
                        <Skeleton width={56} height={56} radius={6} />
                      </div>
                      <div className="q-info">
                        <Skeleton width="65%" height={14} radius={4} style={{ marginBottom: 6 }} />
                        <Skeleton width="40%" height={11} radius={3} />
                      </div>
                      <div className="q-dur">
                        <Skeleton width={36} height={11} radius={3} />
                      </div>
                      <div />
                    </div>
                  ))}
                </>
              )}

              {justPlayed.map((item, i) => (
                <div key={`${item.trackId}-${item.startedAt}`} className="queue-item">
                  <div className="q-pos">{String(i + 1).padStart(2, "0")}</div>
                  <div
                    className={`q-art v${(i % 4) + 2}`}
                    style={
                      item.artworkUrl
                        ? {
                            backgroundImage: `url(${item.artworkUrl})`,
                            backgroundSize: "cover",
                            backgroundPosition: "center",
                          }
                        : undefined
                    }
                  >
                    {!item.artworkUrl && initials(item.title)}
                  </div>
                  <div className="q-info">
                    <div className="q-title">{item.title}</div>
                    <div className="q-artist">
                      {item.artistDisplay ?? "—"}
                      {" · "}
                      {relativeMinutes(item.startedAt, now)}
                    </div>
                  </div>
                  <div className="q-dur">
                    {item.durationSeconds
                      ? formatMinSec(item.durationSeconds)
                      : "—"}
                  </div>
                  <div />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
