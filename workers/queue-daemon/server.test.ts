import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createServer } from "node:http";
import { createHandler, type ServerDeps } from "./server.ts";

type TestDeps = ServerDeps & { __pushed: unknown[]; __onTrack: unknown[] };

function mkDeps(over: Partial<ServerDeps> = {}): TestDeps {
  const __pushed: unknown[] = [];
  const __onTrack: unknown[] = [];
  const base: ServerDeps = {
    pushHandler: async (body) => {
      __pushed.push(body);
      return { queueItemId: "qi-" + __pushed.length };
    },
    onTrackHandler: async (body) => {
      __onTrack.push(body);
    },
    statusHandler: () => ({ socket: "connected", lastPushes: [], lastFailures: [] }),
    ...over,
  };
  return Object.assign(base, { __pushed, __onTrack }) as TestDeps;
}

async function hit(port: number, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function withServer<T>(
  deps: ServerDeps,
  fn: (port: number) => Promise<T>,
): Promise<T> {
  const server = createServer(createHandler(deps));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  try {
    return await fn(port);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

test("POST /push forwards body to handler and returns its result", async () => {
  const deps = mkDeps();
  await withServer(deps, async (port) => {
    const { status, json } = await hit(port, "/push", { trackId: "t1", sourceUrl: "https://cdn.numaradio.com/u1.mp3" });
    assert.equal(status, 200);
    assert.equal(json.queueItemId, "qi-1");
    assert.deepEqual(deps.__pushed[0], { trackId: "t1", sourceUrl: "https://cdn.numaradio.com/u1.mp3" });
  });
});

test("POST /push forwards the kind discriminator to the handler", async () => {
  const deps = mkDeps();
  await withServer(deps, async (port) => {
    await hit(port, "/push", { trackId: "t1", sourceUrl: "https://cdn.numaradio.com/u1.mp3", kind: "shoutout" });
    assert.deepEqual(deps.__pushed[0], {
      trackId: "t1",
      sourceUrl: "https://cdn.numaradio.com/u1.mp3",
      kind: "shoutout",
    });
  });
});

test("POST /push returns 400 on invalid JSON", async () => {
  const deps = mkDeps();
  await withServer(deps, async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/push`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    assert.equal(res.status, 400);
  });
});

test("POST /push returns 400 when handler throws with statusCode=400", async () => {
  const deps = mkDeps({
    pushHandler: async () => {
      throw Object.assign(new Error("unknown track"), { statusCode: 400 });
    },
  });
  await withServer(deps, async (port) => {
    const { status, json } = await hit(port, "/push", { trackId: "bogus", sourceUrl: "https://cdn.numaradio.com/u.mp3" });
    assert.equal(status, 400);
    assert.match(json.message, /unknown track/);
  });
});

test("POST /on-track invokes handler and returns 200", async () => {
  const deps = mkDeps();
  await withServer(deps, async (port) => {
    const { status } = await hit(port, "/on-track", { sourceUrl: "https://cdn.numaradio.com/u.mp3", title: "T", artist: "A" });
    assert.equal(status, 200);
    assert.equal(deps.__onTrack.length, 1);
  });
});

test("GET /status returns the status snapshot", async () => {
  const deps = mkDeps({
    statusHandler: () => ({ socket: "reconnecting", lastPushes: [{ a: 1 }], lastFailures: [] }),
  });
  await withServer(deps, async (port) => {
    const { status, json } = await hit(port, "/status");
    assert.equal(status, 200);
    assert.deepEqual(json.socket, "reconnecting");
    assert.equal(json.lastPushes.length, 1);
  });
});

test("unknown path returns 404", async () => {
  const deps = mkDeps();
  await withServer(deps, async (port) => {
    const { status } = await hit(port, "/does-not-exist");
    assert.equal(status, 404);
  });
});

// validatePushUrl — defense against telnet injection. The daemon
// passes sourceUrl into Liquidsoap via a single-line telnet command,
// so any whitespace would terminate the push early and let a caller
// inject additional Liquidsoap verbs.
test("validatePushUrl accepts B2/CDN https URLs", async () => {
  const { validatePushUrl } = await import("./server.ts");
  assert.equal(
    validatePushUrl("https://cdn.numaradio.com/stations/numaradio/tracks/abc/audio/master.mp3"),
    null,
  );
  assert.equal(
    validatePushUrl("https://f003.backblazeb2.com/file/numaradio/x.mp3"),
    null,
  );
});

test("validatePushUrl accepts file:// URLs (local shoutouts)", async () => {
  const { validatePushUrl } = await import("./server.ts");
  assert.equal(validatePushUrl("file:///var/numa/cache/shoutout-123.mp3"), null);
});

test("validatePushUrl rejects newline injection (telnet boundary)", async () => {
  const { validatePushUrl } = await import("./server.ts");
  assert.match(
    validatePushUrl("https://cdn.numaradio.com/x.mp3\nrotation.skip") ?? "",
    /whitespace/,
  );
  assert.match(
    validatePushUrl("https://cdn.numaradio.com/x.mp3\r\nrotation.skip") ?? "",
    /whitespace/,
  );
});

test("validatePushUrl rejects space (telnet arg separator)", async () => {
  const { validatePushUrl } = await import("./server.ts");
  assert.match(validatePushUrl("https://example.com/a b.mp3") ?? "", /whitespace/);
});

test("validatePushUrl rejects unsupported schemes", async () => {
  const { validatePushUrl } = await import("./server.ts");
  assert.match(validatePushUrl("javascript:alert(1)") ?? "", /http\(s\) or file/);
  assert.match(validatePushUrl("ftp://example.com/x") ?? "", /http\(s\) or file/);
  assert.match(validatePushUrl("data:audio/mpeg;base64,xxxx") ?? "", /http\(s\) or file/);
});

test("POST /push returns 400 for whitespace in sourceUrl", async () => {
  const deps = mkDeps();
  await withServer(deps, async (port) => {
    const { status, json } = await hit(port, "/push", {
      trackId: "t1",
      sourceUrl: "https://cdn.numaradio.com/x.mp3\nrotation.skip",
    });
    assert.equal(status, 400);
    assert.match(json.error, /whitespace/);
    assert.equal(deps.__pushed.length, 0);
  });
});
