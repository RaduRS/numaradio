# Expanded Player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a near-fullscreen expanded player. Desktop = Booth two-column layout (artwork+controls left, Lena+Just Played right). Mobile = full-viewport takeover with Listen / Request / Shout / On Air tabs. Triggered by tapping anywhere on `PlayerCard` or `MiniPlayer` (except play/pause + request buttons); closed via chevron-down at top, `Esc` on desktop, or swipe-down on mobile.

**Architecture:** Expanded state (`isExpanded`, `expand`, `collapse`, `expandSourceRect`) lives in the existing `PlayerProvider` so every page shares one source of truth and the audio element never unmounts during the overlay transition. A single `<ExpandedPlayer />` component mounts under `PlayerProvider` in `app/layout.tsx` and renders `null` unless `isExpanded`. Inside the overlay, a CSS media query (`>= 900px`) decides whether the desktop Booth or mobile Tabs layout renders. The "On Air" merge logic is extracted to a pure function in `lib/on-air/merge.ts` with unit tests; everything else is behavioural React that we smoke-test manually with Playwright.

**Tech Stack:** Next.js 16 App Router + Turbopack (note: `AGENTS.md` — read `node_modules/next/dist/docs/` if you hit anything unexpected), React 19, plain CSS in `app/styles/` (imported via `app/globals.css`), Prisma on the data path (no schema changes here), Node test runner (`node --test --experimental-strip-types`).

**Spec:** `docs/superpowers/specs/2026-04-21-expanded-player-design.md`

---

## File structure

**New files:**
- `app/_components/ExpandedPlayer.tsx` — overlay orchestrator: mounts when `isExpanded`, picks desktop vs mobile, owns close handlers (chevron, Esc, swipe).
- `app/_components/ExpandedPlayerDesktop.tsx` — Booth two-column layout.
- `app/_components/ExpandedPlayerMobile.tsx` — mobile 4-tab layout.
- `app/_components/RequestForm.tsx` — extracted from `Requests.tsx`; owns tab state (song / shout) and submit behaviour. Reused by the landing page and by the Request/Shout mobile tabs.
- `app/_components/TabBar.tsx` — bottom tab bar for the mobile layout.
- `app/_components/OnAirFeed.tsx` — fetches broadcast + shoutouts, renders the merged list.
- `lib/on-air/merge.ts` — pure merge + sort helper.
- `lib/on-air/merge.test.ts` — unit tests.
- `app/styles/_expanded-player.css` — all styles for the overlay.

**Modified files:**
- `app/_components/PlayerProvider.tsx` — add `isExpanded`, `expand(sourceEl?)`, `collapse`, `expandSourceRect`.
- `app/_components/PlayerCard.tsx` — root surface becomes clickable (`expand(e.currentTarget)`); `stopPropagation` on play/pause.
- `app/_components/MiniPlayer.tsx` — same pattern; `stopPropagation` on play/pause and request link.
- `app/_components/Requests.tsx` — delete inline form markup, render `<RequestForm />`.
- `app/_components/Mobile.tsx` — rewrite Phone 1 JSX so it's a visual clone of the mobile Listen tab.
- `app/layout.tsx` — mount `<ExpandedPlayer />` inside `<PlayerProvider>`.
- `app/globals.css` — `@import "./styles/_expanded-player.css"`.

---

## Task 1: Extend `PlayerProvider` with expand/collapse state

**Files:**
- Modify: `app/_components/PlayerProvider.tsx`

No UI yet — only state. Consumers will compile immediately; `expand` is a no-op beyond setting the flag.

- [ ] **Step 1: Add fields to the `PlayerState` type**

In `app/_components/PlayerProvider.tsx`, find the `type PlayerState = { … }` block (around the top of the file) and extend it:

```typescript
type PlayerState = {
  status: PlayerStatus;
  isPlaying: boolean;
  isLoading: boolean;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  volume: number;
  isMuted: boolean;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  // --- expanded-player additions ---
  isExpanded: boolean;
  expand: (sourceEl?: Element | null) => void;
  collapse: () => void;
  expandSourceRect: DOMRect | null;
};
```

- [ ] **Step 2: Add state + callbacks inside `PlayerProvider`**

Inside the `PlayerProvider` component body, right after the existing `useState` calls for volume/mute, add:

```typescript
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandSourceRect, setExpandSourceRect] = useState<DOMRect | null>(null);

  const expand = useCallback((sourceEl?: Element | null) => {
    setExpandSourceRect(sourceEl ? sourceEl.getBoundingClientRect() : null);
    setIsExpanded(true);
  }, []);

  const collapse = useCallback(() => {
    setIsExpanded(false);
    // Keep the source rect — the overlay uses it to animate back to the
    // source position during the exit transition. Clear it a beat later.
    window.setTimeout(() => setExpandSourceRect(null), 400);
  }, []);
```

- [ ] **Step 3: Expose the new fields on the context value**

Find the `const value: PlayerState = { … }` assignment near the bottom of `PlayerProvider` and add the new keys:

```typescript
  const value: PlayerState = {
    status,
    isPlaying: status === "playing",
    isLoading: status === "loading",
    toggle,
    play,
    pause,
    volume,
    isMuted,
    setVolume,
    toggleMute,
    isExpanded,
    expand,
    collapse,
    expandSourceRect,
  };
```

- [ ] **Step 4: Verify build**

Run: `npm run lint 2>&1 | grep -E "PlayerProvider|expand" | head -10`
Expected: empty output (no new lint errors in the file you just edited).

Run: `npx tsc --noEmit 2>&1 | grep -i "playerprovider\|expand" | head -10`
Expected: empty (Prisma client already has types; nothing should complain).

- [ ] **Step 5: Commit**

```bash
git add app/_components/PlayerProvider.tsx
git commit -m "$(cat <<'EOF'
player: add isExpanded state + expand/collapse to PlayerProvider

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Overlay skeleton, click triggers, Esc handler

**Files:**
- Create: `app/_components/ExpandedPlayer.tsx`
- Create: `app/styles/_expanded-player.css`
- Modify: `app/globals.css`
- Modify: `app/layout.tsx`
- Modify: `app/_components/PlayerCard.tsx`
- Modify: `app/_components/MiniPlayer.tsx`

End state: tap anywhere on PlayerCard/MiniPlayer (except play/pause + request) opens a blank full-viewport overlay with a single chevron-down button. Chevron or Esc closes it. No animation yet; no real content yet.

- [ ] **Step 1: Create the stylesheet stub**

Create `app/styles/_expanded-player.css` with:

```css
/* Expanded Player — overlay that morphs from PlayerCard/MiniPlayer into a
   near-fullscreen station monitor (desktop) or app-like tab layout (mobile). */

.ep-root {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(10, 13, 14, 0.92);
  backdrop-filter: blur(14px);
  display: flex;
  align-items: stretch;
  justify-content: stretch;
  opacity: 0;
  pointer-events: none;
  transition: opacity 200ms ease;
}
.ep-root.open {
  opacity: 1;
  pointer-events: auto;
}

.ep-shell {
  position: absolute;
  inset: 2vh 2vw;
  background: linear-gradient(180deg, #12151A, #0A0D0E);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 16px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.ep-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.ep-chev {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.06);
  border: none;
  color: var(--fg);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 140ms ease;
}
.ep-chev:hover { background: rgba(255, 255, 255, 0.12); }

.ep-topbar-center {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--fg-mute);
}

