import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from "./newsletter-unsubscribe-token.ts";

const SECRET = "test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function withSecret<T>(fn: () => T): T {
  const prev = process.env.INTERNAL_API_SECRET;
  process.env.INTERNAL_API_SECRET = SECRET;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.INTERNAL_API_SECRET;
    else process.env.INTERNAL_API_SECRET = prev;
  }
}

test("sign + verify round-trip succeeds", () => {
  withSecret(() => {
    const { exp, sig } = signUnsubscribeToken("artist@example.com");
    assert.ok(verifyUnsubscribeToken("artist@example.com", String(exp), sig));
  });
});

test("verify rejects when email differs", () => {
  withSecret(() => {
    const { exp, sig } = signUnsubscribeToken("artist@example.com");
    assert.equal(verifyUnsubscribeToken("other@example.com", String(exp), sig), false);
  });
});

test("verify rejects when sig is tampered", () => {
  withSecret(() => {
    const { exp, sig } = signUnsubscribeToken("artist@example.com");
    const tampered = sig.slice(0, -2) + (sig.endsWith("00") ? "11" : "00");
    assert.equal(verifyUnsubscribeToken("artist@example.com", String(exp), tampered), false);
  });
});

test("verify rejects when exp is in the past", () => {
  withSecret(() => {
    const past = Math.floor(Date.now() / 1000) - 10;
    const { sig } = signUnsubscribeToken("artist@example.com");
    assert.equal(verifyUnsubscribeToken("artist@example.com", String(past), sig), false);
  });
});

test("verify rejects when exp is millis-instead-of-seconds (units bug guard)", () => {
  withSecret(() => {
    // Token signed with millis-style exp; sig matches for that exp, but
    // verify rejects because exp - now exceeds MAX_TTL.
    const farFuture = Date.now(); // milliseconds → ~50,000 years in seconds
    const sig = createHmac("sha256", SECRET)
      .update(`unsub:artist@example.com.${farFuture}`)
      .digest("hex");
    assert.equal(verifyUnsubscribeToken("artist@example.com", String(farFuture), sig), false);
  });
});

test("verify returns false when INTERNAL_API_SECRET unset", () => {
  const prev = process.env.INTERNAL_API_SECRET;
  delete process.env.INTERNAL_API_SECRET;
  try {
    assert.equal(verifyUnsubscribeToken("a@b.com", "9999999999", "deadbeef"), false);
  } finally {
    if (prev !== undefined) process.env.INTERNAL_API_SECRET = prev;
  }
});

test("verify is case-insensitive on email (matches normalize on submit)", () => {
  withSecret(() => {
    const { exp, sig } = signUnsubscribeToken("Artist@Example.COM");
    assert.ok(verifyUnsubscribeToken("artist@example.com", String(exp), sig));
  });
});

test("sign throws if INTERNAL_API_SECRET unset", () => {
  const prev = process.env.INTERNAL_API_SECRET;
  delete process.env.INTERNAL_API_SECRET;
  try {
    assert.throws(() => signUnsubscribeToken("a@b.com"), /INTERNAL_API_SECRET/);
  } finally {
    if (prev !== undefined) process.env.INTERNAL_API_SECRET = prev;
  }
});
