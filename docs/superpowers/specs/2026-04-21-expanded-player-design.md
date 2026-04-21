# Expanded Player — design

**Status:** spec, awaiting review
**Date:** 2026-04-21
**Scope:** landing page player + global mini-player

## Goal

Make Numa feel like a premium radio *station*, not a web audio player. Tap
the player anywhere on the site, it expands to a near-fullscreen "station
monitor" view (Tidal-style but radio-specific — no prev/next). On mobile,
that expanded view becomes a real app-like experience with a 4-tab bar,
replacing the Phone 1 mockup in `Mobile.tsx`.

## Locked-in decisions

| Decision | Choice |
|---|---|
| Trigger | Tap anywhere on `PlayerCard` or `MiniPlayer` except `play/pause` + `request` buttons (both `stopPropagation`) |
| Close | Chevron-down button at top of expanded view + `Esc` on desktop + swipe-down gesture on mobile |
| Animation | Morph from source element's bounding box → full viewport and back. CSS-only (transform + opacity + position:fixed). No motion library. |
| Desktop layout | **Booth** — two-column dashboard: artwork + controls left, Lena commentary + Just Played right |
| Mobile layout | Phone 1 mockup made real: top bar, big artwork, controls, 4-tab bottom bar |
| Mobile tabs | Listen (default) / Request / Shout / **On Air** |
| `Mobile.tsx` section | Keep on desktop, hidden on mobile (already). Phone 1 JSX rewritten to visually match the real player. |
| "On Air" tab content | Chronological broadcast log — tracks from `/api/station/broadcast` `justPlayed` interleaved with shoutouts from `/api/station/shoutouts/recent`, sorted by timestamp |
| Responsive split | Desktop booth layout ≥ 900 px viewport width; mobile tab layout below |

## Architecture

### State (lives in `PlayerProvider`)

Add to existing `PlayerState`:

```ts
isExpanded: boolean;
expand: () => void;
collapse: () => void;
expandSourceRect: DOMRect | null;  // where the morph animation starts from
```

`expand(sourceEl?)` captures the source element's `getBoundingClientRect()`
so the animation can interpolate from that box. `collapse()` resets.

### New component tree

```
<PlayerProvider>             // adds isExpanded state + animation source rect
  <ExpandedPlayer />         // NEW — renders null unless isExpanded; overlays everything
  {children}                 // the rest of the app
</PlayerProvider>
```

### New files

- `app/_components/ExpandedPlayer.tsx` — root overlay component
- `app/_components/ExpandedPlayer.desktop.tsx` — booth two-column layout
- `app/_components/ExpandedPlayer.mobile.tsx` — 4-tab layout
- `app/_components/ExpandedPlayer/OnAirFeed.tsx` — chronological merge of tracks + shoutouts
- `app/_components/ExpandedPlayer/TabBar.tsx` — mobile bottom tabs
- `app/styles/_expanded-player.css` — styles (matches existing pattern in `app/styles/`)

### Modified files

- `app/_components/PlayerProvider.tsx` — add `isExpanded`, `expand`, `collapse`, `expandSourceRect`
- `app/_components/PlayerCard.tsx` — root `<div>` becomes a clickable surface calling `expand(e.currentTarget)`; `stopPropagation` on play/pause button
- `app/_components/MiniPlayer.tsx` — same: root clickable, play/pause and request link `stopPropagation`
- `app/_components/Mobile.tsx` — decision below
- `app/_components/Requests.tsx` — extract `req-form-card` form body into a reusable `<RequestForm />` component so the Request and Shout mobile tabs can import it without duplication

### `Mobile.tsx` section on landing page

Keep the "06 — In Your Pocket" section on desktop as marketing copy.
Phone 1 must be updated so its inline markup mirrors the real mobile
expanded player (same top bar, artwork block, track info, play button,
and 4-tab bottom bar with Listen active). Source-of-truth goes the
other way: the real player is built first, then Phone 1's JSX is
rewritten to match. If the real layout changes, the mockup changes
with it — they stay visually identical.

Already hidden on mobile (`mobile-showcase` CSS media query from commit
a0440d2) since a mockup of the current experience is redundant when the
user *is* in that experience. No change needed there.

## Desktop layout (≥ 900 px)

Near-full viewport: `inset: 2vh 2vw` with rounded corners, subtle backdrop
blur behind, dark gradient background matching current player chrome.

```
┌─ topbar ──────────────────────────────────────────────────┐
│  ⌄      ● On Air — Lena                    02:47 · LIVE   │
├───────────────────────────────────────────────────────────┤
│                          │                                 │
│   ┌─────────────────┐    │   ┌─ Lena · on the mic ──┐     │
│   │                 │    │   │ "Alright, night      │     │
│   │    ARTWORK      │    │   │  owls — that's       │     │
│   │   (≈ 55% W)     │    │   │  Russell sliding…"   │     │
│   │                 │    │   └──────────────────────┘     │
│   └─────────────────┘    │                                 │
│                          │   Just Played                   │
│   Neon Fever             │   ┌───────────────────┐         │
│   RUSSELL ROSS           │   │ ⬛ Right Now      │         │
│                          │   │    Russell · 3m   │         │
│    [▶]   ─────────  🔊   │   ├───────────────────┤         │
│                          │   │ ⬛ Midnight Drive │         │
│    ♡ 2     ⌖ 0           │   │    Russell · 6m   │         │
│   [copy] [share]         │   └───────────────────┘  …      │
└──────────────────────────┴─────────────────────────────────┘
```

## Mobile layout (< 900 px)

