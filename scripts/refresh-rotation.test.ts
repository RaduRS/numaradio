import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlaylist } from "./refresh-rotation.ts";

type T = { id: string; url: string; title: string };
const t = (id: string, url: string): T => ({ id, url, title: id });

test("buildPlaylist excludes recent track ids and returns one url per line", () => {
  const library: T[] = [t("a", "https://b2/a.mp3"), t("b", "https://b2/b.mp3"), t("c", "https://b2/c.mp3")];
  const recent = new Set(["b"]);
  const out = buildPlaylist(library, recent, () => 0);
  const lines = out.trim().split("\n");
  assert.equal(lines.length, 2);
  assert.ok(lines.every((l) => l.startsWith("https://b2/")));
  assert.ok(!lines.includes("https://b2/b.mp3"));
});

test("buildPlaylist falls back to full library only when every track is recent", () => {
  const library: T[] = [t("a", "a"), t("b", "b"), t("c", "c")];
  const recent = new Set(["a", "b", "c"]);
  const out = buildPlaylist(library, recent, () => 0);
  const lines = out.trim().split("\n");
  assert.equal(lines.length, 3, "empty exclusion → full library");
});

test("buildPlaylist keeps a single-track exclusion instead of falling back to full library", () => {
  // Repro of the 2026-04-20 repeat/starvation bug: with 8 library tracks and
  // RECENT_WINDOW=20, the exclusion regularly shrinks to 1 non-recent track.
  // The old MIN_POOL=5 fallback discarded that and handed back the full
  // library, so the just-played tracks were candidates again AND the
  // one non-recent track (e.g. Hold The Morning) lost its privileged slot.
  const library: T[] = [
    t("a", "u-a"), t("b", "u-b"), t("c", "u-c"), t("d", "u-d"),
    t("e", "u-e"), t("f", "u-f"), t("g", "u-g"), t("h", "u-h"),
  ];
  const recent = new Set(["a", "b", "c", "d", "e", "f", "g"]);
  const out = buildPlaylist(library, recent, () => 0);
  const lines = out.trim().split("\n");
  assert.deepEqual(lines, ["u-h"], "only the non-recent track should air next");
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
