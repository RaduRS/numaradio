import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClaimSql } from "./claim.ts";

test("buildClaimSql updates one queued row atomically with SKIP LOCKED", () => {
  const sql = buildClaimSql();
  assert.match(sql, /UPDATE "SongRequest"/);
  assert.match(sql, /SET "status" = 'processing'/);
  assert.match(sql, /"startedAt" = NOW\(\)/);
  assert.match(sql, /WHERE "id" = \(/);
  assert.match(sql, /SELECT "id"/);
  assert.match(sql, /WHERE "status" = 'queued'/);
  assert.match(sql, /ORDER BY "createdAt" ASC/);
  assert.match(sql, /LIMIT 1/);
  assert.match(sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(sql, /RETURNING/);
});
