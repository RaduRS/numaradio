# Lena Producer — Phase 4b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development.

**Goal:** Route shoutout narration through a Producer + Writer pipeline (Producer-lite, dashboard-side). Behind `LENA_PRODUCER_SHOUTOUT` flag. When off, existing `humanizeScript` runs unchanged.

**Architecture:** Dashboard runs as a separate Next.js app on Orion (not Vercel — has filesystem access to repo). But cross-package imports between `dashboard/` and main `lib/` aren't set up (per HANDOFF 2026-05-05). Build a sibling module at `dashboard/lib/lena-producer-shoutout/` — same shape as `lib/lena-producer-chat/` from Phase 3, different modes.

Modes for shoutouts (Producer decides):
- `shoutout_classic` — current "Going out to X. Y says Z." shape (legacy-compatible)
- `shoutout_inline` — single-sentence fold ("Bob from Berlin wrote in to say the late-night set is hitting")
- `shoutout_quote` — quote the message with minimal wrap ("Anna writes: 'this is my new favourite station'")
- `shoutout_callback` — tie to a recent listener event ("Third shoutout tonight from the Berlin crew — Bob says hi")

Each writer produces a different SHAPE — the variety solves the "every shoutout sounds the same" problem.

**Tech Stack:** TypeScript, MiniMax (via shared minimax-llm.ts pattern), node:test.

**Spec:** `docs/superpowers/specs/2026-05-16-lena-producer-design.md`

---

## File Structure

### Created
```
dashboard/lib/lena-producer-shoutout/
├── feature-flag.ts
├── feature-flag.test.ts
├── modes.ts                  # ShoutoutDecision type
├── shoutout-context.ts       # context + fetchShoutoutContext
├── shoutout-context.test.ts
├── producer-prompt.ts
├── producer-prompt.test.ts
├── producer.ts
├── producer.test.ts
├── writers/
│   ├── classic.ts
│   ├── classic.test.ts
│   ├── inline.ts
│   ├── inline.test.ts
│   ├── quote.ts
│   ├── quote.test.ts
│   ├── callback.ts
│   └── callback.test.ts
├── writer.ts
├── writer.test.ts
├── minimax-llm.ts            # local copy of the MiniMax wrapper
├── index.ts                  # lenaSpeakShoutout(args)
└── index.test.ts
```

### Modified

| File | What |
|---|---|
| `dashboard/lib/shoutout.ts` | Add gate before `humanizeScript` call; flag-on → try `lenaSpeakShoutout()` → fall back to legacy on null/error |
| `docs/HANDOFF.md` | Phase 4b deploy section |

---

## Task 1: feature flag + modes

**Files:**
- Create: `dashboard/lib/lena-producer-shoutout/feature-flag.ts` + `.test.ts`
- Create: `dashboard/lib/lena-producer-shoutout/modes.ts`

- [ ] **Step 1: feature flag (mirrors Phase 3)**

```typescript
// dashboard/lib/lena-producer-shoutout/feature-flag.ts
export function isProducerShoutoutEnabled(env: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean {
  const v = (env.LENA_PRODUCER_SHOUTOUT ?? "").toLowerCase();
  return v === "on" || v === "true" || v === "1";
}
```

```typescript
// dashboard/lib/lena-producer-shoutout/feature-flag.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isProducerShoutoutEnabled } from "./feature-flag.ts";

test("on/true/1 are truthy", () => {
  assert.equal(isProducerShoutoutEnabled({ LENA_PRODUCER_SHOUTOUT: "on" }), true);
  assert.equal(isProducerShoutoutEnabled({ LENA_PRODUCER_SHOUTOUT: "true" }), true);
  assert.equal(isProducerShoutoutEnabled({ LENA_PRODUCER_SHOUTOUT: "1" }), true);
});
test("unset/off are falsy", () => {
  assert.equal(isProducerShoutoutEnabled({}), false);
  assert.equal(isProducerShoutoutEnabled({ LENA_PRODUCER_SHOUTOUT: "off" }), false);
});
```

- [ ] **Step 2: modes**

```typescript
// dashboard/lib/lena-producer-shoutout/modes.ts

export type ShoutoutMode = "shoutout_classic" | "shoutout_inline" | "shoutout_quote" | "shoutout_callback";

export interface ShoutoutDecision {
  mode: ShoutoutMode;
  /** One phrase the Writer should center on. */
  targetFocus: string;
  /** When mode='shoutout_callback', the id of a recent shoutout/Lena-line event. */
  callbackTo: string | null;
  lengthHint: "short" | "medium";
  tone: "dry" | "warm" | "playful" | "low-key";
}

export const LENGTH_WORDS: Record<ShoutoutDecision["lengthHint"], { min: number; max: number }> = {
  short: { min: 12, max: 30 },
  medium: { min: 30, max: 60 },
};
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/lib/lena-producer-shoutout/
git commit -m "$(cat <<'EOF'
lena-producer-shoutout: feature flag + ShoutoutDecision types

Phase 4b foundation. LENA_PRODUCER_SHOUTOUT env flag. 4 narration
shapes the Producer can choose between (classic / inline / quote /
callback) — variety solves the "every shoutout sounds the same"
problem.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: ShoutoutContext + fetcher

The Producer needs: the new shoutout's text + handle, the time, recent shoutouts (last 30min from Postgres), recent Lena lines (anti-echo).

**Files:**
- Create: `dashboard/lib/lena-producer-shoutout/shoutout-context.ts` + `.test.ts`

- [ ] **Step 1: Tests**

```typescript
// dashboard/lib/lena-producer-shoutout/shoutout-context.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildShoutoutContext, fetchShoutoutContext } from "./shoutout-context.ts";

const T0 = new Date("2026-05-16T23:15:00").getTime();

