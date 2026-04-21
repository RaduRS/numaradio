import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSweepSql, STALE_MINUTES } from "./sweeper.ts";

test("STALE_MINUTES is 10", () => {
  assert.equal(STALE_MINUTES, 10);
});

test("buildSweepSql resets processing rows older than 10 minutes", () => {
  const sql = buildSweepSql();
  assert.match(sql, /UPDATE "SongRequest"/);
  assert.match(sql, /SET "status" = 'queued'/);
  assert.match(sql, /"startedAt" = NULL/);
  assert.match(sql, /WHERE "status" = 'processing'/);
  assert.match(sql, /"startedAt" < NOW\(\) - INTERVAL '10 minutes'/);
});