@media (max-width: 899px) {
  .ep-shell {
    inset: 0;
    border-radius: 0;
    border: none;
  }
}
```

- [ ] **Step 2: Import the stylesheet in globals.css**

Open `app/globals.css` and add this line alongside the other `@import`s (near the top of the file, after any existing style imports):

```css
@import "./styles/_expanded-player.css";
```

- [ ] **Step 3: Create the overlay component**

Create `app/_components/ExpandedPlayer.tsx`:

```typescript
"use client";

import { useEffect } from "react";
import { usePlayer } from "./PlayerProvider";

export function ExpandedPlayer() {
  const { isExpanded, collapse } = usePlayer();

  // Esc closes — desktop only really, but cheap everywhere.
  useEffect(() => {
    if (!isExpanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") collapse();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isExpanded, collapse]);

  // Lock body scroll while open so the underlying page doesn't jump.
  useEffect(() => {
    if (!isExpanded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isExpanded]);

  if (!isExpanded) return null;

  return (
    <div
      className="ep-root open"
      role="dialog"
      aria-modal="true"
      aria-label="Expanded player"
    >
      <div className="ep-shell">
        <div className="ep-topbar">
          <button
            type="button"
            className="ep-chev"
            onClick={collapse}
            aria-label="Close expanded player"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
              <path d="M5 7l5 6 5-6z" />
            </svg>
          </button>
          <div className="ep-topbar-center">● On Air — Lena</div>
          <div style={{ width: 36 }} />
        </div>
        {/* body placeholder — Task 3+ fills this */}
        <div style={{ flex: 1 }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Mount the overlay in the root layout**

Open `app/layout.tsx`. Find the block:

```jsx
<PlayerProvider>
  {children}
  <MiniPlayer />
</PlayerProvider>
```

Add `ExpandedPlayer` under it:

```jsx
import { ExpandedPlayer } from "./_components/ExpandedPlayer";
// …
<PlayerProvider>
  {children}
  <MiniPlayer />
  <ExpandedPlayer />
</PlayerProvider>
```

- [ ] **Step 5: Wire `PlayerCard` root click**

Open `app/_components/PlayerCard.tsx`. Change the top-level `<div className="player-card">` so its onClick expands, and add `stopPropagation` to the play button onClick:

```tsx
export function PlayerCard() {
  const { status, isPlaying, isLoading, toggle, expand } = usePlayer();
  // …
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
      {/* … */}
      <button
        className="btn-play"
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
        aria-pressed={isPlaying}
        aria-busy={isLoading}
      >
        {/* … */}
      </button>
      {/* … */}
    </div>
  );
}
```

Also add `e.stopPropagation()` to any other clickable children that should NOT expand: the `VolumeControl`'s `vol-icon-btn` mute toggle, the `VoteButtons` (in `VoteButtons.tsx` — add `stopPropagation` there too if it doesn't already), and the share buttons. For buttons you don't edit the onClick of directly, wrap them in `<span onClick={(e) => e.stopPropagation()}>`.

- [ ] **Step 6: Wire `MiniPlayer` root click**

Open `app/_components/MiniPlayer.tsx`. Change the outer `<div className={…mini-player…}>` to be clickable:

```tsx
export function MiniPlayer() {
  const { isPlaying, isLoading, toggle, expand } = usePlayer();
  // …
  return (
    <div
      className={`mini-player ${show ? "show" : ""}`}
      id="mini-player"
      onClick={(e) => expand(e.currentTarget)}
      role="button"
      tabIndex={0}
    >
      <button
        className="mp-btn-play"
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
        aria-pressed={isPlaying}
        aria-busy={isLoading}
      >
        {/* … */}
      </button>
      {/* … */}
      <a
        className="mp-req-btn"
        href="#requests"
        onClick={(e) => e.stopPropagation()}
      >
        Request
      </a>
    </div>
  );
}
```

- [ ] **Step 7: Smoke test**

Run: `npm run dev` (in background) and open http://localhost:3000/.
- Click on the PlayerCard body (NOT the play button) → overlay opens with chevron + "On Air — Lena".
- Click the chevron → closes.
- Open it again, press Esc → closes.
- Click the play button → should toggle play, NOT open overlay.
- Scroll down until the mini-player appears, click it → opens.
- Click the mini-player play button or Request link → should act normally, NOT open overlay.

- [ ] **Step 8: Commit**

```bash
git add app/_components/ExpandedPlayer.tsx \
        app/_components/PlayerCard.tsx \
        app/_components/MiniPlayer.tsx \
        app/layout.tsx \
        app/globals.css \
        app/styles/_expanded-player.css
git commit -m "$(cat <<'EOF'
expanded-player: skeleton overlay + click triggers + Esc to close

Clicking anywhere on PlayerCard or MiniPlayer (except play/pause and
request) opens a blank near-fullscreen overlay with a chevron-down
close button. Esc also closes. No content or animation yet.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Desktop Booth layout (artwork + controls + Lena + Just Played)

**Files:**
- Create: `app/_components/ExpandedPlayerDesktop.tsx`
- Modify: `app/_components/ExpandedPlayer.tsx`
- Modify: `app/styles/_expanded-player.css`

End state: on viewports ≥ 900 px, the overlay shows the Booth layout — big artwork + controls in the left column, Lena commentary + Just Played feed on the right.

- [ ] **Step 1: Extend the stylesheet**

Append to `app/styles/_expanded-player.css`:

```css
/* Desktop Booth layout */
.ep-booth {
  flex: 1;
  display: grid;
  grid-template-columns: 1.1fr 0.9fr;
  gap: 24px;
  padding: 24px;
  min-height: 0;
}

.ep-booth-left {
  display: flex;
  flex-direction: column;
  gap: 20px;
  align-items: center;
  justify-content: center;
  min-height: 0;
}

.ep-booth-art {
  width: 70%;
  max-width: 420px;
  aspect-ratio: 1;
  border-radius: 14px;
  background-size: cover;
  background-position: center;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.04);
}

.ep-booth-art-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
  font-weight: 800;
  font-size: 64px;
  color: var(--fg);
  letter-spacing: -0.03em;
  background: radial-gradient(circle at 30% 20%, #2A4E4B, transparent 60%),
              radial-gradient(circle at 70% 80%, var(--accent), transparent 55%),
              linear-gradient(135deg, #1A1E23, #0F1114);
}

.ep-booth-track {
  text-align: center;
}
.ep-booth-title {
  font-family: var(--font-display);
  font-weight: 800;
  font-stretch: 115%;
  font-size: 28px;
  letter-spacing: -0.02em;
  text-transform: uppercase;
  line-height: 1;
  margin-bottom: 6px;
}
.ep-booth-artist {
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--fg-dim);
}

.ep-booth-controls {
  display: flex;
  align-items: center;
  gap: 18px;
  width: 100%;
  max-width: 420px;
  justify-content: center;
}

.ep-booth-right {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: 0;
  overflow: hidden;
}

.ep-booth-lena {
  background: rgba(79, 209, 197, 0.06);
  border: 1px solid rgba(79, 209, 197, 0.18);
  border-radius: 12px;
  padding: 16px;
}
.ep-booth-lena .tag {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--accent);
  letter-spacing: 0.2em;
  text-transform: uppercase;
  margin-bottom: 8px;
}
.ep-booth-lena .quote {
  font-size: 14px;
  line-height: 1.5;
  color: var(--fg);
}

.ep-justplayed-head {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--fg-mute);
  letter-spacing: 0.2em;
  text-transform: uppercase;
  margin-bottom: 10px;
}

.ep-justplayed-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
  min-height: 0;
}

.ep-jp-row {
  display: grid;
  grid-template-columns: 36px 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px dashed rgba(255, 255, 255, 0.06);
}
.ep-jp-art {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  background-size: cover;
  background-position: center;
  background-color: rgba(255, 255, 255, 0.06);
}
.ep-jp-title {
  font-size: 13px;
  color: var(--fg);
}
.ep-jp-meta {
  font-size: 11px;
  color: var(--fg-dim);
  font-family: var(--font-mono);
  letter-spacing: 0.08em;
}
.ep-jp-time {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--fg-mute);
  letter-spacing: 0.1em;
}

@media (max-width: 899px) {
  .ep-booth { display: none; }
}
```

- [ ] **Step 2: Create the desktop component**

Create `app/_components/ExpandedPlayerDesktop.tsx`:

```tsx
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
```

- [ ] **Step 3: Extract a shared broadcast hook**

The landing-page `Broadcast.tsx` has `useBroadcastFeed` as a private function. We need to reuse the fetched data in `ExpandedPlayerDesktop`. Create `app/_components/useBroadcast.ts`:

```typescript
"use client";
import { useEffect, useRef, useState } from "react";

const POLL_MS = 6_000;

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

type JustPlayedItem = TrackSummary & {
  startedAt: string;
  durationSeconds?: number;
};

type BroadcastPayload = {
  nowPlaying: NowPlayingPayload;
  upNext: (TrackSummary & { reasonCode?: string }) | null;
  justPlayed: JustPlayedItem[];
  shoutout:
    | { active: false }
    | { active: true; startedAt: string; expectedEndAt: string };
};

const EMPTY: BroadcastPayload = {
  nowPlaying: { isPlaying: false },
  upNext: null,
  justPlayed: [],
  shoutout: { active: false },
};

export function useBroadcast() {
  const [data, setData] = useState<BroadcastPayload>(EMPTY);
  const [now, setNow] = useState<number>(() => Date.now());
  const mounted = useRef(true);
  const lastShoutoutActiveRef = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const ctrl = new AbortController();

    async function poll() {
      try {
        const r = await fetch("/api/station/broadcast", {
          signal: ctrl.signal,
          cache: "no-store",
        });
        if (!r.ok) return;
        const json = (await r.json()) as BroadcastPayload;
        if (!mounted.current) return;
        setData(json);

        // Re-emit the shoutout-end signal so ShoutoutWall / OnAirFeed can
        // refresh without running their own duplicate broadcast poll.
        const isActive = json.shoutout.active;
        if (lastShoutoutActiveRef.current && !isActive) {
          window.dispatchEvent(new CustomEvent("numa:shoutout-ended"));
        }
        lastShoutoutActiveRef.current = isActive;
      } catch {
        /* keep previous */
      }
    }

    poll();
    const id = setInterval(poll, POLL_MS);
    const tickId = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      mounted.current = false;
      clearInterval(id);
      clearInterval(tickId);
      ctrl.abort();
    };
  }, []);

  return { ...data, now };
}
```

*(The landing-page `Broadcast.tsx` component keeps its own `useBroadcastFeed` for now — that has the tighter boundary-polling logic. We don't consolidate in this task; that's a separate refactor.)*

- [ ] **Step 4: Render the desktop layout from the overlay**

Modify `app/_components/ExpandedPlayer.tsx` — replace the body placeholder with the desktop component and a mobile placeholder:

```tsx
"use client";