test("buildShoutoutContext composes trigger + now + recents", () => {
  const ctx = buildShoutoutContext({
    trigger: { source: "booth_shoutout", handle: "anna", text: "loving this set" },
    nowMs: T0,
    recentShoutouts: [{ id: "s1", handle: "bob", text: "hi", minsAgo: 12 }],
    recentLenaLines: [],
  });
  assert.equal(ctx.trigger.handle, "anna");
  assert.equal(ctx.now.localTime, "23:15");
  assert.equal(ctx.now.bucket, "night");
});

test("fetchShoutoutContext queries Postgres for recent shoutouts + chatter (mocked)", async () => {
  const fakePrisma = {
    shoutout: {
      findMany: async () => [
        { id: "s1", requesterName: "bob", cleanText: "hi", createdAt: new Date(T0 - 12 * 60_000) },
      ],
    },
    chatter: {
      findMany: async () => [{ id: "c1", script: "earlier line", airedAt: new Date(T0 - 8 * 60_000) }],
    },
  };
  const ctx = await fetchShoutoutContext({
    prisma: fakePrisma as never,
    stationId: "s1",
    trigger: { source: "booth_shoutout", handle: "anna", text: "loving this" },
    nowMs: T0,
  });
  assert.equal(ctx.recentShoutouts.length, 1);
  assert.equal(ctx.recentLenaLines.length, 1);
});
```

- [ ] **Step 2: Implement**

```typescript
// dashboard/lib/lena-producer-shoutout/shoutout-context.ts

import type { PrismaClient } from "@prisma/client";

export interface ShoutoutTrigger {
  source: "booth_shoutout" | "agent_shoutout";
  handle: string;
  text: string;
}

export interface ShoutoutContext {
  trigger: ShoutoutTrigger;
  now: { localTime: string; bucket: string };
  recentShoutouts: { id: string; handle: string; text: string; minsAgo: number }[];
  recentLenaLines: { text: string; airedAt: number }[];
}

function bucketFor(hour: number): string {
  if (hour < 5) return "late night";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 21) return "evening";
  return "night";
}

function fmtHHMM(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function buildShoutoutContext(args: {
  trigger: ShoutoutTrigger;
  nowMs: number;
  recentShoutouts: ShoutoutContext["recentShoutouts"];
  recentLenaLines: ShoutoutContext["recentLenaLines"];
}): ShoutoutContext {
  const now = new Date(args.nowMs);
  return {
    trigger: args.trigger,
    now: { localTime: fmtHHMM(now), bucket: bucketFor(now.getHours()) },
    recentShoutouts: args.recentShoutouts,
    recentLenaLines: args.recentLenaLines,
  };
}

type PrismaSlice = Pick<PrismaClient, "shoutout" | "chatter">;
const THIRTY_MIN_MS = 30 * 60 * 1000;

export async function fetchShoutoutContext(args: {
  prisma: PrismaSlice;
  stationId: string;
  trigger: ShoutoutTrigger;
  nowMs: number;
}): Promise<ShoutoutContext> {
  const cutoff = new Date(args.nowMs - THIRTY_MIN_MS);
  const [shoutouts, lines] = await Promise.all([
    args.prisma.shoutout.findMany({
      where: { stationId: args.stationId, createdAt: { gte: cutoff } },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, requesterName: true, cleanText: true, createdAt: true },
    }),
    args.prisma.chatter.findMany({
      where: { stationId: args.stationId, airedAt: { gte: cutoff } },
      orderBy: { airedAt: "desc" },
      take: 5,
      select: { id: true, script: true, airedAt: true },
    }),
  ]);
  return buildShoutoutContext({
    trigger: args.trigger,
    nowMs: args.nowMs,
    recentShoutouts: shoutouts.map((s) => ({
      id: s.id,
      handle: s.requesterName ?? "anonymous",
      text: s.cleanText ?? "",
      minsAgo: Math.floor((args.nowMs - s.createdAt.getTime()) / 60_000),
    })),
    recentLenaLines: lines.map((l) => ({ text: l.script, airedAt: l.airedAt.getTime() })),
  });
}
```

- [ ] **Step 3: Run tests → 2/2 PASS, commit**

```bash
git add dashboard/lib/lena-producer-shoutout/shoutout-context.ts dashboard/lib/lena-producer-shoutout/shoutout-context.test.ts
git commit -m "lena-producer-shoutout: ShoutoutContext + fetchShoutoutContext

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Producer prompt + runShoutoutProducer

**Files:**
- Create: `dashboard/lib/lena-producer-shoutout/producer-prompt.ts` + `.test.ts`
- Create: `dashboard/lib/lena-producer-shoutout/producer.ts` + `.test.ts`

- [ ] **Step 1: producer-prompt tests + impl**

```typescript
// dashboard/lib/lena-producer-shoutout/producer-prompt.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildShoutoutProducerPrompt } from "./producer-prompt.ts";
import type { ShoutoutContext } from "./shoutout-context.ts";

function ctx(): ShoutoutContext {
  return {
    trigger: { source: "booth_shoutout", handle: "anna", text: "loving this set" },
    now: { localTime: "23:15", bucket: "night" },
    recentShoutouts: [{ id: "s1", handle: "bob", text: "hi from berlin", minsAgo: 18 }],
    recentLenaLines: [{ text: "Going out to friends in Berlin tonight.", airedAt: 0 }],
  };
}

test("buildShoutoutProducerPrompt forbids silence", () => {
  const p = buildShoutoutProducerPrompt(ctx());
  assert.match(p.system, /NEVER/);
  assert.match(p.system, /silence/i);
});

test("buildShoutoutProducerPrompt mode allowlist", () => {
  const p = buildShoutoutProducerPrompt(ctx());
  assert.match(p.system, /shoutout_classic/);
  assert.match(p.system, /shoutout_inline/);
  assert.match(p.system, /shoutout_quote/);
  assert.match(p.system, /shoutout_callback/);
});

test("buildShoutoutProducerPrompt nudges against repeating the legacy 'going out to' opener too often", () => {
  const p = buildShoutoutProducerPrompt(ctx());
  assert.match(p.system, /shape/i); // mentions varying shapes
});

test("buildShoutoutProducerPrompt user message has the new shoutout + recent shoutouts", () => {
  const p = buildShoutoutProducerPrompt(ctx());
  assert.match(p.user, /loving this set/);
  assert.match(p.user, /bob/);
  assert.match(p.user, /hi from berlin/);
});
```

