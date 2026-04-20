# Plan: Radio-feel audio pipeline + shoutout visibility

Spec: `docs/superpowers/specs/2026-04-20-radio-feel-design.md`

## Phase 1 — Schema + broadcast API + UI (inert without writers)

**Safe to deploy independently. `shoutout.active` returns `false` everywhere
because nothing writes `NowSpeaking` yet.**

1. Prisma migration: add `NowSpeaking` model.
   - File: `prisma/schema.prisma`
   - Migration: `prisma migrate dev --name add_now_speaking`
2. Broadcast API: add `shoutout` field, filter `queueType='shoutout'` from
   `upNext` query.
   - File: `app/api/station/broadcast/route.ts`
3. Hero / PlayerCard: read `shoutout.active`, render pill when active.
   - Files: `app/_components/Hero.tsx`, `app/_components/PlayerCard.tsx`
     (whichever holds the now-playing title), `app/_components/MiniPlayer.tsx`
   - Style: `app/globals.css` or existing card styles — `.on-air-pill` with
     pulse animation.
4. Requests form: extract a shared `SubmitButton` with spinner + disabled.
   - File: `app/_components/Requests.tsx` (+ new
     `app/_components/SubmitButton.tsx` if helpful)
5. Commit + push.

## Phase 2 — Internal endpoints + daemon routing

**These depend on Phase 1 schema. Deploy after Phase 1 is live on Vercel.**

6. `POST /api/internal/shoutout-started`
   - File: `app/api/internal/shoutout-started/route.ts`
   - Body: `{ sourceUrl?, trackId?, title?, artist?, durationSeconds? }`.
   - Auth: `x-internal-secret`.
   - Upserts `NowSpeaking` + inserts `PlayHistory(segmentType='audio_host')`.
   - Does NOT touch `NowPlaying`.
7. `POST /api/internal/shoutout-ended`
   - File: `app/api/internal/shoutout-ended/route.ts`
   - Deletes `NowSpeaking` for the station.
8. Queue daemon: add `kind` routing.
   - File: `workers/queue-daemon.ts` (or wherever the daemon lives).
   - `{ kind: "shoutout" }` → `overlay_queue.push` telnet command.
   - `{ kind: "music" | undefined }` → `priority_music.push`.
   - Mark `queueItem.queueType='shoutout'` for overlay pushes.
   - Notification forwarder: a second callback from Liquidsoap posts to the
     new `/api/internal/shoutout-started` endpoint when overlay starts.
9. `generateShoutout()`: pass `kind: "shoutout"` to `pushToDaemon`.
   - File: `dashboard/lib/shoutout.ts`
   - File: `dashboard/lib/library.ts` (or wherever `pushToDaemon` lives) —
     accept and forward `kind`.
10. Commit + push. Vercel auto-deploys the new endpoints.

## Phase 3 — Liquidsoap rewrite

**Breaks the stream if deployed without Phase 2 daemon. Restart order
matters.**

11. `liquidsoap/numa.liq`:
    - Rename `priority` → `priority_music` (existing semantics).
    - Add `overlay_queue = request.queue(id="overlay_queue")`.
    - Add `rotation_crossed = cross(duration=5., rotation)`.
    - Compose `music_bed = fallback(track_sensitive=true,
      [priority_music, rotation_crossed])`.
    - Normalize + amplify overlay: `overlay_amped = amplify(3.0,
      normalize(overlay_queue))`.
    - Mix: `source = smooth_add(p=-6., delay=0.5, normal=music_bed,
      special=overlay_amped)`.
    - Attach `overlay_queue.on_track` → POST shoutout-started to Vercel.
    - Attach `overlay_queue.on_leave` (or `on_end`) → POST shoutout-ended.
    - Keep commented-out old `priority` / `fallback` graph for one deploy
      cycle as rollback escape hatch.
12. Commit + push.
13. On Orion: `git pull && sudo systemctl restart numa-liquidsoap
    numa-queue-daemon`.
14. Smoke test:
    - Dashboard compose → verify pill appears, music ducks, title/artwork
      stay on the music, pill clears after Lena, music restores.
    - Push two library tracks back-to-back via `/library` → verify 5 s
      crossfade.
    - Stack two shoutouts → verify sequential, not overlapping each other.

## Testing

- `npm test` in repo root — add unit tests for the broadcast shoutout
  assembly and the daemon `kind` routing.
- `cd dashboard && npm test` — add tests for `pushToDaemon` passing `kind`
  through.
- `npm run build` in both root + dashboard — type check.

## Rollback

- **Phase 1**: trivial — revert commits; `NowSpeaking` table left in DB is
  harmless.
- **Phase 2**: revert commits; endpoints 404 until redeployed; daemon
  reverts to single-queue routing.
- **Phase 3**: uncomment the preserved old graph, `sudo systemctl restart
  numa-liquidsoap`.
