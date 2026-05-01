# Voice provider toggle (Deepgram Helena ⇄ Vertex Leda)

**Date:** 2026-05-01
**Status:** approved, implementation pending

## Goal

Let the operator swap Lena's voice between Deepgram Aura-2 Helena
(current) and Google Vertex AI Gemini 3.1 Flash TTS Leda from a
single dashboard tile. One global voice for everything Lena says
(auto-chatter, shoutouts, world asides, replies). Default stays
Deepgram. Manual toggle, no auto-revert.

## Why

Helena's delivery is flat — operator wants more expressivity,
especially for listener shoutouts. Gemini 3.1 Flash TTS supports
inline audio-tag direction (`[warm radio host tone]`), tops the
Artificial Analysis TTS leaderboard, and runs on £225 of free GCP
credit on the same project that already hosts the YouTube OAuth
flow. Audio-tag direction is **out of scope for v1** — we ship the
plain Leda voice first, evaluate live, then decide whether to wire
tags into prompt templates.

## Architecture

### Schema change

Add to `Station` (Prisma):

```
voiceProvider VoiceProvider @default(deepgram)
```

New enum `VoiceProvider { deepgram, vertex }`.

Migration: `20260501_add_voice_provider`.

### Worker (`workers/queue-daemon/`)

- New `vertex-tts.ts` — `synthesizeVertex(text, opts) → Buffer<MP3>`.
  Calls `gemini-3.1-flash-tts-preview` with voice=Leda, gets
  `audio/l16` PCM at 24kHz mono, pipes through `ffmpeg -f s16le -ar
  24000 -ac 1 -i pipe:0 -codec:a libmp3lame -b:a 128k -f mp3 pipe:1`
  to MP3. Returns the MP3 buffer.
- New `synth-router.ts` — `synthesize(text, opts) → Buffer<MP3>`.
  Reads `Station.voiceProvider` (cached 30s, same shape as
  `station-config.ts`). Branches to `synthesizeChatter` (Deepgram)
  or `synthesizeVertex`. Single entry point everywhere downstream.
- `index.ts:184,232` — replace `synthesizeChatter(...)` calls with
  `synthesize(...)` from the router.

### Dashboard (`dashboard/lib/`)

- New `vertex-tts.ts` — duplicate of the worker version (separate
  npm package, can't share code).
- New `synth-router.ts` — same shape as worker router.
- `shoutout.ts` — replace inline Deepgram block (lines 9-60, 126-166)
  with `synth-router.synthesize(...)`. Keep the
  `ShoutoutError` shape and 502 mapping for either provider.

### Dashboard UI

`components/status-pills.tsx` lines 75-79 — replace the **Stream
bitrate** `MetricTile` with a new `VoiceProviderTile`:

```
HELENA           ← font-display 4xl/5xl, accent on hover
deepgram         ← font-mono 10px uppercase, fg-mute
```

Toggle flips to:

```
LEDA
google
```

Click toggles. Optimistic update + `POST /api/voice-provider`. Same
visual size as adjacent tiles. Tooltip on hover: "Click to swap
between Deepgram Helena and Vertex Leda".

### API

- `GET /api/voice-provider` — returns `{ provider: "deepgram" | "vertex" }`.
- `POST /api/voice-provider` — body `{ provider }`, persists to
  Station. Cloudflare Access already gates the dashboard; no extra
  auth.

### Env (Orion only — Vercel public site has no TTS)

Append to `/etc/numa/env`:

```
GOOGLE_CLOUD_PROJECT=numa-radio-dashboard-494716
GOOGLE_APPLICATION_CREDENTIALS=/home/marku/.config/gcloud/application_default_credentials.json
```

Both `numa-queue-daemon` and `numa-dashboard` inherit via
`EnvironmentFile` and pick up the new vars on restart. ADC is
already on disk from `setup_adc.sh`.

### Audio format

Vertex returns 24kHz mono 16-bit PCM (`audio/l16`). Pipeline expects
MP3. Convert PCM → MP3 inline via ffmpeg pipe (already installed on
Orion). ~30-80ms CPU per shoutout, immaterial. Keeps the rest of
the pipeline (B2 upload, queue push, Liquidsoap playback) unchanged.

## Cost

Verified live against the API: 1 second of Leda audio = ~25 audio
output tokens. At $20/1M output tokens, **1 second ≈ $0.0005**.

| Volume | Cost/day | Cost/month |
|---|---|---|
| 100 breaks/day @ 12s avg (light) | $0.60 | $18 |
| 300 breaks/day @ 12s avg (typical) | $1.80 | $54 |
| 600 breaks/day @ 12s avg (heavy) | $3.60 | $108 |

£225 / 87 days = ~$3.20/day budget. Typical usage fits with margin.
~200 shoutouts per US dollar.

## Out of scope (v1)

- Audio-tag direction in prompt templates (revisit after live A/B).
- Per-type toggles (chatter vs shoutout vs reply).
- Auto-revert timer.
- Service-account JSON keys (ADC suffices on Orion).
- Vercel changes (public site has no TTS).

## Test plan

- Unit tests for `vertex-tts.ts` — mock Gemini SDK, assert PCM →
  MP3 conversion shape and error mapping.
- Unit tests for `synth-router.ts` — assert it reads the cached
  config and dispatches to the right backend.
- Integration smoke after deploy:
  1. Toggle stays "Helena · deepgram" by default. Auto-chatter sounds
     unchanged.
  2. Click → "Leda · google". Next chatter break is Leda.
  3. Submit a shoutout from numaradio.com → airs in Leda.
  4. Click back → "Helena · deepgram". Next break is Helena again.
- Watch `journalctl --user -u numa-queue-daemon -f` and
  `sudo journalctl -u numa-dashboard -f` for any provider errors.

## Files touched

- `prisma/schema.prisma` (+enum, +column)
- `prisma/migrations/20260501_add_voice_provider/migration.sql`
- `workers/queue-daemon/vertex-tts.ts` (new)
- `workers/queue-daemon/vertex-tts.test.ts` (new)
- `workers/queue-daemon/synth-router.ts` (new)
- `workers/queue-daemon/synth-router.test.ts` (new)
- `workers/queue-daemon/station-config.ts` (extend cache shape)
- `workers/queue-daemon/index.ts` (route through new module)
- `dashboard/lib/vertex-tts.ts` (new, mirrors worker)
- `dashboard/lib/synth-router.ts` (new, mirrors worker)
- `dashboard/lib/shoutout.ts` (route through new module)
- `dashboard/app/api/voice-provider/route.ts` (new, GET + POST)
- `dashboard/components/status-pills.tsx` (replace bitrate tile)
- `dashboard/components/voice-provider-tile.tsx` (new)
- `/etc/numa/env` (operator step, two new vars)
- `package.json` of both numaradio root and dashboard:
  add `@google/genai`

## Deploy order

1. `git pull` on Orion.
2. `npx prisma migrate deploy` (adds enum + column, default
   "deepgram", no behaviour change).
3. Add the two env vars to `/etc/numa/env`. `chmod 0600` it.
4. `sudo systemctl restart numa-queue-daemon`.
5. `cd dashboard && npm run deploy` (builds + restarts
   `numa-dashboard` via sudoers).
6. Smoke-test toggle on `dashboard.numaradio.com/`.