```typescript
// dashboard/lib/lena-producer-shoutout/producer-prompt.ts
import type { ShoutoutContext } from "./shoutout-context.ts";

const SYSTEM = `You are the producer for Lena, a calm slightly-studio-slang DJ on Numa Radio.
A listener submitted a shoutout to be read on air. Decide HOW Lena narrates it.
You do NOT write her words — a separate Writer does. You emit a small JSON object.

OUTPUT — strict JSON, no prose, no markdown:
{
  "mode": "shoutout_classic" | "shoutout_inline" | "shoutout_quote" | "shoutout_callback",
  "target_focus": "<one short phrase>",
  "callback_to": "<id from recentShoutouts/recentLenaLines, or null>",
  "length_hint": "short" | "medium",
  "tone": "dry" | "warm" | "playful" | "low-key"
}

MODE SHAPES (vary across consecutive shoutouts — don't pick classic 3x in a row):
- shoutout_classic: "Going out to <recipient>. <Sender> says <paraphrase>." (legacy shape)
- shoutout_inline: single-sentence fold ("<Sender> wrote in to say <paraphrase>")
- shoutout_quote: quote the listener with minimal wrap ("<Sender> writes: <quoted line>")
- shoutout_callback: tie to a recent listener event by id (only if recentShoutouts/recentLenaLines has a fitting entry)

RULES:
- "silence" is NEVER valid here. Every approved shoutout MUST air.
- Pick callback only if a recent entry genuinely fits (same recipient, same theme, same listener returning).
- recentLenaLines is the anti-echo signal: if the last 2 Lena lines used shape X, prefer a different shape.
- length_hint: short=12-30 words, medium=30-60.
- callback_to must be a literal id from recentShoutouts OR recentLenaLines, or null.`;

export function buildShoutoutProducerPrompt(ctx: ShoutoutContext): { system: string; user: string } {
  const lines: string[] = [];
  lines.push(`New shoutout from: ${ctx.trigger.handle}`);
  lines.push(`Message: "${ctx.trigger.text}"`);
  lines.push(`Local time: ${ctx.now.localTime} (${ctx.now.bucket})`);
  if (ctx.recentShoutouts.length === 0) {
    lines.push(`Recent shoutouts: (none in last 30 min)`);
  } else {
    lines.push(`Recent shoutouts (last 30 min):`);
    for (const s of ctx.recentShoutouts) {
      lines.push(`  - id=${s.id} (${s.handle}, ${s.minsAgo}min ago): ${s.text.slice(0, 60)}`);
    }
  }
  if (ctx.recentLenaLines.length > 0) {
    lines.push(`Recent Lena lines (anti-echo):`);
    for (const l of ctx.recentLenaLines.slice(0, 3)) {
      lines.push(`  - ${l.text.slice(0, 80)}`);
    }
  }
  lines.push("");
  lines.push("Emit the decision JSON now.");
  return { system: SYSTEM, user: lines.join("\n") };
}
```

- [ ] **Step 2: producer tests + impl**

```typescript
// dashboard/lib/lena-producer-shoutout/producer.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { runShoutoutProducer } from "./producer.ts";
import type { ShoutoutContext } from "./shoutout-context.ts";

function ctx(): ShoutoutContext {
  return {
    trigger: { source: "booth_shoutout", handle: "anna", text: "hi" },
    now: { localTime: "23:00", bucket: "night" },
    recentShoutouts: [{ id: "s1", handle: "bob", text: "hi", minsAgo: 5 }],
    recentLenaLines: [],
  };
}

test("runShoutoutProducer happy path", async () => {
  const llm = async () => JSON.stringify({ mode: "shoutout_inline", target_focus: "x", callback_to: null, length_hint: "short", tone: "warm" });
  const d = await runShoutoutProducer(ctx(), { llm });
  assert.equal(d.mode, "shoutout_inline");
});

test("runShoutoutProducer rejects silence — retry then fallback to classic", async () => {
  let call = 0;
  const llm = async () => { call += 1; return JSON.stringify({ mode: "silence", target_focus: "", callback_to: null, length_hint: "short", tone: "low-key" }); };
  const d = await runShoutoutProducer(ctx(), { llm });
  assert.equal(call, 2);
  assert.equal(d.mode, "shoutout_classic"); // safe default
});

test("runShoutoutProducer: invalid JSON → fallback", async () => {
  const d = await runShoutoutProducer(ctx(), { llm: async () => "garbage" });
  assert.equal(d.mode, "shoutout_classic");
});

test("runShoutoutProducer: callback_to unknown id → stripped to null", async () => {
  const llm = async () => JSON.stringify({ mode: "shoutout_callback", target_focus: "x", callback_to: "not_real", length_hint: "short", tone: "warm" });
  const d = await runShoutoutProducer(ctx(), { llm });
  assert.equal(d.callbackTo, null);
});
```

```typescript
// dashboard/lib/lena-producer-shoutout/producer.ts
import type { ShoutoutContext } from "./shoutout-context.ts";
import type { ShoutoutDecision } from "./modes.ts";
import { buildShoutoutProducerPrompt } from "./producer-prompt.ts";

const VALID_MODES = ["shoutout_classic", "shoutout_inline", "shoutout_quote", "shoutout_callback"] as const;

export interface ShoutoutProducerDeps {
  llm: (prompts: { system: string; user: string }) => Promise<string>;
}

function safeDefault(): ShoutoutDecision {
  return { mode: "shoutout_classic", targetFocus: "read the shoutout", callbackTo: null, lengthHint: "short", tone: "warm" };
}

function parseDecision(raw: string, validIds: ReadonlySet<string>): ShoutoutDecision | null {
  let json: unknown;
  try { json = JSON.parse(raw.trim()); } catch { return null; }
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  if (typeof o.mode !== "string" || !VALID_MODES.includes(o.mode as never)) return null;
  if (typeof o.target_focus !== "string") return null;
  if (typeof o.length_hint !== "string" || !["short", "medium"].includes(o.length_hint)) return null;
  if (typeof o.tone !== "string" || !["dry", "warm", "playful", "low-key"].includes(o.tone)) return null;
  const cb = typeof o.callback_to === "string" && validIds.has(o.callback_to) ? o.callback_to : null;
  return {
    mode: o.mode as ShoutoutDecision["mode"],
    targetFocus: o.target_focus,
    callbackTo: cb,
    lengthHint: o.length_hint as ShoutoutDecision["lengthHint"],
    tone: o.tone as ShoutoutDecision["tone"],
  };
}

export async function runShoutoutProducer(ctx: ShoutoutContext, deps: ShoutoutProducerDeps): Promise<ShoutoutDecision> {
  const validIds = new Set([...ctx.recentShoutouts.map((s) => s.id), ...ctx.recentLenaLines.map((_, i) => `line_${i}`)]);
  const baseline = buildShoutoutProducerPrompt(ctx);

  try {
    const raw = await deps.llm(baseline);
    const p = parseDecision(raw, validIds);
    if (p) return p;
  } catch { /* fall through */ }

  const reinforced = { system: baseline.system, user: `${baseline.user}\n\nIMPORTANT: Output strict JSON only. mode MUST be one of the four shoutout shapes.` };
  try {
    const raw = await deps.llm(reinforced);
    const p = parseDecision(raw, validIds);
    if (p) return p;
  } catch { /* fall through */ }

  return safeDefault();
}
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/lib/lena-producer-shoutout/producer-prompt.ts dashboard/lib/lena-producer-shoutout/producer-prompt.test.ts dashboard/lib/lena-producer-shoutout/producer.ts dashboard/lib/lena-producer-shoutout/producer.test.ts
git commit -m "$(cat <<'EOF'
lena-producer-shoutout: producer-prompt + runShoutoutProducer

JSON-validating Producer for shoutout narration. silence rejected
(every approved shoutout MUST air). Fallback to shoutout_classic
(legacy shape) on parse failure.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Writers (classic + inline + quote + callback) — 4 modes

**Files:**
- Create: `dashboard/lib/lena-producer-shoutout/writers/{classic,inline,quote,callback}.ts` + `.test.ts`

Pattern is identical to Phase 3's writers. All four writers take `(decision, ctx, recentLenaLines)` and return `{system, user}`.

- [ ] **Step 1: Write all four impls + tests**

```typescript
// dashboard/lib/lena-producer-shoutout/writers/classic.ts
import type { ShoutoutDecision } from "../modes.ts";
import { LENGTH_WORDS } from "../modes.ts";
import type { ShoutoutContext } from "../shoutout-context.ts";

const SYSTEM = `You write spoken-narration text for Lena, a Numa Radio DJ, reading a listener's shoutout.
Mode: shoutout_classic — the legacy "Going out to X. Y says Z." shape.

RULES:
- Contractions. Spoken English. No poetry.
- Pattern: open with "Going out to <recipient>" OR "This one's going out to <recipient>" then "<Sender> says <paraphrase>".
- Optional final aside (sparingly — only when one genuinely lands).
- BANNED phrases: "let it ride", "we'll let it ride", "we'll take that one", "hope this reaches them".

OUTPUT: 1-2 lines, no quotes, no stage directions.`;

export function buildClassicShoutoutPrompt(decision: ShoutoutDecision, ctx: ShoutoutContext, recentAired: readonly string[]): { system: string; user: string } {
  const w = LENGTH_WORDS[decision.lengthHint];
  const lines: string[] = [];
  lines.push(`sender: ${ctx.trigger.handle}`);
  lines.push(`message: "${ctx.trigger.text}"`);
  lines.push(`tone: ${decision.tone}`);
  lines.push(`length: ${w.min}-${w.max} words`);
  if (recentAired.length > 0) {
    lines.push(`recently_aired (DO NOT echo openers):`);
    for (const l of recentAired.slice(0, 3)) lines.push(`  - ${l}`);
  }
  lines.push("");
  lines.push("Write Lena's narration now.");
  return { system: SYSTEM, user: lines.join("\n") };
}
```

```typescript
// dashboard/lib/lena-producer-shoutout/writers/inline.ts
import type { ShoutoutDecision } from "../modes.ts";
import { LENGTH_WORDS } from "../modes.ts";
import type { ShoutoutContext } from "../shoutout-context.ts";

const SYSTEM = `You write spoken-narration text for Lena, a Numa Radio DJ, reading a listener's shoutout.
Mode: shoutout_inline — single-sentence fold, no "going out to" opener.

RULES:
- Contractions. Spoken English. No poetry.
- Pattern: one sentence that names the sender naturally and folds the message into Lena's voice.
  Examples (don't copy verbatim):
    "<Sender> wrote in to say <paraphrase>."
    "<Sender> is tuning in tonight and <paraphrase>."
    "<Sender> sends word — <paraphrase>."
- Avoid the legacy "Going out to" opener — that's shoutout_classic's job.
- BANNED phrases: "let it ride", "we'll let it ride", "we'll take that one", "hope this reaches them", "going out to".

OUTPUT: one sentence, no quotes, no stage directions.`;

export function buildInlineShoutoutPrompt(decision: ShoutoutDecision, ctx: ShoutoutContext, recentAired: readonly string[]): { system: string; user: string } {
  const w = LENGTH_WORDS[decision.lengthHint];
  const lines: string[] = [];
  lines.push(`sender: ${ctx.trigger.handle}`);
  lines.push(`message: "${ctx.trigger.text}"`);
  lines.push(`tone: ${decision.tone}`);
  lines.push(`length: ${w.min}-${w.max} words`);
  if (recentAired.length > 0) {
    lines.push(`recently_aired (DO NOT echo):`);
    for (const l of recentAired.slice(0, 3)) lines.push(`  - ${l}`);
  }
  lines.push("");
  lines.push("Write Lena's narration now.");
  return { system: SYSTEM, user: lines.join("\n") };
}
```

```typescript
// dashboard/lib/lena-producer-shoutout/writers/quote.ts
import type { ShoutoutDecision } from "../modes.ts";
import { LENGTH_WORDS } from "../modes.ts";
import type { ShoutoutContext } from "../shoutout-context.ts";

const SYSTEM = `You write spoken-narration text for Lena, a Numa Radio DJ.
Mode: shoutout_quote — quote the listener's words with minimal wrap.

RULES:
- Contractions. Spoken English.
- Pattern: brief intro ("<Sender> writes:" or "From <sender>:") then the listener's message quoted nearly verbatim (paraphrase only if it's too long or has spelling/grammar that won't read aloud well).
- The listener's voice is the star here, not Lena's. Keep her intro tight (≤6 words).
- BANNED phrases: "let it ride", "we'll let it ride", "we'll take that one", "hope this reaches them", "going out to".

OUTPUT: one short intro + the quote, no JSON, no stage directions.`;

export function buildQuoteShoutoutPrompt(decision: ShoutoutDecision, ctx: ShoutoutContext, recentAired: readonly string[]): { system: string; user: string } {
  const w = LENGTH_WORDS[decision.lengthHint];
  const lines: string[] = [];
  lines.push(`sender: ${ctx.trigger.handle}`);
  lines.push(`message_verbatim: "${ctx.trigger.text}"`);
  lines.push(`tone: ${decision.tone}`);
  lines.push(`length: ${w.min}-${w.max} words`);
  if (recentAired.length > 0) {
    lines.push(`recently_aired (DO NOT echo openers):`);
    for (const l of recentAired.slice(0, 3)) lines.push(`  - ${l}`);
  }
  lines.push("");
  lines.push("Write Lena's narration now.");
  return { system: SYSTEM, user: lines.join("\n") };
}
```

```typescript
// dashboard/lib/lena-producer-shoutout/writers/callback.ts
import type { ShoutoutDecision } from "../modes.ts";
import { LENGTH_WORDS } from "../modes.ts";
import type { ShoutoutContext } from "../shoutout-context.ts";

const SYSTEM = `You write spoken-narration text for Lena, a Numa Radio DJ.
Mode: shoutout_callback — tie this new shoutout to a recent listener event.

RULES:
- Contractions. Spoken English.
- Acknowledge the new sender AND naturally reference the earlier event (don't say "earlier" — just weave it: "Anna joining Bob from Berlin — Bob's been here for a while too").
- BANNED phrases: "let it ride", "we'll let it ride", "we'll take that one", "hope this reaches them", "going out to".

OUTPUT: one or two lines, no quotes, no stage directions.`;

export function buildCallbackShoutoutPrompt(decision: ShoutoutDecision, ctx: ShoutoutContext, recentAired: readonly string[]): { system: string; user: string } {
  const w = LENGTH_WORDS[decision.lengthHint];
  const cb = ctx.recentShoutouts.find((s) => s.id === decision.callbackTo);
  const lines: string[] = [];
  lines.push(`sender: ${ctx.trigger.handle}`);
  lines.push(`message: "${ctx.trigger.text}"`);
  lines.push(`callback_event: ${cb ? `${cb.handle} (${cb.minsAgo}min ago): ${cb.text.slice(0, 80)}` : "(unresolved — write a general acknowledgement instead)"}`);
  lines.push(`tone: ${decision.tone}`);
  lines.push(`length: ${w.min}-${w.max} words`);
  if (recentAired.length > 0) {
    lines.push(`recently_aired (DO NOT echo):`);
    for (const l of recentAired.slice(0, 3)) lines.push(`  - ${l}`);
  }
  lines.push("");
  lines.push("Write Lena's narration now.");
  return { system: SYSTEM, user: lines.join("\n") };
}
```

All four test files share the same shape — one test per writer minimum:

```typescript
// dashboard/lib/lena-producer-shoutout/writers/classic.test.ts (mirror for inline.test.ts, quote.test.ts)
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClassicShoutoutPrompt } from "./classic.ts";

