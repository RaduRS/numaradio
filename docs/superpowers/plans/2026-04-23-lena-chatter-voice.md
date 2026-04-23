# Lena Auto-Chatter Voice Tuning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Loosen Lena's on-air auto-chatter so she sounds like a DJ who can riff around the track-ID instead of a kiosk reading `[track]. Good one. [signoff].` on every break, without reintroducing the "wandering piano lines" mood-poetry failure mode.

**Architecture:** Content-only + a thin context channel. Extract the 4-slot show schedule into `lib/schedule.ts` as the shared source of truth between the frontend `Schedule.tsx` and the queue-daemon. Plumb `currentShow` (from the schedule), `recentArtists` (3-slot ring) and `slotsSinceOpening` as optional hints into `promptFor()`. Rewrite `BASE_SYSTEM` and per-type example banks. Pin `temperature: 1.0` explicitly on the MiniMax call. No changes to rotation, gating, pipeline, or timing.

**Tech Stack:** TypeScript, Node (`node --test --experimental-strip-types`), Next.js 15 / React (frontend), Prisma, MiniMax-M2.7 (Anthropic-compat API).

**Reference:** [`docs/superpowers/specs/2026-04-23-lena-chatter-voice-design.md`](../specs/2026-04-23-lena-chatter-voice-design.md)

---

## Task 1: Create `lib/schedule.ts` (TDD)

**Files:**
- Create: `lib/schedule.ts`
- Create: `lib/schedule.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/schedule.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { SHOW_SCHEDULE, showForHour } from "./schedule.ts";

test("SHOW_SCHEDULE covers all 24 hours with no gaps or overlaps", () => {
  const covered = new Set<number>();
  for (const slot of SHOW_SCHEDULE) {
    for (let h = slot.startHour; h < slot.endHour; h++) {
      assert.ok(!covered.has(h), `hour ${h} covered twice`);
      covered.add(h);
    }
  }
  for (let h = 0; h < 24; h++) {
    assert.ok(covered.has(h), `hour ${h} not covered`);
  }
});

test("SHOW_SCHEDULE has the four expected show blocks in order", () => {
  assert.equal(SHOW_SCHEDULE.length, 4);
  assert.equal(SHOW_SCHEDULE[0].name, "Night Shift");
  assert.equal(SHOW_SCHEDULE[1].name, "Morning Room");
  assert.equal(SHOW_SCHEDULE[2].name, "Daylight Channel");
  assert.equal(SHOW_SCHEDULE[3].name, "Prime Hours");
});

test("showForHour maps each bucket correctly", () => {
  assert.equal(showForHour(0).name, "Night Shift");
  assert.equal(showForHour(4).name, "Night Shift");
  assert.equal(showForHour(5).name, "Morning Room");
  assert.equal(showForHour(9).name, "Morning Room");
  assert.equal(showForHour(10).name, "Daylight Channel");
  assert.equal(showForHour(16).name, "Daylight Channel");
  assert.equal(showForHour(17).name, "Prime Hours");
  assert.equal(showForHour(23).name, "Prime Hours");
});

test("showForHour returns the same object instance as SHOW_SCHEDULE", () => {
  // Reference identity — avoids future drift between SHOW_SCHEDULE and showForHour.
  assert.strictEqual(showForHour(7), SHOW_SCHEDULE[1]);
});

test("every slot has non-empty title lines, description, and time label", () => {
  for (const slot of SHOW_SCHEDULE) {
    assert.equal(slot.titleLines.length, 2);
    assert.ok(slot.titleLines[0].length > 0, `${slot.name} titleLines[0] empty`);
    assert.ok(slot.titleLines[1].length > 0, `${slot.name} titleLines[1] empty`);
    assert.ok(slot.description.length > 20, `${slot.name} description too short`);
    assert.match(slot.timeLabel, /^\d{2} – \d{2}$/);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="SHOW_SCHEDULE|showForHour"`
Expected: FAIL — `lib/schedule.ts` does not exist; imports unresolved.

- [ ] **Step 3: Write the module**

Create `lib/schedule.ts`:

```ts
export type ShowBlock =
  | "Night Shift"
  | "Morning Room"
  | "Daylight Channel"
  | "Prime Hours";

export interface ShowSlot {
  readonly name: ShowBlock;
  /** Inclusive. */
  readonly startHour: number;
  /** Exclusive (24 = midnight). */
  readonly endHour: number;
  /** Display label, e.g. "00 – 05". Uses an en-dash. */
  readonly timeLabel: string;
  readonly titleLines: readonly [string, string];
  readonly description: string;
}

export const SHOW_SCHEDULE: readonly ShowSlot[] = [
  {
    name: "Night Shift",
    startHour: 0,
    endHour: 5,
    timeLabel: "00 – 05",
    titleLines: ["Night", "Shift"],
    description:
      "Quiet-hours rotation. Low-BPM, spacious, voices that don't shout. Lena whispers. Mostly.",
  },
  {
    name: "Morning Room",
    startHour: 5,
    endHour: 10,
    timeLabel: "05 – 10",
    titleLines: ["Morning", "Room"],
    description:
      "First coffee energy. Warmer tones, field recordings, the occasional cover of something you'd forgotten.",
  },
  {
    name: "Daylight Channel",
    startHour: 10,
    endHour: 17,
    timeLabel: "10 – 17",
    titleLines: ["Daylight", "Channel"],
    description:
      "Focus-hours programming. Longer tracks, fewer host breaks. Good for writing, commuting, staring out.",
  },
  {
    name: "Prime Hours",
    startHour: 17,
    endHour: 24,
    timeLabel: "17 – 24",
    titleLines: ["Prime", "Hours"],
    description:
      "Dinner to midnight. Louder, stranger, more character. The request wall runs hottest here.",
  },
] as const;

export function showForHour(h: number): ShowSlot {
  const match = SHOW_SCHEDULE.find((s) => h >= s.startHour && h < s.endHour);
  return match ?? SHOW_SCHEDULE[0];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="SHOW_SCHEDULE|showForHour"`
