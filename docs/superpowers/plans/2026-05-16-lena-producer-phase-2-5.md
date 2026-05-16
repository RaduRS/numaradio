# Lena Producer — Phase 2.5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute task-by-task.

**Goal:** Extend `lib/classify-shoutout-intent.ts` from tri-state (shoutout | reply | noise) to 5-state, adding `"request"` and `"shoutout_with_request"`. Pure classifier change — no downstream dispatch logic changes in this phase. Phase 3 (YouTube reply routing) and Phase 5 (QueueDirector) will consume the new intents properly. Until then, downstream code paths treat unknown intents as shoutout-like (existing behavior), which is safe but suboptimal for raw `request` messages — Phase 3+5 fix that.

**Architecture:** Classifier extension only. The `IntentCategory` type grows, the SYSTEM_PROMPT teaches the model the two new shapes with examples, the `parseIntentReply` function recognizes two new decision tokens. The existing `Shoutout.create` + `isReply` branching at the dispatch endpoint (`app/api/internal/youtube-chat-shoutout/route.ts`) keeps working for the new intents (they fall through to the default shoutout path).

**Tech Stack:** TypeScript, MiniMax classifier, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-05-16-lena-producer-design.md`
**Prior phases:** Phase 1 (ShiftMemory) + Phase 2 (Producer/Writer) shipped locally.

---

## File Structure

### Modified

| File | What |
|---|---|
| `lib/classify-shoutout-intent.ts` | Extend `IntentCategory`, update `SYSTEM_PROMPT`, extend `parseIntentReply` to recognize new tokens |
| `lib/classify-shoutout-intent.test.ts` | Add tests for the 2 new categories — parser-level (no LLM hop) |
| `docs/HANDOFF.md` | Prepend Phase 2.5 deploy notes |

### Not modified (Phase 3/5)
- `app/api/internal/youtube-chat-shoutout/route.ts` — dispatcher stays as-is. Unknown intents fall through to shoutout path. Safe but suboptimal for raw `request`s; Phase 3+5 fix routing.
- ShiftEvent types — `youtube_mention.intent` already lists all 5 values (Phase 1 anticipated this).

---

## Task 1: Extend `IntentCategory` type + `parseIntentReply`

**Files:**
- Modify: `lib/classify-shoutout-intent.ts`
- Modify: `lib/classify-shoutout-intent.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `lib/classify-shoutout-intent.test.ts`:

```typescript
test("parseIntentReply: request category parses correctly", () => {
  const r = parseIntentReply('{"d":"request"}');
  assert.equal(r.category, "request");
  assert.equal(r.worthy, true);
  assert.equal(r.reason, "ok");
});

test("parseIntentReply: shoutout_with_request parses correctly", () => {
  const r = parseIntentReply('{"d":"shoutout_with_request"}');
  assert.equal(r.category, "shoutout_with_request");
  assert.equal(r.worthy, true);
  assert.equal(r.reason, "ok");
});

test("parseIntentReply: unknown decision still falls open to shoutout (back-compat)", () => {
  const r = parseIntentReply('{"d":"some_new_category_we_dont_know"}');
  assert.equal(r.category, "shoutout");
  assert.match(r.reason, /classifier_unknown/);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx tsx --test lib/classify-shoutout-intent.test.ts 2>&1 | tail -10`
Expected: FAIL on the 3 new tests (category values don't match because parser doesn't handle them yet, OR the IntentCategory type rejects them).

- [ ] **Step 3: Extend the type**

In `lib/classify-shoutout-intent.ts`, find:
```typescript
export type IntentCategory = "shoutout" | "reply" | "noise";
```

Replace with:
```typescript
export type IntentCategory = "shoutout" | "reply" | "noise" | "request" | "shoutout_with_request";
```

- [ ] **Step 4: Extend the parser**

Find the existing `parseIntentReply` function. Locate the decision-handling block (the if/else if chain on `decision`). After the existing `if (decision === "reply") { ... }` block, add:

```typescript
  if (decision === "request") {
    return { category: "request", worthy: true, reason: "ok" };
  }
  if (decision === "shoutout_with_request") {
    return { category: "shoutout_with_request", worthy: true, reason: "ok" };
  }
```

(Insert before the existing `if (decision === "noise") { ... }` block.)

- [ ] **Step 5: Run tests to verify pass**

Run: `npx tsx --test lib/classify-shoutout-intent.test.ts 2>&1 | tail -10`
Expected: PASS — all existing tests + 3 new.

- [ ] **Step 6: Commit**

```bash
git add lib/classify-shoutout-intent.ts lib/classify-shoutout-intent.test.ts
git commit -m "$(cat <<'EOF'
classify-shoutout-intent: extend to 5 categories (request + shoutout_with_request)

Adds two new intent categories the Phase 5 QueueDirector and Phase 3
YouTube reply routing will consume. Downstream dispatcher
(app/api/internal/youtube-chat-shoutout) is unchanged — new intents
fall through to the existing shoutout path, which is suboptimal for
raw 'play X' messages but safe (the message still airs).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Update `SYSTEM_PROMPT` with new categories + examples

**Files:**
- Modify: `lib/classify-shoutout-intent.ts`

- [ ] **Step 1: Locate the SYSTEM_PROMPT constant**

Find `const SYSTEM_PROMPT = \`...\`` near the top of the file.

- [ ] **Step 2: Update the prompt body**

Replace the existing decision list:
```
Decide one of THREE outcomes:

1. "shoutout" — ...
2. "reply" — ...
3. "noise" — ...
```

