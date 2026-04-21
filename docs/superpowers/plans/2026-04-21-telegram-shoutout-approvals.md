# Telegram shoutout approvals via NanoClaw — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a listener's shoutout is moderator-held, page the operator in Telegram through NanoClaw's existing `@nanoOrion_bot`; let the agent interpret natural-language replies ("yep" / "nah") to approve or reject. Dashboard Held card keeps working and both paths converge on the same DB state.

**Architecture:** Vercel booth-submit fires a best-effort notify to a new dashboard internal route, which drops a JSON file into NanoClaw's IPC directory. NanoClaw's bot delivers a plain message to the operator's DM. The operator's reply is routed to the `telegram_main` agent, which curls new dashboard internal approve/reject routes that share code with the existing CF-Access routes.

**Tech Stack:** Next.js 16 (App Router) on the dashboard + on Vercel, `pg` (raw) on the dashboard, Prisma on Vercel, Node test runner with `--experimental-strip-types`, NanoClaw's IPC watcher (`data/ipc/<group>/messages/*.json`), systemd user unit for NanoClaw.

**Spec:** `docs/superpowers/specs/2026-04-21-telegram-shoutout-approvals-design.md`

---

## File structure

**New files (dashboard):**
- `dashboard/lib/ipc-writer.ts` — atomic JSON-file writer for NanoClaw IPC
- `dashboard/lib/ipc-writer.test.ts`
- `dashboard/lib/shoutouts-ops.ts` — shared `approveShoutout` / `rejectShoutout` helpers, conditional-UPDATE based
- `dashboard/lib/shoutouts-ops.test.ts`
- `dashboard/app/api/internal/shoutouts/[id]/approve/route.ts` — internal-secret-gated approve
- `dashboard/app/api/internal/shoutouts/[id]/reject/route.ts` — internal-secret-gated reject
- `dashboard/app/api/internal/shoutouts/held/route.ts` — GET list of held rows
- `dashboard/app/api/internal/shoutouts/held-notify/route.ts` — writes IPC file

**Modified files (dashboard):**
- `dashboard/app/api/shoutouts/[id]/approve/route.ts` — switch to shared helper
- `dashboard/app/api/shoutouts/[id]/reject/route.ts` — switch to shared helper
- `dashboard/.env.local` — add `NANOCLAW_IPC_DIR`, `TELEGRAM_OPERATOR_CHAT_JID`

**Modified files (Numa Radio root):**
- `app/api/booth/submit/route.ts` — fire-and-forget notify via `after()`
- `.env.local` — add `INTERNAL_HELD_NOTIFY_URL` (and Vercel env)

**Modified files (NanoClaw repo — separate git repo at `/home/marku/nanoclaw`):**
- `groups/telegram_main/CLAUDE.md` — "Held shoutout approvals" subsection
- `data/env/env` — add `INTERNAL_API_SECRET` (value from `/etc/numa/env`)

---

## Task 1: IPC writer helper (TDD)

**Files:**
- Create: `dashboard/lib/ipc-writer.ts`
- Test: `dashboard/lib/ipc-writer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `dashboard/lib/ipc-writer.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { writeIpcMessage } from "./ipc-writer.ts";

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "ipc-writer-test-"));
}

