---
title: YouTube features roadmap — songs from chat + Lena conversational
date: 2026-04-28
status: roadmap (not yet planned)
---

# YouTube features roadmap

Two extensions to the YouTube broadcast surface that we discussed but
intentionally **excluded from PRs 1-4** (the launch set). Captured here
so future-us can pick them up cleanly.

Today's stack (LIVE as of 2026-04-28):
- PR 1: `/live` broadcast page on Vercel
- PR 2: `numa-youtube-encoder.service` on Orion → YouTube RTMP
- PR 3: dashboard YouTube health card (read-only)
- PR 4: queue-daemon polls YT chat → `@lena`-mentioned + shoutout-worthy
  messages become aired shoutouts (one-way, broadcast, no reply)

Both features below are **value-multipliers, not bug fixes** — ship them
once the launch set has soaked for a few weeks and we have real engagement
data telling us which one viewers want first.

---

## Feature A — Songs from YouTube chat

**The pitch:** YouTube viewer types `@lena song: dreamy synth at 2am`,
the song-worker generates a Suno track, Lena airs it on the radio
within ~5 minutes. The viewer hears their own request on the live
stream. Pure dopamine.

**Why we kept it out of PR 4:**
- Songs cost real money (MiniMax music + Flux artwork + B2 storage)
- Single-track throughput on `numa-song-worker` (~3 min/song)
- A bored troll on YouTube has no IP rate-limit anchor; sock-puppet
  channels are cheap. The booth's 1/hr-per-IP doesn't translate.

### Required guardrails

1. **Distinct trigger** — `@lena song:` (not just `@lena`). Avoids
   the "play something" / "I want to hear" ambiguity from PR 4's
   shoutout flow. Anything that doesn't match the prefix stays in
   the shoutout pipeline.
2. **Per-author rate limit**: 1 song/day per `authorChannelId` (vs
   booth's 1/hr × 3/day per IP — channels are easier to mint than
   IPs, so daily-only).
3. **Daily cost cap**: configurable, default 5 YouTube-sourced songs
   per 24h regardless of source. Hard floor that stops cold once
   tripped — operator gets a Telegram nudge to raise it manually if
   they want more.
