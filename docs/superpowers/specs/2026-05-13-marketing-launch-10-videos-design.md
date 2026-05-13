# 10-video marketing launch slate (May 2026)

**Date:** 2026-05-13
**Status:** Design approved by operator inline; implementation plan to follow via `writing-plans`.

## Problem

`@numaradio` YouTube has 22 Shorts uploaded over 4-25 days and is barely growing
(20 subs, 2,931 views total). The data shows a clear winner pattern and a
clear flop pattern, but the most recent uploads have drifted into the flop
bucket. We need 10 new pieces grounded in what actually worked.

## Performance data (from `scripts/youtube-performance-report.ts`)

Top 7 Shorts by views — these define what works:

| Views | Title | Format |
|---|---|---|
| 939 | Custom AI song · generated and aired in 2 minutes | `SongRequestDemo` |
| 594 | Built by listeners — how Numa Radio works | `PitchSpot` (built-by-listeners) |
| 321 | 1,200+ shoutouts on air | `StatHook` (shoutouts) |
| 120 | What is Numa Radio? in 15 seconds | `ListenNow` |
| 110 | Meet Lena — the AI host | `MeetLena` |
| 109 | Hear yourself on the radio in 2 minutes | `ShoutoutFlagship` |
| 102 | How to request an AI-generated song | `HowTo` |

Flop bucket — all under 60 views, mostly under 30:

- Show spotlights (`ShowSpotlight` variants for Morning Room, Daylight
  Channel, Late Drive, Night Shift, Prime Hours)
- Hour-mark / after-dark vibe rooms (`HourMark`, `AfterDark`, `VibeRoom`)
- Brand poster pieces ("Always live. Always making.", "Type a vibe. Hear a song.")
- Live-stream VODs — 21 of them, 9-view average. **Stop uploading these.**

## The 10-video slate

All 10 use compositions that already exist and already proved performance.
Nine are pure remixes (new data, fresh hooks, retuned cold opens). One is
a small new composition (`MagicLoop`) that codifies what made the #1 winner
work — input → output — into the tightest possible 8-second shape.

Render targets: 1080×1920, 30fps, ≤30s each. Output to
`numaradio-videos/out/launch-10/<slug>.mp4` plus matching `.captions.md`
per existing v2 convention (IG / YT Shorts / TikTok blocks).

### Slate

| # | Slug | Composition | Hook (≤1.5s opener) | Data needed |
|---|---|---|---|---|
| 1 | `song-broken-drive` | `SongRequestDemo` | "Someone typed 'broken 2am drive song'. Watch what came back." | Real listener-generated track from B2 + matching prompt |
| 2 | `song-rainy-lisbon` | `SongRequestDemo` | "An AI radio made a song for one listener. Live. In 2 minutes." | Different real track + prompt (use the `2026-05-08` rainy-lisbon if still in DB) |
| 3 | `shoutout-mom` | `ShoutoutFlagship` | "She typed it. The AI host read it. 8 seconds later." | Pull recent real listener shoutout from DB; Deepgram-synth Lena's aired version |
| 4 | `shoutout-dad` | `ShoutoutFlagship` | "Listener: 'play something for my dad'. What aired ↓" | Another real shoutout, emotional-stakes variant |
| 5 | `stat-shoutouts-fresh` | `StatHook` (shoutouts) | "[N] shoutouts on air this month." | Live count from Prisma: `Shoutout.count({ where: { state: 'aired', createdAt: { gte: monthStart } } })` |
| 6 | `stat-tracks-tonight` | `StatHook` (tracks) | "[N] tracks generated tonight." | Live count: `Track.count({ where: { source: 'listener_generated', createdAt: { gte: dayStart } } })` |
| 7 | `listen-now-v2` | `ListenNow` (re-edit) | "There's a radio station that runs itself. Press play." | Just tighten cold open + outro, no data |
| 8 | `meet-lena-v2` | `MeetLena` (re-edit) | "Meet the host. She's never been to bed." | Replace first 3s of original; body intact |
| 9 | `howto-shoutout-noapp` | `HowTo` | "How to get on the radio. 3 steps. No app." | Recycle existing 3-step script, swap closer line |
| 10 | `magic-loop` | **NEW** `MagicLoop` | "I type. She reads. The radio responds." | New comp, 6-8s, uses existing primitives (`TypedText`, `LenaPortrait`, `Waveform`) |

### Why these specifically work

- **Speed claim** ("in 2 minutes", "8 seconds later") proved out in #1 (939v)
  and #6 (109v). Every slate item that can claim time, does.
- **Concrete listener prompt** (real text, not abstract) drove #1. We use
  real DB-sourced prompts/shoutouts wherever possible — not invented copy.
- **Differentiator phrases** ("no app", "runs itself", "never been to bed",
  "built by listeners") are the kinds of single-sentence value props that
  outperformed clever poetic alternatives.
- **Numbers** with the word "tonight" or "this month" are time-bounded
  urgency — outperformed all-time-total framing (#3 used "1,200+" which is
  stale and growing).

### What is NOT in the slate (and why)

- No show spotlight (`ShowSpotlight`, `AfterDark`, `HourMark`, `VibeRoom`)
  — all proven flops.
