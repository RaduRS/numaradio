# Design: Radio-feel audio pipeline + shoutout visibility

Date: 2026-04-20
Status: approved (brainstormed with Markus, self-reviewed)

## Problem

Numa's broadcast feels like a silent song player, not a radio station:

1. Shoutouts surface as if they were songs — "Shoutout: …" by "Lena" shows up
   in the Hero's Now Playing, in Up Next, and in Just Played. A person talking
   is not a song and should not lie about what's in the library.
2. When the listener presses **Send** on a shoutout or song request, the
   button accepts repeat clicks. A pending state (spinner + disabled) is
   missing.
3. Music tracks cut hard between each other. Real radio crossfades so the
   station never has a "dead edge".
4. Lena interrupts music instead of speaking over it. On real radio the host
   talks on top of the track — the bed ducks, never disappears.
5. When Lena speaks, the bed doesn't duck. She competes with the music.
6. Lena's TTS output is quieter than music. She sounds small.

## Goal

Make the stream feel like a radio station. Specifically:

- Shoutouts are invisible in the "what's playing" surfaces (title, artwork,
  Up Next, Just Played). An optional "• Lena on air" pill signals *why* the
  music just got quieter, without claiming Lena is a song.
- Public-facing form buttons block further submits and show a spinner while
  in flight.
- 5-second crossfade between music tracks.
- Lena overlays music, not replaces it. Music ducks −6 dB while she speaks,
  restores over 500 ms when she finishes.
- Lena gets +3 dB baseline gain + loudness normalization so she's consistent
  regardless of Deepgram output.

## Non-goals

- Song-generation endpoint (the `/api/booth/song` stub stays a stub; the real
  endpoint is a separate project).
- Client-side ducking. The Icecast stream is pre-mixed — clients never need
  to know what's in the mix.
- Dynamic duck depth based on music genre. Fixed −6 dB; revisit if listeners
  complain.
- Smart variable-length crossfade. Fixed 5 s; revisit later.

## Architecture

### Audio pipeline (Liquidsoap, the big change)

**Today:**
```
priority ─┐
          fallback(track_sensitive=true) ─► mksafe ─► icecast
rotation ─┘
```
Priority (shoutouts + song requests) *replaces* rotation at track boundaries.
No crossfade. No ducking. Voice and music share a single queue.

**New:**
```
rotation ─► cross(duration=5.) ─► music_bed* ─┐
                                               ├─► smooth_add ─► icecast
priority_music ─────────► music_bed* ─────────┤   (p=-6., delay=0.5)
                                               │
overlay_queue ─► normalize ─► amplify(3.0) ────┘   (special input)
```
`music_bed*` is `fallback(track_sensitive=true, [priority_music, rotation])`
wrapped in `cross(5.)` — song requests still preempt rotation at track
boundaries like today, and `cross` applies 5 s crossfades to *all*
music-to-music transitions inside that fallback.

`overlay_queue` is a **new**, voice-only `request.queue`. Shoutouts push here
instead of `priority`. `smooth_add(normal=music_bed, special=overlay_queue)`
is Liquidsoap's built-in ducker: when the special input has content, it fades
the bed down by `p` dB (default ~300 ms fall, restore over `delay` seconds).

Lena goes through `normalize` (LUFS target) + `amplify(3.0)` before the
special input, so her loudness is independent of Deepgram's per-call output.

### Queue routing (daemon)

The HTTP `/push` endpoint on the on-host queue daemon currently forwards all
pushes to Liquidsoap's `priority.push`. New behavior:

- If the push payload includes `kind: "shoutout"` → forward to
  `overlay_queue.push` over the telnet socket.
- Else (default / `kind: "music"`) → `priority_music.push` (renamed from
  `priority` for clarity).

This is the **only** change needed to distinguish shoutouts in the pipeline.
No new Track columns, no new enum values — discrimination is by queue, which
matches the physical-world semantic (music queue vs voice queue).

### Metadata callbacks

Two new Liquidsoap callbacks + two new Next.js internal routes:

- `overlay_queue.on_track(fun(meta) -> POST /api/internal/shoutout-started)`
- `overlay_queue.on_leave(fun() -> POST /api/internal/shoutout-ended)`

Both are shared-secret authed with the existing `INTERNAL_API_SECRET`.

Music tracks continue using `/api/internal/track-started` unchanged. Shoutouts
**never** write to `NowPlaying`; they write a `PlayHistory` row with
`segmentType='audio_host'` + `NowSpeaking` row (see Data model).

### Data model

One additive change:

```prisma
model NowSpeaking {
  stationId       String   @id
  trackId         String
  startedAt       DateTime
  expectedEndAt   DateTime
  lastHeartbeatAt DateTime

  station Station @relation(fields: [stationId], references: [id])
  track   Track   @relation(fields: [trackId], references: [id])
}
```

Mirrors `NowPlaying` exactly. One row per station, one active shoutout at a
time. Cleared by `/api/internal/shoutout-ended` or aged out via 30 s grace
window (matching the existing `NowPlaying` staleness logic).

No new enums needed — `SegmentType.audio_host` already exists and was always
meant for voice segments.

### Broadcast API surface

`/api/station/broadcast` gains one field:

