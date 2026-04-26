# Skeleton loading states — design

Date: 2026-04-26

## Problem

A handful of public-site surfaces fetch data on mount and render an
empty/dash state until it arrives. The empty state has different
dimensions than the real content, so when data lands the page shifts
(measurable CLS, perceptible jank). Browsers and listeners on slow
connections see this every visit.

## Approach

Single reusable `<Skeleton>` primitive with two variants:

- **`shimmer`** (default): `var(--bg-2)` rectangle with a teal-tinted
  gradient sweep, 1.6 s loop. Tells the user "loading" within the
  first frame without screaming.
- **`static`**: same `var(--bg-2)` rectangle, no animation. Used in
  surfaces where multiple skeletons stacked (ShoutoutWall) would be
  loud; keeps the height reservation, drops the motion.

Both honor `prefers-reduced-motion: reduce` (animation off, fall back
to static).

The skeletons don't try to look like the final content — they're
height-and-width-accurate placeholders that *occupy the same box* as
the real element. The whole point is **zero layout shift on data
arrival**.

## Target surfaces

| # | surface | empty state today | skeleton | variant |
|---|---|---|---|---|
| 1 | HeroStats (3 numeric tiles) | `—` per number | rect 32×80 + rect 10×100 per tile | shimmer |
| 2 | Broadcast main card title/artist | "Warming up" / "Numa Radio" | rect 42 × 70 % + rect 22 × 50 % | shimmer |
| 3 | Broadcast queue list (empty + upNext + justPlayed) | empty list | 5 rows of `.queue-item`-shaped skeletons | shimmer |
| 4 | ListenerCount inline pill | `null` (no element) | rect 14×64 inline-block | shimmer |
| 5 | ShoutoutWall (Hero columns) | two empty `.shout-col` divs | 3 card-shaped skeletons per column | **static** |

Out of scope: Schedule "Live Now" pill (tiny insertion, not worth
it). OnAirFeed (lives behind the expanded-player tab; doesn't affect
the initial above-the-fold paint). Cover artwork itself (already has
the per-show fallback PNG underneath).

## Primitive

`app/_components/Skeleton.tsx`:

```tsx
<Skeleton width={number|string} height={number|string} radius?={number} variant?="shimmer"|"static" className?={string} />
```

- Renders a `<span class="numa-skeleton …">`.
- `display: inline-block`, sizing via inline style for exactness.
- `radius` defaults to 6 px.
- `aria-hidden="true"` — screen readers should ignore the placeholder
  and pick up the real text on update.

CSS lives in `app/styles/_design-base.css` next to the other shared
visual primitives.

```css
.numa-skeleton {
  display: inline-block;
  background: var(--bg-2);
  position: relative;
  overflow: hidden;
  vertical-align: top;
}
.numa-skeleton.shimmer::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(79, 209, 197, 0.10) 50%,
    transparent 100%
  );
  transform: translateX(-100%);
  animation: numa-skeleton-sweep 1.6s linear infinite;
}
@keyframes numa-skeleton-sweep {
  to { transform: translateX(100%); }
}
@media (prefers-reduced-motion: reduce) {
  .numa-skeleton.shimmer::after { animation: none; }
}
```

The sweep is a single linear-gradient overlay translating across the
container. Speed adapts to element width (small skeletons sweep
faster) which feels natural across the size range here (10 px tall
labels through 64 px tall titles).

The teal alpha (`rgba(79, 209, 197, 0.10)`) is restrained — pulse-like
on small elements, clearly motion on bigger ones. Brighter values
(0.20 +) pulled too much focus when prototyped against the live page.

## Wire-up sketch (per surface)

- **HeroStats**: when `data === null`, render three `.hero-stat`s each
  containing two stacked `<Skeleton>` boxes matching the real `.n`
  and `.l` dimensions. The `.hero-stats` container's own padding,
  gap, and border-top stay identical.
- **Broadcast main card**: when `live === null`, replace `<div
  className="title">` text with a 42-px-tall skeleton at 70 %
  width; replace the `.sub` flex content with a 22-px-tall skeleton
  at 50 % width. The container, margin, and progress bar slot keep
  the same heights.
- **Broadcast queue list**: when `justPlayed.length === 0 && !upNext`,
  render 5 row-shaped skeletons that mirror `.queue-item`'s grid:
  fixed-width position cell, 56 × 56 art square, 1fr title bar (two
  stacked skeletons), and trailing duration cell. Same padding and
  radius as a real row.
- **ListenerCount**: when `data === null`, render an inline-block
  skeleton sized to match the typical "247 listening" string at the
  current font (≈ 64 px wide, 14 px tall). Replaces the current
  `null` return.
- **ShoutoutWall**: when `items === null`, render 3 static
  card-shaped skeletons per column (h ≈ 110 px each, gap 16 px).
  Inherits `.shout-col` width. Cards are uniform height — when real
  data arrives, slight per-card height differences cause minor
  internal reflow, but the column total is roughly conserved and
  this surface is below-the-fold anyway.

## Out of scope (deferred)

- Skeletons inside the dashboard (operator-only, different audience).
- Skeleton tinting per-show (the teal accent is brand-universal).
- A Storybook page (project doesn't have one; would be a Trojan horse
  of yak-shaving).

## Testing

- `next build` clean.
- Visual check via dev server (Playwright if needed) on slow-3G
  throttle: skeleton shows for the right surfaces, no layout shift
  when data lands, animation respects `prefers-reduced-motion`.
- The primitive itself is too small to unit-test meaningfully —
  ship and observe.
