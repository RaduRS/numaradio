import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { purgeCloudflareCache } from "./cf-purge.ts";

describe("purgeCloudflareCache", () => {
  test("returns { skipped: 'no_creds' } when CF_API_TOKEN missing", async () => {
    const r = await purgeCloudflareCache(["https://numaradio.com/x.mp3"], {
      apiToken: "",
      zoneId: "z123",
      fetchImpl: async () => new Response("", { status: 200 }),
    });
    assert.deepEqual(r, { skipped: "no_creds" });
  });

  test("returns { skipped: 'no_creds' } when CF_ZONE_ID missing", async () => {
    const r = await purgeCloudflareCache(["https://numaradio.com/x.mp3"], {
      apiToken: "tok",
      zoneId: "",
      fetchImpl: async () => new Response("", { status: 200 }),
    });
    assert.deepEqual(r, { skipped: "no_creds" });
  });

  test("returns { skipped: 'empty_urls' } when given no URLs", async () => {
    const r = await purgeCloudflareCache([], {
      apiToken: "tok",
      zoneId: "z123",
      fetchImpl: async () => new Response("", { status: 200 }),
    });
    assert.deepEqual(r, { skipped: "empty_urls" });
  });

  test("returns { ok: true } on 200 from CF API", async () => {
    let calledUrl = "";
    let calledBody = "";
    const r = await purgeCloudflareCache(["https://numaradio.com/x.mp3"], {
      apiToken: "tok",
      zoneId: "z123",
      fetchImpl: async (url, init) => {
        calledUrl = String(url);
        calledBody = String(init?.body ?? "");
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      },
    });
    assert.deepEqual(r, { ok: true });
    assert.equal(calledUrl, "https://api.cloudflare.com/client/v4/zones/z123/purge_cache");
    assert.equal(calledBody, JSON.stringify({ files: ["https://numaradio.com/x.mp3"] }));
  });

  test("returns { error: ... } on non-200 (caller logs, doesn't throw)", async () => {
    const r = await purgeCloudflareCache(["https://numaradio.com/x.mp3"], {
      apiToken: "tok",
      zoneId: "z123",
      fetchImpl: async () => new Response("forbidden", { status: 403 }),
    });
    assert.equal("error" in r, true);
    if ("error" in r) assert.match(r.error, /403/);
  });

  test("returns { error: ... } on fetch throw", async () => {
    const r = await purgeCloudflareCache(["https://numaradio.com/x.mp3"], {
      apiToken: "tok",
      zoneId: "z123",
      fetchImpl: async () => { throw new Error("network down"); },
    });
    assert.equal("error" in r, true);
    if ("error" in r) assert.match(r.error, /network down/);
  });
});
