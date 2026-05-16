// lib/show-genre-fit.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { showsForGenre, genreFitsShow } from "./show-genre-fit.ts";

test("showsForGenre: ambient maps to Night Shift only", () => {
  assert.deepEqual([...showsForGenre("ambient")], ["Night Shift"]);
});

test("showsForGenre: unknown genre is permissive (returns all blocks)", () => {
  const r = showsForGenre("unidentified noise");
  assert.equal(r.length, 4);
});

test("showsForGenre: null/undefined → all blocks", () => {
  assert.equal(showsForGenre(null).length, 4);
  assert.equal(showsForGenre(undefined).length, 4);
});

test("showsForGenre: substring match (indie synth-pop hits 'synth')", () => {
  const r = showsForGenre("indie synth-pop");
  assert.ok(r.includes("Prime Hours") || r.includes("Night Shift"));
});

test("genreFitsShow: ambient fits Night Shift", () => {
  assert.equal(genreFitsShow("ambient", "Night Shift"), true);
});

test("genreFitsShow: ambient does NOT fit Prime Hours", () => {
  assert.equal(genreFitsShow("ambient", "Prime Hours"), false);
});