const decision = { mode: "shoutout_classic" as const, targetFocus: "x", callbackTo: null, lengthHint: "short" as const, tone: "warm" as const };
const ctx = {
  trigger: { source: "booth_shoutout" as const, handle: "anna", text: "loving this" },
  now: { localTime: "23:15", bucket: "night" },
  recentShoutouts: [],
  recentLenaLines: [],
};

test("buildClassicShoutoutPrompt bans 'let it ride'", () => {
  const p = buildClassicShoutoutPrompt(decision, ctx, []);
  assert.match(p.system, /let it ride/i);
});

test("buildClassicShoutoutPrompt includes sender + message in user", () => {
  const p = buildClassicShoutoutPrompt(decision, ctx, []);
  assert.match(p.user, /anna/);
  assert.match(p.user, /loving this/);
});
```

```typescript
// dashboard/lib/lena-producer-shoutout/writers/inline.test.ts — same shape with import { buildInlineShoutoutPrompt } from "./inline.ts";
```

```typescript
// dashboard/lib/lena-producer-shoutout/writers/quote.test.ts — same shape with import { buildQuoteShoutoutPrompt } from "./quote.ts";
```

```typescript
// dashboard/lib/lena-producer-shoutout/writers/callback.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCallbackShoutoutPrompt } from "./callback.ts";

