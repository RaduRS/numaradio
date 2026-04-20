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
    const { status, json } = await hit(port, "/push", { trackId: "t1", sourceUrl: "u1" });
    assert.equal(status, 200);
    assert.equal(json.queueItemId, "qi-1");
    assert.deepEqual(deps.__pushed[0], { trackId: "t1", sourceUrl: "u1" });
  });
});

test("POST /push forwards the kind discriminator to the handler", async () => {
  const deps = mkDeps();
  await withServer(deps, async (port) => {
    await hit(port, "/push", { trackId: "t1", sourceUrl: "u1", kind: "shoutout" });
    assert.deepEqual(deps.__pushed[0], {
      trackId: "t1",
      sourceUrl: "u1",
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
    const { status, json } = await hit(port, "/push", { trackId: "bogus", sourceUrl: "u" });
    assert.equal(status, 400);
    assert.match(json.message, /unknown track/);
  });
});

test("POST /on-track invokes handler and returns 200", async () => {
  const deps = mkDeps();
  await withServer(deps, async (port) => {
    const { status } = await hit(port, "/on-track", { sourceUrl: "u", title: "T", artist: "A" });
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
