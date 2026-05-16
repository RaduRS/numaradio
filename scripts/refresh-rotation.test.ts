import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlaylist, buildManualPlaylist, cyclePlayedFrom, spaceByArtist } from "./refresh-rotation.ts";

type T = { id: string; url: string; title: string; artist: string | null };
const t = (id: string, url: string, artist: string | null = null): T => ({ id, url, title: id, artist });

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

test("buildManualPlaylist preserves the operator's order verbatim", () => {
  const library: T[] = [t("a", "u-a"), t("b", "u-b"), t("c", "u-c"), t("d", "u-d")];
  const r = buildManualPlaylist(library, ["c", "a", "d"], new Set());
  assert.deepEqual(r.remainingIds, ["c", "a", "d"]);
  assert.equal(r.content, "u-c\nu-a\nu-d\n");
});

test("buildManualPlaylist drops ids that already aired in the current cycle (manual-mode bridge)", () => {
  // Operator put A in their order, but A already played this cycle —
  // dropping it prevents a second airing inside one cycle.
  const library: T[] = [t("a", "u-a"), t("b", "u-b"), t("c", "u-c")];
  const r = buildManualPlaylist(library, ["a", "b", "c"], new Set(["a"]));
  assert.deepEqual(r.remainingIds, ["b", "c"]);
});

test("buildManualPlaylist drops the currently-playing track (seam bridge into manual mode)", () => {
  // Operator put the currently-playing track at position 0 — drop it so
  // it can't air twice in a row.
  const library: T[] = [t("a", "u-a"), t("b", "u-b"), t("c", "u-c")];
  const r = buildManualPlaylist(library, ["a", "b"], new Set(["a"]));
  assert.deepEqual(r.remainingIds, ["b"]);
  assert.equal(r.content, "u-b\n");
});

test("buildManualPlaylist drops ids no longer in the library (deleted/unready)", () => {
  const library: T[] = [t("a", "u-a"), t("b", "u-b")];
  const r = buildManualPlaylist(library, ["a", "ghost", "b"], new Set());
  assert.deepEqual(r.remainingIds, ["a", "b"]);
});

test("buildManualPlaylist returns empty content when nothing remains (caller falls back to auto)", () => {
  const library: T[] = [t("a", "u-a"), t("b", "u-b")];
  const r = buildManualPlaylist(library, ["a", "b"], new Set(["a", "b"]));
  assert.deepEqual(r.remainingIds, []);
  assert.equal(r.content, "");
});