const decision = { mode: "shoutout_callback" as const, targetFocus: "tie to bob", callbackTo: "s1", lengthHint: "medium" as const, tone: "warm" as const };
const ctx = {
  trigger: { source: "booth_shoutout" as const, handle: "anna", text: "hey" },
  now: { localTime: "23:15", bucket: "night" },
  recentShoutouts: [{ id: "s1", handle: "bob", text: "hi from berlin", minsAgo: 5 }],
  recentLenaLines: [],
};

test("buildCallbackShoutoutPrompt resolves callback_to to the recent shoutout", () => {
  const p = buildCallbackShoutoutPrompt(decision, ctx, []);
  assert.match(p.user, /bob/);
  assert.match(p.user, /berlin/);
});

test("buildCallbackShoutoutPrompt bans 'let it ride'", () => {
  const p = buildCallbackShoutoutPrompt(decision, ctx, []);
  assert.match(p.system, /let it ride/i);
});
```

- [ ] **Step 2: Run all writer tests → 8/8 PASS (2 per writer × 4)**

- [ ] **Step 3: Commit**

```bash
git add dashboard/lib/lena-producer-shoutout/writers/
git commit -m "lena-producer-shoutout: 4 writer prompts (classic, inline, quote, callback)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Writer dispatcher + lenaSpeakShoutout entry point + minimax-llm helper