import { useEffect } from "react";
import { usePlayer } from "./PlayerProvider";
import { ExpandedPlayerDesktop } from "./ExpandedPlayerDesktop";

export function ExpandedPlayer() {
  const { isExpanded, collapse } = usePlayer();

  useEffect(() => {
    if (!isExpanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") collapse();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isExpanded, collapse]);

  useEffect(() => {
    if (!isExpanded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isExpanded]);

  if (!isExpanded) return null;

  return (
    <div
      className="ep-root open"
      role="dialog"
      aria-modal="true"
      aria-label="Expanded player"
    >
      <div className="ep-shell">
        <div className="ep-topbar">
          <button
            type="button"
            className="ep-chev"
            onClick={collapse}
            aria-label="Close expanded player"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
              <path d="M5 7l5 6 5-6z" />
            </svg>
          </button>
          <div className="ep-topbar-center">● On Air — Lena</div>
          <div style={{ width: 36 }} />
        </div>

        {/* Desktop Booth — CSS hides this at < 900 px */}
        <ExpandedPlayerDesktop />

        {/* Mobile Tabs — filled in Task 5+ */}
        {/* <ExpandedPlayerMobile /> */}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Smoke test (desktop viewport)**

Run `npm run dev`, open http://localhost:3000/ at ≥ 900 px wide. Click the player. Verify:
- Left column: artwork matches Now Playing, title + artist, big play/pause that toggles audio without closing the overlay.
- Right column: Lena card + Just Played list (4 rows, real data).
- Chevron closes.

- [ ] **Step 6: Commit**

```bash
git add app/_components/ExpandedPlayerDesktop.tsx \
        app/_components/useBroadcast.ts \
        app/_components/ExpandedPlayer.tsx \
        app/styles/_expanded-player.css
git commit -m "$(cat <<'EOF'
expanded-player: desktop Booth layout — artwork, controls, Lena, just played

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Extract `<RequestForm>` from `Requests.tsx`

**Files:**
- Create: `app/_components/RequestForm.tsx`
- Modify: `app/_components/Requests.tsx`

The mobile Request and Shout tabs both need this form. Pull it out exactly as it exists today, then swap `Requests.tsx` to consume it.

- [ ] **Step 1: Create `RequestForm.tsx` with the current behaviour**

Create `app/_components/RequestForm.tsx` and move the form body from `Requests.tsx` into it verbatim (the JSX between `<form onSubmit={submit} key={formKey}>` and its closing tag, plus the tab buttons, plus the state/submit handlers). Keep the exact behaviour — song tab is a stub, shout tab POSTs to `/api/booth/submit`. The component takes one prop:

```typescript
"use client";
import { useEffect, useState } from "react";
import { MegaphoneIcon, SparklesIcon, SendIcon, LoadingIcon } from "./Icons";

type Tab = "song" | "shout";
type StatusTone = "none" | "success" | "pending" | "error";

const REVIEW_LINES = [
  "Requests are reviewed live on air — Lena picks what fits the moment.",
  "Anything unsafe gets quietly dropped — we keep the station clean.",
  "Not every submission is guaranteed to play.",
];

export function RequestForm({ initialTab = "song" }: { initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [reviewIdx, setReviewIdx] = useState(0);
  const [sending, setSending] = useState(false);
  const [sendLabel, setSendLabel] = useState("Send to the booth");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusTone, setStatusTone] = useState<StatusTone>("none");
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    const id = setInterval(
      () => setReviewIdx((i) => (i + 1) % REVIEW_LINES.length),
      4_200,
    );
    return () => clearInterval(id);
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatusMessage("");
    setStatusTone("none");

    if (tab === "song") {
      setSending(true);
      setSendLabel("Sending…");
      setTimeout(() => {
        setSendLabel("✓ In the queue");
        setSending(false);
      }, 1_200);
      setTimeout(() => setSendLabel("Send another"), 2_400);
      return;
    }

    const form = new FormData(e.currentTarget);
    const who = String(form.get("who") ?? "").trim();
    const requesterName = String(form.get("requesterName") ?? "").trim();
    const message = String(form.get("message") ?? "").trim();

    const parts: string[] = [];
    if (who) parts.push(`This one's going out to ${who}.`);
    if (message) parts.push(message);
    const text = parts.join(" ").trim();

    if (text.length < 4) {
      setStatusTone("error");
      setStatusMessage("Add a short message for Lena to read.");
      return;
    }

    setSending(true);
    setSendLabel("Sending…");

    try {
      const res = await fetch("/api/booth/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, requesterName: requesterName || undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        status?: string;
        message?: string;
        error?: string;
      };
      if (res.ok && data.ok && data.status === "queued") {
        setStatusTone("success");
        setStatusMessage(data.message ?? "Shoutout queued — Lena will read it next.");
        setSendLabel("✓ In the queue");
        setFormKey((k) => k + 1);
      } else if (res.ok && data.status === "held") {
        setStatusTone("pending");
        setStatusMessage(data.message ?? "Waiting on a moderator.");
        setSendLabel("✓ Received");
        setFormKey((k) => k + 1);
      } else if (data.status === "blocked") {
        setStatusTone("error");
        setStatusMessage(data.message ?? "That one can't go on air.");
        setSendLabel("Send to the booth");
      } else {
        setStatusTone("error");
        setStatusMessage(data.error ?? data.message ?? "Couldn't send — try again.");
        setSendLabel("Send to the booth");
      }
    } catch {
      setStatusTone("error");
      setStatusMessage("Network hiccup — try again in a moment.");
      setSendLabel("Send to the booth");
    } finally {
      setSending(false);
      setTimeout(() => {
        setSendLabel((label) => (label.startsWith("✓") ? "Send another" : label));
      }, 2_000);
    }
  }

  return (
    <>
      <div className="req-types" role="tablist">
        <button
          className={`req-type ${tab === "song" ? "active" : ""}`}
          onClick={() => setTab("song")}
          role="tab"
          aria-selected={tab === "song"}
        >
          <span className="rt-ico"><SparklesIcon className="" /></span>
          <span className="rt-label">Song request</span>
        </button>
        <button
          className={`req-type ${tab === "shout" ? "active" : ""}`}
          onClick={() => setTab("shout")}
          role="tab"
          aria-selected={tab === "shout"}
        >
          <span className="rt-ico"><MegaphoneIcon className="" /></span>
          <span className="rt-label">Shoutout</span>
        </button>
      </div>
      <form onSubmit={submit} key={formKey}>
        {tab === "song" ? (
          <div className="req-input-group">
            <input className="req-input" placeholder="A vibe, a mood, a moment — Numa makes it into a song" />
            <input className="req-input" placeholder="Your name or city" />
            <textarea className="req-input req-textarea" placeholder="Anything for Lena? (optional)" />
          </div>
        ) : (
          <div className="req-input-group">
            <input name="who" className="req-input" placeholder="Who it's for…" maxLength={60} />
            <input name="requesterName" className="req-input" placeholder="Your name or city" maxLength={60} />
            <textarea
              name="message"
              className="req-input req-textarea"
              placeholder="Your message — keep it short so we get through more."
              maxLength={220}
              required
            />
          </div>
        )}
        <button type="submit" className="btn btn-primary req-send" disabled={sending} aria-busy={sending}>
          <span>{sendLabel}</span>
          {sending ? <LoadingIcon className="btn-icon" /> : <SendIcon className="btn-icon" />}
        </button>
        {statusTone !== "none" && (
          <div
            role="status"
            style={{
              marginTop: 12,
              fontSize: 13,
              color:
                statusTone === "success"
                  ? "var(--accent)"
                  : statusTone === "error"
                    ? "#e85a4f"
                    : "var(--fg-mute)",
            }}
          >
            {statusMessage}
          </div>
        )}
      </form>
      <div className="req-review">
        <div className="rev-rotator">
          {REVIEW_LINES.map((line, i) => (
            <div key={i} className={`rev-line ${i === reviewIdx ? "active" : ""}`}>
              <span className={`dot ${i === 0 ? "" : "soft"}`} />
              <span>{line}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Swap `Requests.tsx` to use `<RequestForm />`**

In `app/_components/Requests.tsx`, delete the now-moved state (`tab`, `reviewIdx`, `sending`, `sendLabel`, `statusMessage`, `statusTone`, `formKey`, the `submit` handler, the `REVIEW_LINES` constant, the `useEffect`) and the now-moved JSX (`req-types` + `form` + `req-review`). Replace with a single `<RequestForm />` inside the existing `req-form-card`. The surrounding copy (`<h3>`, `<p class="hint">`, `.req-tickers`, and the "Got finished music?" block) stays.

Top-level shape of the updated `Requests.tsx`:

```tsx
"use client";
import { RequestForm } from "./RequestForm";
import { ShoutoutWall } from "./ShoutoutWall";

export function Requests() {
  return (
    <section className="requests" id="requests">
      <div className="shell">
        <div className="section-head">
          {/* …existing … */}
        </div>
        <div className="req-wall">
          <div className="req-form-card">
            <h3>Request the<br />next moment.</h3>
            <p className="hint">
              Describe a moment — Numa writes you a song. Or send Lena a
              shoutout to read on air.
            </p>
            <RequestForm />
            <div className="req-tickers">{/* …existing… */}</div>
            {/* …existing "Got finished music?" block… */}
          </div>
          <ShoutoutWall />
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Smoke test**

Run `npm run dev`, open http://localhost:3000/#requests. Verify:
- Both tab buttons work (song / shoutout).
- Song tab shows the stub "In the queue" on submit.
- Shout tab POSTs — submit a shoutout and watch the dashboard receive it.
- Rotating review lines still animate.

- [ ] **Step 4: Commit**

```bash
git add app/_components/RequestForm.tsx app/_components/Requests.tsx
git commit -m "$(cat <<'EOF'
request-form: extract shared form from Requests.tsx

RequestForm owns the song/shoutout tab state, the submit handler, and
the rotating review lines. Lets the mobile Request and Shout tabs
reuse the same UI without duplicating logic.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Mobile `<TabBar>` + layout switch at < 900 px breakpoint

**Files:**
- Create: `app/_components/TabBar.tsx`
- Create: `app/_components/ExpandedPlayerMobile.tsx`
- Modify: `app/_components/ExpandedPlayer.tsx`
- Modify: `app/styles/_expanded-player.css`

End state: on viewports < 900 px, the overlay shows a sticky top bar, empty middle, and a sticky bottom tab bar with four tabs (Listen active by default).

- [ ] **Step 1: Extend styles**

Append to `app/styles/_expanded-player.css`:

```css
/* Mobile tab layout */
.ep-mobile {
  display: none;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
@media (max-width: 899px) {
  .ep-mobile { display: flex; }
}

.ep-mobile-body {
  flex: 1;
  overflow-y: auto;
  padding: 18px 16px 20px;
}

.ep-tabbar {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 2px;
  padding: 8px 6px calc(8px + env(safe-area-inset-bottom));
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(12px);
}

.ep-tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 6px 4px;
  background: none;
  border: none;
  color: var(--fg-dim);
  cursor: pointer;
}
.ep-tab .ico {
  width: 18px;
  height: 18px;
  opacity: 0.7;
}
.ep-tab .label {
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}
.ep-tab.active {
  color: var(--accent);
}
.ep-tab.active .ico { opacity: 1; }
.ep-tab.active .label { font-weight: 600; }
```

- [ ] **Step 2: Create the `TabBar` component**

Create `app/_components/TabBar.tsx`:

```tsx
"use client";

import type { ComponentType, SVGProps } from "react";
import {
  MegaphoneIcon,
  SparklesIcon,
  PlayIcon,
} from "./Icons";

export type TabId = "listen" | "request" | "shout" | "onair";

function RadioTowerIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" {...props}>
      <circle cx="10" cy="10" r="1.5" />
      <path d="M7.5 7.5a3.5 3.5 0 015 0M5.5 5.5a6.5 6.5 0 019 0M10 12l-2 6h4z" />
    </svg>
  );
}

const TABS: Array<{ id: TabId; label: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }> = [
  { id: "listen", label: "Listen", Icon: PlayIcon },
  { id: "request", label: "Request", Icon: SparklesIcon },
  { id: "shout", label: "Shout", Icon: MegaphoneIcon },
  { id: "onair", label: "On Air", Icon: RadioTowerIcon },
];

export function TabBar({
  active,
  onChange,
}: {
  active: TabId;
  onChange: (id: TabId) => void;
}) {
  return (
    <nav className="ep-tabbar" role="tablist">
      {TABS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={active === id}
          className={`ep-tab ${active === id ? "active" : ""}`}
          onClick={() => onChange(id)}
        >
          <Icon className="ico" />
          <span className="label">{label}</span>
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 3: Create the mobile shell**

Create `app/_components/ExpandedPlayerMobile.tsx`:

```tsx
"use client";
import { useState } from "react";
import { TabBar, type TabId } from "./TabBar";

export function ExpandedPlayerMobile() {
  const [tab, setTab] = useState<TabId>("listen");

  return (
    <div className="ep-mobile">
      <div className="ep-mobile-body">
        {tab === "listen" && <div>Listen content — Task 6</div>}
        {tab === "request" && <div>Request content — Task 7</div>}
        {tab === "shout" && <div>Shout content — Task 7</div>}
        {tab === "onair" && <div>On Air content — Task 9</div>}
      </div>
      <TabBar active={tab} onChange={setTab} />
    </div>
  );
}
```

- [ ] **Step 4: Mount it in `ExpandedPlayer`**

In `app/_components/ExpandedPlayer.tsx`, import and render below the desktop component:

```tsx
import { ExpandedPlayerMobile } from "./ExpandedPlayerMobile";
// …
<ExpandedPlayerDesktop />
<ExpandedPlayerMobile />
```

The CSS media queries already hide whichever one doesn't match.

- [ ] **Step 5: Smoke test**

Run `npm run dev`. Open the page. Use browser devtools to set the viewport to iPhone SE (375×667). Click the player. Verify:
- Desktop Booth is gone.
- Sticky top bar at the top with chevron.
- Tab bar at the bottom with 4 tabs.
- Tapping each tab switches the placeholder text.

- [ ] **Step 6: Commit**

```bash
git add app/_components/TabBar.tsx \
        app/_components/ExpandedPlayerMobile.tsx \
        app/_components/ExpandedPlayer.tsx \
        app/styles/_expanded-player.css
git commit -m "$(cat <<'EOF'
expanded-player: mobile tab bar + layout switch at < 900px

Four tabs: Listen (active), Request, Shout, On Air. Tab content is
placeholder text in this commit; populated in subsequent tasks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Mobile Listen tab content

**Files:**
- Modify: `app/_components/ExpandedPlayerMobile.tsx`
- Modify: `app/styles/_expanded-player.css`

End state: the `listen` tab shows the big artwork, track title/artist, vote row, and a huge play button — matching the Phone 1 mockup in spirit but using real data. Lena card below.

- [ ] **Step 1: Extend styles**

Append to `app/styles/_expanded-player.css`:

```css
.ep-listen {
  display: flex;
  flex-direction: column;
  gap: 18px;
  align-items: center;
  padding-top: 4px;
}
.ep-listen-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--fg-mute);
}
.ep-listen-art {
  width: 78vw;
  max-width: 340px;
  aspect-ratio: 1;
  border-radius: 16px;
  background-size: cover;
  background-position: center;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.55);
}
.ep-listen-track {
  text-align: center;
  width: 100%;
}
.ep-listen-title {
  font-family: var(--font-display);
  font-weight: 800;
  font-stretch: 115%;
  font-size: 22px;
  letter-spacing: -0.02em;
  text-transform: uppercase;
  line-height: 1;
  margin-bottom: 4px;
}
.ep-listen-artist {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--fg-dim);
}
.ep-listen-play {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: var(--accent);
  color: #0A0D0E;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 0 1px var(--accent), 0 10px 32px var(--accent-glow);
  cursor: pointer;
}
.ep-listen-lena {
  width: 100%;
  background: rgba(79, 209, 197, 0.06);
  border: 1px solid rgba(79, 209, 197, 0.18);
  border-radius: 12px;
  padding: 14px;
}
```

- [ ] **Step 2: Implement the Listen tab**

Replace `app/_components/ExpandedPlayerMobile.tsx` with:

```tsx
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
```

- [ ] **Step 3: Smoke test**

Mobile viewport, click player. Verify:
- Artwork matches now-playing.
- Title + artist are real.
- Listener count is visible.
- Big play button toggles audio.
- Lena card visible below play button.

- [ ] **Step 4: Commit**

```bash
git add app/_components/ExpandedPlayerMobile.tsx app/styles/_expanded-player.css
git commit -m "$(cat <<'EOF'
expanded-player: mobile Listen tab — artwork, track, play button, Lena card

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Mobile Request + Shout tabs (reuse `<RequestForm />`)

**Files:**
- Modify: `app/_components/ExpandedPlayerMobile.tsx`

- [ ] **Step 1: Render `<RequestForm />` for both tabs**

In `app/_components/ExpandedPlayerMobile.tsx`, add a `RequestForm` import and replace the Request/Shout placeholders:

```tsx
import { RequestForm } from "./RequestForm";
// …
{tab === "request" && (
  <div style={{ paddingTop: 4 }}>
    <h3 style={{
      fontFamily: "var(--font-display)",
      fontWeight: 800,
      fontStretch: "115%",
      fontSize: 22,
      lineHeight: 1,
      textTransform: "uppercase",
      marginBottom: 14,
    }}>
      To the<br />booth.
    </h3>
    <RequestForm initialTab="song" />
  </div>
)}
{tab === "shout" && (
  <div style={{ paddingTop: 4 }}>
    <h3 style={{
      fontFamily: "var(--font-display)",
      fontWeight: 800,
      fontStretch: "115%",
      fontSize: 22,
      lineHeight: 1,
      textTransform: "uppercase",
      marginBottom: 14,
    }}>
      Say it<br />on air.
    </h3>
    <RequestForm initialTab="shout" />
  </div>
)}
```

- [ ] **Step 2: Smoke test**

Mobile viewport, open player, tap Request and Shout tabs in turn. Verify:
- Both render the form.
- On Shout tab, submitting a real shoutout reaches the backend and shows "queued" / "held".
- Tab buttons inside the form (Song/Shoutout) still work — they don't close the overlay.

- [ ] **Step 3: Commit**

```bash
git add app/_components/ExpandedPlayerMobile.tsx
git commit -m "$(cat <<'EOF'
expanded-player: mobile Request + Shout tabs reuse <RequestForm />

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `lib/on-air/merge.ts` + unit tests

**Files:**
- Create: `lib/on-air/merge.ts`
- Create: `lib/on-air/merge.test.ts`

TDD: test first, then implement. Pure function — no React, no fetch.

- [ ] **Step 1: Write the failing test**

Create `lib/on-air/merge.test.ts`:

```typescript
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mergeOnAirFeed, type TrackItem, type ShoutItem } from "./merge";

describe("mergeOnAirFeed", () => {
  test("sorts interleaved tracks + shouts by timestamp desc", () => {
    const tracks: TrackItem[] = [
      { trackId: "t1", title: "Neon Fever", artistDisplay: "Russell Ross", startedAt: "2026-04-21T12:00:00Z" },
      { trackId: "t2", title: "Midnight Drive", artistDisplay: "Russell Ross", startedAt: "2026-04-21T11:55:00Z" },
    ];
    const shouts: ShoutItem[] = [
      { id: "s1", requesterName: "eddie", text: "hey lena", airedAt: "2026-04-21T11:58:00Z" },
    ];
    const merged = mergeOnAirFeed(tracks, shouts, 10);
    assert.deepEqual(
      merged.map((m) => m.kind + ":" + (m.kind === "track" ? m.trackId : m.id)),
      ["track:t1", "shout:s1", "track:t2"],
    );
  });

  test("caps to the requested limit", () => {
    const tracks: TrackItem[] = Array.from({ length: 20 }, (_, i) => ({
      trackId: `t${i}`,
      title: `Track ${i}`,
      startedAt: new Date(Date.now() - i * 60_000).toISOString(),
    }));
    const shouts: ShoutItem[] = [];
    const merged = mergeOnAirFeed(tracks, shouts, 5);
    assert.equal(merged.length, 5);
  });

  test("handles empty inputs without throwing", () => {
    assert.deepEqual(mergeOnAirFeed([], [], 20), []);
  });

  test("a shout without a track still appears", () => {
    const tracks: TrackItem[] = [];
    const shouts: ShoutItem[] = [
      { id: "s1", requesterName: "mike", text: "testing", airedAt: "2026-04-21T10:00:00Z" },
    ];
    const merged = mergeOnAirFeed(tracks, shouts, 10);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].kind, "shout");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test 2>&1 | tail -20`
Expected: import error — `merge.ts` doesn't exist yet.

- [ ] **Step 3: Implement `merge.ts`**

Create `lib/on-air/merge.ts`:

```typescript
export type TrackItem = {
  trackId: string;
  title: string;
  artistDisplay?: string;
  artworkUrl?: string;
  startedAt: string;
  durationSeconds?: number;
};

export type ShoutItem = {
  id: string;
  requesterName?: string;
  text: string;
  airedAt: string;
};

export type OnAirItem =
  | ({ kind: "track"; at: number } & TrackItem)
  | ({ kind: "shout"; at: number } & ShoutItem);

export function mergeOnAirFeed(
  tracks: TrackItem[],
  shouts: ShoutItem[],
  limit: number,
): OnAirItem[] {
  const t: OnAirItem[] = tracks.map((row) => ({
    kind: "track",
    at: new Date(row.startedAt).getTime(),
    ...row,
  }));
  const s: OnAirItem[] = shouts.map((row) => ({
    kind: "shout",
    at: new Date(row.airedAt).getTime(),
    ...row,
  }));
  return [...t, ...s]
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test 2>&1 | tail -20`
Expected: 4/4 passing under `mergeOnAirFeed`.

- [ ] **Step 5: Commit**

```bash
git add lib/on-air/merge.ts lib/on-air/merge.test.ts
git commit -m "$(cat <<'EOF'
on-air: pure merge function for interleaving tracks + shoutouts

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Mobile On Air tab

**Files:**
- Create: `app/_components/OnAirFeed.tsx`
- Modify: `app/_components/ExpandedPlayerMobile.tsx`
- Modify: `app/styles/_expanded-player.css`

- [ ] **Step 1: Extend styles**

Append to `app/styles/_expanded-player.css`:

```css
.ep-onair {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ep-onair-item {
  display: grid;
  grid-template-columns: 42px 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px dashed rgba(255, 255, 255, 0.06);
}
.ep-onair-item.shout {
  grid-template-columns: 42px 1fr;
  gap: 12px;
  padding: 12px;
  background: rgba(79, 209, 197, 0.04);
  border: 1px solid rgba(79, 209, 197, 0.14);
  border-radius: 10px;
}
.ep-onair-art {
  width: 42px;
  height: 42px;
  border-radius: 6px;
  background-size: cover;
  background-position: center;
  background-color: rgba(255, 255, 255, 0.06);
}
.ep-onair-avatar {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: #3D2A4E;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 16px;
  color: var(--fg);
}
.ep-onair-main .primary {
  font-size: 14px;
  color: var(--fg);
  margin-bottom: 2px;
}
.ep-onair-main .secondary {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--fg-mute);
  letter-spacing: 0.1em;
}
.ep-onair-time {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--fg-mute);
  letter-spacing: 0.1em;
}
```

- [ ] **Step 2: Create the feed component**

Create `app/_components/OnAirFeed.tsx`:

```tsx
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
  const [shouts, setShouts] = useState<ShoutItem[]>([]);

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
        setShouts(json.shoutouts as ShoutItem[]);
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
        // shout
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
```

- [ ] **Step 3: Wire the feed into the mobile tab**

In `app/_components/ExpandedPlayerMobile.tsx`, replace the On Air placeholder:

```tsx
import { OnAirFeed } from "./OnAirFeed";
// …
{tab === "onair" && (
  <div style={{ paddingTop: 4 }}>
    <h3 style={{
      fontFamily: "var(--font-display)",
      fontWeight: 800,
      fontStretch: "115%",
      fontSize: 22,
      lineHeight: 1,
      textTransform: "uppercase",
      marginBottom: 14,
    }}>
      The booth,<br />live.
    </h3>
    <OnAirFeed />
  </div>
)}
```

- [ ] **Step 4: Smoke test**

Mobile viewport, open player, switch to On Air. Verify:
- Mix of track rows and shoutout cards in time order (newest first).
- Track rows show artwork + title + artist + "X min ago".
- Shout rows show avatar + quoted text + name + time.
- Submitting a new shoutout: after it airs on the actual stream, the feed updates within ~1s (via the `numa:shoutout-ended` event).

- [ ] **Step 5: Commit**

```bash
git add app/_components/OnAirFeed.tsx \
        app/_components/ExpandedPlayerMobile.tsx \
        app/styles/_expanded-player.css
git commit -m "$(cat <<'EOF'
expanded-player: mobile On Air tab — chronological tracks + shoutouts

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Morph animation from source rect → fullscreen

**Files:**
- Modify: `app/_components/ExpandedPlayer.tsx`
- Modify: `app/styles/_expanded-player.css`

End state: clicking the PlayerCard/MiniPlayer animates the overlay into existence from the source element's on-screen position. Closing reverses the animation. No motion library — plain CSS transitions on `transform` + `opacity`.

- [ ] **Step 1: Extend styles**

Replace the existing `.ep-root` and `.ep-shell` blocks in `app/styles/_expanded-player.css` with:

```css
.ep-root {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(10, 13, 14, 0);
  backdrop-filter: blur(0);
  transition: background 240ms ease, backdrop-filter 240ms ease;
  pointer-events: none;
}
.ep-root.open {
  background: rgba(10, 13, 14, 0.92);
  backdrop-filter: blur(14px);
  pointer-events: auto;
}

.ep-shell {
  position: absolute;
  inset: 2vh 2vw;
  background: linear-gradient(180deg, #12151A, #0A0D0E);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 16px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  transform-origin: top left;
  transform: var(--ep-initial-transform, none);
  opacity: 0;
  transition: transform 320ms cubic-bezier(0.32, 0.72, 0, 1), opacity 240ms ease;
}
.ep-root.open .ep-shell {
  transform: none;
  opacity: 1;
}

@media (max-width: 899px) {
  .ep-shell {
    inset: 0;
    border-radius: 0;
    border: none;
  }
}
```

- [ ] **Step 2: Animate the shell using `expandSourceRect`**

In `app/_components/ExpandedPlayer.tsx`, use the source rect to set an initial CSS transform for the entering animation:

```tsx
"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePlayer } from "./PlayerProvider";
import { ExpandedPlayerDesktop } from "./ExpandedPlayerDesktop";
import { ExpandedPlayerMobile } from "./ExpandedPlayerMobile";

export function ExpandedPlayer() {
  const { isExpanded, collapse, expandSourceRect } = usePlayer();
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);

  // Esc closes
  useEffect(() => {
    if (!isExpanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") collapse();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isExpanded, collapse]);

  // Body scroll lock
  useEffect(() => {
    if (!isExpanded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isExpanded]);

  // FLIP: compute initial transform from the captured source rect on open,
  // then drop the open class next frame so it animates to identity.
  useLayoutEffect(() => {
    if (!isExpanded) {
      setMounted(false);
      return;
    }
    const shell = shellRef.current;
    if (!shell) return;

    if (expandSourceRect) {
      const targetRect = shell.getBoundingClientRect();
      const dx = expandSourceRect.left - targetRect.left;
      const dy = expandSourceRect.top - targetRect.top;
      const sx = expandSourceRect.width / targetRect.width;
      const sy = expandSourceRect.height / targetRect.height;
      shell.style.setProperty(
        "--ep-initial-transform",
        `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`,
      );
    } else {
      shell.style.setProperty("--ep-initial-transform", "scale(0.9)");
    }
    // Next frame: apply `.open` so CSS animates to identity.
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, [isExpanded, expandSourceRect]);

  if (!isExpanded) return null;

  return (
    <div
      className={`ep-root ${mounted ? "open" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Expanded player"
    >
      <div className="ep-shell" ref={shellRef}>
        <div className="ep-topbar">
          <button
            type="button"
            className="ep-chev"
            onClick={collapse}
            aria-label="Close expanded player"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
              <path d="M5 7l5 6 5-6z" />
            </svg>
          </button>
          <div className="ep-topbar-center">● On Air — Lena</div>
          <div style={{ width: 36 }} />
        </div>
        <ExpandedPlayerDesktop />
        <ExpandedPlayerMobile />
      </div>
    </div>
  );
}
```

*Note:* the current `collapse` in `PlayerProvider` sets `isExpanded = false` immediately; on unmount the overlay disappears without a reverse animation. For a proper exit animation we'd need an "exiting" intermediate state — acceptable scope cut for V1. Fade-out comes for free from the `.ep-root` background transition since the overlay stays painted for 240 ms before React unmounts it? Actually it does NOT — once `isExpanded` goes false, the component returns null. If the user objects to the snap-close after V1, revisit with an `exiting` state + delayed `setIsExpanded(false)`.

- [ ] **Step 3: Smoke test**

Desktop viewport. Click the hero PlayerCard. The overlay should scale/translate into place from the hero-right column position. Close with chevron — instant disappearance (known scope cut). Scroll down so the mini-player appears. Click it — overlay should animate from the mini-bar position.

Mobile viewport. Tap the player — same animation but fills the whole viewport.

- [ ] **Step 4: Commit**

```bash
git add app/_components/ExpandedPlayer.tsx app/styles/_expanded-player.css
git commit -m "$(cat <<'EOF'
expanded-player: morph animation from source rect to fullscreen

FLIP-style: capture source bounding box on expand, set initial
transform on the shell, animate to identity. Reverse-animation on
close is deferred (V1 snap-closes).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Swipe-down to close (mobile) + focus trap + a11y polish

**Files:**
- Modify: `app/_components/ExpandedPlayer.tsx`

- [ ] **Step 1: Add swipe handler + focus management**

Add to `app/_components/ExpandedPlayer.tsx` (inside the component, after existing effects):

```tsx
  // Swipe down to close on touch devices. Threshold 80 px.
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  }
  function onTouchEnd(e: React.TouchEvent) {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dy = t.clientY - start.y;
    const dx = Math.abs(t.clientX - start.x);
    if (dy > 80 && dx < 60) collapse();
  }

  // Focus the chevron on open so keyboard users can Esc / Enter to dismiss.
  const chevRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!mounted) return;
    chevRef.current?.focus();
  }, [mounted]);
```

Apply the handlers + ref:

```tsx
return (
  <div
    className={`ep-root ${mounted ? "open" : ""}`}
    role="dialog"
    aria-modal="true"
    aria-label="Expanded player"
    onTouchStart={onTouchStart}
    onTouchEnd={onTouchEnd}
  >
    <div className="ep-shell" ref={shellRef}>
      <div className="ep-topbar">
        <button
          ref={chevRef}
          type="button"
          className="ep-chev"
          onClick={collapse}
          aria-label="Close expanded player"
        >
          {/* … */}
        </button>
        {/* … */}
      </div>
      {/* … */}
    </div>
  </div>
);
```

- [ ] **Step 2: Smoke test**

Mobile viewport, open player. Touch near the top of the overlay, drag down > 80 px, release — closes. Touch + short drag — stays. Keyboard: open via click → chevron has focus → Esc closes → focus returns to previous element (browser default).

- [ ] **Step 3: Commit**

```bash
git add app/_components/ExpandedPlayer.tsx
git commit -m "$(cat <<'EOF'
expanded-player: swipe-down to close on mobile + auto-focus chevron

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Sync the `Mobile.tsx` Phone 1 mockup to the real mobile Listen tab

**Files:**
- Modify: `app/_components/Mobile.tsx`

Rewrite the Phone 1 JSX so it's a visual clone of the real `ListenPane` — same layout rhythm (top bar → meta row → artwork → title/artist → big play button → Lena card → 4-tab bottom bar with Listen active). Use placeholder content (e.g. "Slow Fade, Brighter" / "Russell Ross") but the SHAPE must match.

- [ ] **Step 1: Rewrite the Phone 1 JSX**

In `app/_components/Mobile.tsx`, locate the `{/* Phone 1 — Listen / player */}` block. Replace the entire `<div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "14px 10px 10px", gap: 14 }}>…</div>` block (the inner body below `phone-status`) with the following. The `phone-notch` and `phone-status` rows above it stay untouched. Do NOT touch Phone 2.

```tsx
              <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "14px 10px 10px", gap: 12 }}>
                {/* Top row — logo + live pill (unchanged visually) */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div className="logo" style={{ fontSize: 11 }}>
                    <span className="logo-mark" />
                    <span>
                      Numa<span style={{ color: "var(--accent)" }}>·</span>Radio
                    </span>
                  </div>
                  <div style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "3px 7px",
                    borderRadius: 999,
                    border: "1px solid rgba(255,107,107,0.35)",
                    background: "rgba(255,107,107,0.08)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 7,
                    color: "var(--red-live)",
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                  }}>
                    <span style={{
                      width: 4,
                      height: 4,
                      borderRadius: "50%",
                      background: "var(--red-live)",
                      boxShadow: "0 0 4px var(--red-live)",
                      animation: "pulseDot 1.6s ease-in-out infinite",
                    }} />
                    Live
                  </div>
                </div>

                {/* Meta row — mirrors .ep-listen-meta */}
                <div style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 7,
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  color: "var(--fg-mute)",
                  display: "flex",
                  justifyContent: "space-between",
                }}>
                  <span>On Air · Lena</span>
                  <span>12,418 listening</span>
                </div>

                {/* Artwork — mirrors .ep-listen-art */}
                <div style={{
                  aspectRatio: "1",
                  borderRadius: 14,
                  background:
                    "radial-gradient(circle at 30% 20%, #2A4E4B, transparent 60%), radial-gradient(circle at 70% 80%, var(--accent), transparent 55%), linear-gradient(135deg, #1A1E23, #0F1114)",
                  position: "relative",
                  overflow: "hidden",
                  boxShadow: "0 12px 28px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04)",
                }}>
                  <div style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: "var(--font-display)",
                    fontWeight: 800,
                    fontSize: 48,
                    color: "var(--fg)",
                    letterSpacing: "-0.03em",
                    fontStretch: "125%",
                  }}>SF</div>
                </div>

                {/* Track title + artist — centered, mirrors .ep-listen-track */}
                <div style={{ textAlign: "center" }}>
                  <div style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 800,
                    fontStretch: "115%",
                    fontSize: 14,
                    lineHeight: 1,
                    letterSpacing: "-0.02em",
                    textTransform: "uppercase",
                    marginBottom: 3,
                  }}>Slow Fade, Brighter</div>
                  <div style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 7,
                    letterSpacing: "0.2em",
                    textTransform: "uppercase",
                    color: "var(--fg-dim)",
                  }}>
                    Russell Ross — Nightshore EP
                  </div>
                </div>

                {/* Play button — mirrors .ep-listen-play */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <div style={{
                    width: 40,
                    height: 40,
                    borderRadius: "50%",
                    background: "var(--accent)",
                    color: "#0A0D0E",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 0 0 1px var(--accent), 0 8px 28px var(--accent-glow)",
                  }}>
                    <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 14, height: 14 }}>
                      <path d="M5 3v14l12-7z" />
                    </svg>
                  </div>
                </div>

                {/* Lena card — mirrors .ep-listen-lena */}
                <div style={{
                  background: "rgba(79,209,197,0.06)",
                  border: "1px solid rgba(79,209,197,0.18)",
                  borderRadius: 8,
                  padding: 8,
                }}>
                  <div style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 6.5,
                    color: "var(--accent)",
                    letterSpacing: "0.2em",
                    textTransform: "uppercase",
                    marginBottom: 3,
                  }}>Lena · on the mic</div>
                  <div style={{ fontSize: 8, lineHeight: 1.45, color: "var(--fg)" }}>
                    &ldquo;Slow and a little heartbroken, coming right up — look out the window.&rdquo;
                  </div>
                </div>

                {/* Bottom tab bar — mirrors .ep-tabbar, tabs match TabBar.tsx */}
                <div style={{
                  marginTop: "auto",
                  marginLeft: -10,
                  marginRight: -10,
                  marginBottom: -10,
                  padding: "10px 6px 8px",
                  borderTop: "1px solid var(--line)",
                  background: "rgba(0,0,0,0.4)",
                  backdropFilter: "blur(10px)",
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: 2,
                }}>
                  {[
                    { label: "Listen", active: true },
                    { label: "Request" },
                    { label: "Shout" },
                    { label: "On Air" },
                  ].map((t) => (
                    <div
                      key={t.label}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 3,
                        padding: "4px 2px",
                        color: t.active ? "var(--accent)" : "var(--fg-dim)",
                      }}
                    >
                      <div style={{ width: 14, height: 14, opacity: 0.8 }} />
                      <div style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 6,
                        letterSpacing: "0.16em",
                        textTransform: "uppercase",
                        fontWeight: t.active ? 600 : 400,
                      }}>{t.label}</div>
                    </div>
                  ))}
                </div>
              </div>
