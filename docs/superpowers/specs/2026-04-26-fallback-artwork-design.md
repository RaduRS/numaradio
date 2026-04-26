# Fallback artwork — design

Date: 2026-04-26

## Problem

Listener-generated tracks and operator regen calls fetch cover art from
OpenRouter (Flux). When OpenRouter has no credit (or returns any other
error), today's fallback in `workers/song-worker/pipeline.ts:224` is
`loadDefaultArtwork()` — but the file behind it is a **1×1 transparent
gray pixel**. The track ships with effectively no artwork. The dashboard
regenerate route (`dashboard/app/api/library/track/[id]/artwork/route.ts`)
is worse — it just throws.

We want a real, on-brand placeholder so a Flux outage degrades gracefully
instead of breaking the visual layer.

## Approach

Render four 1024×1024 PNG stills via Remotion in `numaradio-videos`, one
per show. The wordmark is the constant; the per-show variation is the
accent color and the radial-gradient position, so a row of fallback
covers in the dashboard library reads as "different shows, same brand"
rather than "broken".

Re-uses primitives that already exist in `numaradio-videos`
(`Wordmark`, `EyebrowStrip`, `ScanLines`, `FilmGrain`) — no new design
system. The cover effectively looks like a still pulled from one of the
marketing videos' payoff beats.

## Composition

New file: `numaradio-videos/src/compositions/FallbackArtwork.tsx`.

- 1024×1024, 30 fps, `durationInFrames=1` (still).
- Takes `show` prop: `"night_shift" | "morning_room" | "daylight_channel" | "prime_hours"`.
- Layout (centered vertical stack):
  1. `EyebrowStrip` repurposed as a centered top label —
     `NUMA RADIO · <SHOW NAME>` in mono caps.
  2. `Wordmark` (existing primitive) — sized for square canvas
     (~`fontSize: 280`).
  3. Thin teal underline (44 frames-equivalent — single static line,
     ~540 px wide, 2 px tall, color `COLORS.accent`).
  4. `numaradio.com` URL in display font, smaller (`fontSize: 36`),
     letter-spacing matching the videos' payoff beat.
- Background: `COLORS.bg` (`#0B0C0E`) base + per-show radial gradient
  using each show's accent color and on-screen position.
- Overlays at low opacity: `ScanLines`, `FilmGrain` (existing
  primitives, no changes).

### Per-show palette

| show              | accent                  | radial position | feel              |
|-------------------|-------------------------|-----------------|-------------------|
| night_shift       | `#4FD1C5` (teal)        | 20% 80% low-L   | streetlight glow  |
| morning_room      | `#E8D9B0` (warm)        | 80% 20% high-R  | sunrise           |
| daylight_channel  | `#F2F0EA` (fg)          | 50% 30% top     | midday flat light |
| prime_hours       | `#FF4D4D` (red-live)    | 80% 80% low-R   | sunset / dusk     |

Palette pulls from `tokens/brand.ts` — same colors that already power
the videos.

## Render script

New file: `numaradio-videos/src/scripts/render-fallback-artwork.ts`.

- Uses `@remotion/renderer.renderStill` (not `renderMedia` — these are
  PNGs, not video).
- Bundles once, then loops over the four shows passing `inputProps.show`.
- Outputs to `numaradio-videos/out/fallback-artwork/{show}.png`.
- New npm script: `"video:fallback-artwork": "nice -n 10 tsx src/scripts/render-fallback-artwork.ts"`.

Single run regenerates all four. Re-running on a palette change is one
command.

## Output destination & wire-up in `numaradio`

Committed location: `numaradio/assets/fallback-artwork/{show}.png` —
new shared dir at the repo root. Both the song-worker (Node process
on Orion) and the dashboard (Next.js API route on Orion) import from
the same place; no duplication.

Two callers:

1. **Song-worker** (`workers/song-worker/pipeline.ts`):
   - Replace `loadDefaultArtwork()` with `loadFallbackArtwork(show)` —
     reads `assets/fallback-artwork/{show}.png` (relative to repo root
     via `process.cwd()` or a known anchor). The `show` value is
     already in scope via `showEnumFor(new Date())`.
   - Delete `workers/song-worker/assets/default-artwork.png` (the 1×1
     pixel) and the now-dead helper.
2. **Dashboard regenerate route** (`dashboard/app/api/library/track/[id]/artwork/route.ts`):
   - Wrap the OpenRouter call in `try/catch`. On error, look up the
     track's `show` field and fall back to the same per-show PNG. The
     route already writes the resulting bytes to B2 with an immutable
     cache header — that path stays the same.
   - Surface the fallback in the response body
     (`{ ok: true, fallback: true }`) so the dashboard UI can flag the
     event with a small toast like "Generation failed, using brand
     fallback" without changing core behavior.

A shared helper `lib/fallback-artwork.ts` reads + caches the four PNGs.
Both callers go through it.

## Failure & cache behavior

- Track row still gets `primaryArtAssetId`. B2 URL still served. Cache
  headers identical to a generated cover.
- The fallback bytes are deterministic per show — same 4 PNGs forever.
  That's fine for caching: each track's B2 object key is per-track-id
  (`stations/.../tracks/{id}/artwork/primary.png`), so even though the
  bytes repeat across tracks, browsers see distinct URLs and cache
  each correctly.
- Repeat plays of fallback covers in the library look intentional — a
  small "show-tag-only" identity rather than four randomly broken
  thumbnails.

## Observability

- Song-worker pipeline: existing `console.warn("[song-worker] artwork
  failed for ${job.id}: …")` line stays. Add a follow-up
  `console.warn("[song-worker] used fallback artwork for ${show}")` so
  ops can grep for fallback rate.
- Dashboard regen route: log
  `[artwork-regen] fell back to ${show} for track ${id}` on the catch
  branch.

No metrics dashboard wiring — fallback rate is interesting but not
worth a Grafana panel until we see it spike.

## Out of scope (deferred)

- **Per-track text overlays.** Putting the track title on the cover was
  considered and skipped. The fallback should be a *station* identity,
  not a *track* identity — title text turns it into a busy lower-third.
- **Service-worker pre-caching of the 4 PNGs in browsers.** B2 already
  serves them with `public, max-age=31536000, immutable`; that's
  sufficient.
- **Ramping up the fallback to a 1080×1080 size.** 1024×1024 matches
  what Flux returns today, so the dashboard library row sizes don't
  change.

## Drift protection

Existing `numaradio-videos/src/tokens/brand.test.ts` already covers
the brand palette. Composition reads colors from the same module, so a
palette drift is already gated.

If we add new tests, they go alongside the composition file
(`FallbackArtwork.test.ts`) — light coverage on the show-name mapping
function so a typo'd enum value is caught at PR time.

## Build / deploy steps

1. Render the 4 PNGs:
   `cd ~/saas/numaradio-videos && npm run video:fallback-artwork`
2. Copy outputs into the numaradio repo:
   `cp -r out/fallback-artwork ~/saas/numaradio/assets/`
3. Commit numaradio (assets + code), push.
4. `git pull` on Orion picks up the song-worker change. The
   song-worker is `numa-song-worker.service` — restart manually
   (sudoers does NOT include this one):
   `sudo systemctl restart numa-song-worker`.
5. Vercel auto-deploys the dashboard route.

The first listener-generated song after deploy that hits a Flux
failure should land with a real fallback cover; the dashboard library
shows it. If Flux is healthy, behavior is identical to before.