**Files:**
- Create: `dashboard/lib/lena-producer-shoutout/writer.ts` + `.test.ts`
- Create: `dashboard/lib/lena-producer-shoutout/minimax-llm.ts`
- Create: `dashboard/lib/lena-producer-shoutout/index.ts` + `.test.ts`

- [ ] **Step 1: writer.ts**

```typescript
// dashboard/lib/lena-producer-shoutout/writer.ts
import type { ShoutoutDecision } from "./modes.ts";
import type { ShoutoutContext } from "./shoutout-context.ts";
import { buildClassicShoutoutPrompt } from "./writers/classic.ts";
import { buildInlineShoutoutPrompt } from "./writers/inline.ts";
import { buildQuoteShoutoutPrompt } from "./writers/quote.ts";
import { buildCallbackShoutoutPrompt } from "./writers/callback.ts";

export interface ShoutoutWriterDeps {
  llm: (prompts: { system: string; user: string }) => Promise<string>;
}

export async function runShoutoutWriter(
  decision: ShoutoutDecision,
  ctx: ShoutoutContext,
  recentAired: readonly string[],
  deps: ShoutoutWriterDeps,
): Promise<string | null> {
  let prompts: { system: string; user: string };
  switch (decision.mode) {
    case "shoutout_classic": prompts = buildClassicShoutoutPrompt(decision, ctx, recentAired); break;
    case "shoutout_inline": prompts = buildInlineShoutoutPrompt(decision, ctx, recentAired); break;
    case "shoutout_quote": prompts = buildQuoteShoutoutPrompt(decision, ctx, recentAired); break;
    case "shoutout_callback": prompts = buildCallbackShoutoutPrompt(decision, ctx, recentAired); break;
  }
  const raw = await deps.llm(prompts);
  return raw.trim() || null;
}
```

```typescript
// dashboard/lib/lena-producer-shoutout/writer.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { runShoutoutWriter } from "./writer.ts";

const ctx = {
  trigger: { source: "booth_shoutout" as const, handle: "anna", text: "hi" },
  now: { localTime: "23:00", bucket: "night" },
  recentShoutouts: [{ id: "s1", handle: "bob", text: "hi", minsAgo: 5 }],
  recentLenaLines: [],
};

test("runShoutoutWriter routes mode=shoutout_inline", async () => {
  const decision = { mode: "shoutout_inline" as const, targetFocus: "x", callbackTo: null, lengthHint: "short" as const, tone: "warm" as const };
  const llm = async (p: { system: string }) => {
    assert.match(p.system, /shoutout_inline/i);
    return "anna sends word — loving this set.";
  };
  assert.match((await runShoutoutWriter(decision, ctx, [], { llm })) ?? "", /anna/);
});

test("runShoutoutWriter routes mode=shoutout_callback", async () => {
  const decision = { mode: "shoutout_callback" as const, targetFocus: "x", callbackTo: "s1", lengthHint: "short" as const, tone: "warm" as const };
  const llm = async (p: { system: string }) => {
    assert.match(p.system, /callback/i);
    return "anna joining bob — same Berlin energy.";
  };
  assert.match((await runShoutoutWriter(decision, ctx, [], { llm })) ?? "", /bob/);
});
```

- [ ] **Step 2: minimax-llm.ts (local copy of the wrapper from Phase 3)**