With FIVE outcomes:
```
Decide one of FIVE outcomes:

1. "shoutout" — the listener wants Lena to dedicate / shout out / read their message TO someone else (a friend, family, group). Lena narrates it on air.
2. "reply" — the message is for Lena herself (thank-you, comment, question, greeting). Lena answers conversationally.
3. "request" — the listener is asking Lena to play a specific song. Example tokens: "play X by Y", "can you play <song>", "queue up <track>". The message has NO personal sentiment or shoutout target — it is purely a song request.
4. "shoutout_with_request" — the message contains BOTH a personal shoutout/sentiment AND a song request. Example: "loving this set, can you play Aphex Twin?" → personal love + song request. Lena will read the shoutout AND queue the requested track.
5. "noise" — low-effort or empty. Skip silently.
```

Also extend the JSON output spec:
```
Reply with EXACTLY one of these JSON shapes, nothing else:
{"d":"shoutout"}
{"d":"reply"}
{"d":"request"}
{"d":"shoutout_with_request"}
{"d":"noise","r":"<short reason: lol|emoji|greeting|too_short|spam|test|empty>"}
```

And add new examples to the Examples block (after the existing examples, before the closing backtick):

```
"play hotel california by eagles" → {"d":"request"}
"can you play something dreamy" → {"d":"request"}
"queue up aphex twin please" → {"d":"request"}
"loving this set, can you play any synthwave?" → {"d":"shoutout_with_request"}
"this is the best playlist, play more from this artist" → {"d":"shoutout_with_request"}
"thanks for the vibes — can you put on the next album by the same group" → {"d":"shoutout_with_request"}
```

> Note: the existing example `"can you play something dreamy?" → {"d":"reply"}` conflicts with the new `request` category. Remove that line from the examples (or change it to map to `request`). The other existing reply examples (questions ABOUT Lena/show, compliments, greetings) stay.

- [ ] **Step 3: Verify the change parses cleanly**

Run: `npx tsx --test lib/classify-shoutout-intent.test.ts 2>&1 | tail -10`
Expected: All tests still pass.

Also run a quick lint/build check:
```bash
npx tsc --noEmit 2>&1 | grep "classify-shoutout-intent" | head -5
```
Expected: no errors from your changes.

- [ ] **Step 4: Commit**

```bash
git add lib/classify-shoutout-intent.ts
git commit -m "$(cat <<'EOF'
classify-shoutout-intent: SYSTEM_PROMPT teaches the 5-category set

Adds request + shoutout_with_request to the classifier's training
prompt with concrete examples. Updates the JSON output spec. Removes
the old "play something dreamy → reply" example (it now ambiguously
maps to request).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: HANDOFF.md Phase 2.5 deploy notes

**Files:**
- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: Prepend a new section**

After the first `---` divider, BEFORE the existing Phase 2 section, insert:

```markdown
## 2026-05-16 — Lena Producer Phase 2.5: Classifier extended to 5 categories — CODE READY, DEPLOYS WITH PHASE 2

Classifier-only change. No new flag — extension is always on. Downstream
dispatcher (`app/api/internal/youtube-chat-shoutout/route.ts`) treats the
new categories as shoutout-like for now (the message still airs). Phases
3 + 5 will route them properly through Producer + QueueDirector.

**Spec:** `docs/superpowers/specs/2026-05-16-lena-producer-design.md`
**Plan:** `docs/superpowers/plans/2026-05-16-lena-producer-phase-2-5.md`

**What ships:**
- `lib/classify-shoutout-intent.ts`: `IntentCategory` extends from 3 to 5
  (`shoutout | reply | noise` + `request | shoutout_with_request`).
  Parser handles the two new decision tokens. `SYSTEM_PROMPT` teaches
  the model the new categories with examples.

**Behavior change at the listener level:**
- Previously: "play hotel california by eagles" → classifier returned
  `reply` → Lena responded conversationally without queuing anything.
- Now: same message → classifier returns `request` → falls through to
  shoutout path → Lena reads the message as a shoutout. **This is
  suboptimal** (the listener wanted a song, not their message aired)
  but doesn't break anything. Phase 5 (QueueDirector) is when this
  intent actually triggers a queue insert.

**Deploy:** Code-only change, no env flag. Auto-applies on next deploy.
1. `cd /home/marku/saas/numaradio && git pull`
2. Public site auto-deploys on push (Vercel). No daemon restart needed —
   the classifier is called from the Vercel-side dispatch route.

**Rollback:** Revert the commits. Classifier reverts to 3-category set.
No DB or env changes to undo.

---
```

- [ ] **Step 2: Commit**

```bash
git add docs/HANDOFF.md
git commit -m "docs: HANDOFF — Phase 2.5 (classifier extension) deploy notes

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] **Step 1: Tests**
Run: `npm test 2>&1 | grep -E "^(ℹ|# )" | tail -8`
Expected: ~590+ pass, 1 skip, 1 pre-existing fail.

- [ ] **Step 2: Build**
Run: `npm run build 2>&1 | grep -E "(error|✓ Compiled)" | head -5`
Expected: `✓ Compiled successfully`.

- [ ] **Step 3: DO NOT push.**

---

## What ships at end of Phase 2.5

✅ Classifier extended to 5 categories
✅ Parser handles `request` + `shoutout_with_request` tokens
✅ SYSTEM_PROMPT teaches model with concrete examples
✅ Downstream dispatcher unchanged (new intents fall through to shoutout — safe)
✅ ShiftEvent.youtube_mention.intent type already accepts the new values (Phase 1 anticipated this)

🔜 Phase 3 routes YouTube replies (and reply-like intents) through lenaSpeak
🔜 Phase 5 routes request + shoutout_with_request through Producer with queue actions
