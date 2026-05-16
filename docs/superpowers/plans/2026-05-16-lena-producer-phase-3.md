# Lena Producer — Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Route YouTube `@lena` chat replies through a Producer + Writer pipeline (Producer-lite, Vercel-side). Behind `LENA_PRODUCER_REPLY` flag. When off, existing `generateLenaReply()` runs unchanged.

**Architecture:** Because the dispatch route runs on Vercel (`app/api/internal/youtube-chat-shoutout/route.ts`) and `.vercelignore` excludes `workers/`, we cannot reuse the daemon-side `workers/queue-daemon/lena-producer/` module. Instead build a sibling at `lib/lena-producer-chat/` with:
- A lite ChatContext (no full ShiftMemory — just recentShoutouts + recentLenaLines + bucket, fetched from Postgres on each call)
- A 2-mode Producer (`answer` / `callback` — no `silence`; per memory: Lena never ignores a direct mention)
- Per-mode Writers (answer.ts, callback.ts)
- A single `lenaSpeakChat()` entry point the route calls

Falls back to the existing `generateLenaReply()` on any Producer/Writer failure so Vercel-side reliability isn't tied to the new path.

**Tech Stack:** TypeScript, MiniMax (reusing minimax-script.ts pattern). Test runner: node:test.

**Spec:** `docs/superpowers/specs/2026-05-16-lena-producer-design.md`

---

## File Structure

### Created
```
lib/lena-producer-chat/
├── modes.ts                  # ChatDecision type + per-mode length
├── chat-context.ts           # ChatContext type + fetchChatContext() from Postgres
├── chat-context.test.ts
├── producer.ts               # runChatProducer with JSON validation
├── producer.test.ts
├── producer-prompt.ts        # buildChatProducerPrompt
├── producer-prompt.test.ts
├── writers/
│   ├── answer.ts
│   ├── answer.test.ts
│   ├── callback.ts
│   └── callback.test.ts
├── writer.ts                 # runChatWriter dispatcher
├── writer.test.ts
└── index.ts                  # lenaSpeakChat() public API
    index.test.ts
```

### Modified

| File | What |
|---|---|
| `lib/lena-producer-chat/feature-flag.ts` (NEW) | `isProducerReplyEnabled(env)` |
| `app/api/internal/youtube-chat-shoutout/route.ts:318-341` | Gate the existing `generateLenaReply` call behind the flag; on `LENA_PRODUCER_REPLY=on` try `lenaSpeakChat()` first, fall back to `generateLenaReply` on null/error |
| `docs/HANDOFF.md` | Phase 3 deploy notes |

### Not modified
- `lib/lena-reply.ts` stays as the fallback path
- Daemon-side `workers/queue-daemon/lena-producer/` — separate concern (auto-chatter only)

---

## Task 1: feature flag + modes type

**Files:**
- Create: `lib/lena-producer-chat/feature-flag.ts`
- Create: `lib/lena-producer-chat/feature-flag.test.ts`
- Create: `lib/lena-producer-chat/modes.ts`

- [ ] **Step 1: feature flag**

```typescript
// lib/lena-producer-chat/feature-flag.ts
export function isProducerReplyEnabled(env: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean {
  const v = (env.LENA_PRODUCER_REPLY ?? "").toLowerCase();
  return v === "on" || v === "true" || v === "1";
}
```

```typescript
// lib/lena-producer-chat/feature-flag.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isProducerReplyEnabled } from "./feature-flag.ts";

test("isProducerReplyEnabled returns true when env='on'", () => assert.equal(isProducerReplyEnabled({ LENA_PRODUCER_REPLY: "on" }), true));
test("isProducerReplyEnabled returns false when unset", () => assert.equal(isProducerReplyEnabled({}), false));
test("isProducerReplyEnabled returns false when env='off'", () => assert.equal(isProducerReplyEnabled({ LENA_PRODUCER_REPLY: "off" }), false));
```

Run: `npx tsx --test lib/lena-producer-chat/feature-flag.test.ts` → 3/3 PASS.

- [ ] **Step 2: modes**

```typescript
// lib/lena-producer-chat/modes.ts

/** Phase 3 modes for chat-reply Producer. silence is NEVER valid (direct
 *  @lena mentions ALWAYS get a spoken response — see memory:
 *  feedback_lena_never_ignores_direct_mention). */
export type ChatMode = "answer" | "callback";

export interface ChatDecision {
  mode: ChatMode;
  targetFocus: string;
  /** Optional ref to a recentShoutouts entry id when mode='callback'. */
  callbackTo: string | null;
  lengthHint: "short" | "medium";
  tone: "dry" | "warm" | "playful" | "low-key";
}

export const LENGTH_WORDS: Record<ChatDecision["lengthHint"], { min: number; max: number }> = {
  short: { min: 4, max: 25 },
  medium: { min: 25, max: 45 },
};
```

- [ ] **Step 3: Commit**

