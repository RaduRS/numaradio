import { test } from "node:test";
import assert from "node:assert/strict";

test("parseShoutoutStash: valid round-trip", async () => {
  const { parseShoutoutStash } = await import("./booth-stash.ts");
  const got = parseShoutoutStash(
    JSON.stringify({ shoutoutId: "abc123", submittedAt: 1714000000000 }),
  );
  assert.deepEqual(got, { shoutoutId: "abc123", submittedAt: 1714000000000 });
});

test("parseShoutoutStash: null/empty/garbage → null", async () => {
  const { parseShoutoutStash } = await import("./booth-stash.ts");
  assert.equal(parseShoutoutStash(null), null);
  assert.equal(parseShoutoutStash(""), null);
  assert.equal(parseShoutoutStash("not json"), null);
  assert.equal(parseShoutoutStash("[]"), null);
  assert.equal(parseShoutoutStash("null"), null);
  assert.equal(parseShoutoutStash('{"shoutoutId":42,"submittedAt":1}'), null);
  assert.equal(parseShoutoutStash('{"shoutoutId":"x"}'), null);
  assert.equal(
    parseShoutoutStash('{"shoutoutId":"x","submittedAt":"yesterday"}'),
    null,
  );
});

test("parseSongStash: valid round-trip", async () => {
  const { parseSongStash } = await import("./booth-stash.ts");
  const got = parseSongStash(
    JSON.stringify({ requestId: "req_xyz", submittedAt: 1714000000000 }),
  );
  assert.deepEqual(got, { requestId: "req_xyz", submittedAt: 1714000000000 });
});

test("parseSongStash: missing fields or wrong types → null", async () => {
  const { parseSongStash } = await import("./booth-stash.ts");
  assert.equal(parseSongStash('{}'), null);
  assert.equal(
    parseSongStash('{"requestId":"r","submittedAt":"now"}'),
    null,
  );
  assert.equal(parseSongStash('{"requestId":42,"submittedAt":1}'), null);
});

test("isFresh: respects max age", async () => {
  const { isFresh, SHOUTOUT_STASH_MAX_AGE_MS } = await import(
    "./booth-stash.ts"
  );
  const now = 1_000_000_000_000;
  assert.equal(isFresh(now - 60_000, SHOUTOUT_STASH_MAX_AGE_MS, now), true);
  assert.equal(
    isFresh(now - SHOUTOUT_STASH_MAX_AGE_MS - 1, SHOUTOUT_STASH_MAX_AGE_MS, now),
    false,
  );
  // Boundary: equal age is NOT fresh
  assert.equal(
    isFresh(now - SHOUTOUT_STASH_MAX_AGE_MS, SHOUTOUT_STASH_MAX_AGE_MS, now),
    false,
  );
});

test("freshness constants are sane", async () => {
  const { SHOUTOUT_STASH_MAX_AGE_MS, SONG_STASH_MAX_AGE_MS } = await import(
    "./booth-stash.ts"
  );
  assert.equal(SHOUTOUT_STASH_MAX_AGE_MS, 5 * 60 * 1000);
  assert.equal(SONG_STASH_MAX_AGE_MS, 10 * 60 * 1000);
});