```ts
type Broadcast = {
  nowPlaying: ... // unchanged
  upNext:     ... // unchanged
  justPlayed: ... // unchanged (already filters segmentType='audio_track')
  shoutout:   { active: true, startedAt: string, expectedEndAt: string }
            | { active: false }
}
```

Reads from `NowSpeaking` with the same 30 s stale-grace as `NowPlaying`.

`upNext` query gets one additional WHERE clause: `queueType != 'shoutout'`,
in case anything ever lands a shoutout row in the request queue by accident.
Defense in depth.

### UI

**Hero / PlayerCard (`app/_components/`):**

Read `shoutout.active` from the broadcast response. When true, render a small
pill next to the now-playing title:

```
[● Lena on air]
```

- Pulse animation on the dot.
- Accent-colored (`var(--accent)`).
- Disappears when `shoutout.active` becomes false.
- Title + artwork continue to show the underlying music track. No change.

**Requests form (`app/_components/Requests.tsx`):**

Pull the submit button into a `<SubmitButton sending label />` subcomponent
used by both the song and shoutout tabs. While `sending`:

- `disabled` (already there for shoutout, not for song stub).
- `SendIcon` is replaced by a small spinner icon (`animate-spin` Tailwind
  class or CSS equivalent using the existing design tokens).
- Label cycles: "Send to the booth" → "Sending…" → "✓ In the queue" →
  "Send another" (existing logic, just re-homed).

## Data flow (end-to-end shoutout)

1. Listener submits text via `/api/booth/submit` OR operator composes via
   `/api/shoutouts/compose` OR NanoClaw calls `/api/generate/shoutout`.
2. Moderation (where applicable) → `generateShoutout()` →
   TTS → B2 → Track + TrackAsset rows.
3. `pushToDaemon({ trackId, sourceUrl, kind: "shoutout", reason })`.
4. Daemon routes to `overlay_queue.push` via telnet. Returns `queueItemId`
   (written with `queueType='shoutout'`).
5. When Liquidsoap starts the shoutout (immediately, overlay has no
   track-boundary wait), `overlay_queue.on_track` fires →
   daemon POSTs `/api/internal/shoutout-started` to Vercel.
6. Vercel: upsert `NowSpeaking(stationId, trackId, startedAt, expectedEndAt,
   lastHeartbeatAt)` + insert `PlayHistory(segmentType='audio_host', …)`.
7. Broadcast API next poll returns `shoutout.active=true`. Hero pill lights
   up. Music bed continues to show in title/artwork.
8. `smooth_add` ducks bed by −6 dB over ~300 ms; Lena (+3 dB, normalized)
   plays on top.
9. Lena ends → `overlay_queue.on_leave` → POST
   `/api/internal/shoutout-ended` → clear `NowSpeaking` → broadcast API next
   poll returns `shoutout.active=false` → pill disappears. Bed restores over
   500 ms.

## Testing

- **Unit** (`lib/...` + `dashboard/lib/...`):
  - `NowSpeaking` 30 s stale-grace behavior in broadcast response assembly.
  - `pushToDaemon` forwards `kind` correctly; default is `music`.
  - `upNext` excludes `queueType='shoutout'` rows.
- **Manual smoke**:
  - Submit a shoutout while a known song is playing. Verify pill appears,
    music ducks audibly, title/artwork unchanged, pill clears after Lena
    ends, music restores to full volume.
  - Play two music tracks back-to-back with a short gap in rotation. Verify
    5 s crossfade (no hard cut, no silence).
  - Stack two shoutouts. Verify they play sequentially, not simultaneously.

## Rollout

1. Schema migration (`NowSpeaking`) + broadcast field + UI (pill + spinner)
   → deploy to Vercel. Inert until writers land (`shoutout.active` always
   false).
2. Daemon `kind` routing + `/api/internal/shoutout-started` +
   `/api/internal/shoutout-ended` → deploy to Vercel.
3. `liquidsoap/numa.liq` rewrite → deploy via `sudo systemctl restart
   numa-liquidsoap numa-queue-daemon`.
4. Smoke test on live stream.

## Risks / open questions

- **`smooth_add` parameter naming** varies across Liquidsoap minor versions.
  2.2.4 uses `p=` (dB), `delay=` (restore seconds), `normal=`/`special=`.
  Verify against the bundled version before final merge.
- **Overlay arriving mid-crossfade**: `smooth_add` wraps the already-crossed
  music source, so duck should apply uniformly to both fading tracks. Smoke
  test confirms.
- **`NowSpeaking` orphan rows**: if `shoutout-ended` is missed (network blip,
  Liquidsoap crash), the pill could stick. Mitigated by 30 s `expectedEndAt`
  grace. TTS duration is known at generation time — pass it through
  `shoutout-started` and set `expectedEndAt = startedAt + duration + 2s`.
- **Rollback**: keep the previous `priority`/`fallback` path in a
  commented-out block in `numa.liq` for one deploy cycle. Reverting is
  uncommenting 5 lines.
- **Queue daemon backwards compat**: deploying a new-routing daemon against
  an old `numa.liq` that still only has `priority.push` will break shoutouts
  silently (wrong queue name). Restart order must be
  `numa-liquidsoap → numa-queue-daemon` or both simultaneously.
