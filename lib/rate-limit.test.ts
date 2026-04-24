import { test } from "node:test";
import assert from "node:assert/strict";

function reqWith(headers: Record<string, string>): Request {
  return new Request("https://example.com/", { headers });
}

test("SONG_LIMITS is 1/hour and 3/day", async () => {
  // Dynamic import to bypass TypeScript path alias issues with node --test
  const { SONG_LIMITS } = await import("./rate-limit.ts");
  assert.equal(SONG_LIMITS.HOUR_LIMIT, 1);
  assert.equal(SONG_LIMITS.DAY_LIMIT, 3);
});

test("clientIpFromRequest prefers cf-connecting-ip over everything", async () => {
  const { clientIpFromRequest } = await import("./rate-limit.ts");
  const req = reqWith({
    "cf-connecting-ip": "9.9.9.9",
    "x-real-ip": "1.1.1.1",
    "x-forwarded-for": "evil, 2.2.2.2",
  });
  assert.equal(clientIpFromRequest(req), "9.9.9.9");
});

test("clientIpFromRequest uses x-real-ip when cf-connecting-ip is absent", async () => {
  const { clientIpFromRequest } = await import("./rate-limit.ts");
  const req = reqWith({
    "x-real-ip": "1.1.1.1",
    "x-forwarded-for": "evil, 2.2.2.2",
  });
  assert.equal(clientIpFromRequest(req), "1.1.1.1");
});

test("clientIpFromRequest uses x-vercel-forwarded-for when x-real-ip is absent", async () => {
  const { clientIpFromRequest } = await import("./rate-limit.ts");
  const req = reqWith({
    "x-vercel-forwarded-for": "3.3.3.3",
    "x-forwarded-for": "evil, 2.2.2.2",
  });
  assert.equal(clientIpFromRequest(req), "3.3.3.3");
});

test("clientIpFromRequest takes LAST value of x-forwarded-for, not first (spoofing defense)", async () => {
  // Attacker sends `X-Forwarded-For: 1.2.3.4` trying to bind their rate-limit
  // bucket to a fake IP. The edge appends the real connection IP on the
  // right, so LAST is the real trusted hop.
  const { clientIpFromRequest } = await import("./rate-limit.ts");
  const req = reqWith({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
  assert.equal(clientIpFromRequest(req), "5.6.7.8");
});

test("clientIpFromRequest handles single-value x-forwarded-for", async () => {
  const { clientIpFromRequest } = await import("./rate-limit.ts");
  const req = reqWith({ "x-forwarded-for": "7.7.7.7" });
  assert.equal(clientIpFromRequest(req), "7.7.7.7");
});

test("clientIpFromRequest handles whitespace around x-forwarded-for entries", async () => {
  const { clientIpFromRequest } = await import("./rate-limit.ts");
  const req = reqWith({ "x-forwarded-for": "  1.1.1.1 ,   2.2.2.2  " });
  assert.equal(clientIpFromRequest(req), "2.2.2.2");
});

test("clientIpFromRequest returns 'unknown' when no IP headers present", async () => {
  const { clientIpFromRequest } = await import("./rate-limit.ts");
  const req = reqWith({});
  assert.equal(clientIpFromRequest(req), "unknown");
});
