"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "./Skeleton";

// Lucide's Youtube icon (MIT) inlined: lucide-react@1.8 in this repo lacks it.
// Default size = 75% so it fills the parent avatar bubble proportionally
// (avatar is 28px on the wall, 42px on expanded player, ~65px on the
// 1920x1080 broadcast page — fixed-pixel sizing looked tiny on the latter).
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

const POLL_MS = 30_000;

type ApiShoutout = {
  id: string;
  text: string;
  requesterName?: string;
  airedAt: string;
  track?: { title: string; artistDisplay?: string };
};

type Payload = { shoutouts: ApiShoutout[] };

// Avatar palette classes defined in _design-sections.css. The first card on
// the page uses the default (no suffix); the rest cycle through c2–c5.
const AVATAR_CLASSES = ["", "c2", "c3", "c4", "c5"];

// `[YT] ` prefix is added by the YouTube-chat ingest route to mark shoutouts
// from live chat. We strip it for display and render a YouTube icon avatar.
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

function formatRelative(iso: string, now: number): string {
  const t = new Date(iso).getTime();
  const diff = Math.max(0, Math.floor((now - t) / 1000));
  if (diff < 60) return "just now";
  const m = Math.floor(diff / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function splitColumns<T>(items: T[]): [T[], T[]] {
  const left: T[] = [];
  const right: T[] = [];
  items.forEach((item, i) => {
    if (i % 2 === 0) left.push(item);
    else right.push(item);
  });
  return [left, right];
}

function ShoutoutCard({
  item,
  avatarClass,
  featured,
  now,
}: {
  item: ApiShoutout;
  avatarClass: string;
  featured?: boolean;
  now: number;
}) {
  const { source, clean } = parseRequester(item.requesterName);
  return (
    <div className={`shout-card${featured ? " featured" : ""}`}>
      <div className="shout-head">
        <div className={`shout-avatar ${avatarClass}`.trim()}>
          {source === "youtube" ? (
            <YoutubeIcon />
          ) : (
            (clean[0]?.toUpperCase() ?? "?")
          )}
        </div>
        <div className="shout-meta">
          <div className="shout-name">{clean || "Anonymous"}</div>
          <div className="shout-time">{formatRelative(item.airedAt, now)}</div>
        </div>
        <div className="shout-tag live">Aired</div>
      </div>
      <div className="shout-text">&ldquo;{item.text}&rdquo;</div>
      {item.track && (
        <div className="shout-track">
          <span className="ico" />
          <span className="tt">{item.track.title}</span>
          {item.track.artistDisplay && (
            <>
              <span className="sep">·</span>
              <span className="ta">{item.track.artistDisplay}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function ShoutoutWall() {
  const [items, setItems] = useState<ApiShoutout[] | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const ctrl = new AbortController();

    // Regular polls hit the CDN-cached URL (30s s-maxage). Event-triggered
    // refetches append a timestamp so they bypass the cache and see the
    // freshly-written "aired" row.
    async function poll(fresh = false) {
      // Skip routine polls while tab is hidden; event-triggered refetches
      // (fresh=true from numa:shoutout-ended) and visibility-resume
      // refetches always run.
      if (
        !fresh &&
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) return;
      try {
        const url = fresh
          ? `/api/station/shoutouts/recent?t=${Date.now()}`
          : "/api/station/shoutouts/recent";
        const r = await fetch(url, {
          signal: ctrl.signal,
          cache: "no-store",
        });
        if (!r.ok) return;
        const json = (await r.json()) as Payload;
        setItems(json.shoutouts);
      } catch {
        /* keep previous */
      }
    }

    poll();
    const pollId = setInterval(() => poll(false), POLL_MS);
    const tickId = setInterval(() => setNow(Date.now()), 30_000);

    // Refetch as soon as Broadcast detects a shoutout has finished airing —
    // the `deliveryStatus='aired'` row has just been written, so the wall
    // should update within a second instead of waiting for the next poll.
    const onShoutoutEnded = () => {
      // Tiny delay to let the shoutout-ended webhook's DB write commit
      // before we re-read.
      window.setTimeout(() => poll(true), 1_000);
    };
    window.addEventListener("numa:shoutout-ended", onShoutoutEnded);

    const onVis = () => {
      if (document.visibilityState === "visible") poll(false);
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      clearInterval(pollId);
      clearInterval(tickId);
      window.removeEventListener("numa:shoutout-ended", onShoutoutEnded);
      document.removeEventListener("visibilitychange", onVis);
      ctrl.abort();
    };
  }, []);

  if (items === null) {
    // Skeleton cards while the wall fetches its first response. Static
    // variant (no shimmer): three card-shaped skeletons per column
    // would be visually loud against the shimmering hero stats above
    // — quiet height-reservation is enough below the fold.
    const col = (prefix: string) => (
      <div className="shout-col" aria-hidden>
        {[0, 1, 2].map((i) => (
          <Skeleton
            key={`${prefix}-${i}`}
            variant="static"
            width="100%"
            height={120}
            radius={12}
          />
        ))}
      </div>
    );
    return (
      <>
        {col("L")}
        {col("R")}
      </>
    );
  }

  if (items.length === 0) {
    return (
      <div
        className="shout-col"
        style={{
          gridColumn: "span 2",
          color: "var(--fg-mute)",
          fontSize: 14,
          padding: "28px 18px",
        }}
      >
        No shoutouts on air yet. Send one — yours could be the first.
      </div>
    );
  }

  const [left, right] = splitColumns(items);

  return (
    <>
      <div className="shout-col">
        {left.map((item, i) => (
          <ShoutoutCard
            key={item.id}
            item={item}
            avatarClass={AVATAR_CLASSES[(i * 2) % AVATAR_CLASSES.length]}
            featured={i === 0}
            now={now}
          />
        ))}
      </div>
      <div className="shout-col">
        {right.map((item, i) => (
          <ShoutoutCard
            key={item.id}
            item={item}
            avatarClass={AVATAR_CLASSES[(i * 2 + 1) % AVATAR_CLASSES.length]}
            now={now}
          />
        ))}
      </div>
    </>
  );
}