```

Key differences from the old Phone 1: tab labels are **Listen / Request / Shout / On Air** (was Listen / Request / Shout / Queue); rhythm of content moves the "On Air · Lena / 12,418 listening" meta row above the artwork, adds a centered play button, and adds a Lena-card block, all matching the real `ExpandedPlayerMobile` ListenPane.

- [ ] **Step 2: Smoke test**

Desktop viewport, open http://localhost:3000/. Scroll to the "06 — In Your Pocket" section. Verify:
- Phone 1 looks like a scaled-down screenshot of the real mobile Listen tab.
- Bottom tabs read **Listen · Request · Shout · On Air** (not Queue).
- Phone 2 unchanged.

Mobile viewport: verify the whole section is still hidden (existing CSS).

- [ ] **Step 3: Commit**

```bash
git add app/_components/Mobile.tsx
git commit -m "$(cat <<'EOF'
mobile-showcase: sync Phone 1 mockup with real mobile player

Tabs now read Listen/Request/Shout/On Air (was …/Queue). Layout
rhythm — meta row, artwork, title/artist, centered play button,
Lena card, bottom tab bar — mirrors the real expanded-player
Listen tab.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Full smoke test + Playwright verification

**Files:**
- None (verification only).

- [ ] **Step 1: Start dev server + regenerate Prisma client if needed**