test("manual + auto-tail concat: m3u carries the full upcoming pool, no duplicates at the seam", () => {
  // Simulates what runRefresh writes when manual mode is active: the
  // operator's remaining order followed by an auto-shuffled pool of the
  // rest. Without the auto fill, a 2-track manual remainder would leave
  // Liquidsoap looping a tiny m3u; with it, the queue stays full.
  const library: T[] = Array.from({ length: 8 }, (_, i) => t(`k${i}`, `u${i}`));
  const manualRemaining = ["k1", "k3"];
  const cycleExclude = new Set<string>(["k0", "k7"]); // already played + nowPlaying
  const bridgeExclude = new Set<string>(["k7"]);

  const manual = buildManualPlaylist(library, manualRemaining, cycleExclude);
  const tailExclude = new Set<string>([...cycleExclude, ...manual.remainingIds]);
  const tail = buildPlaylist(library, tailExclude, bridgeExclude, () => 0);
  const combined = (manual.content + tail).split("\n").filter(Boolean);

  // First 2 are the manual order, verbatim
  assert.deepEqual(combined.slice(0, 2), ["u1", "u3"]);
  // Tail covers the remaining eligible tracks (k2, k4, k5, k6) in some order
  const tailUrls = combined.slice(2).sort();
  assert.deepEqual(tailUrls, ["u2", "u4", "u5", "u6"]);
  // No duplicates at the seam
  assert.equal(new Set(combined).size, combined.length);
  // Bridge holds: k7 (currently playing) is nowhere
  assert.ok(!combined.includes("u7"));
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

function maxRunIn<T extends { artist: string | null }>(seq: readonly T[]): number {
  let best = 0, cur = 0, prev: string | null = null;
  for (const t of seq) {
    const a = t.artist?.trim().toLowerCase() ?? null;
    if (a !== null && a === prev) cur++;
    else cur = 1;
    if (cur > best) best = cur;
    prev = a;
  }
  return best;
}

test("spaceByArtist (maxRun=2) eliminates 3-in-a-row on Russell-dominant catalog", () => {
  // 6 R + 3 B + 2 D — feasible for maxRun=2.
  const pool: T[] = [
    t("r1", "u-r1", "Russell Ross"), t("r2", "u-r2", "Russell Ross"),
    t("r3", "u-r3", "Russell Ross"), t("r4", "u-r4", "Russell Ross"),
    t("r5", "u-r5", "Russell Ross"), t("r6", "u-r6", "Russell Ross"),
    t("b1", "u-b1", "Barely Jared"), t("b2", "u-b2", "Barely Jared"),
    t("b3", "u-b3", "Barely Jared"),
    t("d1", "u-d1", "Digital Culprit"), t("d2", "u-d2", "Digital Culprit"),
  ];
  const out = spaceByArtist(pool, 2);
  assert.equal(out.length, pool.length, "no track lost");
  assert.ok(maxRunIn(out) <= 2, `max run was ${maxRunIn(out)}, expected ≤ 2`);
});

test("spaceByArtist case-insensitive on artist", () => {
  const pool: T[] = [
    t("a", "u-a", "russell ross"), t("b", "u-b", "RUSSELL ROSS"),
    t("c", "u-c", "Russell Ross"), t("d", "u-d", "Digital Culprit"),
  ];
  // 3 R + 1 D, maxRun=2 → should produce R R D R, not R R R D
  const out = spaceByArtist(pool, 2);
  assert.ok(maxRunIn(out) <= 2);
});

test("spaceByArtist degrades gracefully when dominant artist > ~2/3 of pool", () => {
  // 5 of 6 are X — maxRun=2 impossible, must accept ≥3-run somewhere.
  const pool: T[] = [
    t("x1", "u-x1", "X"), t("x2", "u-x2", "X"), t("x3", "u-x3", "X"),
    t("x4", "u-x4", "X"), t("x5", "u-x5", "X"), t("o1", "u-o1", "Other"),
  ];
  const out = spaceByArtist(pool, 2);
  assert.equal(out.length, 6);
  assert.equal(new Set(out.map((x) => x.id)).size, 6, "all unique, no track lost");
});

test("spaceByArtist treats null artists as run-breakers", () => {
  const pool: T[] = [
    t("a", "u-a", null), t("b", "u-b", null), t("c", "u-c", null),
  ];
  const out = spaceByArtist(pool, 2);
  assert.equal(out.length, 3);
});

test("buildPlaylist (integration) — Russell-heavy catalog never produces 3-in-a-row", () => {
  // 8 R + 3 B + 2 D = ~62% R, mirrors prod ratio. Run buildPlaylist 50×
  // with shifting RNG; assert no run exceeds 2 in any output.
  const library: T[] = [
    ...Array.from({ length: 8 }, (_, i) => t(`r${i}`, `u-r${i}`, "Russell Ross")),
    ...Array.from({ length: 3 }, (_, i) => t(`b${i}`, `u-b${i}`, "Barely Jared")),
    ...Array.from({ length: 2 }, (_, i) => t(`d${i}`, `u-d${i}`, "Digital Culprit")),
  ];
  const byUrl = new Map(library.map((x) => [x.url, x] as const));
  for (let seed = 1; seed <= 50; seed++) {
    let s = seed;
    const rng = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    const lines = buildPlaylist(library, new Set(), new Set(), rng).trim().split("\n");
    const seq = lines.map((u) => byUrl.get(u)!);
    assert.ok(
      maxRunIn(seq) <= 2,
      `seed=${seed} produced run of ${maxRunIn(seq)}: ${seq.map((x) => x.artist?.[0]).join("")}`,
    );
  }
});
