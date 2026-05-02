import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlaylist, cyclePlayedFrom } from "./refresh-rotation.ts";

type T = { id: string; url: string; title: string };
const t = (id: string, url: string): T => ({ id, url, title: id });

test("cyclePlayedFrom collects distinct ids until the first duplicate", () => {
  // Most-recent-first order; "a" recurs → cycle is the 3 plays before that.
  const ids = ["d", "c", "b", "a", "c", "x", "y"];
  const seen = cyclePlayedFrom(ids, 100);
  assert.deepEqual([...seen].sort(), ["a", "b", "c", "d"]);
});

test("cyclePlayedFrom caps at librarySize (full cycle just completed)", () => {
  const ids = ["e", "d", "c", "b", "a"];
  const seen = cyclePlayedFrom(ids, 3);
  assert.equal(seen.size, 3);
  assert.deepEqual([...seen], ["e", "d", "c"]);
});

test("cyclePlayedFrom returns empty for empty history", () => {
  assert.equal(cyclePlayedFrom([], 10).size, 0);
});

test("buildPlaylist excludes cycle-played tracks", () => {
  const library: T[] = [t("a", "u-a"), t("b", "u-b"), t("c", "u-c"), t("d", "u-d")];
  const cycle = new Set(["a", "b"]);
  const out = buildPlaylist(library, cycle, new Set(), () => 0);
  const lines = out.trim().split("\n");
  assert.equal(lines.length, 2);
  assert.ok(!lines.includes("u-a"));
  assert.ok(!lines.includes("u-b"));
});

test("buildPlaylist wraps to library minus the bridge when cycle exhausts the pool", () => {
  // Whole library has aired in the current cycle (incl. nowPlaying "d").
  // Wrap should reshuffle library minus the bridge so position 0 ≠ "d".
  const library: T[] = [t("a", "u-a"), t("b", "u-b"), t("c", "u-c"), t("d", "u-d")];
  const cycle = new Set(["a", "b", "c", "d"]);
  const bridge = new Set(["d"]);
  const out = buildPlaylist(library, cycle, bridge, () => 0);
  const lines = out.trim().split("\n");
  assert.equal(lines.length, 3, "wrap pool drops the bridge track");
  assert.ok(!lines.includes("u-d"), "bridge track must not air right after itself");
});

test("buildPlaylist degenerate single-track library still emits the track on wrap", () => {
  const library: T[] = [t("a", "u-a")];
  const cycle = new Set(["a"]);
  const bridge = new Set(["a"]);
  const out = buildPlaylist(library, cycle, bridge, () => 0);
  assert.equal(out.trim(), "u-a", "bridge can't drop the only track");
});

test("buildPlaylist newly approved track surfaces in the current cycle without waiting", () => {
  // Mid-cycle: "a" and "b" already aired. "z" is brand new (just approved)
  // — not in cycle, so it lands in the upcoming pool alongside "c", "d".
  const library: T[] = [t("a", "u-a"), t("b", "u-b"), t("c", "u-c"), t("d", "u-d"), t("z", "u-z")];
  const cycle = new Set(["a", "b"]);
  const out = buildPlaylist(library, cycle, new Set(), () => 0);
  const lines = out.trim().split("\n");
  assert.equal(lines.length, 3);
  assert.ok(lines.includes("u-z"), "new track must appear in remaining cycle");
});

test("buildPlaylist is deterministic given a seeded rng", () => {
  const library: T[] = Array.from({ length: 10 }, (_, i) => t(`k${i}`, `u${i}`));
  let seed = 0;
  const rng = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const a = buildPlaylist(library, new Set(), new Set(), rng);
  seed = 0;
  const b = buildPlaylist(library, new Set(), new Set(), rng);
  assert.equal(a, b);
});

test("buildPlaylist returns empty string when library is empty", () => {
  assert.equal(buildPlaylist([], new Set(), new Set(), () => 0), "");
});

test("simulated full cycle: every track airs exactly once before any repeat", () => {
  // End-to-end generational guarantee. Walk N picks; on each pick:
  //   - derive cycle from history
  //   - shuffle the remaining pool
  //   - "play" position 0 → push to history
  // After library.length picks, every track must have aired exactly once.
  const library: T[] = Array.from({ length: 12 }, (_, i) => t(`k${i}`, `u${i}`));
  const history: string[] = []; // most recent first
  let nowPlaying: string | null = null;
  let seed = 1;
  const rng = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  for (let i = 0; i < library.length; i++) {
    const cycle = cyclePlayedFrom(history, library.length);
    const bridge = new Set<string>();
    if (nowPlaying) {
      cycle.add(nowPlaying);
      bridge.add(nowPlaying);
    }
    const lines = buildPlaylist(library, cycle, bridge, rng).trim().split("\n").filter(Boolean);
    assert.ok(lines.length > 0, `pick ${i}: pool not empty`);
    const nextUrl = lines[0];
    const nextTrack = library.find((t) => t.url === nextUrl)!;
    history.unshift(nextTrack.id);
    nowPlaying = nextTrack.id;
  }

  assert.equal(new Set(history).size, library.length, "every track aired exactly once");
});

test("simulated cycle wrap: first pick of cycle N+1 is not the last of cycle N", () => {
  // Play through one full cycle, then take one more pick. The seam track
  // should never repeat: the bridge guarantees position 0 ≠ just-played.
  const library: T[] = Array.from({ length: 8 }, (_, i) => t(`k${i}`, `u${i}`));
  const history: string[] = [];
  let nowPlaying: string | null = null;
  let seed = 42;
  const rng = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const pick = (): string => {
    const cycle = cyclePlayedFrom(history, library.length);
    const bridge = new Set<string>();
    if (nowPlaying) {
      cycle.add(nowPlaying);
      bridge.add(nowPlaying);
    }
    const url = buildPlaylist(library, cycle, bridge, rng).trim().split("\n")[0];
    const track = library.find((t) => t.url === url)!;
    history.unshift(track.id);
    nowPlaying = track.id;
    return track.id;
  };

  for (let i = 0; i < library.length; i++) pick();
  const lastOfCycleN = nowPlaying!;
  const firstOfCycleN1 = pick();
  assert.notEqual(firstOfCycleN1, lastOfCycleN, "seam must not repeat the just-played track");
});