- No `DayInNuma` 4-shows montage (38v) — the format doesn't compress well.
- No live-stream VOD uploads (avg 9 views) — algorithmically dead.
- No abstract brand poster ("Always live. Always making.") — 17v on the
  one we tried.

## The new `MagicLoop` composition (slate #10)

8 seconds, three beats, each ~80 frames. Reuses existing primitives only.

```
0.0–2.5s   "i type"   →  TypedText "play something for my dad" appears in a
                         minimal card on left half. Cursor blink.
2.5–5.0s   "she reads" →  LenaPortrait slides in from right with breathing
                         halo. Waveform pulses to a 2.5s clip of her aired
                         line. Card fades to ghost.
5.0–8.0s   "the radio  →  Hard cut to PlayerCard mock (album + waveform +
            responds"      track title generated on the fly). Wordmark +
                         numaradio.com URL stamps in. End.
```

Music bed: 8 seconds of `bed-01` (already curated). No new SFX needed.

Why this earns its place over a 10th remix: the magic of Numa is
input→aired-output, but no existing composition shows the full loop in
under 10 seconds. Even the 939-view winner only shows half (input →
generated song). This piece captures the whole product in the time a
viewer takes to swipe.

## Captions and hashtags strategy

Per-platform, per existing v2 convention:

### Instagram

- 1-2 sentence hook in regular case + line break.
- "Numa Radio · [angle]" framing.
- "Submit your own at numaradio.com." closer.
- 8-10 hashtags: `#NumaRadio #AIRadio #IndieMusic #InternetRadio #LiveRadio
  #Shoutouts #ListenLive` plus 2-3 piece-specific (`#AIGeneratedMusic` for
  song pieces, `#OnAir` for shoutout pieces, `#NoApp` for the loop).

### YouTube Shorts

- Title: front-loaded with the concrete payoff, ≤65 chars (mobile cap).
  Use specific numbers and timeframes where possible.
- Description: 2-3 sentence rebroadcast of the on-screen story + URL.
- 5-6 hashtags including `#shorts` always.

### TikTok

- Lowercase, no proper-noun caps, conversational.
- Lead with the curiosity gap, not the product name.
- Final line = "numaradio.com" (no http://).
- 5-7 hashtags: `#numaradio #airadio #indiemusic #shoutouts #fyp` + 1-2
  piece-specific.

### Per-piece captions

Each rendered piece gets one `.captions.md` file matching the existing v2
format. Caption authoring happens during the render step, not the spec
step — captions reference render-time data (real shoutout text, real
track title, real stat number) that isn't known yet.

## Posting cadence

Mon / Wed / Fri × ~3.5 weeks = 10 slots starting next business day:

```
Wed 14 May  #1 song-broken-drive
Fri 16 May  #3 shoutout-mom
Mon 19 May  #5 stat-shoutouts-fresh
Wed 21 May  #7 listen-now-v2
Fri 23 May  #10 magic-loop          ← NEW comp lands here
Mon 26 May  #2 song-rainy-lisbon
Wed 28 May  #4 shoutout-dad
Fri 30 May  #6 stat-tracks-tonight
Mon  2 Jun  #8 meet-lena-v2
Wed  4 Jun  #9 howto-shoutout-noapp
```

Pattern: alternate "magic-moment" pieces (song / shoutout / loop) with
"explainer / stat" pieces. Highest-confidence winner pattern (#1, #3, #5)
goes first to seed the algorithm with fast watch-time signal.

## Rendering plan

1. **Data fetch step** (before any render): a new `scripts/pull-launch-data.ts`
   that queries Prisma for: 2 real listener-generated tracks + their prompts
   (for #1, #2); 2 real recent shoutouts with broadcast text + Deepgram-synth
   audio (for #3, #4); fresh month/day stat counts (for #5, #6). Writes results
   to `numaradio-videos/src/data/launch-10.json` for the comps to read.
2. **Render step:** `numaradio-videos/scripts/render-launch-10-batch.ts`
   sequences the 10 renders under `nice -n 10` with `concurrency: 4`. Each
   render lands under `out/launch-10/<slug>.mp4`.
3. **Caption step:** captions written per-piece into
   `out/launch-10/<slug>.captions.md` by the batch script, populated from
   the same `launch-10.json` so the on-screen story matches the IG/TT/YT
   text.
4. **New comp:** `numaradio-videos/src/compositions/MagicLoop.tsx` lands
   before the batch render. ~half-day dev, no new primitives needed.
5. **Verification:** ffprobe each MP4 (1080×1920 30fps, duration in spec
   range); open a sample on Windows desktop before declaring done.

## Out of scope

- TikTok and Instagram performance analysis — not accessible without
  manual export from the operator. The YouTube signal alone is strong
  enough to direct the slate; the same hooks port across platforms.
- YouTube Analytics deeper data (retention curves, traffic source,
  swipe-through %) — requires a separate OAuth scope rescope. Defer
  unless this slate also flatlines.
- Stop uploading live-stream VODs as videos. (Not a code change, an
  operator habit — but it's load-bearing for channel SEO health.)
- A separate spec for posting/scheduling automation. The 10 videos
  ship; operator posts manually on the cadence above.
