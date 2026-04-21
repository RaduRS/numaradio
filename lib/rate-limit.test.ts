import { test } from "node:test";
import assert from "node:assert/strict";

test("SONG_LIMITS is 1/hour and 3/day", async () => {
  // Dynamic import to bypass TypeScript path alias issues with node --test
  const { SONG_LIMITS } = await import("./rate-limit.ts");
  assert.equal(SONG_LIMITS.HOUR_LIMIT, 1);
  assert.equal(SONG_LIMITS.DAY_LIMIT, 3);
});