```bash
git add lib/lena-producer-chat/
git commit -m "$(cat <<'EOF'
lena-producer-chat: feature flag + modes (Phase 3 foundation)

Vercel-side Producer-lite for YouTube @lena replies. Sibling module
to workers/queue-daemon/lena-producer/ (can't be shared — Vercel
build excludes workers/). LENA_PRODUCER_REPLY env flag, ChatMode =
answer | callback (no silence — direct mentions always get a reply).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: ChatContext + fetchChatContext

Builds the lite context the chat Producer sees. Reads recent Shoutout + Chatter rows from Postgres (last 30 min).

**Files:**
- Create: `lib/lena-producer-chat/chat-context.ts`
- Create: `lib/lena-producer-chat/chat-context.test.ts`

- [ ] **Step 1: Tests**

```typescript
// lib/lena-producer-chat/chat-context.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildChatContext, fetchChatContext } from "./chat-context.ts";

const T0 = new Date("2026-05-16T23:15:00").getTime();

test("buildChatContext composes trigger + now + recentShoutouts + recentLenaLines", () => {
  const ctx = buildChatContext({
    trigger: { source: "youtube_chat_mention", handle: "anna", text: "hey lena, loving this set" },
    nowMs: T0,
    recentShoutouts: [{ id: "s1", handle: "bob", originalText: "hi from berlin", minsAgo: 12 }],
    recentLenaLines: [{ text: "earlier line", airedAt: T0 - 5 * 60_000 }],
  });
  assert.equal(ctx.trigger.handle, "anna");
  assert.equal(ctx.now.localTime, "23:15");
  assert.equal(ctx.now.bucket, "night");
  assert.equal(ctx.recentShoutouts.length, 1);
  assert.equal(ctx.recentLenaLines.length, 1);
});

test("fetchChatContext queries Postgres for last 30min of shoutouts + chatter (mocked)", async () => {
  const fakePrisma = {
    shoutout: {
      findMany: async () => [
        { id: "s1", requesterName: "bob", cleanText: "hi", createdAt: new Date(T0 - 12 * 60_000) },
      ],
    },
    chatter: {
      findMany: async () => [
        { id: "c1", script: "earlier line", airedAt: new Date(T0 - 5 * 60_000) },
      ],
    },
  };
  const ctx = await fetchChatContext({
    prisma: fakePrisma as never,
    stationId: "s1",
    trigger: { source: "youtube_chat_mention", handle: "anna", text: "hey" },
    nowMs: T0,
  });
  assert.equal(ctx.recentShoutouts.length, 1);
  assert.equal(ctx.recentShoutouts[0].id, "s1");
  assert.equal(ctx.recentShoutouts[0].handle, "bob");
  assert.equal(ctx.recentShoutouts[0].minsAgo, 12);
});
```

- [ ] **Step 2: Run → expect FAIL**

- [ ] **Step 3: Implement**

```typescript
// lib/lena-producer-chat/chat-context.ts

import type { PrismaClient } from "@prisma/client";

export interface ChatTrigger {
  source: "youtube_chat_mention";
  handle: string;
  text: string;
}

