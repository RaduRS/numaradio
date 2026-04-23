# Lena auto-chatter — voice tuning pass (more engaging, less robotic)

**Status:** brainstormed 2026-04-23, awaiting implementation plan
**Owner:** queue-daemon (Orion)
**Supersedes:** extends `2026-04-22-lena-auto-chatter-design.md` — content-only changes, no cadence changes

## Why

The 2026-04-22 rollout shipped auto-chatter on a 20-slot rotation. It works reliably on every axis except voice. A day of live output reads like a kiosk announcement rather than a DJ:

```
slot18  "That was 'Midnight Drive' by Russell Ross. Good one. You're on Numa Radio."
slot16  "That was 'Neon Fever' by Russell Ross. Good one. Stay close."
slot14  "That was 'Sunset' by Russell Ross. Good one. Stay close, you're on Numa Radio."
slot12  "That was 'Ocean Eyes' by Russell Ross. Good one. Stay close."
slot10  "That was 'Neon Fever' by Russell Ross. Good one. You're on Numa Radio."
```

Every back-announce collapses to the same skeleton: `[track ID]. [2-word reaction]. [signoff].` MiniMax is anchoring hard on the three identical-shape example lines in the prompt, and the BASE_SYSTEM rule *"reaction: 2–3 words MAX"* leaves almost no room for variation.

The historical reason for those guardrails was a previous version that drifted into *"wandering piano lines that felt like dawn peeking through curtains"* poetry. That failure mode must stay blocked. But the fix overshot.

This pass loosens the voice so Lena sounds like a calm, slightly-studio-slang DJ who can riff a beat around the track-ID — **without** reintroducing mood poetry about the music itself.

## What stays exactly the same

Not touching any of these:

- `slotTypeFor()` and the 20-slot rotation order.
- Gating: auto-chatter fires only if no shoutouts aired in the last 2 music tracks.
- Slot counter only advances on a *successful* push (MiniMax/Deepgram/B2/push failures don't burn a slot).
- MiniMax model (`MiniMax-M2.7`) and `max_tokens=16_000`. Temperature is the one exception — see the Temperature section below.
- Deepgram Aura-2-Andromeda-en → B2 upload → telnet push to Liquidsoap `overlay_queue`.
- `lastFailures` / `lastPushes` ring buffers and their reason codes.
- `listener_song_announce` event path (separate flow, out of scope here).
- `announcementPrompt()` for first-air listener songs — out of scope; leave as-is.

## Prompt philosophy shift

**From** *"forbid everything ornamental"*  **to** *"forbid poetry about the music, encourage DJ texture around it."*

### Keep banned (unchanged guardrails)

- Describing the music poetically: no "wandering piano lines", "warm hum", "gentle percussion", "dawn peeking through curtains", etc.
- Stacked adjectives about the track itself ("soft, wandering, gentle, warm").
- Atmospheric/mood words applied to the *song* ("dreamy", "late-night", "intimate", "cozy").
- Mentioning AI, generation, MiniMax, Deepgram, or how songs are made.
- Inventing listener names, specific places, weather, emotions, time-of-day the system didn't tell her about.
- ALL CAPS, stage directions, emojis, markdown, surrounding quotes.

### Actively encourage (new)

- **One beat of non-music riff per break** — a small observation, a rhetorical question, a casual listener callout, a light station-vibe line, or a soft teaser about what's coming. One beat, not a paragraph.
- **Specific-but-short reactions** instead of only "good one": *"hook on that chorus"*, *"real earworm"*, *"that bassline"*, *"chorus landed"*. Still brief, still spoken-style.
- **Varied signoffs**: rotate across *"you're on Numa Radio"*, *"stay close"*, *"more ahead"*, *"keep it locked"*, *"we'll keep it rolling"*, *"sticking with you"*, etc. Not every line needs a signoff at all.

### Budget

- **20–30 words → 35–50 words.**
- **1–2 short sentences → 2–3 short sentences.**
- Contractions preferred. Spoken-style, not written-style.

## Example shapes (the real lever)

Each content type currently ships with 3 example shapes that all follow the same skeleton. We move to **6 deliberately varied examples per type**, spanning the axes: minimal vs. reaction-led vs. riff-led vs. continuity-aware vs. listener-nod vs. station-vibe. MiniMax anchors on examples, so a varied bank produces varied output.

### back_announce (6 examples)

1. *Minimal* — "That was 'Neon Fever' by Russell Ross. Good one. Stay close, more ahead."
2. *Reaction-led* — "Hook on that chorus, stuck with me. 'Neon Fever' from Russell Ross. You're on Numa Radio."
3. *Riff-led (listener-nod)* — "Hope the evening's treating you alright. That was 'Neon Fever' by Russell Ross. More coming up."
4. *Continuity-aware (uses recentArtists)* — "Second Russell Ross back to back — he's holding the hour for us. 'Neon Fever' was the one. Stay close."
5. *Show-name riff (uses currentShow)* — "Prime Hours in here, request wall's been busy. That was 'Sunset' by Russell Ross. We'll keep it rolling."
6. *Soft teaser* — "That was 'Ocean Eyes' by Russell Ross, real earworm. Sticking with the vibe for a bit, more ahead."

### shoutout_cta (6 examples)

1. "Got something to say? Head to numaradio.com, Requests tab, drop me a shoutout. I read them here between tracks."
2. "Anyone want a shoutout on air tonight? numaradio.com, Requests tab. Write what you want, I'll catch it."
3. "Plenty of room for shoutouts tonight — numaradio.com, Requests. Tell me what's on your mind, I'll read it out."
4. "If there's someone you're listening with, send them a shoutout. numaradio.com, Requests tab, I'll do the rest."
5. "Quiet hour in the inbox. If you want a shoutout, numaradio.com, Requests. I'll read it out right here."
6. "Shoutouts are open. numaradio.com, Requests tab, drop a line — I'll read it between songs. No filters beyond the obvious."

### song_cta (6 examples)

1. "Got a mood? numaradio.com, Song Request tab. Tell me what you want, I'll make it, airs here in a few minutes."
2. "Want your own track on air? numaradio.com, hit Song Request, describe it. Your song plays here shortly."
3. "If there's a sound rattling around your head, I can build it. numaradio.com, Song Request tab, I take it from there."
4. "Head to numaradio.com, Song Request, tell me a genre or a tempo. I'll have something airing here in a few."
5. "Fresh one coming up for whoever wants to order it — numaradio.com, Song Request. I'll air it soon as it's done."
6. "Feel like hearing something that doesn't exist yet? Song Request tab at numaradio.com. I make it, you hear it here."

### filler (6 examples)

1. "You're with Lena on Numa Radio. Good to have you here."
2. "Numa Radio, always on. Thanks for riding with me tonight."
3. "You're listening to Numa Radio. More music coming up, stay close."
4. "This is Numa Radio, I'm Lena. Glad you're tuned in."
5. *Show-name riff* — "Morning Room on Numa Radio. Lena here, warming up with you."
6. "Numa Radio, I'm Lena — hope you're having a decent one. More ahead."

## Optional context channel

Three optional fields added to `PromptContext`. All are **hints** the prompt surfaces for Lena to weave in *if it fits*, never required. They're cheap to compute and zero-risk if missing.

```ts
export interface PromptContext {
  title?: string;
  artist?: string;
  // new:
  currentShow?: ShowBlock;     // from lib/schedule.ts — see below
  recentArtists?: string[];    // last 3 aired artists, newest-first
  slotsSinceOpening?: number;  // current slotCounter % 20
}
```

### Shared schedule (`lib/schedule.ts` — new, single source of truth)

The frontend's `app/_components/Schedule.tsx` already defines a 4-slot show grid and an hour-to-slot function. Rather than duplicate the hour boundaries in the daemon (guaranteed to drift), we extract the schedule to a shared module both sides import.

```ts
// lib/schedule.ts
export type ShowBlock = "Night Shift" | "Morning Room" | "Daylight Channel" | "Prime Hours";

export interface ShowSlot {
  readonly name: ShowBlock;
  readonly startHour: number;       // inclusive
  readonly endHour: number;         // exclusive (24 = midnight)
  readonly timeLabel: string;       // e.g. "00 – 05"
  readonly titleLines: readonly [string, string];
  readonly description: string;
}

export const SHOW_SCHEDULE: readonly ShowSlot[] = [
  { name: "Night Shift",      startHour: 0,  endHour: 5,  timeLabel: "00 – 05",
    titleLines: ["Night", "Shift"],
    description: "Quiet-hours rotation. Low-BPM, spacious, voices that don't shout. Lena whispers. Mostly." },
  { name: "Morning Room",     startHour: 5,  endHour: 10, timeLabel: "05 – 10",
    titleLines: ["Morning", "Room"],
    description: "First coffee energy. Warmer tones, field recordings, the occasional cover of something you'd forgotten." },
  { name: "Daylight Channel", startHour: 10, endHour: 17, timeLabel: "10 – 17",
    titleLines: ["Daylight", "Channel"],
    description: "Focus-hours programming. Longer tracks, fewer host breaks. Good for writing, commuting, staring out." },
  { name: "Prime Hours",      startHour: 17, endHour: 24, timeLabel: "17 – 24",
    titleLines: ["Prime", "Hours"],
    description: "Dinner to midnight. Louder, stranger, more character. The request wall runs hottest here." },
] as const;

export function showForHour(h: number): ShowSlot {
  const match = SHOW_SCHEDULE.find((s) => h >= s.startHour && h < s.endHour);
  return match ?? SHOW_SCHEDULE[0]; // h is always 0-23, so match is guaranteed
}
```

### Derivation (in `auto-host.ts`, before calling `promptFor()`)

- **`currentShow`** — `showForHour(new Date().getHours()).name`. Uses the daemon's `TZ` (already Europe/London in the systemd unit).
- **`recentArtists`** — a 3-slot in-memory ring owned by `auto-host.ts`. `onMusicTrackStart()` unshifts the artist from the current-track lookup (falling back to `"unknown"` if unresolved), capped at 3. Cleared on daemon restart (fine — 3 tracks to warm up).
- **`slotsSinceOpening`** — pass `slotCounter % 20` straight through. Used only for mild "few songs in" / "cruising" flavor.

### Refactoring `Schedule.tsx` to consume the shared module

Keep `Schedule.tsx`'s rendered output identical. Replace its local `SHOWS` array and `slotForHour` function with imports from `lib/schedule.ts`. The component still renders the same 4 cards; the hour boundaries, titles, and descriptions now come from the shared module. Zero visual change, but a future edit in one place propagates to both.

### How the prompt surfaces these

`promptFor()` appends a short **Context** block to the `user` prompt **only when at least one optional field is present**. When `currentShow` is present, include both the show name and its one-line description so Lena has the station's own framing:

```
Context (optional, weave in only if natural — skip if it doesn't fit):
- Current show: Prime Hours — Dinner to midnight. Louder, stranger, more character.
- Last 3 artists aired (newest first): Russell Ross, Russell Ross, Numa Radio
- Position in the 20-slot rotation: 12
```

Explicit instructions inside the Context block: "You do NOT have to use any of these. They're here for texture if a natural line comes to mind." This keeps lines that don't need context from getting stilted.

## Temperature

The existing MiniMax call (`workers/queue-daemon/minimax-script.ts:generateChatterScript`) doesn't set `temperature`, so it runs at whatever MiniMax-M2.7's default is. One plausible reason day-1 output feels locked to a single skeleton: the default may be lower than we want for creative riff generation.

We set it explicitly in the MiniMax request body:

```ts
body: JSON.stringify({
  model,
  max_tokens: MAX_TOKENS,
  temperature: 1.0,        // new: creative riff bias
  system: prompts.system,
  messages: [{ role: "user", content: prompts.user }],
}),
```

Rationale for `1.0`:
- Standard creative-generation default across Anthropic/OpenAI/MiniMax APIs.
- Leaves room to dial UP to `1.1` in a follow-up if outputs still feel same-y after the prompt + examples loosening; or to dial DOWN to `0.8` if poetry creeps back in.
- Reasoning-model thinking block is not temperature-sensitive in the same way as the final text — bumping final-text temp shouldn't destabilize the reasoning.

One small abuse-surface consideration: higher temp increases the chance of MiniMax emitting "As an AI assistant…" style output, which `isSuspicious()` in `minimax-script.ts` already catches and throws on. If that failure rate rises past ~5%, revisit.

## Testing

### Unit tests (`chatter-prompts.test.ts`)

- Assert `BASE_SYSTEM` contains the new encouraged-texture section (substring match on a known phrase).
- Assert each type's `user` prompt contains ≥ 6 example shapes (count by line prefix `- `).
- Assert the optional Context block renders only when context fields are present, and lists only populated fields.
- Assert when `currentShow` is present, the Context block includes the matching show description from `SHOW_SCHEDULE`.
- Keep existing shape assertions (system + user strings non-empty).

### Unit tests (`lib/schedule.test.ts` — new)

- `showForHour(0)`, `showForHour(4)` → Night Shift.
- `showForHour(5)`, `showForHour(9)` → Morning Room (hour 5 is the inclusive start).
- `showForHour(10)`, `showForHour(16)` → Daylight Channel.
- `showForHour(17)`, `showForHour(23)` → Prime Hours.

### Unit tests (`auto-host.test.ts`)

- New test: `onMusicTrackStart()` pushes the resolved artist onto the `recentArtists` ring and caps at 3.
- New test: `currentShow` context field is populated via `showForHour()` at chatter generation time.
- Existing tests untouched — cadence, gating, slot-advance-only-on-success all unchanged.

### Unit tests (`minimax-script.test.ts`)

- Assert the outgoing request body includes `temperature: 1.0` (JSON.parse the captured fetch body).
- Existing assertions for auth headers, cleanup, suspicious-output detection all unchanged.

### Manual ear-check (before deploy)

One-off script `scripts/preview-chatter.ts` that calls `generateChatterScript()` 8 times against MiniMax — 2 of each type, with synthetic context matching a realistic night. Eyeball outputs for:

- No poetic music descriptions.
- Visible variety across lines of the same type.
- 35–50 word range holds.
- Context (when provided) either weaves in naturally or is ignored — never forced.

If any line shows a regression toward poetry or stilted context-parroting, fix the prompt before deploy.

## Rollout

- Unit tests must pass on Orion: `cd workers/queue-daemon && node --test --experimental-strip-types *.test.ts`.
- Manual sample batch must pass eye-check.
- Deploy queue-daemon: `git pull && sudo systemctl restart numa-queue-daemon` (password-free via existing sudoers drop-in).
- Deploy frontend: `git push origin main` — Vercel auto-deploys. `Schedule.tsx` refactor is rendering-identical; no visual smoke-test needed beyond a homepage load.
- Watch: `journalctl -u numa-queue-daemon -f | grep auto-chatter` for the first hour — check for any new failure reason codes or unexpected script content.
- Rollback: `git revert <sha> && sudo systemctl restart numa-queue-daemon && git push origin main`. Revert is clean — touches `chatter-prompts.ts`, `auto-host.ts`, `minimax-script.ts`, new `lib/schedule.ts`, and the `Schedule.tsx` import refactor.

## Out of scope (named so they don't creep in)

- Rotation changes (slot order, cadence, gating).
- Real track-metadata context beyond artist name (BPM, genre, album, release year) — prompt already has enough levers.
- Time-zone awareness beyond the daemon's local TZ.
- Listener-count / weather / news integration.
- `listener_song_announce` tone changes — works well, leave alone.
- `announcementPrompt()` changes — same, out of scope.
