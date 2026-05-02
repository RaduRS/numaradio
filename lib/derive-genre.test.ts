import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveGenreFromText } from "./derive-genre.ts";

test("deriveGenreFromText catches the explicit genre word in a freeform prompt", () => {
  assert.equal(deriveGenreFromText("Dubstep"), "Dubstep");
  assert.equal(deriveGenreFromText("Ranny day but edm in A minor and blue kinda sad lyrics"), "EDM");
  assert.equal(deriveGenreFromText("chill lo-fi 90 BPM A minor rainy afternoon"), "Lo-Fi");
  assert.equal(deriveGenreFromText("fun pop about lollipops and time machines"), "Pop");
  assert.equal(deriveGenreFromText("A major about 130bpm EDM with rand b influences and regeton"), "EDM");
});

test("deriveGenreFromText prefers more specific genre over broader (lo-fi over indie, edm over dance)", () => {
  assert.equal(deriveGenreFromText("indie lo-fi vibes"), "Lo-Fi");
  assert.equal(deriveGenreFromText("dance EDM track"), "EDM");
  assert.equal(deriveGenreFromText("reggaeton dance party"), "Reggaeton");
});

test("deriveGenreFromText handles common variants (lofi, hiphop, synth-wave)", () => {
  assert.equal(deriveGenreFromText("lofi beats"), "Lo-Fi");
  assert.equal(deriveGenreFromText("hiphop track"), "Hip-Hop");
  assert.equal(deriveGenreFromText("synth-wave 80s"), "Synthwave");
  assert.equal(deriveGenreFromText("dnb energy"), "Drum & Bass");
});

test("deriveGenreFromText returns null when no genre word is present", () => {
  assert.equal(deriveGenreFromText("something funny"), null);
  assert.equal(deriveGenreFromText(""), null);
  assert.equal(deriveGenreFromText(null), null);
  assert.equal(deriveGenreFromText("just a song about my dog"), null);
});

test("deriveGenreFromText is case-insensitive", () => {
  assert.equal(deriveGenreFromText("EDM TRACK"), "EDM");
  assert.equal(deriveGenreFromText("Pop song"), "Pop");
});
