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