Full viewport takeover (no inset). Sticky top bar, sticky bottom tab bar,
scrollable middle. Each tab renders different middle content.

**Listen tab** (default)

```
┌─────────────────────────────┐
│ ⌄    Numa·Radio        Live │
├─────────────────────────────┤
│  On Air · Lena    16 listen │
│                             │
│       ┌─────────────┐       │
│       │   ARTWORK   │       │
│       └─────────────┘       │
│                             │
│       Neon Fever            │
│       RUSSELL ROSS          │
│                             │
│       ♡ 2   ⌖ 0             │
│                             │
│              [▶]            │
│                             │
│       ─── Lena · mic ───    │
│       "Alright, night…"     │
├─────────────────────────────┤
│ ●Listen  Request  Shout  On │
│                        Air  │
└─────────────────────────────┘
```

**Request tab** — the existing song request form from `Requests.tsx`, sized
for mobile. Uses the new `<RequestForm />` extracted component.

**Shout tab** — same form component, `tab="shout"` initial state.

**On Air tab** — chronological feed:

```
  02:47 · Neon Fever
  Russell Ross · ⬛ artwork

  02:46 · eddie shouted out
  "going out to robert. hey — what's
   going on with this radio?"

  02:44 · Right Now
  Russell Ross · ⬛ artwork

  02:43 · mihai shouted out
  "going out to robert. how are your
   girls?"
  …
```

## "On Air" feed data model

Merged list of two source streams:

```ts
type OnAirItem =
  | { kind: "track"; id: string; title: string; artist: string;
      artworkUrl?: string; startedAt: string }
  | { kind: "shout"; id: string; requesterName: string; text: string;
      airedAt: string };
```

Merge client-side, sort by timestamp desc, cap at 20 items total.

Fetches already exist:
- `/api/station/broadcast` → `justPlayed[]` (currently 4 items, can widen)
- `/api/station/shoutouts/recent` → `shoutouts[]` (currently 6 items)

Extend `/api/station/broadcast` to optionally return more `justPlayed` (e.g.
`?justPlayed=20`), or keep the On Air feed lightweight with 4 + 6 items
merged. **Start with existing limits; widen later if the feed feels sparse.**

## Animation

Morph animation using CSS transforms:

1. On `expand(sourceEl)`: capture `sourceEl.getBoundingClientRect()` and
   stash it in state. Mount `<ExpandedPlayer>` as `position: fixed`, initially
   positioned and scaled to match the source rect, opacity 0.
2. Next frame: transition to `inset: 2vh 2vw` (desktop) or `inset: 0`
   (mobile), opacity 1, with `transform` easing `cubic-bezier(0.32, 0.72, 0, 1)`
   over 320 ms.
3. On `collapse()`: reverse — animate back to the stashed source rect + opacity 0,
   then unmount.

Use the FLIP-ish technique: measure source rect, set initial transform to
place the overlay on top of the source, transition to identity transform
at target size. Single `transform` + `opacity` transition, GPU-accelerated.

## Close handlers

- Chevron-down button: `onClick={collapse}`
- Esc key: `useEffect` adds `window` keydown listener while `isExpanded`
- Swipe-down (mobile): touch handlers on the root overlay; if `touchend.y -
  touchstart.y > 80px` and no ancestor claimed the gesture, collapse.

## Accessibility

- Trap focus inside the overlay while open; return focus to trigger on close
- `aria-modal="true"`, `role="dialog"`, `aria-labelledby` on the track title
- `Esc` closes (already covered)
- Tab bar buttons: `role="tab"` + `aria-selected`

## Out of scope for this spec

- Desktop Esc-to-close animation polish beyond the basic morph
- Keyboard shortcuts for tab switching on mobile web (unusual usage pattern)
- Persistent active-tab state across opens (always start on Listen)
- Pull-to-refresh on the "On Air" feed (deferred — polling covers it)

## Risks / tradeoffs

- **Morph animation complexity** — FLIP from arbitrary source rects to a
  viewport-sized overlay is finicky, especially when the source scrolls
  between open/close. Mitigation: if the source element is no longer in the
  DOM at close time (user navigated), fall back to a plain fade-out.
- **Mobile tab state & routing** — tabs switch content but don't change URL.
  Browser back should close the overlay, not navigate between tabs. Handle via
  `history.pushState` on expand, `popstate` triggers collapse.
- **Form duplication** — the Request/Shout tabs reuse `<RequestForm />` from
  the landing page. If we change the form logic, both places stay in sync —
  that's the goal, not a risk.

## File / component tree after the change

```
app/_components/
  ExpandedPlayer.tsx              NEW — orchestrator, decides mobile vs desktop, handles animation
  ExpandedPlayer.desktop.tsx      NEW — booth layout
  ExpandedPlayer.mobile.tsx       NEW — tab layout
  ExpandedPlayer/
    TabBar.tsx                    NEW — mobile bottom tabs
    OnAirFeed.tsx                 NEW — chronological merge
    RequestForm.tsx               NEW — extracted from Requests.tsx, reused in tabs + landing
  PlayerProvider.tsx              MODIFIED — add isExpanded state + expand/collapse
  PlayerCard.tsx                  MODIFIED — clickable root, stopPropagation on buttons
  MiniPlayer.tsx                  MODIFIED — same
  Requests.tsx                    MODIFIED — consumes <RequestForm />
  Mobile.tsx                      MODIFIED — Phone 1 JSX rewritten to mirror the real mobile player
app/styles/
  _expanded-player.css            NEW
  _design-sections.css            (unchanged; existing styles reused where possible)
```
