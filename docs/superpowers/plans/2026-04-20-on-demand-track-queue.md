# On-demand track queue + Neon-backed rotation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static one-line `/etc/numa/playlist.m3u` with a two-source Liquidsoap pipeline — a priority `request.queue` (user-requested songs, airs at next track boundary) layered above a reloadable playlist that regenerates from Neon every 2 minutes (library shuffle minus recent plays).

**Architecture:** A new Node service (`numa-queue-daemon`) owns a telnet connection to Liquidsoap's local control socket and exposes a loopback HTTP API (`POST /push`, `POST /on-track`, `GET /status`). `QueueItem` DB rows are the durability layer — the daemon hydrates them to the socket on startup. A separate `numa-rotation-refresher` script, invoked by a systemd timer, regenerates `/etc/numa/playlist.m3u` atomically. Liquidsoap's `numa.liq` gains a `fallback(track_sensitive=true, [priority, rotation, blank()])` source and a second POST to the daemon from `notify_track_started`. The Vercel `/api/internal/track-started` endpoint gains a `PlayHistory` insert so rotation can reliably avoid recent plays.

**Tech Stack:** TypeScript (strict), Node 20+ native test runner (`node --test --experimental-strip-types`, matching `dashboard/package.json`), `@prisma/client` (already in repo), Node built-in `net` for telnet, Node built-in `http` for the server (no Express — keep deps minimal), `tsx` for running scripts, systemd for service supervision, Liquidsoap 2.2.4.

**Spec:** `docs/superpowers/specs/2026-04-20-on-demand-track-queue-design.md`

---

## File structure

### New files
- `workers/queue-daemon/index.ts` — entrypoint; wires prisma, socket, HTTP server, hydrator
- `workers/queue-daemon/server.ts` — HTTP server with `/push`, `/on-track`, `/status` handlers
- `workers/queue-daemon/socket.ts` — Liquidsoap telnet client with reconnect
- `workers/queue-daemon/hydrator.ts` — reads staged priority QueueItems from Neon, pushes to socket
- `workers/queue-daemon/status-buffers.ts` — ring buffers for last-N pushes/failures
- `workers/queue-daemon/prisma.ts` — shared prisma client (single instance)
- `workers/queue-daemon/resolve-track.ts` — trackId resolution (id → url-path extract → title+artist fallback), shared with on-track handler
- `workers/queue-daemon/server.test.ts`, `socket.test.ts`, `hydrator.test.ts`, `status-buffers.test.ts`, `resolve-track.test.ts`
- `scripts/refresh-rotation.ts` — rotation refresher (one-shot)
- `scripts/refresh-rotation.test.ts` — unit test for the pure build-playlist function
- `scripts/queue-push.ts` — manual CLI that POSTs to the daemon
- `scripts/test-queue-e2e.sh` — integration test
- `deploy/systemd/numa-queue-daemon.service` — systemd unit
- `deploy/systemd/numa-rotation-refresher.service` — systemd unit (oneshot)
- `deploy/systemd/numa-rotation-refresher.timer` — systemd timer

### Modified files
- `liquidsoap/numa.liq` — add telnet socket, `request.queue`, `fallback`, daemon POST
- `app/api/internal/track-started/route.ts` — add `PlayHistory` insert
- `package.json` — add `test` and `queue:push` scripts; add `@types/node` dev dep if missing
- `docs/HANDOFF.md` — update "where we are" block at the end
- `lib/db.ts` (if exists) — no change, reuse

---

## Task 1: Test infrastructure (root package.json)

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add `test` and `queue:push` scripts**

Open `package.json` and change the `"scripts"` block to:

```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "postinstall": "prisma generate",
    "ingest:seed": "tsx scripts/ingest-seed.ts",
    "refresh-rotation": "tsx scripts/refresh-rotation.ts",
    "queue:push": "tsx scripts/queue-push.ts",
    "queue:daemon": "tsx workers/queue-daemon/index.ts",
    "test": "node --test --experimental-strip-types '{scripts,workers}/**/*.test.ts'"
  },
```

- [ ] **Step 2: Verify the test runner finds nothing yet**

Run: `npm test`
Expected output: `ok 0` / `tests 0` with exit code 0 (no tests exist yet — this is correct).

If the command fails with a glob-related error, the shell is likely not expanding `{scripts,workers}` — on newer Node (20+) the runner expands globs itself, but if it complains, change the script to pass two explicit args: `"test": "node --test --experimental-strip-types scripts/**/*.test.ts workers/**/*.test.ts"`.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: wire npm scripts for queue daemon, rotation refresher, tests"
```

---

## Task 2: Rotation refresher — pure build function + unit test

Build the most-isolatable piece first: a pure function that takes library tracks + recent trackIds and returns an m3u string. Zero DB, zero filesystem.

**Files:**
- Create: `scripts/refresh-rotation.ts`
- Create: `scripts/refresh-rotation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/refresh-rotation.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlaylist } from "./refresh-rotation.ts";

type T = { id: string; url: string };
const t = (id: string, url: string): T => ({ id, url });

test("buildPlaylist excludes recent track ids and returns one url per line", () => {
  const library: T[] = [t("a", "https://b2/a.mp3"), t("b", "https://b2/b.mp3"), t("c", "https://b2/c.mp3")];
  const recent = new Set(["b"]);
  const out = buildPlaylist(library, recent, () => 0);
  const lines = out.trim().split("\n");
  assert.equal(lines.length, 2);
  assert.ok(lines.every((l) => l.startsWith("https://b2/")));
  assert.ok(!lines.includes("https://b2/b.mp3"));
});

test("buildPlaylist falls back to full library if pool < 5", () => {
  const library: T[] = [t("a", "a"), t("b", "b"), t("c", "c")];
  const recent = new Set(["a", "b", "c"]);
  const out = buildPlaylist(library, recent, () => 0);
  const lines = out.trim().split("\n");
  assert.equal(lines.length, 3, "pool<5 → full library");
});

test("buildPlaylist is deterministic given a seeded rng", () => {
  const library: T[] = Array.from({ length: 10 }, (_, i) => t(`k${i}`, `u${i}`));
  let seed = 0;
  const rng = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const a = buildPlaylist(library, new Set(), rng);
  seed = 0;
  const b = buildPlaylist(library, new Set(), rng);
  assert.equal(a, b);
});