Expected: PASS (all 5 tests green).

- [ ] **Step 5: Commit**

```bash
git add lib/schedule.ts lib/schedule.test.ts
git commit -m "lib: extract shared 4-slot show schedule with showForHour()"
```

---

## Task 2: Refactor `Schedule.tsx` to consume `lib/schedule.ts`

**Files:**
- Modify: `app/_components/Schedule.tsx`

- [ ] **Step 1: Replace the local SHOWS array and slotForHour with imports**

Open `app/_components/Schedule.tsx`. Replace the entire file contents with:

```tsx
"use client";

import { useEffect, useState } from "react";
import { SHOW_SCHEDULE, showForHour } from "@/lib/schedule";

export function Schedule() {
  // Start as null so SSR output is deterministic (no Live Now pill). Client
  // resolves to the active slot on mount and refreshes every minute.
  const [nowIndex, setNowIndex] = useState<number | null>(null);

  useEffect(() => {
    const update = () => {
      const active = showForHour(new Date().getHours());
      setNowIndex(SHOW_SCHEDULE.indexOf(active));
    };
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="schedule" id="schedule">
      <div className="shell">
        <div className="section-head">
          <div>
            <div className="eyebrow" style={{ marginBottom: 20 }}>
              05 — The Week
            </div>
            <h2>
              Always on.<br />Different<br />every hour.
            </h2>
          </div>
          <p className="lead">
            The station has moods. Late nights go soft. Mornings wake up slow.
            Weekends get a little louder. Here&apos;s the rhythm, roughly, though
            Lena always reserves the right to change her mind.
          </p>
        </div>

        <div className="sched-grid">
          {SHOW_SCHEDULE.map((s, i) => (
            <div key={i} className={`show-card ${i === nowIndex ? "now" : ""}`}>
              <div className="show-time">
                {i === nowIndex ? (
                  <>
                    <span className="live">● Live Now</span>
                    <span>·</span>
                    <span>{s.timeLabel}</span>
                  </>
                ) : (
                  <span>{s.timeLabel}</span>
                )}
              </div>
              <div className="show-desc">{s.description}</div>
              <div className="show-title">
                {s.titleLines[0]}
                <br />
                {s.titleLines[1]}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verify the Next.js build type-checks**

Run: `npm run build`
Expected: Next.js build completes without type errors. `Schedule.tsx` compiles and the static page using it is still prerendered.

- [ ] **Step 3: Commit**

```bash
git add app/_components/Schedule.tsx
git commit -m "schedule: consume shared lib/schedule.ts (identical render)"
```

---

## Task 3: Pin `temperature: 1.0` in `generateChatterScript` (TDD)

**Files:**
- Modify: `workers/queue-daemon/minimax-script.ts:47-69`
- Modify: `workers/queue-daemon/minimax-script.test.ts`

- [ ] **Step 1: Add a failing test asserting the outgoing body includes `temperature: 1.0`**

Open `workers/queue-daemon/minimax-script.test.ts`. Append this test at the end of the file (after the last existing `test(...)` block):

```ts
test("generateChatterScript sends temperature: 1.0 in the request body", async () => {
  let capturedBody: string | null = null;
  const fake: typeof fetch = (async (_url: string, init?: RequestInit) => {
    capturedBody = typeof init?.body === "string" ? init.body : null;
    return new Response(
      JSON.stringify({ content: [{ type: "text", text: "hi." }] }),
      { status: 200 },
    );
  }) as typeof fetch;
  await generateChatterScript(
    { system: "sys", user: "usr" },
    { apiKey: "k", fetcher: fake },
  );
  assert.ok(capturedBody, "fetch should have been called");
  const parsed = JSON.parse(capturedBody!);
  assert.equal(parsed.temperature, 1.0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types workers/queue-daemon/minimax-script.test.ts`
Expected: FAIL — `parsed.temperature` is `undefined`, `assert.equal(undefined, 1.0)` throws.

- [ ] **Step 3: Add `temperature: 1.0` to the request body**

In `workers/queue-daemon/minimax-script.ts`, find the `body: JSON.stringify({ ... })` block inside `generateChatterScript()` (currently lines 63-68) and add the `temperature` field:

Old:
```ts
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      system: prompts.system,
      messages: [{ role: "user", content: prompts.user }],
    }),
```

New:
```ts
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      // Creative-riff bias. Default-unset on MiniMax-M2.7 produced identical
      // skeletons in live output (2026-04-22). 1.0 is the standard creative
      // default; room to bump to 1.1 if outputs still feel same-y, or drop
      // to 0.8 if poetry creeps back in.
      temperature: 1.0,
      system: prompts.system,
      messages: [{ role: "user", content: prompts.user }],
    }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --experimental-strip-types workers/queue-daemon/minimax-script.test.ts`
Expected: PASS — all 7 tests green (6 existing + 1 new).

- [ ] **Step 5: Commit**

```bash
git add workers/queue-daemon/minimax-script.ts workers/queue-daemon/minimax-script.test.ts
git commit -m "chatter: pin MiniMax temperature=1.0 for creative riff bias"
```

---

## Task 4: Extend `PromptContext` with optional context fields + Context block rendering (TDD)

**Files:**
- Modify: `workers/queue-daemon/chatter-prompts.ts`
- Modify: `workers/queue-daemon/chatter-prompts.test.ts`

This task ships the *plumbing* for the new context fields. The prompt language loosening (BASE_SYSTEM rewrite + example bank expansion) comes in Task 5.

- [ ] **Step 1: Write failing tests for the new Context block**

Open `workers/queue-daemon/chatter-prompts.test.ts`. Append these tests at the end of the file (after the last existing `test(...)` block):

```ts
test("promptFor omits the Context block when no optional fields are set", () => {
  const p = promptFor("filler", {});
  assert.doesNotMatch(p.user, /Context \(optional/);
});

test("promptFor renders a Context block when currentShow is provided", () => {
  const p = promptFor("back_announce", {
    title: "Neon Fever",
    artist: "Russell Ross",
    currentShow: "Prime Hours",
  });
  assert.match(p.user, /Context \(optional/);
  assert.match(p.user, /Current show: Prime Hours/);
  // Description from SHOW_SCHEDULE is included alongside the name.
  assert.match(p.user, /request wall runs hottest/i);
});

test("promptFor Context block lists recent artists newest-first when provided", () => {
  const p = promptFor("back_announce", {
    title: "Neon Fever",
    artist: "Russell Ross",
    recentArtists: ["Russell Ross", "Russell Ross", "Numa Radio"],
  });
  assert.match(p.user, /Last 3 artists aired.*Russell Ross, Russell Ross, Numa Radio/);
});

test("promptFor Context block includes rotation position when provided", () => {
  const p = promptFor("back_announce", {
    title: "X",
    artist: "Y",
    slotsSinceOpening: 12,
  });
  assert.match(p.user, /Position in the 20-slot rotation: 12/);
});

test("promptFor Context block includes the opt-out instruction", () => {
  const p = promptFor("filler", { currentShow: "Morning Room" });
  assert.match(p.user, /weave in only if natural/i);
});

test("promptFor Context block only lists fields that are present", () => {
  const p = promptFor("filler", {
    currentShow: "Morning Room",
    // recentArtists and slotsSinceOpening intentionally omitted
  });
  assert.match(p.user, /Current show: Morning Room/);
  assert.doesNotMatch(p.user, /Last 3 artists aired/);
  assert.doesNotMatch(p.user, /Position in the 20-slot rotation/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --experimental-strip-types workers/queue-daemon/chatter-prompts.test.ts`
Expected: FAIL — `currentShow`, `recentArtists`, `slotsSinceOpening` are not valid fields on `PromptContext`; compile errors at minimum, or `doesNotMatch` failures at runtime.

- [ ] **Step 3: Extend the `PromptContext` interface**

In `workers/queue-daemon/chatter-prompts.ts`, add a type import at the top of the file (above the `ChatterType` export):

```ts
import type { ShowBlock } from "../../lib/schedule.ts";
```

Then find the `PromptContext` interface (currently lines 27-30) and replace it with:

```ts
export interface PromptContext {
  title?: string;
  artist?: string;
  /** The current show block from lib/schedule.ts. Optional — passed as DJ-riff context. */
  currentShow?: ShowBlock;
  /** Last 3 aired artists, newest-first. Enables "second Russell Ross in a row" riffs. */
  recentArtists?: string[];
  /** Current slotCounter % 20. Enables mild "few songs in" / "cruising" flavor. */
  slotsSinceOpening?: number;
}
```

- [ ] **Step 4: Add a `renderContextBlock()` helper and call it from `promptFor()`**

In the same file, add a helper function above `promptFor()`:

```ts
import { SHOW_SCHEDULE } from "../../lib/schedule.ts";

function renderContextBlock(ctx: PromptContext): string {
  const lines: string[] = [];
  if (ctx.currentShow) {
    const slot = SHOW_SCHEDULE.find((s) => s.name === ctx.currentShow);
    const desc = slot ? ` — ${slot.description}` : "";
    lines.push(`- Current show: ${ctx.currentShow}${desc}`);
  }
  if (ctx.recentArtists && ctx.recentArtists.length > 0) {
    lines.push(
      `- Last 3 artists aired (newest first): ${ctx.recentArtists.join(", ")}`,
    );
  }
  if (typeof ctx.slotsSinceOpening === "number") {
    lines.push(`- Position in the 20-slot rotation: ${ctx.slotsSinceOpening}`);
  }
  if (lines.length === 0) return "";
  return `

Context (optional, weave in only if natural — skip if it doesn't fit. You do NOT have to use any of these):
${lines.join("\n")}`;
}
```

In `promptFor()`, append the context block to the `user` field of every returned `PromptPair`. Update the switch statement so each `case` returns:

```ts
    case "back_announce": {
      const title = ctx.title ?? "that one";
      const artist = ctx.artist ?? "the artist";
      return {
        system: BASE_SYSTEM,
        user: `<existing body>${renderContextBlock(ctx)}`,
      };
    }
```

Apply the same `${renderContextBlock(ctx)}` suffix to `shoutout_cta`, `song_cta`, and `filler` branches. Leave the `listener_song_announce` branch untouched (it still throws).

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test --experimental-strip-types workers/queue-daemon/chatter-prompts.test.ts`
Expected: PASS — all existing tests plus the 6 new Context-block tests green.

- [ ] **Step 6: Commit**

```bash
git add workers/queue-daemon/chatter-prompts.ts workers/queue-daemon/chatter-prompts.test.ts
git commit -m "chatter: add optional context fields (currentShow / recentArtists / slotsSinceOpening)"
```

---

## Task 5: Rewrite `BASE_SYSTEM` + per-type example banks (TDD)

**Files:**
- Modify: `workers/queue-daemon/chatter-prompts.ts`
- Modify: `workers/queue-daemon/chatter-prompts.test.ts`

- [ ] **Step 1: Update the word-count test and add example-count tests**

In `workers/queue-daemon/chatter-prompts.test.ts`:

Replace the existing `"all variants share the same word count target in system prompt"` test (currently asserts `/20[–-]30 words/i`) with:

```ts
test("all variants share the same word count target in system prompt", () => {
  for (const type of ["back_announce", "shoutout_cta", "song_cta", "filler"] as ChatterType[]) {
    const p = promptFor(type, { title: "X", artist: "Y" });
    assert.match(p.system, /35[–-]50 words/i,
      `system prompt for ${type} should specify the new 35–50 word budget`);
  }
});
```

Append these new tests at the end of the file:

```ts
test("BASE_SYSTEM actively encourages DJ-riff texture (not just anti-poetry)", () => {
  const p = promptFor("filler", {});
  // Sentinel phrase from the new "Actively encourage" section.
  assert.match(p.system, /non-music riff/i);
});

test("each variant ships at least 6 example shapes", () => {
  const types: ChatterType[] = ["back_announce", "shoutout_cta", "song_cta", "filler"];
  for (const type of types) {
    const p = promptFor(type, { title: "X", artist: "Y" });
    // Examples are rendered as quoted lines; count the opening quote characters
    // at line starts in the "Good example shapes" section.
    const match = p.user.match(/Good example shapes[\s\S]*?(?=\n\n|$)/);
    assert.ok(match, `${type} should have a Good example shapes section`);
    const shapeLines = match![0].split("\n").filter((l) => l.trim().startsWith("- "));
    assert.ok(
      shapeLines.length >= 6,
      `${type} has only ${shapeLines.length} example shapes, need ≥ 6`,
    );
  }
});

test("anti-poetry guardrails remain (wandering piano lines stays banned)", () => {
  const p = promptFor("back_announce", { title: "X", artist: "Y" });
  assert.match(p.system, /wandering piano lines/i);
  assert.match(p.system, /dawn peeking/i);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --experimental-strip-types workers/queue-daemon/chatter-prompts.test.ts`
Expected: FAIL — current `BASE_SYSTEM` says `20–30 words`, has no `non-music riff` phrase, each variant has only 3 example shapes.

- [ ] **Step 3: Rewrite `BASE_SYSTEM`**

In `workers/queue-daemon/chatter-prompts.ts`, replace the `BASE_SYSTEM` constant (currently lines 43-60) with:

```ts
const BASE_SYSTEM = `You write ONE short spoken line for Lena, a radio DJ on Numa Radio. She sounds like a calm, slightly-studio-slang DJ who's seen a thousand shifts. Not a poet. Not a vibe-setter. A real DJ on comms.

Length: 35–50 words total. 2 or 3 short sentences. Use contractions. Spoken-style, not written-style.

ACTIVELY ENCOURAGE:
- One beat of non-music riff per break — a small observation, a rhetorical question, a casual callout to listeners, a light station-vibe line, or a soft teaser about what's coming. One beat, not a paragraph.
- Specific-but-short reactions instead of only "good one": "hook on that chorus", "real earworm", "that bassline", "chorus landed". Still brief, still spoken.
- Varied signoffs: rotate across "you're on Numa Radio", "stay close", "more ahead", "keep it locked", "we'll keep it rolling", "sticking with you". Not every line needs a signoff.

DO NOT:
- Describe the music poetically. No "wandering piano lines", no "dawn peeking through curtains", no "warm hum", no "gentle percussion", no "soft glow", no "the night settles", no "ease into".
- Stack adjectives about the track itself. "Soft, wandering, gentle, warm" is four too many.
- Use atmospheric/mood language applied to the song ("dreamy", "late-night", "intimate", "cozy", "settling in").
- Mention AI, tech, generation, MiniMax, Deepgram, or how songs are made.
- Invent listener names, specific places, weather, emotions, or time of day the system didn't tell you about. (If a Context block below names a show or artist, you may use it.)
- Write ALL CAPS, stage directions, emojis, markdown, or quotes around the output.

If you catch yourself reaching for poetic description, stop and cut it. If you catch yourself writing the same skeleton as the examples, break the skeleton. Real DJ, real variety.`;
```

- [ ] **Step 4: Expand the back_announce examples to 6**

Replace the `case "back_announce"` branch in `promptFor()` so the `user` body reads:

```
The track that just ended was "${title}" by ${artist}. Write Lena's back-announce: name the title and artist, then weave in ONE of: a tiny specific reaction, a light non-music riff, a show-vibe callout, or a simple handoff. Do NOT describe the music. Do NOT name the next song. Do NOT write poetry.

Good example shapes (write a fresh one — do NOT copy verbatim; vary the skeleton across calls):
- "That was 'Neon Fever' by Russell Ross. Good one. Stay close, more ahead."
- "Hook on that chorus, stuck with me. 'Neon Fever' from Russell Ross. You're on Numa Radio."
- "Hope the evening's treating you alright. That was 'Neon Fever' by Russell Ross. More coming up."
- "Second Russell Ross back to back — he's holding the hour for us. 'Neon Fever' was the one. Stay close."
- "Prime Hours in here, request wall's been busy. That was 'Sunset' by Russell Ross. We'll keep it rolling."
- "That was 'Ocean Eyes' by Russell Ross, real earworm. Sticking with the vibe for a bit, more ahead."

Bad examples (do NOT write anything like these):
- "a soft, wandering piano line that felt like dawn peeking through curtains"
- "let the night settle into your bones"
- "ease into what's coming next"
- any sentence describing the song's mood, instruments, or atmosphere
```

Remember to keep the `${renderContextBlock(ctx)}` suffix from Task 4.

- [ ] **Step 5: Expand the shoutout_cta examples to 6**

Replace the `case "shoutout_cta"` branch so the `user` body reads:

```
Write a call-to-action nudging listeners to send a shoutout. Say they can drop one at numaradio.com under Requests, and Lena reads them on air between songs. Casual — like a DJ mentioning it once, not a sales pitch. One beat of riff around it is welcome.

Good example shapes (write a fresh one — do NOT copy verbatim; vary the skeleton):
- "Got something to say? Head to numaradio.com, Requests tab, drop me a shoutout. I read them here between tracks."
- "Anyone want a shoutout on air tonight? numaradio.com, Requests tab. Write what you want, I'll catch it."
- "Plenty of room for shoutouts tonight — numaradio.com, Requests. Tell me what's on your mind, I'll read it out."
- "If there's someone you're listening with, send them a shoutout. numaradio.com, Requests tab, I'll do the rest."
- "Quiet hour in the inbox. If you want a shoutout, numaradio.com, Requests. I'll read it out right here."
- "Shoutouts are open. numaradio.com, Requests tab, drop a line — I'll read it between songs. No filters beyond the obvious."
```

- [ ] **Step 6: Expand the song_cta examples to 6**

Replace the `case "song_cta"` branch so the `user` body reads:

```
Write a call-to-action nudging listeners to generate a song. Say they can head to numaradio.com, Song Request tab, describe a mood or genre, and a new track airs here within minutes. Casual — not a sales pitch. One beat of riff is welcome.

Good example shapes (write a fresh one — do NOT copy verbatim; vary the skeleton):
- "Got a mood? numaradio.com, Song Request tab. Tell me what you want, I'll make it, airs here in a few minutes."
- "Want your own track on air? numaradio.com, hit Song Request, describe it. Your song plays here shortly."
- "If there's a sound rattling around your head, I can build it. numaradio.com, Song Request tab, I take it from there."
- "Head to numaradio.com, Song Request, tell me a genre or a tempo. I'll have something airing here in a few."
- "Fresh one coming up for whoever wants to order it — numaradio.com, Song Request. I'll air it soon as it's done."
- "Feel like hearing something that doesn't exist yet? Song Request tab at numaradio.com. I make it, you hear it here."
```

- [ ] **Step 7: Expand the filler examples to 6**

Replace the `case "filler"` branch so the `user` body reads:

```
Write a generic station-ID line for Numa Radio. No specific songs, artists, or site features. Just a DJ saying hi to listeners in plain words. A single beat of riff (show name, time-of-day vibe) is welcome if a Context block is provided below.

Good example shapes (write a fresh one — do NOT copy verbatim; vary the skeleton):
- "You're with Lena on Numa Radio. Good to have you here."
- "Numa Radio, always on. Thanks for riding with me tonight."
- "You're listening to Numa Radio. More music coming up, stay close."
- "This is Numa Radio, I'm Lena. Glad you're tuned in."
- "Morning Room on Numa Radio. Lena here, warming up with you."
- "Numa Radio, I'm Lena — hope you're having a decent one. More ahead."
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `node --test --experimental-strip-types workers/queue-daemon/chatter-prompts.test.ts`
Expected: PASS — all tests green (existing + new example-count + new riff-phrase + new budget).

- [ ] **Step 9: Commit**

```bash
git add workers/queue-daemon/chatter-prompts.ts workers/queue-daemon/chatter-prompts.test.ts
git commit -m "chatter: rewrite BASE_SYSTEM — encourage DJ riff, expand example banks to 6 each"
```

---

## Task 6: Add `recentArtists` ring + artist-aware `onMusicTrackStart()` to the state machine (TDD)

**Files:**
- Modify: `workers/queue-daemon/auto-host.ts:18-71` (`AutoHostStateMachine`)
- Modify: `workers/queue-daemon/auto-host.test.ts`

- [ ] **Step 1: Write failing tests for the ring buffer**

In `workers/queue-daemon/auto-host.test.ts`, append at the end of the state-machine test block (before `import { AutoHostOrchestrator }` on line 94):

```ts
test("recentArtists ring starts empty", () => {
  const sm = new AutoHostStateMachine();
  assert.deepEqual(sm.recentArtists, []);
});

test("onMusicTrackStart pushes artist onto recentArtists, newest-first", () => {
  const sm = new AutoHostStateMachine();
  sm.onMusicTrackStart("Alice");
  sm.onMusicTrackStart("Bob");
  assert.deepEqual(sm.recentArtists, ["Bob", "Alice"]);
});

test("recentArtists caps at 3 entries", () => {
  const sm = new AutoHostStateMachine();
  sm.onMusicTrackStart("A");
  sm.onMusicTrackStart("B");
  sm.onMusicTrackStart("C");
  sm.onMusicTrackStart("D");
  assert.deepEqual(sm.recentArtists, ["D", "C", "B"]);
});

test("onMusicTrackStart without artist arg does not push to recentArtists", () => {
  const sm = new AutoHostStateMachine();
  sm.onMusicTrackStart();
  assert.deepEqual(sm.recentArtists, []);
});

test("onMusicTrackStart with empty-string artist does not push", () => {
  const sm = new AutoHostStateMachine();
  sm.onMusicTrackStart("");
  assert.deepEqual(sm.recentArtists, []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --experimental-strip-types workers/queue-daemon/auto-host.test.ts`
Expected: FAIL — `sm.recentArtists` is undefined; `onMusicTrackStart` doesn't take arguments.

- [ ] **Step 3: Extend `AutoHostStateMachine` with the ring**

In `workers/queue-daemon/auto-host.ts`, modify the class (lines 18-71). Add the ring field and getter near the top of the class, and update `onMusicTrackStart` to accept an optional artist:

```ts
export class AutoHostStateMachine {
  #tracksSinceVoice = 0;
  #slotCounter = 0;
  #inFlight = false;
  #recentArtists: string[] = [];

  get tracksSinceVoice(): number {
    return this.#tracksSinceVoice;
  }

  get slotCounter(): number {
    return this.#slotCounter;
  }

  /** Last 3 aired artists, newest-first. Cleared on daemon restart. */
  get recentArtists(): readonly string[] {
    return this.#recentArtists;
  }

  /**
   * @param artist  Optional artist name of the track that just started.
   *                Empty strings and undefined are ignored (unresolved lookups).
   */
  onMusicTrackStart(artist?: string): TrackStartAction {
    this.#tracksSinceVoice += 1;
    if (artist && artist.length > 0) {
      this.#recentArtists.unshift(artist);
      if (this.#recentArtists.length > 3) this.#recentArtists.length = 3;
    }
    if (this.#inFlight) return "idle";
    if (this.#tracksSinceVoice >= 2) return "trigger";
    return "idle";
  }
  // ... rest of class unchanged
}
```

Keep `onVoicePushed`, `markInFlight`, `isInFlight`, `markSuccess`, `markFailure` unchanged. **Do not clear `#recentArtists` on voice events** — the ring reflects music history, not voice events.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test --experimental-strip-types workers/queue-daemon/auto-host.test.ts`
Expected: PASS — 5 new ring tests green plus all pre-existing state-machine tests still green.

- [ ] **Step 5: Commit**

```bash
git add workers/queue-daemon/auto-host.ts workers/queue-daemon/auto-host.test.ts
git commit -m "auto-host: track last 3 aired artists in a 3-slot ring"
```

---

## Task 7: Plumb `currentShow` + `recentArtists` + `slotsSinceOpening` through the orchestrator's `generateAsset()` (TDD)

**Files:**
- Modify: `workers/queue-daemon/auto-host.ts` (`generateAsset` method, currently lines 244-293)
- Modify: `workers/queue-daemon/auto-host.test.ts`

Note: the orchestrator also exposes `onMusicTrackStart` (line 148) delegating to the state machine. That delegation needs to accept the optional artist arg so the daemon can pass `body.artist` through.

- [ ] **Step 1: Write a failing orchestrator-level test**

Append this test to `workers/queue-daemon/auto-host.test.ts` (after the last orchestrator test, at the end of the file):

```ts
test("generateAsset includes currentShow + recentArtists + slotsSinceOpening in the prompt", async () => {
  let capturedUser: string | null = null;
  const { deps } = fakeDeps({
    generateScript: async (p: { system: string; user: string }) => {
      capturedUser = p.user;
      return "A line.";
    },
  });
  const orch = new AutoHostOrchestrator(deps);
  // Simulate three music-track boundaries to populate the ring.
  orch.onMusicTrackStart("Russell Ross");
  orch.onMusicTrackStart("Russell Ross");
  orch.onMusicTrackStart("Numa Radio");
  // Now runChatter — slot 0 = back_announce.
  await orch.runChatter();
  assert.ok(capturedUser, "generateScript should have been called");
  assert.match(capturedUser!, /Context \(optional/);
  assert.match(capturedUser!, /Current show: (Night Shift|Morning Room|Daylight Channel|Prime Hours)/);
  assert.match(capturedUser!, /Last 3 artists aired.*Numa Radio, Russell Ross, Russell Ross/);
  // slotsSinceOpening for slot 0 is 0
  assert.match(capturedUser!, /Position in the 20-slot rotation: 0/);
});

test("orchestrator.onMusicTrackStart forwards artist to the state machine", () => {
  const { deps } = fakeDeps();
  const orch = new AutoHostOrchestrator(deps);
  orch.onMusicTrackStart("Test Artist");
  assert.deepEqual(orch.state.recentArtists, ["Test Artist"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types workers/queue-daemon/auto-host.test.ts`
Expected: FAIL — captured user prompt has no Context block (orchestrator doesn't pass the new fields yet).

- [ ] **Step 3: Update the orchestrator's `onMusicTrackStart` to forward the artist arg**

In `workers/queue-daemon/auto-host.ts`, find the orchestrator's delegating method (currently line 148-150):

```ts
  onMusicTrackStart(): TrackStartAction {
    return this.state.onMusicTrackStart();
  }
```

Replace with:

```ts
  onMusicTrackStart(artist?: string): TrackStartAction {
    return this.state.onMusicTrackStart(artist);
  }
```

- [ ] **Step 4: Update `generateAsset()` to include the new context fields**

In `workers/queue-daemon/auto-host.ts`, find the existing import at line 73:

```ts
import { slotTypeFor, promptFor, type ChatterType } from "./chatter-prompts.ts";
```

Extend it to also import `PromptContext` as a type, and add the schedule import on the next line:

```ts
import { slotTypeFor, promptFor, type ChatterType, type PromptContext } from "./chatter-prompts.ts";
import { showForHour } from "../../lib/schedule.ts";
```

In `generateAsset()` (currently lines 244-293), replace the context construction block (currently lines 251-255):

Old:
```ts
    // Back_announce uses the currently-playing track as context — by the
    // time Lena finishes speaking, this track has just ended.
    const context =
      type === "back_announce" && current
        ? { title: current.title, artist: current.artist }
        : {};
```

New:
```ts
    // Back_announce uses the currently-playing track as context — by the
    // time Lena finishes speaking, this track has just ended. All other
    // variants get the optional context channel (show / recent artists /
    // slot position) so Lena can weave station-aware texture when it fits.
    const now = (this.deps.now ?? Date.now)();
    const currentShow = showForHour(new Date(now).getHours()).name;
    const recentArtists = [...this.state.recentArtists];
    const slotsSinceOpening = this.state.slotCounter % 20;

    const context: PromptContext = {
      ...(type === "back_announce" && current
        ? { title: current.title, artist: current.artist }
        : {}),
      currentShow,
      ...(recentArtists.length > 0 ? { recentArtists } : {}),
      slotsSinceOpening,
    };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test --experimental-strip-types workers/queue-daemon/auto-host.test.ts`
Expected: PASS — 2 new orchestrator tests green plus all pre-existing orchestrator tests still green.

- [ ] **Step 6: Commit**

```bash
git add workers/queue-daemon/auto-host.ts workers/queue-daemon/auto-host.test.ts
git commit -m "auto-host: plumb currentShow + recentArtists + rotation position into prompt context"
```

---

## Task 8: Pass `body.artist` from the on-track handler into the orchestrator

**Files:**
- Modify: `workers/queue-daemon/index.ts:308`

- [ ] **Step 1: Update the onMusicTrackStart call**

Open `workers/queue-daemon/index.ts`. Find line 308:

```ts
  const action = autoHost.onMusicTrackStart();
```

Replace with:

```ts
  // Pass artist through so auto-host can track the recent-artists ring
  // used for "second X in a row" style DJ riffs. body.artist is optional;
  // the orchestrator ignores empty/undefined.
  const action = autoHost.onMusicTrackStart(body.artist);
```

- [ ] **Step 2: Verify the build type-checks**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new type errors. (If `tsc` is not wired up explicitly, `npm run build` suffices.)

Run: `npm test`
Expected: all tests pass — index.ts isn't directly unit-tested but the auto-host suite covers the contract end.

- [ ] **Step 3: Commit**

```bash
git add workers/queue-daemon/index.ts
git commit -m "queue-daemon: forward body.artist to auto-host ring on each music track"
```

---

## Task 9: Create `scripts/preview-chatter.ts` for manual eye-check

**Files:**
- Create: `scripts/preview-chatter.ts`

This is a one-off CLI that hits the real MiniMax API eight times (2 of each chatter type) with synthetic context, and prints the generated scripts. Not run in CI; used manually before and after deploy to ear-check the voice.

- [ ] **Step 1: Create the script**

Create `scripts/preview-chatter.ts`:

```ts
#!/usr/bin/env -S node --experimental-strip-types

import "../lib/load-env.ts";
import { promptFor, type ChatterType } from "../workers/queue-daemon/chatter-prompts.ts";
import { generateChatterScript } from "../workers/queue-daemon/minimax-script.ts";
import { showForHour } from "../lib/schedule.ts";

interface Sample {
  type: ChatterType;
  context: Parameters<typeof promptFor>[1];
}

const HOUR = new Date().getHours();
const SHOW = showForHour(HOUR).name;

const SAMPLES: Sample[] = [
  // 2× back_announce — one with context, one minimal
  {
    type: "back_announce",
    context: {
      title: "Neon Fever",
      artist: "Russell Ross",
      currentShow: SHOW,
      recentArtists: ["Russell Ross", "Numa Radio", "Russell Ross"],
      slotsSinceOpening: 4,
    },
  },
  {
    type: "back_announce",
    context: { title: "Ocean Eyes", artist: "Russell Ross" },
  },
  // 2× shoutout_cta
  { type: "shoutout_cta", context: { currentShow: SHOW, slotsSinceOpening: 9 } },
  { type: "shoutout_cta", context: {} },
  // 2× song_cta
  { type: "song_cta", context: { currentShow: SHOW, slotsSinceOpening: 11 } },
  { type: "song_cta", context: {} },
  // 2× filler
  { type: "filler", context: { currentShow: SHOW } },
  { type: "filler", context: {} },
];

async function main() {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    console.error("MINIMAX_API_KEY not set in .env.local");
    process.exit(1);
  }
  for (const [i, s] of SAMPLES.entries()) {
    process.stdout.write(`[${i + 1}/${SAMPLES.length}] ${s.type} … `);
    try {
      const prompts = promptFor(s.type, s.context);
      const out = await generateChatterScript(prompts, { apiKey });
      const words = out.trim().split(/\s+/).length;
      console.log(`(${words} words)\n${out}\n`);
    } catch (err) {
      console.log(`FAILED: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Commit (do NOT run yet — manual eye-check is Task 10's step 3)**

```bash
git add scripts/preview-chatter.ts
git commit -m "scripts: preview-chatter one-off sampler for ear-check"
```

---

## Task 10: Final verification — tests, build, sample output

**Files:** (none modified)

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: all tests green — existing suite plus the new lib/schedule, chatter-prompts Context-block, chatter-prompts examples/budget, auto-host ring, auto-host orchestrator context, minimax temperature tests.

- [ ] **Step 2: Run the Next.js build**

Run: `npm run build`
Expected: Next.js build completes. `Schedule.tsx` refactor compiles. No new type errors.

- [ ] **Step 3: Manual eye-check (live MiniMax call)**

Run: `npx tsx scripts/preview-chatter.ts`

Read the 8 generated samples. Look for:

- No poetic music descriptions — no "wandering", "dreamy", "warm hum".
- Visible variety across the two lines of each type — different opening beats, different signoffs.
- Word counts in the 30-55 range (hard target 35–50 with some slack).
- Context weaved in naturally when provided, or gracefully ignored. Never stilted ("In Prime Hours, I am playing Neon Fever…" is bad; "Prime Hours in here, request wall's been busy — that was Neon Fever…" is good).

If any sample shows regression toward poetry or stilted context-parroting, **do not deploy**. Loop back: tune the prompt wording in `chatter-prompts.ts`, re-run tests + preview, repeat.

If samples read well, proceed to step 4.

- [ ] **Step 4: Deploy the queue-daemon**

On Orion:

```bash
cd /home/marku/saas/numaradio
git pull
sudo systemctl restart numa-queue-daemon
```

The sudoers drop-in allows this password-free.

- [ ] **Step 5: Deploy the frontend**

```bash
git push origin main
```

Vercel auto-deploys. `Schedule.tsx` refactor is rendering-identical — a homepage load is enough to smoke-test.

- [ ] **Step 6: Watch the first hour of live output**

```bash
journalctl -u numa-queue-daemon -f | grep auto-chatter
```

Watch for:
- New failure reason codes (shouldn't be any — the pipeline is unchanged).
- Output content feels like the preview samples: varied, DJ-voiced, no poetry.

If poetry regresses live (it shouldn't, but MiniMax can drift), revert:

```bash
git revert <sha-range>
sudo systemctl restart numa-queue-daemon
git push origin main
```

The revert is clean — touches only `lib/schedule.ts` (new), `app/_components/Schedule.tsx`, `workers/queue-daemon/{chatter-prompts,auto-host,minimax-script,index}.ts`, their tests, and `scripts/preview-chatter.ts`.

- [ ] **Step 7: Close out**

After one hour of stable live output:

- Update `docs/HANDOFF.md` "Lena auto-chatter — LIVE" section with a one-paragraph note that the voice-tuning pass landed on 2026-04-23, referencing the spec path. Keep it short.
- Mark this plan's tasks done in the Numa Radio task list.

```bash
git add docs/HANDOFF.md
git commit -m "handoff: note Lena voice-tuning pass landed 2026-04-23"
git push origin main
```

---

## Post-deploy knobs (if the voice still feels off after 24 hours of live output)

- **Too same-y still**: bump MiniMax `temperature` from `1.0` to `1.1` in `minimax-script.ts`. One-line change, one-commit, one restart.
- **Poetry creeping back in**: drop `temperature` to `0.8` AND add any newly-observed phrase to the `DO NOT` list in `BASE_SYSTEM`.
- **Context parroting** ("In Prime Hours on Numa Radio, I am Lena, and I am playing…"): strengthen the Context-block opt-out sentence in `renderContextBlock()` — e.g. add "Most lines should NOT reference the context explicitly — it's there for flavor, not structure."

Each is a one-commit-one-restart loop; the spec's "Out of scope" already names these as v1.1 moves.