```typescript
// dashboard/lib/lena-producer-shoutout/minimax-llm.ts

const MINIMAX_URL = "https://api.minimax.io/anthropic/v1/messages";
const MODEL = process.env.MINIMAX_HUMANIZE_MODEL ?? "MiniMax-M2.7";

export async function callMiniMaxJson(
  prompts: { system: string; user: string },
  opts: { apiKey: string; fetcher?: typeof fetch } = { apiKey: process.env.MINIMAX_API_KEY ?? "" },
): Promise<string> {
  const fetcher = opts.fetcher ?? fetch;
  if (!opts.apiKey) throw new Error("MINIMAX_API_KEY is not set");
  const res = await fetcher(MINIMAX_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 8000, temperature: 0.9, system: prompts.system, messages: [{ role: "user", content: prompts.user }] }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`minimax http ${res.status}`);
  const data = await res.json() as { content?: Array<{ type: string; text?: string }> };
  const text = data.content?.find((b) => b.type === "text" && b.text)?.text ?? "";
  return text.trim();
}
```

- [ ] **Step 3: index.ts (lenaSpeakShoutout)**

```typescript
// dashboard/lib/lena-producer-shoutout/index.ts
import type { PrismaClient } from "@prisma/client";
import { fetchShoutoutContext, type ShoutoutTrigger } from "./shoutout-context.ts";
import { runShoutoutProducer } from "./producer.ts";
import { runShoutoutWriter } from "./writer.ts";

export interface LenaShoutoutResult {
  text: string;
  mode: "shoutout_classic" | "shoutout_inline" | "shoutout_quote" | "shoutout_callback";
}

export interface LenaSpeakShoutoutArgs {
  trigger: ShoutoutTrigger;
  prisma: Pick<PrismaClient, "shoutout" | "chatter">;
  stationId: string;
  nowMs: number;
  llm: (prompts: { system: string; user: string }) => Promise<string>;
}

export async function lenaSpeakShoutout(args: LenaSpeakShoutoutArgs): Promise<LenaShoutoutResult | null> {
  let ctx;
  try {
    ctx = await fetchShoutoutContext({ prisma: args.prisma, stationId: args.stationId, trigger: args.trigger, nowMs: args.nowMs });
  } catch { return null; }
  const decision = await runShoutoutProducer(ctx, { llm: args.llm });
  const recentAired = ctx.recentLenaLines.slice(0, 3).map((l) => l.text);
  try {
    const text = await runShoutoutWriter(decision, ctx, recentAired, { llm: args.llm });
    if (!text) return null;
    return { text, mode: decision.mode };
  } catch { return null; }
}
```

```typescript
// dashboard/lib/lena-producer-shoutout/index.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { lenaSpeakShoutout } from "./index.ts";

const T0 = new Date("2026-05-16T23:15:00").getTime();

test("lenaSpeakShoutout happy path", async () => {
  const fakePrisma = {
    shoutout: { findMany: async () => [] },
    chatter: { findMany: async () => [] },
  };
  const llm = async (p: { system: string }) => {
    if (p.system.startsWith("You are the producer")) {
      return JSON.stringify({ mode: "shoutout_inline", target_focus: "x", callback_to: null, length_hint: "short", tone: "warm" });
    }
    return "anna sends word — loving this set tonight.";
  };
  const r = await lenaSpeakShoutout({
    trigger: { source: "booth_shoutout", handle: "anna", text: "loving this" },
    prisma: fakePrisma as never,
    stationId: "s1",
    nowMs: T0,
    llm,
  });
  assert.ok(r);
  assert.equal(r!.mode, "shoutout_inline");
  assert.match(r!.text, /anna/);
});

test("lenaSpeakShoutout returns null on DB error", async () => {
  const fakePrisma = {
    shoutout: { findMany: async () => { throw new Error("db down"); } },
    chatter: { findMany: async () => [] },
  };
  const r = await lenaSpeakShoutout({
    trigger: { source: "booth_shoutout", handle: "anna", text: "hi" },
    prisma: fakePrisma as never,
    stationId: "s1",
    nowMs: T0,
    llm: async () => "n/a",
  });
  assert.equal(r, null);
});
```

- [ ] **Step 4: Run all tests → 4/4 PASS (2 writer + 2 index)**

- [ ] **Step 5: Commit**

```bash
git add dashboard/lib/lena-producer-shoutout/writer.ts dashboard/lib/lena-producer-shoutout/writer.test.ts dashboard/lib/lena-producer-shoutout/minimax-llm.ts dashboard/lib/lena-producer-shoutout/index.ts dashboard/lib/lena-producer-shoutout/index.test.ts
git commit -m "$(cat <<'EOF'
lena-producer-shoutout: writer dispatcher + lenaSpeakShoutout entry point

Wires Producer → Writer for shoutout narration. Returns null on DB
error or Writer failure — caller falls back to legacy humanizeScript.
Includes local minimax-llm.ts wrapper (dashboard can't import the
sibling at lib/lena-producer-chat/ due to cross-package boundaries).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Wire into dashboard/lib/shoutout.ts

**Files:**
- Modify: `dashboard/lib/shoutout.ts` (find where `humanizeScript` is called — that's the integration point)

- [ ] **Step 1: Locate the humanize call in shoutout.ts**

Run: `grep -n "humanizeScript\|humanize(" dashboard/lib/shoutout.ts | head -5`

The flag-gated code should:
1. If `LENA_PRODUCER_SHOUTOUT` is on, try `lenaSpeakShoutout({...})` first
2. On null/error, fall back to existing `humanizeScript` (legacy path)
3. Use `callMiniMaxJson` for the LLM dep

Construction:

```typescript
import { lenaSpeakShoutout } from "./lena-producer-shoutout/index.ts";
import { isProducerShoutoutEnabled } from "./lena-producer-shoutout/feature-flag.ts";
import { callMiniMaxJson } from "./lena-producer-shoutout/minimax-llm.ts";