test("buildPlaylist returns empty string when library is empty", () => {
  assert.equal(buildPlaylist([], new Set(), () => 0), "");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="buildPlaylist"`
Expected: FAIL with "Cannot find module './refresh-rotation.ts'" (or similar module resolution error).

- [ ] **Step 3: Write minimal implementation**

Create `scripts/refresh-rotation.ts`:

```ts
import "../lib/load-env.ts";
import { writeFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

export type RotationTrack = { id: string; url: string };

const PLAYLIST_PATH = process.env.NUMA_PLAYLIST_PATH ?? "/etc/numa/playlist.m3u";
const RECENT_WINDOW = 20;
const MIN_POOL = 5;

export function buildPlaylist(
  library: RotationTrack[],
  recentIds: Set<string>,
  rng: () => number = Math.random,
): string {
  if (library.length === 0) return "";
  const excluded = library.filter((t) => !recentIds.has(t.id));
  const pool = excluded.length < MIN_POOL ? library : excluded;
  // Fisher–Yates
  const a = pool.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.map((t) => t.url).join("\n") + "\n";
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const station = await prisma.station.findUniqueOrThrow({
      where: { slug: process.env.STATION_SLUG ?? "numaradio" },
      select: { id: true },
    });

    const tracks = await prisma.track.findMany({
      where: {
        stationId: station.id,
        trackStatus: "ready",
        airingPolicy: "library",
      },
      select: {
        id: true,
        assets: {
          where: { assetType: "audio_stream" },
          take: 1,
          select: { publicUrl: true },
        },
      },
    });

    const library: RotationTrack[] = tracks
      .filter((t) => t.assets[0]?.publicUrl)
      .map((t) => ({ id: t.id, url: t.assets[0].publicUrl }));

    const recent = await prisma.playHistory.findMany({
      where: { stationId: station.id, trackId: { not: null } },
      orderBy: { startedAt: "desc" },
      take: RECENT_WINDOW,
      select: { trackId: true },
    });
    const recentIds = new Set(recent.map((r) => r.trackId!).filter(Boolean));

    const content = buildPlaylist(library, recentIds);

    const tmpPath = join(tmpdir(), `playlist-${process.pid}-${Date.now()}.m3u`);
    await writeFile(tmpPath, content, "utf8");
    await rename(tmpPath, PLAYLIST_PATH);

    const firstTitles = library.slice(0, 3).map((t) => t.id).join(", ");
    console.log(
      `[refresh-rotation] library=${library.length} excluded=${recentIds.size} wrote=${PLAYLIST_PATH} sample=[${firstTitles}]`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

// Only run main() when invoked directly (so tests can import without side effects).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("[refresh-rotation] failed", err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="buildPlaylist"`
Expected: 4 tests pass.

- [ ] **Step 5: Smoke-test against real Neon (read-only)**

Run (from `/home/marku/saas/numaradio`): `NUMA_PLAYLIST_PATH=/tmp/playlist-smoke.m3u npm run refresh-rotation`
Expected output line: `[refresh-rotation] library=1 excluded=0 wrote=/tmp/playlist-smoke.m3u sample=[<trackId>]`
Verify file: `cat /tmp/playlist-smoke.m3u` — should contain the B2 URL for "One More Dance".

- [ ] **Step 6: Commit**

```bash
git add scripts/refresh-rotation.ts scripts/refresh-rotation.test.ts
git commit -m "feat(rotation): Neon-backed playlist.m3u refresher with recent-play exclusion"
```

---

## Task 3: Vercel endpoint — add `PlayHistory` insert

**Files:**
- Modify: `app/api/internal/track-started/route.ts`

- [ ] **Step 1: Read the current file to locate the upsert block**

Read `app/api/internal/track-started/route.ts`. The block to wrap is the `prisma.nowPlaying.upsert(...)` call near the end.

- [ ] **Step 2: Replace the upsert with a transaction that also writes PlayHistory**

Replace lines 87–107 (the `const startedAt` through the closing `});` of the upsert) with:

```ts
  const startedAt = new Date();
  const durationMs = (track.durationSeconds ?? 180) * 1000;
  const expectedEndAt = new Date(startedAt.getTime() + durationMs);

  const trackMeta = await prisma.track.findUnique({
    where: { id: track.id },
    select: { title: true },
  });

  await prisma.$transaction([
    prisma.nowPlaying.upsert({
      where: { stationId: station.id },
      create: {
        stationId: station.id,
        currentTrackId: track.id,
        startedAt,
        expectedEndAt,
        lastHeartbeatAt: startedAt,
      },
      update: {
        currentTrackId: track.id,
        startedAt,
        expectedEndAt,
        lastHeartbeatAt: startedAt,
      },
    }),
    prisma.playHistory.create({
      data: {
        stationId: station.id,
        trackId: track.id,
        segmentType: "audio_track",
        titleSnapshot: trackMeta?.title ?? null,
        startedAt,
        durationSeconds: track.durationSeconds,
        completedNormally: true,
      },
    }),
  ]);
```

- [ ] **Step 3: Verify type-check passes**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Manual probe against the local dev server**

Run (in one shell): `npm run dev`

Run (in another shell) with the real secret loaded from `.env.local`:
```bash
SECRET=$(grep ^INTERNAL_API_SECRET .env.local | cut -d= -f2-)
curl -sS -X POST http://localhost:3000/api/internal/track-started \
  -H "Content-Type: application/json" \
  -H "x-internal-secret: $SECRET" \
  -d '{"sourceUrl":"https://f003.backblazeb2.com/file/numaradio/stations/numaradio/tracks/cmo5o2tsa0002wey8w4398pge/audio/stream.mp3","title":"One More Dance","artist":"russellross"}' | jq .
```
Expected: `{ "ok": true, "trackId": "cmo5o2tsa0002wey8w4398pge", "startedAt": "..." }`.

Then verify in Neon (via Prisma Studio or CLI):
```bash
npx prisma studio
```
Open the `PlayHistory` table — there should be a new row with that track's id, `segmentType="audio_track"`, and a recent `startedAt`.

Stop the dev server (`Ctrl-C`).

- [ ] **Step 5: Commit**

```bash
git add app/api/internal/track-started/route.ts
git commit -m "feat(track-started): insert PlayHistory alongside NowPlaying upsert"
```

---

## Task 4: Queue daemon — shared prisma client

**Files:**
- Create: `workers/queue-daemon/prisma.ts`

- [ ] **Step 1: Create the file**

```ts
import "../../lib/load-env.ts";
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
```

- [ ] **Step 2: Commit**

```bash
git add workers/queue-daemon/prisma.ts
git commit -m "chore(queue-daemon): shared prisma client"
```

---

## Task 5: Queue daemon — status buffers (ring buffers for `/status`)

Pure, no dependencies — implement and test in isolation first.

**Files:**
- Create: `workers/queue-daemon/status-buffers.ts`
- Create: `workers/queue-daemon/status-buffers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { RingBuffer } from "./status-buffers.ts";

test("RingBuffer keeps only the last N entries, newest-first", () => {
  const r = new RingBuffer<number>(3);
  r.push(1);
  r.push(2);
  r.push(3);
  r.push(4);
  assert.deepEqual(r.snapshot(), [4, 3, 2]);
});

test("RingBuffer snapshot returns a copy", () => {
  const r = new RingBuffer<string>(2);
  r.push("a");
  const s = r.snapshot();
  r.push("b");
  assert.deepEqual(s, ["a"]);
});

test("RingBuffer returns empty array when unused", () => {
  const r = new RingBuffer<number>(5);
  assert.deepEqual(r.snapshot(), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="RingBuffer"`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement**

```ts
export class RingBuffer<T> {
  private readonly items: T[] = [];
  constructor(private readonly cap: number) {}

  push(item: T): void {
    this.items.unshift(item);
    if (this.items.length > this.cap) this.items.length = this.cap;
  }

  snapshot(): T[] {
    return this.items.slice();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="RingBuffer"`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add workers/queue-daemon/status-buffers.ts workers/queue-daemon/status-buffers.test.ts
git commit -m "feat(queue-daemon): RingBuffer for /status last-N tracking"
```

---

## Task 6: Queue daemon — track resolver (id / URL / title+artist)

Mirror the resolution logic in `/api/internal/track-started` so `/on-track` handles the same inputs identically.

**Files:**
- Create: `workers/queue-daemon/resolve-track.ts`
- Create: `workers/queue-daemon/resolve-track.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractTrackIdFromUrl, resolveTrackId } from "./resolve-track.ts";

test("extractTrackIdFromUrl pulls the id from a /tracks/<id>/audio/ path", () => {
  const url = "https://f003.backblazeb2.com/file/numaradio/stations/numaradio/tracks/cmo5o2tsa0002wey8w4398pge/audio/stream.mp3";
  assert.equal(extractTrackIdFromUrl(url), "cmo5o2tsa0002wey8w4398pge");
});

test("extractTrackIdFromUrl returns null on non-track paths", () => {
  assert.equal(extractTrackIdFromUrl("https://example.com/foo.mp3"), null);
  assert.equal(extractTrackIdFromUrl(""), null);
});

test("resolveTrackId prefers explicit trackId when valid", async () => {
  const lookup = {
    byId: async (id: string) => (id === "real" ? { id: "real", stationId: "s1" } : null),
    byTitleArtist: async () => null,
  };
  const got = await resolveTrackId({ trackId: "real" }, lookup);
  assert.equal(got?.id, "real");
});

test("resolveTrackId falls back to URL extraction when trackId missing", async () => {
  const lookup = {
    byId: async (id: string) => (id === "extracted" ? { id: "extracted", stationId: "s1" } : null),
    byTitleArtist: async () => null,
  };
  const got = await resolveTrackId(
    { sourceUrl: "https://x/tracks/extracted/audio/y.mp3" },
    lookup,
  );
  assert.equal(got?.id, "extracted");
});

test("resolveTrackId falls back to title+artist lookup last", async () => {
  const lookup = {
    byId: async () => null,
    byTitleArtist: async (title: string, artist: string | undefined) =>
      title === "T" && artist === "A" ? { id: "ta", stationId: "s1" } : null,
  };
  const got = await resolveTrackId({ title: "T", artist: "A" }, lookup);
  assert.equal(got?.id, "ta");
});

test("resolveTrackId returns null when nothing matches", async () => {
  const lookup = {
    byId: async () => null,
    byTitleArtist: async () => null,
  };
  assert.equal(await resolveTrackId({ title: "nope" }, lookup), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="resolveTrackId|extractTrackIdFromUrl"`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement**

```ts
export type TrackRef = { id: string; stationId: string };

export interface TrackLookup {
  byId(id: string): Promise<TrackRef | null>;
  byTitleArtist(title: string, artist: string | undefined): Promise<TrackRef | null>;
}

export function extractTrackIdFromUrl(url: string): string | null {
  const m = url.match(/\/tracks\/([^/]+)\/audio\//);
  return m?.[1] ?? null;
}

export type ResolveInput = {
  trackId?: string;
  sourceUrl?: string;
  title?: string;
  artist?: string;
};

export async function resolveTrackId(
  input: ResolveInput,
  lookup: TrackLookup,
): Promise<TrackRef | null> {
  if (input.trackId) {
    const hit = await lookup.byId(input.trackId);
    if (hit) return hit;
  }
  if (input.sourceUrl) {
    const id = extractTrackIdFromUrl(input.sourceUrl);
    if (id) {
      const hit = await lookup.byId(id);
      if (hit) return hit;
    }
  }
  if (input.title) {
    const hit = await lookup.byTitleArtist(input.title, input.artist);
    if (hit) return hit;
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="resolveTrackId|extractTrackIdFromUrl"`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add workers/queue-daemon/resolve-track.ts workers/queue-daemon/resolve-track.test.ts
git commit -m "feat(queue-daemon): track resolver (id → url extract → title+artist)"
```

---

## Task 7: Queue daemon — Liquidsoap socket client

Small TCP client. Wrap in a class that exposes `send(line)` and fires `onLine(line)` callbacks. Reconnects with exponential backoff.

**Files:**
- Create: `workers/queue-daemon/socket.ts`
- Create: `workers/queue-daemon/socket.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server, type Socket } from "node:net";
import { LiquidsoapSocket } from "./socket.ts";

function tcpServer(onData: (s: Socket, chunk: string) => void): Promise<{ port: number; server: Server }> {
  return new Promise((resolve) => {
    const server = createServer((s) => {
      s.on("data", (d) => onData(s, d.toString()));
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (typeof addr === "object" && addr) resolve({ port: addr.port, server });
    });
  });
}

test("LiquidsoapSocket connects and sends commands", async () => {
  const received: string[] = [];
  const { port, server } = await tcpServer((_s, chunk) => {
    received.push(chunk);
  });

  const sock = new LiquidsoapSocket({ host: "127.0.0.1", port });
  await sock.connect();
  await sock.send("priority.push https://example.com/a.mp3");
  // Give the server a tick to receive.
  await new Promise((r) => setTimeout(r, 50));

  sock.close();
  server.close();

  assert.equal(received.length, 1);
  assert.equal(received[0], "priority.push https://example.com/a.mp3\n");
});

test("LiquidsoapSocket emits lines received from the server", async () => {
  const lines: string[] = [];
  const { port, server } = await tcpServer((s) => {
    s.write("hello\nworld\n");
  });

  const sock = new LiquidsoapSocket({ host: "127.0.0.1", port });
  sock.onLine((l) => lines.push(l));
  await sock.connect();
  await new Promise((r) => setTimeout(r, 50));

  sock.close();
  server.close();

  assert.deepEqual(lines, ["hello", "world"]);
});

test("LiquidsoapSocket reports isConnected correctly", async () => {
  const { port, server } = await tcpServer(() => {});
  const sock = new LiquidsoapSocket({ host: "127.0.0.1", port });
  assert.equal(sock.isConnected(), false);
  await sock.connect();
  assert.equal(sock.isConnected(), true);
  sock.close();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(sock.isConnected(), false);
  server.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="LiquidsoapSocket"`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement**

```ts
import { Socket } from "node:net";

export type SocketOpts = { host: string; port: number };

export class LiquidsoapSocket {
  private sock: Socket | null = null;
  private connected = false;
  private buffer = "";
  private lineListeners = new Set<(line: string) => void>();
  private disconnectListeners = new Set<() => void>();

  constructor(private readonly opts: SocketOpts) {}

  isConnected(): boolean {
    return this.connected;
  }

  onLine(fn: (line: string) => void): () => void {
    this.lineListeners.add(fn);
    return () => this.lineListeners.delete(fn);
  }

  onDisconnect(fn: () => void): () => void {
    this.disconnectListeners.add(fn);
    return () => this.disconnectListeners.delete(fn);
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const s = new Socket();
      s.setEncoding("utf8");
      s.setKeepAlive(true, 10_000);
      const onError = (err: Error) => {
        s.removeAllListeners();
        this.sock = null;
        this.connected = false;
        reject(err);
      };
      s.once("error", onError);
      s.connect(this.opts.port, this.opts.host, () => {
        s.removeListener("error", onError);
        this.sock = s;
        this.connected = true;
        s.on("data", (chunk: string) => this.handleData(chunk));
        s.on("close", () => this.handleClose());
        s.on("error", () => this.handleClose());
        resolve();
      });
    });
  }

  private handleData(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, "");
      this.buffer = this.buffer.slice(idx + 1);
      for (const fn of this.lineListeners) fn(line);
    }
  }

  private handleClose(): void {
    if (!this.connected) return;
    this.connected = false;
    this.sock = null;
    for (const fn of this.disconnectListeners) fn();
  }

  send(line: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.sock || !this.connected) return reject(new Error("not connected"));
      this.sock.write(line + "\n", (err) => (err ? reject(err) : resolve()));
    });
  }

  close(): void {
    if (this.sock) {
      this.sock.destroy();
      this.sock = null;
    }
    this.connected = false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="LiquidsoapSocket"`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add workers/queue-daemon/socket.ts workers/queue-daemon/socket.test.ts
git commit -m "feat(queue-daemon): Liquidsoap telnet socket client"
```

---

## Task 8: Queue daemon — reconnect supervisor

A thin wrapper around `LiquidsoapSocket` that keeps it connected. Exposes the same `send` interface, queues sends while disconnected, and fires an `onReconnect()` callback after each successful reconnect (the daemon uses it to trigger the hydrator).

**Files:**
- Modify: `workers/queue-daemon/socket.ts` — add the supervisor class below
- Modify: `workers/queue-daemon/socket.test.ts` — add supervisor tests

- [ ] **Step 1: Write the failing tests (append to socket.test.ts)**

```ts
import { SupervisedSocket } from "./socket.ts";

test("SupervisedSocket reconnects after server restart", async () => {
  const reconnects: number[] = [];
  let sink: string[] = [];
  const make = () => tcpServer((_s, chunk) => sink.push(chunk));

  const first = await make();
  const sup = new SupervisedSocket({ host: "127.0.0.1", port: first.port }, { baseDelayMs: 20, maxDelayMs: 40 });
  sup.onReconnect(() => reconnects.push(Date.now()));
  await sup.start();
  await sup.send("hello");
  await new Promise((r) => setTimeout(r, 40));

  // Restart the server on the SAME port.
  first.server.close();
  await new Promise((r) => setTimeout(r, 50));
  const second = await new Promise<{ port: number; server: import("node:net").Server }>((resolve) => {
    const srv = require("node:net").createServer((s: any) => s.on("data", (d: any) => sink.push(d.toString())));
    srv.listen(first.port, "127.0.0.1", () => resolve({ port: first.port, server: srv }));
  });

  // Wait up to 500ms for the supervisor to reconnect.
  const deadline = Date.now() + 500;
  while (Date.now() < deadline && reconnects.length < 1) {
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.ok(reconnects.length >= 1, "expected at least one reconnect");

  await sup.send("world");
  await new Promise((r) => setTimeout(r, 40));

  sup.stop();
  second.server.close();

  assert.ok(sink.some((s) => s.includes("hello")));
  assert.ok(sink.some((s) => s.includes("world")));
});

test("SupervisedSocket.send rejects fast when not connected and no queueing is enabled", async () => {
  const sup = new SupervisedSocket(
    { host: "127.0.0.1", port: 1 /* bogus */ },
    { baseDelayMs: 10_000, maxDelayMs: 10_000 },
  );
  // Do not call start(); we just want to confirm the "not connected" path.
  await assert.rejects(() => sup.send("x"), /not connected/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern="SupervisedSocket"`
Expected: FAIL with "SupervisedSocket is not exported".

- [ ] **Step 3: Add the supervisor to `socket.ts`**

Append to `workers/queue-daemon/socket.ts`:

```ts
export type SupervisorOpts = { baseDelayMs?: number; maxDelayMs?: number };

export class SupervisedSocket {
  private inner: LiquidsoapSocket;
  private stopped = false;
  private reconnectListeners = new Set<() => void | Promise<void>>();
  private lineListeners = new Set<(line: string) => void>();
  private readonly base: number;
  private readonly max: number;

  constructor(opts: SocketOpts, sup: SupervisorOpts = {}) {
    this.inner = new LiquidsoapSocket(opts);
    this.base = sup.baseDelayMs ?? 2_000;
    this.max = sup.maxDelayMs ?? 30_000;
    this.inner.onDisconnect(() => {
      if (!this.stopped) void this.loop(this.base);
    });
    this.inner.onLine((l) => {
      for (const fn of this.lineListeners) fn(l);
    });
  }

  onLine(fn: (line: string) => void) {
    this.lineListeners.add(fn);
  }

  onReconnect(fn: () => void | Promise<void>) {
    this.reconnectListeners.add(fn);
  }

  isConnected() {
    return this.inner.isConnected();
  }

  async start(): Promise<void> {
    await this.loop(this.base);
  }

  stop(): void {
    this.stopped = true;
    this.inner.close();
  }

  async send(line: string): Promise<void> {
    await this.inner.send(line);
  }

  private async loop(delay: number): Promise<void> {
    while (!this.stopped) {
      try {
        await this.inner.connect();
        for (const fn of this.reconnectListeners) await fn();
        return;
      } catch {
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, this.max);
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="SupervisedSocket|LiquidsoapSocket"`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add workers/queue-daemon/socket.ts workers/queue-daemon/socket.test.ts
git commit -m "feat(queue-daemon): SupervisedSocket with exponential reconnect"
```

---

## Task 9: Queue daemon — hydrator

On startup and on every reconnect: read `QueueItem` rows where `priorityBand='priority_request' AND queueStatus IN ('planned','staged')` ordered by `positionIndex`, resolve their sourceUrls, push each to the socket. If a track is missing an `audio_stream` asset, mark the QueueItem `failed` with `reasonCode="hydrate_missing_asset"`.

**Files:**
- Create: `workers/queue-daemon/hydrator.ts`
- Create: `workers/queue-daemon/hydrator.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { hydrate, type HydrateDeps } from "./hydrator.ts";

function mkDeps(overrides: Partial<HydrateDeps> = {}): HydrateDeps {
  const sent: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];
  return {
    listStaged: async () => [],
    resolveAssetUrl: async () => null,
    markFailed: async (id, reason) => void failed.push({ id, reason }),
    send: async (line) => void sent.push(line),
    // Expose the sinks via closures in tests that need them.
    ...overrides,
  } as HydrateDeps & { __sent?: string[]; __failed?: typeof failed };
}

test("hydrate pushes resolved URLs in positionIndex order", async () => {
  const sent: string[] = [];
  await hydrate({
    listStaged: async () => [
      { id: "q1", trackId: "t1", positionIndex: 1 },
      { id: "q2", trackId: "t2", positionIndex: 2 },
    ],
    resolveAssetUrl: async (tid) => `https://b2/${tid}.mp3`,
    markFailed: async () => {},
    send: async (line) => void sent.push(line),
  });
  assert.deepEqual(sent, [
    "priority.push https://b2/t1.mp3",
    "priority.push https://b2/t2.mp3",
  ]);
});

test("hydrate marks items with missing asset as failed and skips them", async () => {
  const sent: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];
  await hydrate({
    listStaged: async () => [
      { id: "q1", trackId: "t1", positionIndex: 1 },
      { id: "q2", trackId: "missing", positionIndex: 2 },
      { id: "q3", trackId: "t3", positionIndex: 3 },
    ],
    resolveAssetUrl: async (tid) => (tid === "missing" ? null : `https://b2/${tid}.mp3`),
    markFailed: async (id, reason) => void failed.push({ id, reason }),
    send: async (line) => void sent.push(line),
  });
  assert.deepEqual(sent, [
    "priority.push https://b2/t1.mp3",
    "priority.push https://b2/t3.mp3",
  ]);
  assert.deepEqual(failed, [{ id: "q2", reason: "hydrate_missing_asset" }]);
});

test("hydrate does nothing when there are no staged items", async () => {
  const sent: string[] = [];
  await hydrate({
    listStaged: async () => [],
    resolveAssetUrl: async () => "unused",
    markFailed: async () => {},
    send: async (line) => void sent.push(line),
  });
  assert.deepEqual(sent, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="hydrate"`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement**

```ts
export type StagedItem = { id: string; trackId: string | null; positionIndex: number };

export interface HydrateDeps {
  listStaged(): Promise<StagedItem[]>;
  resolveAssetUrl(trackId: string): Promise<string | null>;
  markFailed(queueItemId: string, reasonCode: string): Promise<void>;
  send(line: string): Promise<void>;
}

export async function hydrate(deps: HydrateDeps): Promise<void> {
  const items = await deps.listStaged();
  for (const item of items) {
    if (!item.trackId) {
      await deps.markFailed(item.id, "hydrate_missing_track");
      continue;
    }
    const url = await deps.resolveAssetUrl(item.trackId);
    if (!url) {
      await deps.markFailed(item.id, "hydrate_missing_asset");
      continue;
    }
    await deps.send(`priority.push ${url}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="hydrate"`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add workers/queue-daemon/hydrator.ts workers/queue-daemon/hydrator.test.ts
git commit -m "feat(queue-daemon): priority-queue hydrator with missing-asset handling"
```

---

## Task 10: Queue daemon — HTTP server + `/push` + `/on-track` + `/status`

Pure `node:http` server. All dependencies injected so tests can hit the handlers directly without real prisma or a real socket.

**Files:**
- Create: `workers/queue-daemon/server.ts`
- Create: `workers/queue-daemon/server.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createHandler, type ServerDeps } from "./server.ts";
import { createServer } from "node:http";

function mkDeps(over: Partial<ServerDeps> = {}): ServerDeps & { __sent: string[]; __pushed: any[]; __onTrack: any[] } {
  const __sent: string[] = [];
  const __pushed: any[] = [];
  const __onTrack: any[] = [];
  return {
    pushHandler: async (body) => {
      __pushed.push(body);
      return { queueItemId: "qi-" + __pushed.length };
    },
    onTrackHandler: async (body) => {
      __onTrack.push(body);
    },
    statusHandler: () => ({ socket: "connected", lastPushes: [], lastFailures: [] }),
    ...over,
    __sent,
    __pushed,
    __onTrack,
  } as any;
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

test("POST /push forwards body to handler and returns its result", async () => {
  const deps = mkDeps();
  const h = createHandler(deps);
  const server = createServer(h);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;

  const { status, json } = await hit(port, "/push", {
    trackId: "t1",
    sourceUrl: "u1",
  });
  assert.equal(status, 200);
  assert.equal(json.queueItemId, "qi-1");
  assert.deepEqual(deps.__pushed[0], { trackId: "t1", sourceUrl: "u1" });

  server.close();
});

test("POST /push returns 400 on invalid JSON", async () => {
  const deps = mkDeps();
  const server = createServer(createHandler(deps));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;

  const res = await fetch(`http://127.0.0.1:${port}/push`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not json",
  });
  assert.equal(res.status, 400);

  server.close();
});

test("POST /push returns 400 when handler throws with statusCode=400", async () => {
  const deps = mkDeps({
    pushHandler: async () => {
      throw Object.assign(new Error("unknown track"), { statusCode: 400 });
    },
  });
  const server = createServer(createHandler(deps));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;

  const { status, json } = await hit(port, "/push", { trackId: "bogus", sourceUrl: "u" });
  assert.equal(status, 400);
  assert.match(json.message, /unknown track/);

  server.close();
});

test("POST /on-track invokes handler and returns 200", async () => {
  const deps = mkDeps();
  const server = createServer(createHandler(deps));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;

  const { status } = await hit(port, "/on-track", { sourceUrl: "u", title: "T", artist: "A" });
  assert.equal(status, 200);
  assert.equal(deps.__onTrack.length, 1);
  server.close();
});

test("GET /status returns the status snapshot", async () => {
  const deps = mkDeps({
    statusHandler: () => ({ socket: "reconnecting", lastPushes: [{ a: 1 }], lastFailures: [] }),
  });
  const server = createServer(createHandler(deps));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;

  const { status, json } = await hit(port, "/status");
  assert.equal(status, 200);
  assert.deepEqual(json.socket, "reconnecting");
  assert.equal(json.lastPushes.length, 1);
  server.close();
});

test("unknown path returns 404", async () => {
  const deps = mkDeps();
  const server = createServer(createHandler(deps));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;

  const { status } = await hit(port, "/does-not-exist");
  assert.equal(status, 404);
  server.close();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern="/push|/on-track|/status|unknown path"`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `server.ts`**

```ts
import type { IncomingMessage, ServerResponse, RequestListener } from "node:http";

export type PushBody = {
  trackId: string;
  sourceUrl: string;
  requestId?: string;
  reason?: string;
};

export type OnTrackBody = {
  sourceUrl?: string;
  trackId?: string;
  title?: string;
  artist?: string;
};

export type StatusSnapshot = {
  socket: "connected" | "reconnecting";
  lastPushes: unknown[];
  lastFailures: unknown[];
};

export interface ServerDeps {
  pushHandler(body: PushBody): Promise<{ queueItemId: string }>;
  onTrackHandler(body: OnTrackBody): Promise<void>;
  statusHandler(): StatusSnapshot;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export function createHandler(deps: ServerDeps): RequestListener {
  return async (req, res) => {
    try {
      if (req.method === "POST" && req.url === "/push") {
        const text = await readBody(req);
        let body: PushBody;
        try {
          body = JSON.parse(text);
        } catch {
          return sendJson(res, 400, { error: "invalid json" });
        }
        if (!body?.trackId || !body?.sourceUrl) {
          return sendJson(res, 400, { error: "missing trackId or sourceUrl" });
        }
        const result = await deps.pushHandler(body);
        return sendJson(res, 200, result);
      }
      if (req.method === "POST" && req.url === "/on-track") {
        const text = await readBody(req);
        let body: OnTrackBody;
        try {
          body = JSON.parse(text);
        } catch {
          return sendJson(res, 400, { error: "invalid json" });
        }
        await deps.onTrackHandler(body);
        return sendJson(res, 200, { ok: true });
      }
      if (req.method === "GET" && req.url === "/status") {
        return sendJson(res, 200, deps.statusHandler());
      }
      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      const statusCode = typeof (err as { statusCode?: unknown }).statusCode === "number"
        ? (err as { statusCode: number }).statusCode
        : 500;
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, statusCode, { error: statusCode >= 500 ? "internal" : "bad request", message: msg });
    }
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="/push|/on-track|/status|unknown path"`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add workers/queue-daemon/server.ts workers/queue-daemon/server.test.ts
git commit -m "feat(queue-daemon): HTTP server with /push /on-track /status handlers"
```

---

## Task 11: Queue daemon — entrypoint wiring everything

**Files:**
- Create: `workers/queue-daemon/index.ts`

- [ ] **Step 1: Implement the entrypoint**

```ts
import { createServer } from "node:http";
import { prisma } from "./prisma.ts";
import { SupervisedSocket } from "./socket.ts";
import { RingBuffer } from "./status-buffers.ts";
import { hydrate, type StagedItem } from "./hydrator.ts";
import { createHandler, type OnTrackBody, type PushBody, type StatusSnapshot } from "./server.ts";
import { resolveTrackId, type TrackLookup } from "./resolve-track.ts";

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";
const LS_HOST = process.env.NUMA_LS_HOST ?? "127.0.0.1";
const LS_PORT = Number(process.env.NUMA_LS_PORT ?? 1234);
const HTTP_PORT = Number(process.env.NUMA_DAEMON_PORT ?? 4000);

const sock = new SupervisedSocket({ host: LS_HOST, port: LS_PORT });
const lastPushes = new RingBuffer<{ at: string; trackId: string; url: string }>(10);
const lastFailures = new RingBuffer<{ at: string; reason: string; detail?: string }>(10);

async function stationId(): Promise<string> {
  const s = await prisma.station.findUniqueOrThrow({
    where: { slug: STATION_SLUG },
    select: { id: true },
  });
  return s.id;
}

async function resolveAssetUrl(trackId: string): Promise<string | null> {
  const asset = await prisma.trackAsset.findFirst({
    where: { trackId, assetType: "audio_stream" },
    select: { publicUrl: true },
  });
  return asset?.publicUrl ?? null;
}

async function listStaged(): Promise<StagedItem[]> {
  const sid = await stationId();
  const rows = await prisma.queueItem.findMany({
    where: {
      stationId: sid,
      priorityBand: "priority_request",
      queueStatus: { in: ["planned", "staged"] },
    },
    orderBy: { positionIndex: "asc" },
    select: { id: true, trackId: true, positionIndex: true },
  });
  return rows.map((r) => ({ id: r.id, trackId: r.trackId, positionIndex: r.positionIndex }));
}

async function markFailed(queueItemId: string, reasonCode: string): Promise<void> {
  await prisma.queueItem.update({
    where: { id: queueItemId },
    data: { queueStatus: "failed", reasonCode },
  });
  lastFailures.push({ at: new Date().toISOString(), reason: reasonCode, detail: queueItemId });
}

async function nextPositionIndex(sid: string): Promise<number> {
  const top = await prisma.queueItem.findFirst({
    where: { stationId: sid, priorityBand: "priority_request" },
    orderBy: { positionIndex: "desc" },
    select: { positionIndex: true },
  });
  return (top?.positionIndex ?? 0) + 1;
}

async function pushHandler(body: PushBody): Promise<{ queueItemId: string }> {
  const track = await prisma.track.findUnique({
    where: { id: body.trackId },
    select: { id: true, stationId: true },
  });
  if (!track) throw Object.assign(new Error("unknown track"), { statusCode: 400 });

  const position = await nextPositionIndex(track.stationId);
  const sourceObjectType = body.requestId ? "request" : "track";
  const sourceObjectId = body.requestId ?? body.trackId;

  const item = await prisma.queueItem.create({
    data: {
      stationId: track.stationId,
      queueType: "music",
      sourceObjectType,
      sourceObjectId,
      trackId: body.trackId,
      priorityBand: "priority_request",
      queueStatus: "staged",
      positionIndex: position,
      insertedBy: "queue-daemon",
      reasonCode: body.reason,
    },
    select: { id: true },
  });

  // Fire-and-forget socket send. If offline, the row stays `staged` and the
  // hydrator re-sends on reconnect.
  lastPushes.push({ at: new Date().toISOString(), trackId: body.trackId, url: body.sourceUrl });
  sock
    .send(`priority.push ${body.sourceUrl}`)
    .catch((err) =>
      lastFailures.push({
        at: new Date().toISOString(),
        reason: "socket_send_failed",
        detail: err instanceof Error ? err.message : String(err),
      }),
    );
  return { queueItemId: item.id };
}

async function onTrackHandler(body: OnTrackBody): Promise<void> {
  const sid = await stationId();
  const lookup: TrackLookup = {
    byId: async (id) =>
      prisma.track
        .findUnique({ where: { id }, select: { id: true, stationId: true } })
        .then((t) => (t && t.stationId === sid ? t : null)),
    byTitleArtist: async (title, artist) =>
      prisma.track
        .findFirst({
          where: {
            stationId: sid,
            title: { equals: title, mode: "insensitive" },
            ...(artist ? { artistDisplay: { equals: artist, mode: "insensitive" } } : {}),
          },
          orderBy: { updatedAt: "desc" },
          select: { id: true, stationId: true },
        })
        .then((t) => t ?? null),
  };
  const resolved = await resolveTrackId(body, lookup);
  if (!resolved) return;

  // Complete any prior playing priority item.
  await prisma.queueItem.updateMany({
    where: { stationId: sid, priorityBand: "priority_request", queueStatus: "playing" },
    data: { queueStatus: "completed" },
  });

  // Promote the oldest staged priority item for this track to playing.
  const staged = await prisma.queueItem.findFirst({
    where: {
      stationId: sid,
      priorityBand: "priority_request",
      queueStatus: "staged",
      trackId: resolved.id,
    },
    orderBy: { positionIndex: "asc" },
    select: { id: true, sourceObjectType: true, sourceObjectId: true },
  });
  if (!staged) return; // came from rotation, nothing to transition

  await prisma.queueItem.update({
    where: { id: staged.id },
    data: { queueStatus: "playing" },
  });
  if (staged.sourceObjectType === "request") {
    await prisma.request.update({
      where: { id: staged.sourceObjectId },
      data: { requestStatus: "aired" },
    });
  }
}

function statusHandler(): StatusSnapshot {
  return {
    socket: sock.isConnected() ? "connected" : "reconnecting",
    lastPushes: lastPushes.snapshot(),
    lastFailures: lastFailures.snapshot(),
  };
}

async function runHydrate(): Promise<void> {
  await hydrate({
    listStaged,
    resolveAssetUrl,
    markFailed,
    send: (line) => sock.send(line),
  });
}

async function main() {
  // Start HTTP first so k8s/systemd can probe us while the socket connects.
  const server = createServer(
    createHandler({
      pushHandler: async (b) => {
        try {
          return await pushHandler(b);
        } catch (err: any) {
          if (err?.statusCode === 400) {
            lastFailures.push({ at: new Date().toISOString(), reason: "push_bad_request", detail: err.message });
            throw err;
          }
          throw err;
        }
      },
      onTrackHandler,
      statusHandler,
    }),
  );
  server.listen(HTTP_PORT, "127.0.0.1", () => {
    console.log(`[queue-daemon] http listening on 127.0.0.1:${HTTP_PORT}`);
  });

  // Hydrate on every (re)connect.
  sock.onReconnect(async () => {
    console.log("[queue-daemon] socket up — hydrating");
    await runHydrate().catch((err) => console.error("[queue-daemon] hydrate failed", err));
  });

  await sock.start();

  const shutdown = () => {
    console.log("[queue-daemon] shutting down");
    sock.stop();
    server.close();
    prisma.$disconnect().finally(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("[queue-daemon] fatal", err);
  process.exit(1);
});
```

- [ ] **Step 2: Type-check passes**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Boot the daemon against a fake Liquidsoap**

In one shell (fake socket that accepts connections but does nothing):
```bash
python3 -c "
import socket
s = socket.socket()
s.bind(('127.0.0.1', 1234))
s.listen(5)
print('fake ls listening on 1234')
while True:
    c, _ = s.accept()
    print('conn')
"
```

In another shell:
```bash
NUMA_DAEMON_PORT=4000 NUMA_LS_PORT=1234 npm run queue:daemon
```
Expected daemon output:
```
[queue-daemon] http listening on 127.0.0.1:4000
[queue-daemon] socket up — hydrating
```

Fake server output: `conn` appears.

In a third shell:
```bash
curl -sS http://127.0.0.1:4000/status | jq .
```
Expected JSON: `{ "socket": "connected", "lastPushes": [], "lastFailures": [] }`.

Stop both processes.

- [ ] **Step 4: Commit**

```bash
git add workers/queue-daemon/index.ts
git commit -m "feat(queue-daemon): entrypoint wiring socket, hydrator, HTTP handlers"
```

---

## Task 12: Liquidsoap config — telnet socket + request.queue + fallback + daemon POST

**Files:**
- Modify: `liquidsoap/numa.liq`

- [ ] **Step 1: Replace the source stanza and add telnet + daemon POST**

Open `liquidsoap/numa.liq` and replace everything from line 13 (`settings.frame.audio.samplerate.set(44100)`) down through the end of the file with:

```liquidsoap
settings.frame.audio.samplerate.set(44100)
settings.log.stdout.set(true)
settings.log.level.set(3)

# ─── Local control socket (loopback only) ──────────────────────────
settings.server.telnet.set(true)
settings.server.telnet.bind_addr.set("127.0.0.1")
settings.server.telnet.port.set(1234)

playlist_file = "/etc/numa/playlist.m3u"

# ─── Sources ───────────────────────────────────────────────────────
priority = request.queue(id="priority")

rotation = playlist.reloadable(
  id="rotation",
  reload_mode="watch",
  playlist_file
)

# ─── Now-playing notification ──────────────────────────────────────
api_url = environment.get(
  default="https://numaradio.com/api/internal/track-started",
  "NUMA_TRACK_API_URL"
)
daemon_url = environment.get(
  default="http://127.0.0.1:4000/on-track",
  "NUMA_DAEMON_TRACK_URL"
)

def notify_track_started(metadata) =
  filename = metadata["filename"]
  source_url = metadata["source_url"]
  initial_uri = metadata["initial_uri"]
  title = metadata["title"]
  artist = metadata["artist"]
  src = if source_url != "" then source_url
        elsif initial_uri != "" then initial_uri
        else filename end
  log.important(
    "[numa] track: src=" ^ src ^
    " filename=" ^ filename ^
    " source_url=" ^ source_url ^
    " initial_uri=" ^ initial_uri ^
    " title=" ^ title ^
    " artist=" ^ artist
  )
  if src != "" or title != "" then
    secret = environment.get(default="", "INTERNAL_API_SECRET")
    body = json.stringify({sourceUrl=src, title=title, artist=artist})
    if secret == "" then
      log.severe("[numa] INTERNAL_API_SECRET not set — skipping Vercel notify")
    else
      try
        response = http.post(
          headers=[
            ("Content-Type", "application/json"),
            ("x-internal-secret", secret)
          ],
          data=body,
          api_url
        )
        if response.status_code != 200 then
          log.severe("[numa] track-started POST to Vercel failed: " ^ string(response.status_code))
        end
      catch err do
        log.severe("[numa] track-started POST to Vercel error: " ^ string(err))
      end
    end
    # Also notify the local daemon. Loopback-only, no auth needed.
    try
      _ = http.post(
        headers=[("Content-Type", "application/json")],
        data=body,
        daemon_url
      )
    catch err do
      log.severe("[numa] track-started POST to daemon error: " ^ string(err))
    end
  end
end

# ─── Composite source with track-boundary safety ───────────────────
# track_sensitive=true: sources only switch at track boundaries. A
# priority push mid-song waits for the current song to finish. A
# rotation reload mid-song also waits.
source = fallback(track_sensitive=true, [priority, rotation, blank()])

source.on_track(notify_track_started)
log.important("[numa] notify pipeline ready, api=" ^ api_url ^ " daemon=" ^ daemon_url)

source = mksafe(source)

output.icecast(
  %mp3(bitrate=192, samplerate=44100, stereo=true),
  host="localhost",
  port=8000,
  password=environment.get("ICECAST_SOURCE_PASSWORD"),
  mount="/stream",
  name="Numa Radio",
  description="Always-on AI radio",
  url="https://numaradio.com",
  genre="Various",
  source
)
```

- [ ] **Step 2: Syntax-check the config (does not start icecast output)**

Run: `liquidsoap --check liquidsoap/numa.liq`
Expected: no fatal errors; any warnings are OK to note.

- [ ] **Step 3: Commit**

```bash
git add liquidsoap/numa.liq
git commit -m "feat(liquidsoap): priority+rotation fallback, local telnet socket, daemon notify"
```

---

## Task 13: Manual CLI — `scripts/queue-push.ts`

**Files:**
- Create: `scripts/queue-push.ts`

- [ ] **Step 1: Implement the CLI**

```ts
import "../lib/load-env.ts";
import { PrismaClient } from "@prisma/client";

function arg(name: string): string | undefined {
  const flag = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(flag));
  return hit?.slice(flag.length);
}

async function main() {
  const trackId = arg("trackId");
  const reason = arg("reason");
  if (!trackId) {
    console.error("usage: npm run queue:push -- --trackId=<id> [--reason=<text>]");
    process.exit(2);
  }

  const prisma = new PrismaClient();
  try {
    const track = await prisma.track.findUnique({
      where: { id: trackId },
      select: {
        id: true,
        assets: {
          where: { assetType: "audio_stream" },
          take: 1,
          select: { publicUrl: true },
        },
      },
    });
    if (!track) throw new Error(`no track with id=${trackId}`);
    const url = track.assets[0]?.publicUrl;
    if (!url) throw new Error(`track ${trackId} has no audio_stream asset`);

    const daemon = process.env.NUMA_DAEMON_URL ?? "http://127.0.0.1:4000";
    const res = await fetch(`${daemon}/push`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trackId, sourceUrl: url, reason }),
    });
    const body = await res.text();
    console.log(`[queue:push] ${res.status} ${body}`);
    if (!res.ok) process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[queue:push] failed", err);
  process.exit(1);
});
```

- [ ] **Step 2: Dry-check (no push, just arg validation)**

Run: `npm run queue:push`
Expected: exits with code 2 and prints the usage line.

- [ ] **Step 3: Commit**

```bash
git add scripts/queue-push.ts
git commit -m "feat(queue-push): manual CLI that POSTs to the queue daemon"
```

---

## Task 14: Systemd units

**Files:**
- Create: `deploy/systemd/numa-queue-daemon.service`
- Create: `deploy/systemd/numa-rotation-refresher.service`
- Create: `deploy/systemd/numa-rotation-refresher.timer`

- [ ] **Step 1: Create queue daemon unit**

```ini
[Unit]
Description=Numa Radio — queue daemon (priority queue + Liquidsoap socket)
After=network-online.target numa-liquidsoap.service
Wants=network-online.target

[Service]
Type=simple
User=marku
WorkingDirectory=/home/marku/saas/numaradio
EnvironmentFile=/etc/numa/env
ExecStart=/usr/bin/npm run queue:daemon
Restart=always
RestartSec=2s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2: Create rotation refresher service unit**

```ini
[Unit]
Description=Numa Radio — regenerate /etc/numa/playlist.m3u from Neon
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=marku
WorkingDirectory=/home/marku/saas/numaradio
EnvironmentFile=/etc/numa/env
ExecStart=/usr/bin/npm run refresh-rotation
```

- [ ] **Step 3: Create rotation refresher timer unit**

```ini
[Unit]
Description=Numa Radio — rotation refresh every 2 minutes

[Timer]
OnBootSec=30s
OnUnitActiveSec=2min
Persistent=true
Unit=numa-rotation-refresher.service

[Install]
WantedBy=timers.target
```

- [ ] **Step 4: Install the units on the mini-server**

Run:
```bash
sudo cp deploy/systemd/numa-queue-daemon.service /etc/systemd/system/
sudo cp deploy/systemd/numa-rotation-refresher.service /etc/systemd/system/
sudo cp deploy/systemd/numa-rotation-refresher.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now numa-rotation-refresher.timer
sudo systemctl enable --now numa-queue-daemon.service
```

- [ ] **Step 5: Restart Liquidsoap to pick up the new config**

```bash
sudo systemctl restart numa-liquidsoap
```

- [ ] **Step 6: Verify all three units are active**

Run: `systemctl status numa-queue-daemon numa-rotation-refresher.timer numa-liquidsoap --no-pager`
Expected: all three `active (running)` / `active (waiting)` for the timer.

Run: `curl -sS http://127.0.0.1:4000/status | jq .`
Expected: `{ "socket": "connected", "lastPushes": [], "lastFailures": [] }`.

Run: `cat /etc/numa/playlist.m3u`
Expected: an m3u file with one or more B2 URLs (one in today's state).

- [ ] **Step 7: Commit**

```bash
git add deploy/systemd/
git commit -m "feat(systemd): units for queue daemon and rotation refresher"
```

---

## Task 15: End-to-end integration test script

**Files:**
- Create: `scripts/test-queue-e2e.sh`

- [ ] **Step 1: Implement the script**

```bash
#!/usr/bin/env bash
# End-to-end test for the on-demand queue pipeline.
#
# Must run on the mini-server (Orion). Assumes numa-liquidsoap, icecast2,
# and numa-queue-daemon are active. Uses the single seed track "One More
# Dance" as the push subject.
#
# The script does NOT mutate audio playback directly — it just asserts the
# DB/service contracts hold end-to-end.

set -euo pipefail

TRACK_ID="cmo5o2tsa0002wey8w4398pge"
DAEMON="http://127.0.0.1:4000"

echo "== 1. services active =="
for u in numa-liquidsoap numa-queue-daemon icecast2; do
  systemctl is-active --quiet "$u" || { echo "FAIL: $u not active"; exit 1; }
  echo "  ok: $u"
done

echo "== 2. daemon /status reachable =="
STATUS=$(curl -fsS "$DAEMON/status")
echo "  $STATUS"

echo "== 3. push the seed track =="
RES=$(curl -fsS -X POST "$DAEMON/push" \
  -H "Content-Type: application/json" \
  -d "{\"trackId\":\"$TRACK_ID\",\"sourceUrl\":\"https://f003.backblazeb2.com/file/numaradio/stations/numaradio/tracks/$TRACK_ID/audio/stream.mp3\",\"reason\":\"e2e_test\"}")
echo "  $RES"
QI=$(echo "$RES" | python3 -c "import sys,json; print(json.load(sys.stdin)['queueItemId'])")
echo "  queueItemId=$QI"

echo "== 4. wait for on_track to fire (up to 300s) =="
# Tail the Liquidsoap journal for the [numa] track line referencing our URL.
deadline=$(( $(date +%s) + 300 ))
while [ "$(date +%s)" -lt $deadline ]; do
  if journalctl -u numa-liquidsoap --since "5 min ago" \
      | grep -q "tracks/$TRACK_ID/audio/stream.mp3"; then
    echo "  ok: saw track line"
    break
  fi
  sleep 5
done
if [ "$(date +%s)" -ge $deadline ]; then
  echo "FAIL: did not observe track boundary within 5 min"
  exit 1
fi

echo "== 5. QueueItem transitioned past 'staged' =="
# Use prisma studio or a one-liner; here we use psql via DATABASE_URL.
# shellcheck disable=SC1091
source /etc/numa/env
STATUS=$(psql "$DATABASE_URL" -At -c \
  "SELECT \"queueStatus\" FROM \"QueueItem\" WHERE id = '$QI'")
echo "  queueStatus=$STATUS"
case "$STATUS" in
  playing|completed) echo "  ok";;
  *) echo "FAIL: expected playing|completed, got $STATUS"; exit 1;;
esac

echo "== 6. PlayHistory has a recent row for this track =="
N=$(psql "$DATABASE_URL" -At -c \
  "SELECT COUNT(*) FROM \"PlayHistory\" WHERE \"trackId\" = '$TRACK_ID' AND \"startedAt\" > now() - interval '10 minutes'")
echo "  count=$N"
[ "$N" -ge 1 ] || { echo "FAIL: no PlayHistory row"; exit 1; }

echo "== PASS =="
```

- [ ] **Step 2: Make executable and run it**

Run:
```bash
chmod +x scripts/test-queue-e2e.sh
./scripts/test-queue-e2e.sh
```
Expected output concludes with `== PASS ==`. Track boundary wait may take up to the current-song-remaining duration + up to 2 min (since our current seed loops one song).

- [ ] **Step 3: Commit**

```bash
git add scripts/test-queue-e2e.sh
git commit -m "test(e2e): queue + rotation integration script"
```

---

## Task 16: Manual verification checklist

Run these **on the mini-server** after Task 15 passes. These exercise the listener-facing invariants that unit tests can't reach.

- [ ] **Check 1: FIFO under rapid pushes**

Open two shells on the mini-server. In shell A, tail the journal:
```bash
journalctl -u numa-liquidsoap -f | grep "\[numa\] track:"
```
In shell B, push the seed track three times in a row (it's the only one we have; repeat is fine):
```bash
for i in 1 2 3; do
  curl -fsS -X POST http://127.0.0.1:4000/push \
    -H "Content-Type: application/json" \
    -d '{"trackId":"cmo5o2tsa0002wey8w4398pge","sourceUrl":"https://f003.backblazeb2.com/file/numaradio/stations/numaradio/tracks/cmo5o2tsa0002wey8w4398pge/audio/stream.mp3","reason":"fifo-'$i'"}'
  echo
done
```
Expected: shell A shows the track line fire three times in sequence, each one waiting for the previous to finish.

- [ ] **Check 2: Daemon restart re-hydrates**

After Check 1 (or with at least one staged item in Neon):
```bash
sudo systemctl restart numa-queue-daemon
journalctl -u numa-queue-daemon --since "1 min ago" | grep hydrat
```
Expected: a log line `[queue-daemon] socket up — hydrating` shortly after restart, and any still-staged items resume airing at the next boundary.

- [ ] **Check 3: Broken URL fails gracefully**

```bash
curl -fsS -X POST http://127.0.0.1:4000/push \
  -H "Content-Type: application/json" \
  -d '{"trackId":"cmo5o2tsa0002wey8w4398pge","sourceUrl":"https://example.com/does-not-exist.mp3","reason":"broken-test"}'
```
Listen: the stream keeps playing; no dead air. After it would have aired, check `curl -s http://127.0.0.1:4000/status | jq '.lastFailures'` — you should not see `socket_send_failed` (because the socket push succeeded; Liquidsoap just couldn't resolve the URL and moved on).

- [ ] **Check 4: Rotation picks up new library tracks within 2 min**

Insert a new `Track` row in Neon (via Prisma Studio) with `trackStatus='ready'` and `airingPolicy='library'`, attach a `TrackAsset` with `assetType='audio_stream'` pointing at a valid B2 URL. Wait up to 2 min, then:
```bash
cat /etc/numa/playlist.m3u
```
Expected: the new URL appears. (The current-playing song finishes first; subsequent rotation plays include the new track.)

- [ ] **Check 5: Empty library → silence, not dead air**

Not required to execute; confirm by reasoning that the fallback chain ends in `blank()` and the spec's §6.4 empty-state behavior has been preserved. If we ever want to verify live: mark all library tracks `trackStatus='held'` for 3 min, listen for silence (not a disconnect), then revert.

---

## Task 17: Update handoff

**Files:**
- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: Update the Phase section**

In `docs/HANDOFF.md`, under the existing "Public site" or similar "where we are" block, add a new section:

```markdown
**On-demand queue + Neon rotation — LIVE**
- ✅ `numa-queue-daemon.service` active on Orion (loopback `:4000`).
- ✅ `numa-rotation-refresher.timer` active; regenerates `/etc/numa/playlist.m3u`
  from Neon every 2 min (library shuffle minus last 20 plays).
- ✅ `numa.liq` now uses `fallback([priority, rotation, blank()], track_sensitive=true)`
  — user requests air at the next track boundary, never mid-song.
- Manual queue push: `npm run queue:push -- --trackId=<id>`
- Spec: `docs/superpowers/specs/2026-04-20-on-demand-track-queue-design.md`
- Plan: `docs/superpowers/plans/2026-04-20-on-demand-track-queue.md`
- NanoClaw integration seam: `POST http://127.0.0.1:4000/push` with
  `{ trackId, sourceUrl, requestId?, reason? }`.
```

- [ ] **Step 2: Commit**

```bash
git add docs/HANDOFF.md
git commit -m "docs: handoff — on-demand queue + Neon rotation live"
```

---

## Self-review notes (pre-execution)

- **Spec coverage**: Each of the spec's components (§5.1–§5.6) has an explicit task. Data flow paths A and B are exercised by Task 15 E2E and Task 16 manual checks. Failure handling rows are exercised by Tasks 10/11 (server returns 400 on bad JSON; `hydrate` marks `hydrate_missing_asset`; socket supervisor backoff is covered in Task 8). `PlayHistory` insert — Task 3. `QueueItem` durability — Task 11 wiring + Task 16 Check 2. Atomic m3u write — Task 2 Step 3.
- **Placeholders**: None. All code blocks are complete; commands have expected outputs; no "implement later."
- **Type consistency**: `StagedItem` in hydrator matches the select in index.ts. `PushBody` / `OnTrackBody` / `StatusSnapshot` defined once in `server.ts`, consumed everywhere. `TrackLookup` / `TrackRef` in resolver reused in index.ts with the prisma-backed implementation. `assetType="audio_stream"` is used everywhere (never the earlier spec-placeholder `audio_master`). `priorityBand="priority_request"` string is consistent.
- **Outstanding asks**: None that block execution. Dashboard UI for `lastFailures` is explicitly deferred in the spec and this plan. Janitor for stuck `staged` items is deferred.
