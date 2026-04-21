"use client";

import { useEffect, useState } from "react";

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

function initial(name: string | undefined): string {
  const trimmed = name?.trim();
  if (!trimmed) return "?";
  return trimmed[0].toUpperCase();
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
  return (
    <div className={`shout-card${featured ? " featured" : ""}`}>
      <div className="shout-head">
        <div className={`shout-avatar ${avatarClass}`.trim()}>
          {initial(item.requesterName)}
        </div>
        <div className="shout-meta">
          <div className="shout-name">{item.requesterName ?? "Anonymous"}</div>
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

    return () => {
      clearInterval(pollId);
      clearInterval(tickId);
      window.removeEventListener("numa:shoutout-ended", onShoutoutEnded);
      ctrl.abort();
    };
  }, []);

  if (items === null) {
    return (
      <>
        <div className="shout-col" aria-hidden />
        <div className="shout-col" aria-hidden />
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
