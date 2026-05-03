import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifySubmissionAudioSig } from "./verify-audio-sig.ts";

const SECRET = "test-secret-do-not-use";

function mintSig(id: string, exp: number, secretOverride?: string): string {
  return createHmac("sha256", secretOverride ?? SECRET)
    .update(`${id}.${exp}`)
    .digest("hex");
}

function withEnv<T>(secret: string | undefined, fn: () => T): T {
  const prev = process.env.INTERNAL_API_SECRET;
  if (secret === undefined) delete process.env.INTERNAL_API_SECRET;
  else process.env.INTERNAL_API_SECRET = secret;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.INTERNAL_API_SECRET;
    else process.env.INTERNAL_API_SECRET = prev;
  }
}

test("accepts a freshly minted signature", () => {
  const id = "abc123";
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const sig = mintSig(id, exp);
  withEnv(SECRET, () => {
    assert.equal(verifySubmissionAudioSig(id, String(exp), sig), true);
  });
});

test("rejects an expired signature", () => {
  const id = "abc123";
  const exp = Math.floor(Date.now() / 1000) - 60; // expired 1 min ago
  const sig = mintSig(id, exp);
  withEnv(SECRET, () => {
    assert.equal(verifySubmissionAudioSig(id, String(exp), sig), false);
  });
});

test("rejects a sig minted for a different id", () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const sigForOther = mintSig("other-id", exp);
  withEnv(SECRET, () => {
    assert.equal(verifySubmissionAudioSig("abc123", String(exp), sigForOther), false);
  });
});

test("rejects a sig minted with the wrong secret", () => {
  const id = "abc123";
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const sig = mintSig(id, exp, "different-secret");
  withEnv(SECRET, () => {
    assert.equal(verifySubmissionAudioSig(id, String(exp), sig), false);
  });
});

test("rejects when sig param is missing", () => {
  const id = "abc123";
  const exp = String(Math.floor(Date.now() / 1000) + 3600);
  withEnv(SECRET, () => {
    assert.equal(verifySubmissionAudioSig(id, exp, null), false);
    assert.equal(verifySubmissionAudioSig(id, null, "abc"), false);
  });
});

test("rejects when INTERNAL_API_SECRET is unset (fail-closed)", () => {
  const id = "abc123";
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const sig = mintSig(id, exp);
  withEnv(undefined, () => {
    assert.equal(verifySubmissionAudioSig(id, String(exp), sig), false);
  });
});

test("rejects malformed exp (non-numeric)", () => {
  withEnv(SECRET, () => {
    assert.equal(
      verifySubmissionAudioSig("abc123", "not-a-number", "deadbeef"),
      false,
    );
  });
});

test("verify-then-sign roundtrip works (compatibility with sign helper)", async () => {
  // The dashboard's signSubmissionAudioQuery() must produce something
  // this verifier accepts. We can't import the dashboard helper from
  // here (separate Next app), so reproduce its formula and assert.
  const id = "submission-cuid-abc";
  const ttl = 60 * 60;
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const sig = createHmac("sha256", SECRET).update(`${id}.${exp}`).digest("hex");
  withEnv(SECRET, () => {
    assert.equal(verifySubmissionAudioSig(id, String(exp), sig), true);
  });
});
