import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSweepSql, STALE_MINUTES } from "./sweeper.ts";

test("STALE_MINUTES is 20", () => {
  assert.equal(STALE_MINUTES, 20);
});

test("buildSweepSql resets processing rows older than 20 minutes", () => {
  const sql = buildSweepSql();
  assert.match(sql, /UPDATE "SongRequest"/);
  assert.match(sql, /SET "status" = 'queued'/);
  assert.match(sql, /"startedAt" = NULL/);
  assert.match(sql, /WHERE "status" = 'processing'/);
  assert.match(sql, /"startedAt" < NOW\(\) - INTERVAL '20 minutes'/);
});