export interface ChatContext {
  trigger: ChatTrigger;
  now: { localTime: string; bucket: string };
  recentShoutouts: { id: string; handle: string; originalText: string; minsAgo: number }[];
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

export function buildChatContext(args: {
  trigger: ChatTrigger;
  nowMs: number;
  recentShoutouts: ChatContext["recentShoutouts"];
  recentLenaLines: ChatContext["recentLenaLines"];
}): ChatContext {
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

export async function fetchChatContext(args: {
  prisma: PrismaSlice;
  stationId: string;
  trigger: ChatTrigger;
  nowMs: number;
}): Promise<ChatContext> {
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
  return buildChatContext({
    trigger: args.trigger,
    nowMs: args.nowMs,
    recentShoutouts: shoutouts.map((s) => ({
      id: s.id,
      handle: s.requesterName ?? "anonymous",
      originalText: s.cleanText ?? "",
      minsAgo: Math.floor((args.nowMs - s.createdAt.getTime()) / 60_000),
    })),
    recentLenaLines: lines.map((l) => ({ text: l.script, airedAt: l.airedAt.getTime() })),
  });
}
```

- [ ] **Step 4: Run → 2/2 PASS**

- [ ] **Step 5: Commit**

```bash
git add lib/lena-producer-chat/chat-context.ts lib/lena-producer-chat/chat-context.test.ts
git commit -m "lena-producer-chat: ChatContext + fetchChatContext (DB-backed lite memory)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Chat Producer prompt + runChatProducer

**Files:**
- Create: `lib/lena-producer-chat/producer-prompt.ts`
- Create: `lib/lena-producer-chat/producer-prompt.test.ts`
- Create: `lib/lena-producer-chat/producer.ts`
- Create: `lib/lena-producer-chat/producer.test.ts`

- [ ] **Step 1: producer-prompt tests + impl**

```typescript
// lib/lena-producer-chat/producer-prompt.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildChatProducerPrompt } from "./producer-prompt.ts";
import type { ChatContext } from "./chat-context.ts";

function ctx(): ChatContext {
  return {
    trigger: { source: "youtube_chat_mention", handle: "anna", text: "hey lena loving this" },
    now: { localTime: "23:15", bucket: "night" },
    recentShoutouts: [{ id: "s1", handle: "bob", originalText: "hi from berlin", minsAgo: 18 }],
    recentLenaLines: [{ text: "earlier line", airedAt: 0 }],
  };
}

test("buildChatProducerPrompt enforces strict JSON output", () => {
  const p = buildChatProducerPrompt(ctx());
  assert.match(p.system, /strict JSON/i);
  assert.match(p.system, /no prose/i);
});

test("buildChatProducerPrompt forbids silence", () => {
  const p = buildChatProducerPrompt(ctx());
  assert.match(p.system, /NEVER/);
  assert.match(p.system, /silence/i);
});

test("buildChatProducerPrompt mode allowlist is answer + callback only", () => {
  const p = buildChatProducerPrompt(ctx());
  assert.match(p.system, /"answer"/);
  assert.match(p.system, /"callback"/);
});

test("buildChatProducerPrompt user message includes the listener message + shoutout pool", () => {
  const p = buildChatProducerPrompt(ctx());
  assert.match(p.user, /anna/);
  assert.match(p.user, /hey lena loving this/);
  assert.match(p.user, /bob/);
});
```

```typescript
// lib/lena-producer-chat/producer-prompt.ts
import type { ChatContext } from "./chat-context.ts";

const SYSTEM = `You are the producer for Lena, a calm slightly-studio-slang DJ on Numa Radio.
A listener just sent her a message on YouTube live chat. Decide HOW she responds.
You do NOT write her words — a separate Writer does. You emit a small JSON object.

OUTPUT — strict JSON, no prose, no markdown:
{
  "mode": "answer" | "callback",
  "target_focus": "<one short phrase>",
  "callback_to": "<id from recentShoutouts, or null>",
  "length_hint": "short" | "medium",
  "tone": "dry" | "warm" | "playful" | "low-key"
}

RULES:
- "silence" is NEVER valid here. Listener directly addressed Lena — she always responds.
- "callback" only if a recentShoutouts entry genuinely fits (e.g., listener's question relates to an earlier shoutout, OR the same listener appears recently).
- length_hint: short=4-25 words, medium=25-45.
- Tone tracks bucket: night/late-night → warm or low-key, morning → playful, afternoon → dry by default.
- callback_to must be a literal id from recentShoutouts, or null. Never invent.`;

export function buildChatProducerPrompt(ctx: ChatContext): { system: string; user: string } {
  const lines: string[] = [];
  lines.push(`Listener: ${ctx.trigger.handle}`);
  lines.push(`Message: "${ctx.trigger.text}"`);
  lines.push(`Local time: ${ctx.now.localTime} (${ctx.now.bucket})`);
  if (ctx.recentShoutouts.length === 0) {
    lines.push(`Recent shoutouts: (none in last 30 min)`);
  } else {
    lines.push(`Recent shoutouts (last 30 min):`);
    for (const s of ctx.recentShoutouts) {
      lines.push(`  - id=${s.id} (${s.handle}, ${s.minsAgo}min ago): ${s.originalText.slice(0, 60)}`);
    }
  }
  if (ctx.recentLenaLines.length > 0) {
    lines.push(`Recent Lena lines (for anti-echo awareness):`);
    for (const l of ctx.recentLenaLines.slice(0, 3)) {
      lines.push(`  - ${l.text.slice(0, 80)}`);
    }
  }
  lines.push("");
  lines.push("Emit the decision JSON now.");
  return { system: SYSTEM, user: lines.join("\n") };
}
```

Run prompt tests → 4/4 PASS.

- [ ] **Step 2: producer tests + impl**

```typescript
// lib/lena-producer-chat/producer.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { runChatProducer } from "./producer.ts";
import type { ChatContext } from "./chat-context.ts";

function ctx(): ChatContext {
  return {
    trigger: { source: "youtube_chat_mention", handle: "anna", text: "hey" },
    now: { localTime: "23:15", bucket: "night" },
    recentShoutouts: [{ id: "s1", handle: "bob", originalText: "hi", minsAgo: 5 }],
    recentLenaLines: [],
  };
}

test("runChatProducer happy path", async () => {
  const llm = async () => JSON.stringify({ mode: "answer", target_focus: "say hi back", callback_to: null, length_hint: "short", tone: "warm" });
  const d = await runChatProducer(ctx(), { llm });
  assert.equal(d.mode, "answer");
  assert.equal(d.tone, "warm");
});

test("runChatProducer rejects silence — retry then fallback to answer", async () => {
  let call = 0;
  const llm = async () => {
    call += 1;
    return JSON.stringify({ mode: "silence", target_focus: "", callback_to: null, length_hint: "short", tone: "low-key" });
  };
  const d = await runChatProducer(ctx(), { llm });
  assert.equal(call, 2); // retried once
  assert.equal(d.mode, "answer"); // safe default
});

test("runChatProducer: invalid JSON → retry → fallback to answer", async () => {
  const llm = async () => "garbage";
  const d = await runChatProducer(ctx(), { llm });
  assert.equal(d.mode, "answer");
});

test("runChatProducer: callback_to unknown id → stripped to null", async () => {
  const llm = async () => JSON.stringify({ mode: "callback", target_focus: "x", callback_to: "not_real", length_hint: "short", tone: "warm" });
  const d = await runChatProducer(ctx(), { llm });
  assert.equal(d.callbackTo, null);
});
```

```typescript
// lib/lena-producer-chat/producer.ts
import type { ChatContext } from "./chat-context.ts";
import type { ChatDecision } from "./modes.ts";
import { buildChatProducerPrompt } from "./producer-prompt.ts";

const VALID_MODES = ["answer", "callback"] as const;

export interface ChatProducerDeps {
  llm: (prompts: { system: string; user: string }) => Promise<string>;
}

function safeDefault(): ChatDecision {
  return { mode: "answer", targetFocus: "respond directly", callbackTo: null, lengthHint: "short", tone: "warm" };
}

function parseDecision(raw: string, validIds: ReadonlySet<string>): ChatDecision | null {
  let json: unknown;
  try {
    json = JSON.parse(raw.trim());
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  if (typeof o.mode !== "string") return null;
  if (!VALID_MODES.includes(o.mode as never)) return null;
  if (typeof o.target_focus !== "string") return null;
  if (typeof o.length_hint !== "string" || !["short", "medium"].includes(o.length_hint)) return null;
  if (typeof o.tone !== "string" || !["dry", "warm", "playful", "low-key"].includes(o.tone)) return null;
  const cb = typeof o.callback_to === "string" && validIds.has(o.callback_to) ? o.callback_to : null;
  return {
    mode: o.mode as ChatDecision["mode"],
    targetFocus: o.target_focus,
    callbackTo: cb,
    lengthHint: o.length_hint as ChatDecision["lengthHint"],
    tone: o.tone as ChatDecision["tone"],
  };
}

export async function runChatProducer(ctx: ChatContext, deps: ChatProducerDeps): Promise<ChatDecision> {
  const validIds = new Set(ctx.recentShoutouts.map((s) => s.id));
  const baseline = buildChatProducerPrompt(ctx);

  try {
    const raw = await deps.llm(baseline);
    const p = parseDecision(raw, validIds);
    if (p) return p;
  } catch { /* fall through */ }

  const reinforced = { system: baseline.system, user: `${baseline.user}\n\nIMPORTANT: Output strict JSON only. mode MUST be "answer" or "callback".` };
  try {
    const raw = await deps.llm(reinforced);
    const p = parseDecision(raw, validIds);
    if (p) return p;
  } catch { /* fall through */ }

  return safeDefault();
}
```

Run all producer tests → 4/4 PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/lena-producer-chat/producer-prompt.ts lib/lena-producer-chat/producer-prompt.test.ts lib/lena-producer-chat/producer.ts lib/lena-producer-chat/producer.test.ts
git commit -m "$(cat <<'EOF'
lena-producer-chat: producer prompt + runChatProducer

JSON-validating Producer for chat replies. silence is REJECTED
(direct mentions always get a response). Fallback to safe-default
answer/warm/short on parse failure.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Writers (answer + callback)

**Files:**
- Create: `lib/lena-producer-chat/writers/answer.ts` + `answer.test.ts`
- Create: `lib/lena-producer-chat/writers/callback.ts` + `callback.test.ts`

- [ ] **Step 1: Tests**

```typescript
// lib/lena-producer-chat/writers/answer.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildChatAnswerPrompt } from "./answer.ts";

const decision = { mode: "answer" as const, targetFocus: "say hi", callbackTo: null, lengthHint: "short" as const, tone: "warm" as const };
const ctx = {
  trigger: { source: "youtube_chat_mention" as const, handle: "anna", text: "hi lena" },
  now: { localTime: "23:15", bucket: "night" },
  recentShoutouts: [],
  recentLenaLines: [],
};

test("buildChatAnswerPrompt bans 'let it ride'", () => {
  const p = buildChatAnswerPrompt(decision, ctx);
  assert.match(p.system, /let it ride/i);
});

test("buildChatAnswerPrompt addresses listener by handle", () => {
  const p = buildChatAnswerPrompt(decision, ctx);
  assert.match(p.user, /anna/);
});

test("buildChatAnswerPrompt includes the original message", () => {
  const p = buildChatAnswerPrompt(decision, ctx);
  assert.match(p.user, /hi lena/);
});
```

```typescript
// lib/lena-producer-chat/writers/callback.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildChatCallbackPrompt } from "./callback.ts";

const decision = { mode: "callback" as const, targetFocus: "tie to bob's shoutout", callbackTo: "s1", lengthHint: "medium" as const, tone: "warm" as const };
const ctx = {
  trigger: { source: "youtube_chat_mention" as const, handle: "anna", text: "what was that last shoutout" },
  now: { localTime: "23:30", bucket: "night" },
  recentShoutouts: [{ id: "s1", handle: "bob", originalText: "hi from berlin", minsAgo: 5 }],
  recentLenaLines: [],
};

test("buildChatCallbackPrompt resolves callback_to to a recent shoutout description", () => {
  const p = buildChatCallbackPrompt(decision, ctx);
  assert.match(p.user, /bob/);
  assert.match(p.user, /berlin/);
});

test("buildChatCallbackPrompt bans 'let it ride'", () => {
  const p = buildChatCallbackPrompt(decision, ctx);
  assert.match(p.system, /let it ride/i);
});
```

- [ ] **Step 2: Implementations**

```typescript
// lib/lena-producer-chat/writers/answer.ts
import type { ChatDecision } from "../modes.ts";
import { LENGTH_WORDS } from "../modes.ts";
import type { ChatContext } from "../chat-context.ts";

const SYSTEM = `You write ONE spoken line for Lena replying to a YouTube live-chat listener.
She always replies — never silently. Warm, brief, in her DJ voice.

RULES:
- Contractions. Spoken English. No poetry. No "wandering piano lines" / "dawn peeking through curtains".
- Address the listener by their handle when natural. Don't force it.
- BANNED phrases: "let it ride", "we'll let it ride", "we'll take that one", "hope this reaches them", "going out to".
- Match tone + length exactly.

OUTPUT: one line. No quotes. No stage directions.`;

export function buildChatAnswerPrompt(decision: ChatDecision, ctx: ChatContext): { system: string; user: string } {
  const w = LENGTH_WORDS[decision.lengthHint];
  const lines: string[] = [];
  lines.push(`listener_handle: ${ctx.trigger.handle}`);
  lines.push(`listener_said: "${ctx.trigger.text}"`);
  lines.push(`local_time: ${ctx.now.localTime} (${ctx.now.bucket})`);
  lines.push(`target_focus: ${decision.targetFocus}`);
  lines.push(`tone: ${decision.tone}`);
  lines.push(`length: ${w.min}-${w.max} words`);
  if (ctx.recentLenaLines.length > 0) {
    lines.push(`recently_aired_lines (DO NOT echo phrasing):`);
    for (const l of ctx.recentLenaLines.slice(0, 3)) lines.push(`  - ${l.text}`);
  }
  lines.push("");
  lines.push("Write Lena's reply now.");
  return { system: SYSTEM, user: lines.join("\n") };
}
```

```typescript
// lib/lena-producer-chat/writers/callback.ts
import type { ChatDecision } from "../modes.ts";
import { LENGTH_WORDS } from "../modes.ts";
import type { ChatContext } from "../chat-context.ts";

const SYSTEM = `You write ONE spoken line for Lena replying to a YouTube live-chat listener.
She's tying her reply to something a different listener said earlier in the shift.

RULES:
- Contractions. Spoken English. No poetry.
- Acknowledge the new listener AND naturally reference the earlier shoutout.
- Don't say "earlier"; just weave it: "Anna — bob was just shouting out Berlin too…"
- BANNED phrases: "let it ride", "we'll let it ride", "we'll take that one", "hope this reaches them", "going out to".

OUTPUT: one line. No quotes. No stage directions.`;

export function buildChatCallbackPrompt(decision: ChatDecision, ctx: ChatContext): { system: string; user: string } {
  const w = LENGTH_WORDS[decision.lengthHint];
  const cb = ctx.recentShoutouts.find((s) => s.id === decision.callbackTo);
  const lines: string[] = [];
  lines.push(`listener_handle: ${ctx.trigger.handle}`);
  lines.push(`listener_said: "${ctx.trigger.text}"`);
  lines.push(`callback_to: ${cb ? `${cb.handle} (${cb.minsAgo}min ago): ${cb.originalText.slice(0, 60)}` : "(unresolved — drop the callback, write a direct answer)"}`);
  lines.push(`local_time: ${ctx.now.localTime} (${ctx.now.bucket})`);
  lines.push(`target_focus: ${decision.targetFocus}`);
  lines.push(`tone: ${decision.tone}`);
  lines.push(`length: ${w.min}-${w.max} words`);
  lines.push("");
  lines.push("Write Lena's reply now.");
  return { system: SYSTEM, user: lines.join("\n") };
}
```

Run all writer tests → 5/5 PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/lena-producer-chat/writers/
git commit -m "lena-producer-chat: answer + callback writer prompts

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Writer dispatcher + lenaSpeakChat entry point

**Files:**
- Create: `lib/lena-producer-chat/writer.ts` + tests
- Create: `lib/lena-producer-chat/index.ts` + tests

- [ ] **Step 1: writer.ts**

```typescript
// lib/lena-producer-chat/writer.ts
import type { ChatDecision } from "./modes.ts";
import type { ChatContext } from "./chat-context.ts";
import { buildChatAnswerPrompt } from "./writers/answer.ts";
import { buildChatCallbackPrompt } from "./writers/callback.ts";

export interface ChatWriterDeps {
  llm: (prompts: { system: string; user: string }) => Promise<string>;
}

export async function runChatWriter(decision: ChatDecision, ctx: ChatContext, deps: ChatWriterDeps): Promise<string | null> {
  const prompts = decision.mode === "answer"
    ? buildChatAnswerPrompt(decision, ctx)
    : buildChatCallbackPrompt(decision, ctx);
  const raw = await deps.llm(prompts);
  const text = raw.trim();
  return text || null;
}
```

```typescript
// lib/lena-producer-chat/writer.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { runChatWriter } from "./writer.ts";

const ctx = {
  trigger: { source: "youtube_chat_mention" as const, handle: "anna", text: "hi" },
  now: { localTime: "23:00", bucket: "night" },
  recentShoutouts: [],
  recentLenaLines: [],
};

test("runChatWriter answer mode calls answer prompt", async () => {
  const decision = { mode: "answer" as const, targetFocus: "x", callbackTo: null, lengthHint: "short" as const, tone: "warm" as const };
  const llm = async (p: { system: string }) => {
    assert.match(p.system, /always replies/i);
    return "hey anna!";
  };
  assert.equal(await runChatWriter(decision, ctx, { llm }), "hey anna!");
});

test("runChatWriter callback mode calls callback prompt", async () => {
  const decision = { mode: "callback" as const, targetFocus: "x", callbackTo: "s1", lengthHint: "short" as const, tone: "warm" as const };
  const llm = async (p: { system: string }) => {
    assert.match(p.system, /tying/i);
    return "hey anna, bob was on earlier too";
  };
  assert.match((await runChatWriter(decision, ctx, { llm })) ?? "", /bob/);
});
```

- [ ] **Step 2: index.ts (lenaSpeakChat)**

```typescript
// lib/lena-producer-chat/index.ts
import type { PrismaClient } from "@prisma/client";
import { fetchChatContext, type ChatTrigger } from "./chat-context.ts";
import { runChatProducer } from "./producer.ts";
import { runChatWriter } from "./writer.ts";

export interface LenaChatResult {
  text: string;
  mode: "answer" | "callback";
}

export interface LenaSpeakChatArgs {
  trigger: ChatTrigger;
  prisma: Pick<PrismaClient, "shoutout" | "chatter">;
  stationId: string;
  nowMs: number;
  llm: (prompts: { system: string; user: string }) => Promise<string>;
}

/**
 * Phase 3 public API for YouTube chat replies. Always returns a text
 * (or throws on hard failure) — silence is never a valid outcome.
 * Caller should fall back to legacy generateLenaReply() on null/throw.
 */
export async function lenaSpeakChat(args: LenaSpeakChatArgs): Promise<LenaChatResult | null> {
  let ctx;
  try {
    ctx = await fetchChatContext({
      prisma: args.prisma,
      stationId: args.stationId,
      trigger: args.trigger,
      nowMs: args.nowMs,
    });
  } catch {
    return null;
  }
  const decision = await runChatProducer(ctx, { llm: args.llm });
  try {
    const text = await runChatWriter(decision, ctx, { llm: args.llm });
    if (!text) return null;
    return { text, mode: decision.mode };
  } catch {
    return null;
  }
}
```

```typescript
// lib/lena-producer-chat/index.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { lenaSpeakChat } from "./index.ts";

const T0 = new Date("2026-05-16T23:15:00").getTime();

test("lenaSpeakChat happy path: Producer→Writer→{text, mode}", async () => {
  const fakePrisma = {
    shoutout: { findMany: async () => [] },
    chatter: { findMany: async () => [] },
  };
  let llmCall = 0;
  const llm = async (p: { system: string }) => {
    llmCall += 1;
    if (p.system.includes("you are the producer") || p.system.includes("You are the producer")) {
      return JSON.stringify({ mode: "answer", target_focus: "hi back", callback_to: null, length_hint: "short", tone: "warm" });
    }
    return "hey anna!";
  };
  const r = await lenaSpeakChat({
    trigger: { source: "youtube_chat_mention", handle: "anna", text: "hi lena" },
    prisma: fakePrisma as never,
    stationId: "s1",
    nowMs: T0,
    llm,
  });
  assert.ok(r);
  assert.equal(r!.text, "hey anna!");
  assert.equal(r!.mode, "answer");
  assert.equal(llmCall, 2);
});

test("lenaSpeakChat returns null when fetchChatContext throws", async () => {
  const fakePrisma = {
    shoutout: { findMany: async () => { throw new Error("db down"); } },
    chatter: { findMany: async () => [] },
  };
  const llm = async () => "n/a";
  const r = await lenaSpeakChat({
    trigger: { source: "youtube_chat_mention", handle: "anna", text: "hi" },
    prisma: fakePrisma as never,
    stationId: "s1",
    nowMs: T0,
    llm,
  });
  assert.equal(r, null);
});
```

Run tests → 4/4 PASS (2 writer + 2 index).

- [ ] **Step 3: Commit**

```bash
git add lib/lena-producer-chat/writer.ts lib/lena-producer-chat/writer.test.ts lib/lena-producer-chat/index.ts lib/lena-producer-chat/index.test.ts
git commit -m "$(cat <<'EOF'
lena-producer-chat: writer dispatcher + lenaSpeakChat public API

Ties Producer + Writer for chat replies. Returns null on
fetchChatContext throw OR Writer throw — caller falls back to
legacy generateLenaReply().

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Wire into youtube-chat-shoutout route

**Files:**
- Modify: `app/api/internal/youtube-chat-shoutout/route.ts` (around line 318-341, the `if (isReply)` block)

- [ ] **Step 1: Locate the existing reply path**

The route at `app/api/internal/youtube-chat-shoutout/route.ts:318-341` has:

```typescript
if (isReply) {
  const reply = await generateLenaReply(moderation.text, { displayName });
  if (!reply.text) {
    await prisma.shoutout.update({...failed...});
    return;
  }
  textToAir = reply.text;
  skipHumanize = true;
}
```

- [ ] **Step 2: Add imports near the top of the file**

```typescript
import { lenaSpeakChat } from "@/lib/lena-producer-chat";
import { isProducerReplyEnabled } from "@/lib/lena-producer-chat/feature-flag";
import { generateChatterScript } from "@/workers/queue-daemon/minimax-script";
```

Wait — `generateChatterScript` is in `workers/` which Vercel excludes. Use the MiniMax client pattern directly here OR extract a shared `lib/minimax-client.ts`. For Phase 3 the simplest path: create a tiny `lib/minimax-llm.ts` that wraps the same MiniMax call.

ACTUALLY simpler: reuse `generateLenaReply`'s underlying MiniMax pattern. It's the same fetch call shape. Or just write a thin local wrapper:

Create new file `lib/lena-producer-chat/minimax-llm.ts`:

```typescript
const MINIMAX_URL = "https://api.minimax.io/anthropic/v1/messages";
const MODEL = process.env.MINIMAX_HUMANIZE_MODEL ?? "MiniMax-M2.7";

export async function callMiniMaxJson(prompts: { system: string; user: string }, opts: { apiKey: string; fetcher?: typeof fetch } = { apiKey: process.env.MINIMAX_API_KEY ?? "" }): Promise<string> {
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

Commit this helper as a tiny prep step OR fold into the same wiring commit.

- [ ] **Step 3: Gate the existing reply path**

Replace the `if (isReply) { ... }` block with:

```typescript
if (isReply) {
  let producerResult: { text: string; mode: string } | null = null;

  if (isProducerReplyEnabled(process.env)) {
    try {
      const stationRow = await prisma.station.findUnique({ where: { slug: process.env.STATION_SLUG ?? "numaradio" }, select: { id: true } });
      if (stationRow) {
        producerResult = await lenaSpeakChat({
          trigger: { source: "youtube_chat_mention", handle: displayName ?? "anonymous", text: moderation.text },
          prisma,
          stationId: stationRow.id,
          nowMs: Date.now(),
          llm: (prompts) => callMiniMaxJson(prompts, { apiKey: process.env.MINIMAX_API_KEY ?? "" }),
        });
      }
    } catch (err) {
      console.warn("[lena-producer-chat] failed, falling back to legacy reply:", err);
    }
  }

  if (producerResult) {
    textToAir = producerResult.text;
    skipHumanize = true;
  } else {
    // Legacy fallback (also runs when flag is off)
    const reply = await generateLenaReply(moderation.text, { displayName });
    if (!reply.text) {
      await prisma.shoutout.update({ where: { id: shoutoutId }, data: { deliveryStatus: "failed", moderationReason: `reply_gen_${reply.reason}` } });
      console.warn(`yt-chat-shoutout: reply generation failed for ${shoutoutId} (${reply.reason})`);
      return;
    }
    textToAir = reply.text;
    skipHumanize = true;
  }
}
```

Add the `callMiniMaxJson` import at the top of the file.

- [ ] **Step 4: Type-check + test**

```bash
cd /home/marku/saas/numaradio && npx tsc --noEmit 2>&1 | grep "youtube-chat-shoutout\|lena-producer-chat" | head -10
```
Expected: clean (or only pre-existing errors).

```bash
npm test 2>&1 | grep -E "^(ℹ|# )" | tail -8
```
Expected: ~600+ pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/internal/youtube-chat-shoutout/route.ts lib/lena-producer-chat/minimax-llm.ts
git commit -m "$(cat <<'EOF'
youtube-chat-shoutout: gate reply path through Producer (Phase 3)

When LENA_PRODUCER_REPLY=on, the reply intent goes through
lenaSpeakChat (Producer + Writer split with recent-shoutouts context).
On Producer/Writer failure OR flag off, falls back to the existing
generateLenaReply path. Listener never sees worse than today's behavior.

Adds a tiny minimax-llm.ts wrapper since the daemon's
generateChatterScript lives in workers/ and Vercel excludes that dir.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: HANDOFF.md Phase 3 deploy notes

**Files:**
- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: Prepend section**

After first `---`, BEFORE the Phase 2.5 section:

```markdown
## 2026-05-16 — Lena Producer Phase 3: YouTube replies through Producer — CODE READY, NEEDS ENV

YouTube `@lena` chat replies now optionally route through the new
Producer + Writer pipeline (Producer-lite, runs Vercel-side because
`.vercelignore` excludes `workers/`). Behind `LENA_PRODUCER_REPLY`
flag, default off. When off, existing `generateLenaReply()` path is
unchanged.

**Spec:** `docs/superpowers/specs/2026-05-16-lena-producer-design.md`
**Plan:** `docs/superpowers/plans/2026-05-16-lena-producer-phase-3.md`

**What ships:**
- `lib/lena-producer-chat/` — sibling module to the daemon-side
  Producer. ChatContext fetched from Postgres (last 30min of
  Shoutouts + Chatter). Modes: `answer` (default) + `callback` (when
  a recent shoutout fits). No `silence` — direct mentions ALWAYS get
  a response (per the "Lena never ignores a direct mention" rule).
- `app/api/internal/youtube-chat-shoutout/route.ts:318-360` gated:
  flag on → try `lenaSpeakChat()`; on null/error → fall back to
  legacy `generateLenaReply()`.

**Deploy:**
1. `cd /home/marku/saas/numaradio && git pull`
2. Add `LENA_PRODUCER_REPLY=on` to Vercel env vars (Production +
   Preview), via dashboard or CLI:
   ```
   vercel env add LENA_PRODUCER_REPLY production
   # enter: on
   ```
3. Redeploy to pick up the env var (Vercel auto-redeploys on env
   change, or push a no-op commit).
4. Test: from a non-owner YouTube account on a live broadcast, send
   `@lena what are you spinning tonight` and confirm Lena's response
   addresses you by handle and feels conversational (not formulaic).
   Send a second `@lena thanks for that` and watch for `callback`
   mode kicking in if the first message landed as a shoutout.

**Rollback:** unset `LENA_PRODUCER_REPLY` in Vercel env, redeploy.
Legacy `generateLenaReply` resumes immediately.

**What to watch:**
- `[lena-producer-chat] failed, falling back to legacy reply:` in
  Vercel logs → Producer-side error (DB miss, MiniMax timeout,
  invalid JSON). Hardening can be added if frequent.
- Vercel function duration for `/api/internal/youtube-chat-shoutout`
  goes up by ~2 MiniMax calls (Producer + Writer) when flag on.
  Currently runs in `after()` so listener-side wait is unaffected.

**Next phase:** Phase 4 routes shoutout narration through Producer +
fixes the `,.` regex bug in `dashboard/lib/radio-host.ts` + scrubs
"let it ride" examples in `dashboard/lib/humanize.ts`.

---
```

- [ ] **Step 2: Commit**

```bash
git add docs/HANDOFF.md
git commit -m "docs: HANDOFF — Phase 3 (YouTube replies through Producer) deploy notes

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] **Step 1:** `npm test 2>&1 | grep -E "^(ℹ|# )" | tail -8` → ~605+ pass.
- [ ] **Step 2:** `npm run build 2>&1 | grep -E "(error|✓ Compiled)" | head -5` → ✓ Compiled.
- [ ] **Step 3:** DO NOT push.

---

## What ships at end of Phase 3

✅ `lib/lena-producer-chat/` Vercel-side Producer-lite
✅ ChatContext from DB (recent shoutouts + Lena lines, last 30min)
✅ Producer modes: answer + callback (no silence)
✅ Writers for both modes with banned-phrase list
✅ `LENA_PRODUCER_REPLY` flag (default off)
✅ Route gates Producer path with fallback to existing `generateLenaReply`
✅ Vercel function duration tolerated (runs in `after()`)

🔜 Phase 4 — shoutout narration through Producer + bug fixes
🔜 Phase 5 — QueueDirector + queue autonomy modes