// ... where humanizeScript is called:
let narrated: string | null = null;
if (isProducerShoutoutEnabled(process.env)) {
  try {
    const stationRow = await prisma.station.findUnique({
      where: { slug: process.env.STATION_SLUG ?? "numaradio" },
      select: { id: true },
    });
    if (stationRow) {
      const r = await lenaSpeakShoutout({
        trigger: {
          source: input.source.kind === "agent" ? "agent_shoutout" : "booth_shoutout",
          handle: input.source.kind === "agent" ? (input.source.sender ?? "anonymous") : (input.source.requesterName ?? "anonymous"),
          text: input.text,
        },
        prisma,
        stationId: stationRow.id,
        nowMs: Date.now(),
        llm: (prompts) => callMiniMaxJson(prompts, { apiKey: process.env.MINIMAX_API_KEY ?? "" }),
      });
      if (r) narrated = r.text;
    }
  } catch (err) {
    console.warn("[lena-producer-shoutout] failed, falling back to humanize:", err);
  }
}

if (!narrated) {
  // Legacy path
  narrated = await humanizeScript(...);  // adjust to the actual current call
}

// Continue with narrated text through radioHostTransform → TTS pipeline
```

The exact wire-up depends on the existing structure of `shoutout.ts`. Read the file around the humanize call (~line 150-200) and integrate cleanly. Preserve all existing fallback behavior (suspicious-rewrite detection, etc.).

- [ ] **Step 2: Type-check + run tests + builds**

```bash
cd /home/marku/saas/numaradio
npx tsc --noEmit 2>&1 | grep "shoutout.ts\|lena-producer-shoutout" | head -5
npm test 2>&1 | grep -E "^(ℹ|# )" | tail -8
cd dashboard && npm run build 2>&1 | grep -E "(error|✓ Compiled)" | head -3
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/lib/shoutout.ts
git commit -m "$(cat <<'EOF'
shoutout: gate humanize path through Producer (Phase 4b)

When LENA_PRODUCER_SHOUTOUT=on, shoutout narration goes through
lenaSpeakShoutout (Producer-decided shape: classic / inline / quote
/ callback). On Producer/Writer failure OR flag off, falls back to
the existing humanizeScript path. Listener never sees worse than
today's behavior.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: HANDOFF.md Phase 4b deploy notes

**Files:**
- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: Prepend section after first `---`, before existing Phase 3 section**

```markdown
## 2026-05-16 — Lena Producer Phase 4b: Shoutout narration through Producer — CODE READY, NEEDS ENV

Shoutout narration (currently `humanizeScript`) now optionally routes
through a 4-mode Producer + Writer pipeline. Behind
`LENA_PRODUCER_SHOUTOUT` flag, default off. Dashboard-side (Orion).

**Spec:** `docs/superpowers/specs/2026-05-16-lena-producer-design.md`
**Plan:** `docs/superpowers/plans/2026-05-16-lena-producer-phase-4b.md`

**What ships:**
- `dashboard/lib/lena-producer-shoutout/` — sibling module to
  `lib/lena-producer-chat/`. Producer modes: `shoutout_classic`
  (legacy "Going out to X. Y says Z" shape), `shoutout_inline`
  (single-sentence fold), `shoutout_quote` (verbatim with intro),
  `shoutout_callback` (tie to a recent event by id).
- `dashboard/lib/shoutout.ts` gated: flag on → try Producer; on
  failure → fall back to existing humanizeScript.

**Deploy:**
1. `cd /home/marku/saas/numaradio && git pull` on Orion
2. Add `LENA_PRODUCER_SHOUTOUT=on` to `dashboard/.env.local`:
   ```
   nano dashboard/.env.local
   # add: LENA_PRODUCER_SHOUTOUT=on
   ```
3. `cd dashboard && npm run deploy` — picks up the new env + flips
   the flag.
4. Test: submit a shoutout from numaradio.com — expect one of the
   4 shapes (not always "Going out to..."). Submit a second
   shoutout within 30 min and watch for `shoutout_callback` mode
   that references the first one.

**Rollback:** unset `LENA_PRODUCER_SHOUTOUT` in
`dashboard/.env.local`, restart dashboard. Legacy humanize resumes.

**What to watch:**
- `[lena-producer-shoutout] failed, falling back to humanize:` in
  dashboard logs → Producer-side error. Falls back to existing path.
- Producer adds 2 MiniMax calls per shoutout (~3-8s typical). Booth
  submit returns immediately (`after()` wraps the pipeline), so
  listener doesn't wait.

**Next phase:** Phase 5 — QueueDirector + queue autonomy modes
(Lena can accept listener song requests, pick the next track).

---
```

- [ ] **Step 2: Commit**

```bash
git add docs/HANDOFF.md
git commit -m "docs: HANDOFF — Phase 4b (shoutout narration through Producer) deploy notes

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- `npm test 2>&1 | grep -E "^(ℹ|# )" | tail -8` — expect ~630 pass / 1 skip / 1 pre-existing fail
- `npm run build 2>&1 | grep -E "(error|✓ Compiled)" | head -3` — ✓
- `cd dashboard && npm run build 2>&1 | grep -E "(error|✓ Compiled)" | head -3` — ✓
- DO NOT push

---

## What ships

✅ `dashboard/lib/lena-producer-shoutout/` module (4 modes + ctx + producer + writers)
✅ `LENA_PRODUCER_SHOUTOUT` flag
✅ `dashboard/lib/shoutout.ts` gated with legacy fallback
✅ Producer never picks silence for shoutouts (every approved shoutout airs)
✅ 4 distinct narration shapes — solves "every shoutout sounds the same"

🔜 Phase 5 — QueueDirector
🔜 Phase 6 — Cleanup