test("writeIpcMessage writes the expected JSON shape to <dir>/held-<id>.json", async () => {
  const dir = await tmpDir();
  try {
    await writeIpcMessage({
      dir,
      shoutoutId: "abc123",
      chatJid: "555",
      text: "hello",
    });
    const body = await fs.readFile(path.join(dir, "held-abc123.json"), "utf8");
    const parsed = JSON.parse(body);
    assert.deepEqual(parsed, {
      type: "message",
      chatJid: "555",
      text: "hello",
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("writeIpcMessage overwrites an existing file atomically (no .tmp left behind)", async () => {
  const dir = await tmpDir();
  try {
    await writeIpcMessage({ dir, shoutoutId: "x", chatJid: "1", text: "a" });
    await writeIpcMessage({ dir, shoutoutId: "x", chatJid: "1", text: "b" });
    const files = await fs.readdir(dir);
    assert.deepEqual(files.sort(), ["held-x.json"]);
    const parsed = JSON.parse(
      await fs.readFile(path.join(dir, "held-x.json"), "utf8"),
    );
    assert.equal(parsed.text, "b");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("writeIpcMessage rejects when the target directory does not exist", async () => {
  await assert.rejects(
    () =>
      writeIpcMessage({
        dir: "/nonexistent/does/not/exist",
        shoutoutId: "x",
        chatJid: "1",
        text: "a",
      }),
    /ENOENT/,
  );
});

test("writeIpcMessage rejects ids that contain path separators", async () => {
  const dir = await tmpDir();
  try {
    await assert.rejects(
      () =>
        writeIpcMessage({
          dir,
          shoutoutId: "../escape",
          chatJid: "1",
          text: "a",
        }),
      /invalid shoutout id/i,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

From `dashboard/`:

```bash
npm test -- --test-name-pattern="writeIpcMessage"
```

Expected: all four cases FAIL — "Cannot find module './ipc-writer.ts'".

- [ ] **Step 3: Implement the writer**

Create `dashboard/lib/ipc-writer.ts`:

```typescript
import fs from "node:fs/promises";
import path from "node:path";

export interface WriteIpcMessageInput {
  dir: string;
  shoutoutId: string;
  chatJid: string;
  text: string;
}

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export async function writeIpcMessage(input: WriteIpcMessageInput): Promise<void> {
  const { dir, shoutoutId, chatJid, text } = input;
  if (!ID_PATTERN.test(shoutoutId)) {
    throw new Error(`invalid shoutout id: ${shoutoutId}`);
  }
  const finalPath = path.join(dir, `held-${shoutoutId}.json`);
  const tmpPath = `${finalPath}.tmp`;
  const payload = JSON.stringify({ type: "message", chatJid, text });
  await fs.writeFile(tmpPath, payload, "utf8");
  await fs.rename(tmpPath, finalPath);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --test-name-pattern="writeIpcMessage"
```

Expected: 4 tests pass.

- [ ] **Step 5: Run the full test suite — nothing else should break**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add dashboard/lib/ipc-writer.ts dashboard/lib/ipc-writer.test.ts
git commit -m "feat(dashboard): add atomic IPC file writer for NanoClaw

Writes JSON messages into NanoClaw's per-group IPC directory with an
atomic tmp→rename, rejects path-traversal in the id component, and uses
a deterministic filename so retries overwrite instead of piling up."
```

---

## Task 2: Shared approve/reject helper with conditional UPDATE (TDD)

**Files:**
- Create: `dashboard/lib/shoutouts-ops.ts`
- Test: `dashboard/lib/shoutouts-ops.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `dashboard/lib/shoutouts-ops.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import { approveShoutout, rejectShoutout } from "./shoutouts-ops.ts";
import type {
  GenerateShoutoutFn,
  GenerateShoutoutResult,
} from "./shoutouts-ops.ts";

type Call = { sql: string; params: unknown[] };

interface FakePoolOpts {
  /** Sequence of query results in order of calls. */
  results: Array<{ rowCount?: number; rows?: unknown[] }>;
}

function fakePool(opts: FakePoolOpts): { pool: Pool; calls: Call[] } {
  const calls: Call[] = [];
  let i = 0;
  const pool = {
    query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      const r = opts.results[i++] ?? { rowCount: 0, rows: [] };
      return { rowCount: r.rowCount ?? (r.rows?.length ?? 0), rows: r.rows ?? [] };
    },
  } as unknown as Pool;
  return { pool, calls };
}

function okGenerator(): GenerateShoutoutFn {
  return async () => ({
    trackId: "t-1",
    queueItemId: "q-1",
    sourceUrl: "https://b2/file.mp3",
  }) satisfies GenerateShoutoutResult;
}

function failingGenerator(message: string): GenerateShoutoutFn {
  return async () => {
    throw new Error(message);
  };
}

test("approveShoutout returns not_found when no row exists", async () => {
  const { pool } = fakePool({
    results: [
      { rowCount: 0, rows: [] }, // conditional UPDATE
      { rowCount: 0, rows: [] }, // follow-up SELECT
    ],
  });
  const result = await approveShoutout({
    id: "missing",
    operator: "tester",
    pool,
    generate: okGenerator(),
  });
  assert.deepEqual(result, { ok: false, code: "not_found" });
});

test("approveShoutout returns already_aired when row is aired", async () => {
  const { pool } = fakePool({
    results: [
      { rowCount: 0, rows: [] },
      {
        rowCount: 1,
        rows: [{ id: "x", deliveryStatus: "aired", moderationStatus: "allowed" }],
      },
    ],
  });
  const result = await approveShoutout({
    id: "x",
    operator: "tester",
    pool,
    generate: okGenerator(),
  });
  assert.deepEqual(result, { ok: false, code: "already_aired" });
});

test("approveShoutout returns not_held when row is not in held state", async () => {
  const { pool } = fakePool({
    results: [
      { rowCount: 0, rows: [] },
      {
        rowCount: 1,
        rows: [{ id: "x", deliveryStatus: "blocked", moderationStatus: "blocked" }],
      },
    ],
  });
  const result = await approveShoutout({
    id: "x",
    operator: "tester",
    pool,
    generate: okGenerator(),
  });
  assert.deepEqual(result, { ok: false, code: "not_held" });
});

test("approveShoutout succeeds: flips held→allowed, generates, then marks aired", async () => {
  const { pool, calls } = fakePool({
    results: [
      {
        rowCount: 1,
        rows: [
          {
            id: "x",
            rawText: "hello world",
            cleanText: null,
            requesterName: "Mihai",
          },
        ],
      },
      { rowCount: 1, rows: [] }, // final UPDATE
    ],
  });
  const result = await approveShoutout({
    id: "x",
    operator: "telegram:nanoclaw",
    pool,
    generate: okGenerator(),
  });
  assert.deepEqual(result, {
    ok: true,
    trackId: "t-1",
    queueItemId: "q-1",
  });
  // First call is the conditional UPDATE; second is the aired UPDATE.
  assert.match(calls[0].sql, /UPDATE "Shoutout"[\s\S]*moderationStatus[\s\S]*'allowed'/);
  assert.match(calls[0].sql, /moderationStatus" = 'held'/);
  assert.match(calls[0].sql, /RETURNING/);
  assert.equal(calls[0].params[1], "approved_by:telegram:nanoclaw");
  assert.match(calls[1].sql, /deliveryStatus"    = 'aired'/);
});

test("approveShoutout marks row failed when generate throws", async () => {
  const { pool, calls } = fakePool({
    results: [
      {
        rowCount: 1,
        rows: [{ id: "x", rawText: "hi", cleanText: null, requesterName: null }],
      },
      { rowCount: 1, rows: [] }, // failure UPDATE
    ],
  });
  const result = await approveShoutout({
    id: "x",
    operator: "tester",
    pool,
    generate: failingGenerator("deepgram 500"),
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "generate_failed");
    assert.match(result.error ?? "", /deepgram 500/);
  }
  assert.match(calls[1].sql, /deliveryStatus"   = 'failed'/);
});

test("approveShoutout uses cleanText when present, otherwise rawText", async () => {
  let seenText = "";
  const generate: GenerateShoutoutFn = async (input) => {
    seenText = input.text;
    return { trackId: "t", queueItemId: "q", sourceUrl: "s" };
  };
  const { pool } = fakePool({
    results: [
      {
        rowCount: 1,
        rows: [
          {
            id: "x",
            rawText: "raw version",
            cleanText: "clean version",
            requesterName: null,
          },
        ],
      },
      { rowCount: 1, rows: [] },
    ],
  });
  await approveShoutout({ id: "x", operator: "t", pool, generate });
  assert.equal(seenText, "clean version");
});

test("rejectShoutout returns not_found / already_aired / not_held with same codes", async () => {
  const missing = fakePool({
    results: [
      { rowCount: 0 },
      { rowCount: 0, rows: [] },
    ],
  });
  assert.deepEqual(
    await rejectShoutout({ id: "missing", operator: "t", pool: missing.pool }),
    { ok: false, code: "not_found" },
  );

  const aired = fakePool({
    results: [
      { rowCount: 0 },
      { rowCount: 1, rows: [{ deliveryStatus: "aired", moderationStatus: "allowed" }] },
    ],
  });
  assert.deepEqual(
    await rejectShoutout({ id: "x", operator: "t", pool: aired.pool }),
    { ok: false, code: "already_aired" },
  );

  const blocked = fakePool({
    results: [
      { rowCount: 0 },
      { rowCount: 1, rows: [{ deliveryStatus: "blocked", moderationStatus: "blocked" }] },
    ],
  });
  assert.deepEqual(
    await rejectShoutout({ id: "x", operator: "t", pool: blocked.pool }),
    { ok: false, code: "not_held" },
  );
});

test("rejectShoutout succeeds and includes reasonHint in moderationReason", async () => {
  const { pool, calls } = fakePool({
    results: [{ rowCount: 1 }],
  });
  const result = await rejectShoutout({
    id: "x",
    operator: "telegram:nanoclaw",
    pool,
    reasonHint: "too aggressive",
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(
    calls[0].params[1],
    "rejected_by:telegram:nanoclaw reason=too aggressive",
  );
  assert.match(calls[0].sql, /moderationStatus" = 'held'/);
});

test("rejectShoutout clips reasonHint at 200 chars", async () => {
  const { pool, calls } = fakePool({ results: [{ rowCount: 1 }] });
  const longHint = "x".repeat(500);
  await rejectShoutout({
    id: "x",
    operator: "t",
    pool,
    reasonHint: longHint,
  });
  const reason = String(calls[0].params[1]);
  const hint = reason.replace(/^rejected_by:t reason=/, "");
  assert.equal(hint.length, 200);
});

test("concurrent double-approve: second call sees not_held", async () => {
  const first = fakePool({
    results: [
      {
        rowCount: 1,
        rows: [{ id: "x", rawText: "r", cleanText: null, requesterName: null }],
      },
      { rowCount: 1 },
    ],
  });
  const second = fakePool({
    results: [
      { rowCount: 0 },
      {
        rowCount: 1,
        rows: [{ deliveryStatus: "pending", moderationStatus: "allowed" }],
      },
    ],
  });
  const r1 = await approveShoutout({
    id: "x",
    operator: "a",
    pool: first.pool,
    generate: okGenerator(),
  });
  const r2 = await approveShoutout({
    id: "x",
    operator: "b",
    pool: second.pool,
    generate: okGenerator(),
  });
  assert.equal(r1.ok, true);
  assert.deepEqual(r2, { ok: false, code: "not_held" });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --test-name-pattern="approveShoutout|rejectShoutout|concurrent double-approve"
```

Expected: all cases FAIL — "Cannot find module './shoutouts-ops.ts'".

- [ ] **Step 3: Implement the helper**

Create `dashboard/lib/shoutouts-ops.ts`:

```typescript
import type { Pool } from "pg";

export type ApproveCode =
  | "not_found"
  | "already_aired"
  | "not_held"
  | "generate_failed";
export type RejectCode = "not_found" | "already_aired" | "not_held";

export interface GenerateShoutoutResult {
  trackId: string;
  sourceUrl: string;
  queueItemId: string;
  durationHintSeconds?: number;
}

export interface GenerateShoutoutInput {
  text: string;
  shoutoutRowId: string;
  requesterName?: string;
  pool: Pool;
}

export type GenerateShoutoutFn = (
  input: GenerateShoutoutInput,
) => Promise<GenerateShoutoutResult>;

export interface ApproveInput {
  id: string;
  operator: string;
  pool: Pool;
  generate: GenerateShoutoutFn;
}

export interface RejectInput {
  id: string;
  operator: string;
  pool: Pool;
  reasonHint?: string;
}

export type ApproveResult =
  | { ok: true; trackId: string; queueItemId: string }
  | { ok: false; code: ApproveCode; error?: string };

export type RejectResult =
  | { ok: true }
  | { ok: false; code: RejectCode };

async function classifyMissInto(
  pool: Pool,
  id: string,
): Promise<"not_found" | "already_aired" | "not_held"> {
  const { rows } = await pool.query<{
    deliveryStatus: string;
    moderationStatus: string;
  }>(
    `SELECT "deliveryStatus", "moderationStatus" FROM "Shoutout" WHERE id = $1 LIMIT 1`,
    [id],
  );
  if (rows.length === 0) return "not_found";
  if (rows[0].deliveryStatus === "aired") return "already_aired";
  return "not_held";
}

export async function approveShoutout(input: ApproveInput): Promise<ApproveResult> {
  const { id, operator, pool, generate } = input;
  const reserved = await pool.query<{
    id: string;
    rawText: string;
    cleanText: string | null;
    requesterName: string | null;
  }>(
    `UPDATE "Shoutout"
        SET "moderationStatus" = 'allowed',
            "moderationReason" = $2,
            "deliveryStatus"   = 'pending',
            "updatedAt"        = NOW()
      WHERE id = $1
        AND "moderationStatus" = 'held'
        AND "deliveryStatus"   != 'aired'
      RETURNING id, "rawText", "cleanText", "requesterName"`,
    [id, `approved_by:${operator}`],
  );

  if (reserved.rowCount === 0) {
    const code = await classifyMissInto(pool, id);
    return { ok: false, code };
  }

  const row = reserved.rows[0];
  const text = (row.cleanText ?? row.rawText).trim();

  try {
    const gen = await generate({
      text,
      shoutoutRowId: id,
      requesterName: row.requesterName ?? undefined,
      pool,
    });
    await pool.query(
      `UPDATE "Shoutout"
          SET "deliveryStatus"    = 'aired',
              "linkedQueueItemId" = $2,
              "broadcastText"     = $3,
              "updatedAt"         = NOW()
        WHERE id = $1`,
      [id, gen.queueItemId, text.slice(0, 500)],
    );
    return { ok: true, trackId: gen.trackId, queueItemId: gen.queueItemId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "generate_failed";
    await pool.query(
      `UPDATE "Shoutout"
          SET "deliveryStatus"   = 'failed',
              "moderationReason" = $2,
              "updatedAt"        = NOW()
        WHERE id = $1`,
      [id, msg.slice(0, 200)],
    );
    return { ok: false, code: "generate_failed", error: msg };
  }
}

export async function rejectShoutout(input: RejectInput): Promise<RejectResult> {
  const { id, operator, pool, reasonHint } = input;
  const clipped = reasonHint ? reasonHint.slice(0, 200) : undefined;
  const reason = clipped
    ? `rejected_by:${operator} reason=${clipped}`
    : `rejected_by:${operator}`;

  const res = await pool.query(
    `UPDATE "Shoutout"
        SET "moderationStatus" = 'blocked',
            "deliveryStatus"   = 'blocked',
            "moderationReason" = $2,
            "updatedAt"        = NOW()
      WHERE id = $1
        AND "moderationStatus" = 'held'`,
    [id, reason],
  );

  if (res.rowCount === 0) {
    const code = await classifyMissInto(pool, id);
    return { ok: false, code };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --test-name-pattern="approveShoutout|rejectShoutout|concurrent double-approve"
```

Expected: all 10 tests pass.

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```

Expected: all tests pass, no regressions.

- [ ] **Step 6: Commit**

```bash
git add dashboard/lib/shoutouts-ops.ts dashboard/lib/shoutouts-ops.test.ts
git commit -m "feat(dashboard): shared approve/reject helper with conditional UPDATE

Extracts the shoutout approve/reject logic into a reusable helper so the
CF-Access web routes and the new Telegram-driven internal routes share one
code path. The held-check is tightened from read-then-write into a
conditional UPDATE so two concurrent approvals cannot both proceed."
```

---

## Task 3: Refactor the CF-Access approve route to use the helper

**Files:**
- Modify: `dashboard/app/api/shoutouts/[id]/approve/route.ts`

- [ ] **Step 1: Rewrite the route to call the shared helper**

Replace `dashboard/app/api/shoutouts/[id]/approve/route.ts` with:

```typescript
import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import { approveShoutout } from "@/lib/shoutouts-ops";
import { generateShoutout, ShoutoutError } from "@/lib/shoutout";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const pool = getDbPool();
  const operator =
    req.headers.get("cf-access-authenticated-user-email") ?? "operator";

  const result = await approveShoutout({
    id,
    operator,
    pool,
    generate: async ({ text, shoutoutRowId, requesterName, pool: p }) => {
      try {
        return await generateShoutout({
          text,
          source: { kind: "booth", shoutoutRowId, requesterName },
          pool: p,
        });
      } catch (e) {
        if (e instanceof ShoutoutError) {
          throw new Error(`ShoutoutError:${e.status}:${e.code}:${e.message}`);
        }
        throw e;
      }
    },
  });

  if (!result.ok) {
    if (result.code === "not_found") {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }
    if (result.code === "already_aired") {
      return NextResponse.json(
        { ok: false, error: "already aired" },
        { status: 409 },
      );
    }
    if (result.code === "not_held") {
      return NextResponse.json(
        { ok: false, error: "not held" },
        { status: 409 },
      );
    }
    // generate_failed — decode the encoded ShoutoutError tuple so this
    // route's HTTP semantics match the pre-refactor behavior.
    const msg = result.error ?? "generate_failed";
    const m = msg.match(/^ShoutoutError:(\d+):([^:]+):(.+)$/s);
    if (m) {
      return NextResponse.json(
        { ok: false, error: m[3], code: m[2] },
        { status: Number(m[1]) || 500 },
      );
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  console.info(
    `action=shoutout-approve route=web row=${id} operator=${operator} queue=${result.queueItemId}`,
  );
  return NextResponse.json({
    ok: true,
    trackId: result.trackId,
    queueItemId: result.queueItemId,
  });
}
```

The inline try/catch around `generateShoutout` encodes the
`ShoutoutError` status/code/message into the string channel so the
helper can stay framework-agnostic (returns error strings, not
exceptions) while this route reconstructs the original HTTP response
shape.

- [ ] **Step 2: Build the dashboard to confirm no type or import regressions**

```bash
cd /home/marku/saas/numaradio/dashboard && npm run build
```

Expected: build completes cleanly.

- [ ] **Step 3: Run the tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add dashboard/app/api/shoutouts/\[id\]/approve/route.ts
git commit -m "refactor(dashboard): CF-Access approve route uses shared helper

Behavior unchanged from the operator's point of view; conditional-UPDATE
race-tightening is inherited from shoutouts-ops."
```

---

## Task 4: Refactor the CF-Access reject route

**Files:**
- Modify: `dashboard/app/api/shoutouts/[id]/reject/route.ts`

- [ ] **Step 1: Rewrite the route**

Replace the body of `dashboard/app/api/shoutouts/[id]/reject/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import { rejectShoutout } from "@/lib/shoutouts-ops";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const pool = getDbPool();
  const operator =
    req.headers.get("cf-access-authenticated-user-email") ?? "operator";

  const result = await rejectShoutout({ id, operator, pool });

  if (!result.ok) {
    if (result.code === "not_found") {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }
    return NextResponse.json(
      { ok: false, error: result.code === "already_aired" ? "already aired" : "not held" },
      { status: 409 },
    );
  }

  console.info(`action=shoutout-reject route=web row=${id} operator=${operator}`);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Run build + tests**

```bash
cd /home/marku/saas/numaradio/dashboard && npm run build && npm test
```

Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add dashboard/app/api/shoutouts/\[id\]/reject/route.ts
git commit -m "refactor(dashboard): CF-Access reject route uses shared helper"
```

---

## Task 5: Internal approve route (x-internal-secret-gated)

**Files:**
- Create: `dashboard/app/api/internal/shoutouts/[id]/approve/route.ts`

- [ ] **Step 1: Implement the route**

Create `dashboard/app/api/internal/shoutouts/[id]/approve/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getDbPool } from "@/lib/db";
import { approveShoutout } from "@/lib/shoutouts-ops";
import { generateShoutout, ShoutoutError } from "@/lib/shoutout";

export const dynamic = "force-dynamic";

function authOk(req: Request): boolean {
  const expected = process.env.INTERNAL_API_SECRET;
  if (!expected) return false;
  const got = req.headers.get("x-internal-secret") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!authOk(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const pool = getDbPool();

  const result = await approveShoutout({
    id,
    operator: "telegram:nanoclaw",
    pool,
    generate: async ({ text, shoutoutRowId, requesterName, pool: p }) => {
      try {
        return await generateShoutout({
          text,
          source: { kind: "booth", shoutoutRowId, requesterName },
          pool: p,
        });
      } catch (e) {
        if (e instanceof ShoutoutError) {
          throw new Error(`ShoutoutError:${e.status}:${e.code}:${e.message}`);
        }
        throw e;
      }
    },
  });

  if (!result.ok) {
    const status =
      result.code === "not_found" ? 404 :
      result.code === "already_aired" || result.code === "not_held" ? 409 :
      500;
    return NextResponse.json(
      { ok: false, error: result.code, detail: result.error },
      { status },
    );
  }

  console.info(
    `action=shoutout-approve route=internal row=${id} operator=telegram:nanoclaw queue=${result.queueItemId}`,
  );
  return NextResponse.json({
    ok: true,
    trackId: result.trackId,
    queueItemId: result.queueItemId,
  });
}
```

- [ ] **Step 2: Build to confirm types compile**

```bash
cd /home/marku/saas/numaradio/dashboard && npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add dashboard/app/api/internal/shoutouts/\[id\]/approve/route.ts
git commit -m "feat(dashboard): internal approve route gated by INTERNAL_API_SECRET

Reachable via tunnel at api.numaradio.com/api/internal/shoutouts/<id>/approve
and via host-network from NanoClaw containers at
host.docker.internal:3001. Authenticates with a constant-time comparison
against INTERNAL_API_SECRET."
```

---

## Task 6: Internal reject route

**Files:**
- Create: `dashboard/app/api/internal/shoutouts/[id]/reject/route.ts`

- [ ] **Step 1: Implement the route**

Create `dashboard/app/api/internal/shoutouts/[id]/reject/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getDbPool } from "@/lib/db";
import { rejectShoutout } from "@/lib/shoutouts-ops";

export const dynamic = "force-dynamic";

function authOk(req: Request): boolean {
  const expected = process.env.INTERNAL_API_SECRET;
  if (!expected) return false;
  const got = req.headers.get("x-internal-secret") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!authOk(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

  let body: { reasonHint?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    // empty body is fine
  }
  const reasonHint =
    typeof body.reasonHint === "string" && body.reasonHint.trim().length > 0
      ? body.reasonHint.trim()
      : undefined;

  const result = await rejectShoutout({
    id,
    operator: "telegram:nanoclaw",
    pool: getDbPool(),
    reasonHint,
  });

  if (!result.ok) {
    const status =
      result.code === "not_found" ? 404 :
      409;
    return NextResponse.json({ ok: false, error: result.code }, { status });
  }

  console.info(
    `action=shoutout-reject route=internal row=${id} operator=telegram:nanoclaw hint=${reasonHint ?? ""}`,
  );
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Build**

```bash
cd /home/marku/saas/numaradio/dashboard && npm run build
```

Expected: builds cleanly.

- [ ] **Step 3: Commit**

```bash
git add dashboard/app/api/internal/shoutouts/\[id\]/reject/route.ts
git commit -m "feat(dashboard): internal reject route gated by INTERNAL_API_SECRET

Takes an optional reasonHint body that gets appended to the audit reason
string. Same auth model as the internal approve route."
```

---

## Task 7: Internal held-list route (GET)

**Files:**
- Create: `dashboard/app/api/internal/shoutouts/held/route.ts`

- [ ] **Step 1: Implement the route**

Create `dashboard/app/api/internal/shoutouts/held/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getDbPool } from "@/lib/db";

export const dynamic = "force-dynamic";

function authOk(req: Request): boolean {
  const expected = process.env.INTERNAL_API_SECRET;
  if (!expected) return false;
  const got = req.headers.get("x-internal-secret") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(req: Request): Promise<NextResponse> {
  if (!authOk(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const pool = getDbPool();
  const { rows } = await pool.query(
    `SELECT id,
            "rawText"           AS "rawText",
            "requesterName"     AS "requesterName",
            "moderationReason"  AS "moderationReason",
            "createdAt"         AS "createdAt"
       FROM "Shoutout"
      WHERE "moderationStatus" = 'held'
      ORDER BY "createdAt" DESC
      LIMIT 10`,
  );
  return NextResponse.json({ ok: true, held: rows });
}
```

- [ ] **Step 2: Build**

```bash
cd /home/marku/saas/numaradio/dashboard && npm run build
```

Expected: builds cleanly.

- [ ] **Step 3: Commit**

```bash
git add dashboard/app/api/internal/shoutouts/held/route.ts
git commit -m "feat(dashboard): internal GET /shoutouts/held for agent disambiguation"
```

---

## Task 8: Internal held-notify route

**Files:**
- Create: `dashboard/app/api/internal/shoutouts/held-notify/route.ts`

- [ ] **Step 1: Implement the route**

Create `dashboard/app/api/internal/shoutouts/held-notify/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { writeIpcMessage } from "@/lib/ipc-writer";

export const dynamic = "force-dynamic";

function authOk(req: Request): boolean {
  const expected = process.env.INTERNAL_API_SECRET;
  if (!expected) return false;
  const got = req.headers.get("x-internal-secret") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function formatTelegramText(input: {
  rawText: string;
  cleanText?: string;
  requesterName?: string;
  moderationReason?: string;
  id: string;
}): string {
  const from = input.requesterName?.trim() || "anonymous";
  const bodyText = (input.cleanText?.trim() || input.rawText.trim()).slice(0, 300);
  const reason = input.moderationReason?.trim() || "no specific reason";
  return [
    "🎙 *Held shoutout awaiting your call*",
    "",
    `From: ${from}`,
    `_"${bodyText}"_`,
    "",
    `Moderator flagged: ${reason}`,
    "",
    `ID: \`${input.id}\``,
    "",
    "Reply *yes* to air or *no* to block.",
  ].join("\n");
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!authOk(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const ipcDir = process.env.NANOCLAW_IPC_DIR;
  const chatJid = process.env.TELEGRAM_OPERATOR_CHAT_JID;
  if (!ipcDir || !chatJid) {
    console.warn(
      "held-notify: NANOCLAW_IPC_DIR or TELEGRAM_OPERATOR_CHAT_JID not set; skipping",
    );
    return NextResponse.json(
      { ok: false, error: "not_configured" },
      { status: 503 },
    );
  }

  let body: {
    id?: unknown;
    rawText?: unknown;
    cleanText?: unknown;
    requesterName?: unknown;
    moderationReason?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id : "";
  const rawText = typeof body.rawText === "string" ? body.rawText : "";
  if (!id || !rawText) {
    return NextResponse.json(
      { ok: false, error: "id_and_rawText_required" },
      { status: 400 },
    );
  }

  try {
    await writeIpcMessage({
      dir: ipcDir,
      shoutoutId: id,
      chatJid,
      text: formatTelegramText({
        id,
        rawText,
        cleanText: typeof body.cleanText === "string" ? body.cleanText : undefined,
        requesterName:
          typeof body.requesterName === "string" ? body.requesterName : undefined,
        moderationReason:
          typeof body.moderationReason === "string"
            ? body.moderationReason
            : undefined,
      }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ipc_write_failed";
    console.error(`held-notify: ipc write failed row=${id} err=${msg}`);
    return NextResponse.json(
      { ok: false, error: "ipc_write_failed", detail: msg },
      { status: 500 },
    );
  }

  console.info(`action=held-notify row=${id}`);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Build**

```bash
cd /home/marku/saas/numaradio/dashboard && npm run build
```

Expected: builds cleanly.

- [ ] **Step 3: Commit**

```bash
git add dashboard/app/api/internal/shoutouts/held-notify/route.ts
git commit -m "feat(dashboard): held-notify route writes NanoClaw IPC message

Receives shoutout metadata from Vercel's booth-submit, formats a
Telegram-markdown message, and atomically writes a JSON file into
\$NANOCLAW_IPC_DIR for NanoClaw to deliver through @nanoOrion_bot."
```

---

## Task 9: Vercel booth-submit fires notify after response

**Files:**
- Modify: `app/api/booth/submit/route.ts`

- [ ] **Step 1: Verify the Next.js 16 `after` API exists in this repo**

Per the repo convention in `AGENTS.md`, breaking changes may apply.
Confirm the symbol is exported:

```bash
grep -r "export.*function after" /home/marku/saas/numaradio/node_modules/next/dist/server/after 2>/dev/null | head -3
grep -rE "\"after\"" /home/marku/saas/numaradio/node_modules/next/dist/docs/ 2>/dev/null | head -3
```

Expected: at least one match. The plan uses `import { after } from "next/server"` — if that specific import path has changed in Next 16, adjust the import below but keep the semantics (schedule the fetch after the response has been returned).

- [ ] **Step 2: Add the notify call**

In `app/api/booth/submit/route.ts`, add at the top with the other imports:

```typescript
import { after } from "next/server";
```

Then replace the existing `held` branch (the block that currently just
returns `{ ok: true, status: "held", ... }`) with:

```typescript
  if (moderation.decision === "held") {
    const notifyUrl =
      process.env.INTERNAL_HELD_NOTIFY_URL ??
      "https://api.numaradio.com/api/internal/shoutouts/held-notify";
    const secret = process.env.INTERNAL_API_SECRET;
    if (secret) {
      after(async () => {
        try {
          const res = await fetch(notifyUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-internal-secret": secret,
            },
            body: JSON.stringify({
              id: shoutout.id,
              rawText,
              cleanText:
                moderation.decision === "rewritten" ? moderation.text : undefined,
              requesterName: requesterName ?? undefined,
              moderationReason: moderation.reason ?? undefined,
            }),
          });
          if (!res.ok) {
            console.warn(
              `booth-submit: held-notify returned ${res.status} for ${shoutout.id}`,
            );
          }
        } catch (e) {
          console.warn(
            `booth-submit: held-notify fetch failed for ${shoutout.id}: ${
              e instanceof Error ? e.message : "unknown"
            }`,
          );
        }
      });
    } else {
      console.warn(
        `booth-submit: INTERNAL_API_SECRET missing; skipping held-notify for ${shoutout.id}`,
      );
    }

    return NextResponse.json({
      ok: true,
      status: "held",
      message: publicMessageFor("held"),
      shoutoutId: shoutout.id,
    });
  }
```

The `after` call schedules the fetch to run once the public response
has been returned, so the listener doesn't wait for NanoClaw's path to
complete. Failures are logged and ignored — the dashboard Held card is
still authoritative.

- [ ] **Step 3: Build from the repo root**

```bash
cd /home/marku/saas/numaradio && npm run build
```

Expected: root app builds cleanly (Next 16 may emit a warning if `after`
is in a non-dynamic route — the route is already `force-dynamic`, so no
warning expected).

- [ ] **Step 4: Commit**

```bash
git add app/api/booth/submit/route.ts
git commit -m "feat(booth): notify dashboard held-notify after public response

When moderation holds a shoutout, Vercel fires a best-effort call to
the dashboard's held-notify route after returning the listener's
response. This causes a Telegram ping via NanoClaw without adding any
latency to the public path."
```

---

## Task 10: NanoClaw agent instructions

**Files:**
- Modify (separate repo): `/home/marku/nanoclaw/groups/telegram_main/CLAUDE.md`

- [ ] **Step 1: Append the approvals subsection**

Open `/home/marku/nanoclaw/groups/telegram_main/CLAUDE.md`. Locate the
existing `## Numa Radio` section. After the existing "Shoutout (host
voice — Lena)" subsection, append this new subsection verbatim:

```markdown
### Held shoutout approvals

Sometimes the bot will post a plain message starting with "🎙 *Held
shoutout awaiting your call*". This is a listener-submitted shoutout
that the MiniMax moderator flagged for operator review. The message
contains the shoutout ID in backticks, e.g. ``ID: `abc123` ``. The
operator will reply in natural language.

When the operator's reply is clearly **approval** — any of: yes, yeah,
yep, ok, okay, sure, do it, send it, air it, go, go ahead, play it — run
this curl to air the shoutout:

```
curl -sS -X POST http://host.docker.internal:3001/api/internal/shoutouts/<id>/approve \
  -H "x-internal-secret: $INTERNAL_API_SECRET"
```

When the reply is clearly **rejection** — any of: no, nah, don't, dont,
stop, block, skip, kill it, hold off, not this one, reject — run:

```
curl -sS -X POST http://host.docker.internal:3001/api/internal/shoutouts/<id>/reject \
  -H "x-internal-secret: $INTERNAL_API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"reasonHint":"<short verbatim snippet of why, if they gave one>"}'
```

If the reply is ambiguous (e.g. just "yes" but the last few messages
referred to multiple held shoutouts, or the operator is replying much
later than the original ping), first list the currently held items:

```
curl -sS http://host.docker.internal:3001/api/internal/shoutouts/held \
  -H "x-internal-secret: $INTERNAL_API_SECRET"
```

and ask the operator which one they mean (by number, requester name, or
quote). Do not guess silently.

Interpret the response from approve/reject:

- 2xx with `{"ok":true}`: read back a one-line confirmation. For
  approve: "Approved — Lena is reading it now." For reject: "Blocked."
- 409 with `{"error":"already_aired"}` or `{"error":"not_held"}`: the
  shoutout was already handled on the dashboard. Tell the operator
  "Looks like you already handled that one on the dashboard."
- 404: the ID is stale. Check the held list, apologize for the
  confusion, and ask which one they mean.
- Other errors: surface the error message to the operator verbatim
  ("Approval failed: <error>"). Do not retry automatically — let the
  operator decide.

Do not approve or reject without a clear yes/no from the operator. Do
not answer "what's airing?" or "show me held shoutouts" by running
approve/reject — those are read-only questions; use the held list if
needed.
```

- [ ] **Step 2: Commit in the NanoClaw repo**

```bash
cd /home/marku/nanoclaw
git add groups/telegram_main/CLAUDE.md
git commit -m "docs(telegram_main): held shoutout approvals flow

Adds instructions for the agent to interpret yes/no replies against
'🎙 Held shoutout awaiting your call' messages and to hit the dashboard's
new internal approve/reject routes accordingly."
```

No NanoClaw restart is required — CLAUDE.md is read by the container at
each agent turn.

---

## Task 11: NanoClaw env — add INTERNAL_API_SECRET

**Files:**
- Modify: `/home/marku/nanoclaw/data/env/env`

- [ ] **Step 1: Read the canonical value**

```bash
sudo grep ^INTERNAL_API_SECRET= /etc/numa/env
```

Expected: one line like `INTERNAL_API_SECRET=<hex64>`. Copy the value.

- [ ] **Step 2: Append it to the NanoClaw env file**

```bash
echo "INTERNAL_API_SECRET=<paste value here>" >> /home/marku/nanoclaw/data/env/env
```

Verify:

```bash
grep ^INTERNAL_API_SECRET= /home/marku/nanoclaw/data/env/env
```

Expected: the line prints, with the value matching `/etc/numa/env`.

- [ ] **Step 3: Restart NanoClaw**

```bash
systemctl --user restart nanoclaw
systemctl --user status nanoclaw --no-pager | head -10
```

Expected: `active (running)`.

- [ ] **Step 4: No commit**

`data/env/env` is not checked into git (it contains secrets; verified in
Task 0 by grepping `.gitignore`). Skip the commit step for this task.

---

## Task 12: Dashboard env vars

**Files:**
- Modify: `/home/marku/saas/numaradio/dashboard/.env.local`

- [ ] **Step 1: Resolve the operator's Telegram chat JID**

The `telegram_main` group is registered under one JID that matches the
operator's DM. Read it from NanoClaw's group registry:

```bash
ls /home/marku/nanoclaw/data/sessions 2>/dev/null
grep -rE "telegram_main" /home/marku/nanoclaw/data 2>/dev/null | head -5
```

If the jid is not obvious from file contents, send any message to
`@nanoOrion_bot` once and check:

```bash
journalctl --user -u nanoclaw -n 50 --no-pager | grep -iE "chatJid|telegram_main"
```

The jid is a numeric string. Record it.

- [ ] **Step 2: Append env vars**

Append to `/home/marku/saas/numaradio/dashboard/.env.local` (the file
already exists; `EnvironmentFile=` in the systemd unit reads it):

```
NANOCLAW_IPC_DIR=/home/marku/nanoclaw/data/ipc/telegram_main/messages
TELEGRAM_OPERATOR_CHAT_JID=<paste the jid here>
```

Verify the IPC directory exists and is writable by `marku`:

```bash
mkdir -p /home/marku/nanoclaw/data/ipc/telegram_main/messages
ls -ld /home/marku/nanoclaw/data/ipc/telegram_main/messages
touch /home/marku/nanoclaw/data/ipc/telegram_main/messages/.writable-check && rm /home/marku/nanoclaw/data/ipc/telegram_main/messages/.writable-check
```

Expected: owner `marku`, the touch + rm succeeds silently.

- [ ] **Step 3: Also add INTERNAL_API_SECRET to Vercel**

`INTERNAL_API_SECRET` is already set on Vercel (used by existing booth
forwarding). `INTERNAL_HELD_NOTIFY_URL` is optional — the default in
code points at `api.numaradio.com/api/internal/shoutouts/held-notify`,
which is already tunneled to the dashboard. No Vercel env change is
strictly required for this feature. Skip.

- [ ] **Step 4: No commit**

`.env.local` is git-ignored. Skip the commit step.

---

## Task 13: Deploy + end-to-end smoke test

- [ ] **Step 1: Deploy the dashboard**

```bash
cd /home/marku/saas/numaradio/dashboard && npm run deploy
```

Expected: `✓ dashboard deployed`. (Requires the `numa-nopasswd` sudoers
drop-in from the handoff to be installed — it is.)

- [ ] **Step 2: Sanity-check the new routes are live**

```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3001/api/internal/shoutouts/held
# Expected: 401 (no secret header)

curl -sS -H "x-internal-secret: $(sudo grep ^INTERNAL_API_SECRET= /etc/numa/env | cut -d= -f2)" \
  http://127.0.0.1:3001/api/internal/shoutouts/held | head -c 200
# Expected: {"ok":true,"held":[...]}

curl -sS -H "x-internal-secret: $(sudo grep ^INTERNAL_API_SECRET= /etc/numa/env | cut -d= -f2)" \
  http://127.0.0.1:3001/api/internal/shoutouts/held-notify \
  -X POST -H "Content-Type: application/json" \
  -d '{"id":"smoke-test-1","rawText":"This is a smoke test"}'
# Expected: {"ok":true}
# And: ls /home/marku/nanoclaw/data/ipc/telegram_main/messages/held-smoke-test-1.json
#      (file will be consumed by NanoClaw; if it arrives in Telegram, delete there.)
```

If the smoke-test row arrived in your Telegram DM, that confirms the
full IPC → NanoClaw → Telegram path is wired. Reply "ignore that" to
the bot to dismiss (the agent will skip because the id isn't real).

- [ ] **Step 3: Deploy Vercel changes**

```bash
cd /home/marku/saas/numaradio
git push origin main
```

Vercel auto-deploys on push.

- [ ] **Step 4: Live end-to-end walk-through**

On `numaradio.com`, submit a shoutout deliberately worded to be held
(a mild profanity that the MiniMax moderator flags but doesn't outright
block — based on past behavior, something like *"shoutout to everyone
still fucking awake at 3am"* tends to land `held`).

Expected:
1. Public form returns "A moderator will review your shoutout".
2. Within a few seconds, Telegram DM from `@nanoOrion_bot` with the
   "🎙 Held shoutout awaiting your call" message.
3. Reply "yep".
4. Agent replies "Approved — Lena is reading it now."
5. Within the next track boundary, Lena airs the shoutout on the live
   stream (listen on numaradio.com or curl `/stream`).
6. Dashboard `/shoutouts` Held card no longer shows the row.

- [ ] **Step 5: Rejection flow**

Submit another shoutout that gets held. Reply "no too aggressive".

Expected:
1. Agent replies "Blocked."
2. Dashboard `/shoutouts` Recent panel shows the row with
   `moderationStatus='blocked'` and `moderationReason` containing
   `rejected_by:telegram:nanoclaw reason=too aggressive`.

- [ ] **Step 6: Web-first race**

Submit another held shoutout. Approve it on the dashboard Held card
first, then reply "yes" on Telegram.

Expected:
1. Dashboard approval airs the shoutout (same as before).
2. Telegram agent replies "Looks like you already handled that one on
   the dashboard." (409 path.)

- [ ] **Step 7: Multiple-held disambiguation**

Submit two held shoutouts back-to-back (wait ~20s between them so both
pings land). Reply "yes".

Expected: agent calls `GET /held`, lists both items, asks which. Then
approve whichever the operator names.

- [ ] **Step 8: If any step fails, log and open an issue**

For each failure capture:
- `journalctl -u numa-dashboard -n 100 --no-pager` (dashboard logs)
- `journalctl --user -u nanoclaw -n 100 --no-pager` (NanoClaw logs)
- Vercel function log for the `/api/booth/submit` invocation

Then decide: is the bug in Numa Radio (fix and re-deploy) or in
NanoClaw (fix the agent instructions in `groups/telegram_main/CLAUDE.md`
and rely on the agent to re-read them on its next turn)? Both repos are
under direct-to-main — commit the fix and re-test.

---

## Rollback

If the feature is causing problems, rollback is one Vercel revert plus
one dashboard revert:

```bash
# Numa Radio repo
cd /home/marku/saas/numaradio
git revert <commit of Task 9>
git push

# Dashboard deploy rollback
cd /home/marku/saas/numaradio/dashboard && npm run deploy
```

The Vercel revert turns off Telegram pings. The dashboard revert is
optional — the internal routes become dead code but harmless; the
CF-Access routes continue to work via the shared helper. The NanoClaw
CLAUDE.md can stay in place; without the Telegram ping, the agent never
sees a trigger.