4. **All YT-sourced songs go to held queue first.** Never
   auto-generate. Operator approves via dashboard `/library` ("YT
   pending" tab). Approved → song-worker picks up → airs. Rejected
   → audit row, no money spent.
5. **Soft-filter on prompt**: existing `moderateSongPrompt()` from
   `lib/moderate.ts` runs first. Anything `held`/`blocked` never
   reaches operator review.

### Implementation sketch

Files to add/modify:
- `app/api/internal/youtube-chat-song/route.ts` — new internal
  endpoint mirroring the booth song path, with held-by-default flow.
- `workers/queue-daemon/youtube-chat-loop.ts` — branch on trigger:
  `@lena song:` → song endpoint, `@lena` → shoutout endpoint.
- `dashboard/app/library/page.tsx` — new "YT pending" tab next to
  the existing Library list. Approve/reject buttons hit a new
  internal route that flips the row to "approved" + hands it to
  song-worker.
- New Prisma column on `Track` (or a new `YoutubeSongRequest`
  model) tracking author + cost + dailyCounter.

### Operator UX

Dashboard `/library` gets a "YT pending" sidebar tab:
```
┌──────────────────────────────────────────────────────────────┐
│ YT pending (3)                                                │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ "dreamy synth at 2am, like ocean breath"                 │ │
│ │ — Marek (UC...AbC) · 4m ago · daily 2/5 · est £0.08      │ │
│ │ [ APPROVE ]   [ REJECT ]   [ BLOCK AUTHOR ]               │ │
│ └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

Estimated scope: **3–4 days**. Schema change + endpoint + dashboard
tab + held flow + tests. No new infrastructure (reuses song-worker).

---

## Feature B — Lena conversational on YouTube chat

**The pitch:** Lena reads YouTube chat in real time, replies in chat,
remembers returning viewers, has actual conversations. Listeners feel
they're with a real host. This is the feature that puts Numa Radio in
a different category from every other 24/7 livestream out there.

**Why we kept it out of PR 4:**
- Bidirectional needs the `youtube.force-ssl` OAuth scope (write
  access) — different consent screen, new refresh token.
- `liveChatMessages.insert` costs 50 quota units per reply (vs 5
  for read). At 1 reply/minute that's 72k/day — needs a Google
  quota-bump request (free, ~2-3 weeks turnaround).
- MiniMax cost scales linearly with chat volume. 100 replies/hr =
  $1-5/hr. Needs a kill switch.
- Soft-tone safety: Lena replying to a troll badly is a brand event.
  Need her own moderator pre-filter on outbound.
- This is a "wow" feature — wants polish before launch, not a v1
  rough cut.

### Architecture

Reuses NanoClaw's pattern (already proven by Telegram + dashboard
chat surfaces):

```
YouTube live chat
       │
       ▼
queue-daemon polls (existing, PR 4)
       │
       ▼
NanoClaw HTTP channel — youtube_live group (NEW)
       │
       ▼
Lena agent (MiniMax-M2.7, briefing = "you're the on-air host")
       │
       ├─→ POST youtube.googleapis.com/.../liveChatMessages
       │    (Lena's reply visible to all chat viewers)
       │
       └─→ optional: queue TTS (Lena reads her own reply on air,
            same moment chat sees it)
```

### Required components

1. **OAuth re-grant** with `youtube.force-ssl` scope. Same dance as
   PR 3, ~5 minutes.
2. **NanoClaw YouTube channel** (`src/channels/youtube.ts`,
   parallel to the existing `http.ts` and `telegram.ts`). Implements
   the `Channel` interface. Outbound = `liveChatMessages.insert`,
   inbound = polled by queue-daemon and forwarded.
3. **Per-broadcast group** with auto-cleanup when broadcast ends —
   conversational memory shouldn't leak across separate live
   sessions.
4. **Reply gating** in Lena's NanoClaw briefing:
   - Always reply to direct `@lena` mentions
   - Random ~20% engage with non-mention messages (selectable in
     the briefing — "feel free to interject naturally")
   - Skip messages that are pure shoutout requests (those go through
     the existing PR 4 flow to be aired, not chat-replied)
   - Hard cap: max 40 replies/hour total (Lena gets quiet, not
     spammy)
5. **Outbound moderator** — Lena's reply runs through
   `moderateChatReply()` (new) before posting. Anything held →
   logged + dropped silently. Anything blocked → ALERT operator on
   Telegram.
6. **Dashboard kill switch** — three-state toggle on
   `/youtube-chat`:
   - `Auto` — Lena replies according to gating rules
   - `Forced Off` — Lena reads only (PR 4 shoutout flow still
     active)
   - `Forced Mute` — Lena ignores chat entirely (incidents only)
7. **Memory** — leverage NanoClaw's existing global memory file +
   per-group `groups/youtube_live/memory.json`. Lena learns
   regulars: "good to hear from you again Marek — last time you
   were here at 3am asking for something dreamy."
8. **Cost dashboard** — track per-day MiniMax spend on YouTube
   chat. Show on dashboard. Alert at $5/$10/$20 thresholds.

### TTS optional layer

Two modes operator picks per session:
- **Chat-only** — Lena replies in chat text only. No air impact.
  Cheap, low-risk. Default.
- **Chat + air** — Lena's reply goes to chat AND queues as TTS so
  air listeners hear it. Higher engagement but mixes noise into the
  broadcast. Bonus: chat viewers AND audio-only listeners hear
  Lena address each viewer by name. Powerful when it lands, awkward
  when she misreads tone.

### Quota math

- Read (PR 4 already): ~3,300/day at 90s polling
- Write at 40 replies/hour cap = 960 replies/day × 50u = 48,000/day
- Combined: ~51,300/day
- **Default quota: 10k/day → quota bump REQUIRED.** Submit form at
  <https://support.google.com/youtube/contact/yt_api_form>. Typical
  approval: 100k–1M units/day. ~2-3 week turnaround. **Start the
  request the same day we start building this.**

### Implementation sketch

Files to add/modify:
- NanoClaw: `src/channels/youtube-live.ts` (new), with HTTP API
  hooks back to queue-daemon for inbound message ingestion.
- `nanoclaw-groups/youtube_live/CLAUDE.md` (briefing — Lena as
  on-air host, conversational rules, reply gating, never break
  character).
- `workers/queue-daemon/youtube-chat-loop.ts` — instead of
  dispatching to `/api/internal/youtube-chat-shoutout` directly,
  forward messages to NanoClaw's youtube_live channel. NanoClaw
  decides reply vs. shoutout-via-existing-pipeline vs. ignore.
- `lib/moderate.ts` — new `moderateChatReply()` function (Lena's
  outbound, separate from listener moderation since the failure
  modes are different).
- `dashboard/app/youtube-chat/page.tsx` — new page with kill switch
  + cost dashboard + recent-replies feed for audit.
- `dashboard/components/youtube-chat-card.tsx` — small tile on home
  dashboard showing today's reply count + cost + state.

### Reply persona considerations

Lena's existing voice is "warm host, intimate, mood-aware". Chat
replies need to translate that to text without losing it:
- Short replies (≤2 sentences typical, ≤4 absolute max)
- Address by name when she can
- Time-of-day cues (`good to see you up at this hour`)
- Doesn't repeat the message back at the user
- Doesn't flood with emojis (1 max, often zero)
- Acknowledges past conversations from memory ("you were here last
  Tuesday too")
- Knows what's currently playing — so she can naturally tie chat
  reactions to the track

Briefing draft is a Phase 2 task once we start building.

### Operator-side risks

- **Brand event risk**: Lena says something that gets clipped to
  Twitter as "AI radio host caught saying X". Mitigation: outbound
  moderator + soft tone in briefing + hard kill switch.
- **Chat moderation drift**: Lena ends up engaging with trolls.
  Mitigation: she's briefed to disengage on hostility, not
  escalate.
- **Cost surprise**: a viral moment quadruples chat volume,
  $50 in a day. Mitigation: dashboard cost alert + auto-mute at
  $20 daily spend (operator-configurable).
- **Real-person impersonation**: viewer says "I'm Marek's friend"
  and Lena confidently uses fabricated context. Mitigation:
  briefing emphasises "remember what you've seen, don't fill gaps;
  acknowledge new viewers freshly".

Estimated scope: **~2 weeks**. NanoClaw channel + briefing + reply
gating + outbound moderator + dashboard page + cost tracking +
quota bump + soak. Plus the OAuth re-grant.

---

## Suggested ordering

If we ship both, do them in this order:

1. **Songs from chat** first (3–4 days, lower risk, reuses
   existing infra). Adds a clear conversion lever — viewers see
   "I can request a song" and it pulls them deeper.
2. **Lena conversational** second (2 weeks, higher impact, higher
   risk). Build on a stable platform + an established reply
   surface (the songs PR introduces YouTube users to "Lena
   responds to me").

Rough timeline if greenlit today:
- Day 1: start Google quota-bump request for the conversational
  feature (it'll be ready when we are).
- Days 2-5: ship Songs from chat.
- Days 6-8: soak Songs feature, gather data, tune limits.
- Days 9-22: build Lena conversational. Dark-launch first
  (replies sent to dashboard log only, not posted to YouTube),
  then enable for a single test stream, then full.

---

## Open questions

1. Do we cap **shoutouts AND songs combined** per author, or
   separate buckets? (Suggested: separate. 3 shoutouts/hr + 1
   song/day.)
2. Should Lena replies appear with a different display name on
   YouTube (e.g. "Lena · Numa Radio") so viewers know it's the
   bot? (Suggested: yes, transparency.)
3. If Lena posts a reply that doesn't get aired as TTS, should
   chat see the reply at all? (Suggested: yes — the chat-only
   layer is half the value, especially for audio-off viewers.)
4. Per-stream memory wipe (clean slate every Go Live) or
   persistent across streams? (Suggested: persistent for
   regulars who return; per-stream for incidents/moderation
   notes.)