```bash
npx prisma generate
npm run dev
```

Wait until `http://localhost:3000/` responds 200.

- [ ] **Step 2: Desktop smoke**

Open a Playwright browser at 1440×900. Verify:
- Landing hero shows real data (numbers, now-playing).
- Click the PlayerCard body — expanded player slides into view from the hero-right position.
- Booth layout: artwork + controls left, Lena card + Just Played right.
- Chevron closes. Esc closes.
- Scroll down past the hero — mini-player appears; click it — overlay morphs from mini-bar position.

- [ ] **Step 3: Mobile smoke**

Playwright viewport 390×844. Verify:
- Player card (full-width on mobile) expands on tap.
- Listen tab: artwork + title + artist + play button + Lena card.
- Request tab: song/shoutout sub-tabs, form, submit works.
- Shout tab: opens with shoutout sub-tab active by default.
- On Air tab: chronological list of real tracks + real shoutouts.
- Chevron closes. Swipe down closes.

- [ ] **Step 4: Visual-companion cleanup**

```bash
/Users/sisin/.claude/plugins/cache/claude-plugins-official/superpowers/5.0.7/skills/brainstorming/scripts/stop-server.sh \
  /Users/sisin/Developer/numaradio/.superpowers/brainstorm/67640-1776776342 2>/dev/null || true
```

- [ ] **Step 5: Final push**

```bash
git pull --rebase
git push
git log --oneline origin/main..HEAD  # should be empty
git log --oneline -15  # sanity-check the story
```

---

## Known V1 scope cuts

These are explicitly deferred so the first merge can land:

- **Reverse close animation** — overlay currently snaps closed. Backdrop fade is there; shell morph-back is not. Revisit with an `exiting` state + delayed unmount.
- **Focus trap** — Esc closes and the chevron gets focus on open, but Tab can escape the overlay into the underlying page. Acceptable for V1; keyboard users with AT typically use Esc anyway.
- **Browser back gesture on mobile to close** — listed in the spec but not implemented; swipe-down + chevron cover the common case. Re-visit if usage data shows confusion.
- **Persistent last-opened tab** — always starts on Listen.
