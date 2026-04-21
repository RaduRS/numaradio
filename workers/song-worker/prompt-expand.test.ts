import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parsePromptExpansion,
  buildPromptExpansionSystem,
} from "./prompt-expand.ts";

test("parsePromptExpansion extracts fields from clean JSON", () => {
  const raw = `{"title":"Rainy Morning","artworkPrompt":"ink-wash rainy window","lyrics":"[verse] drops"}`;
  const parsed = parsePromptExpansion(raw, { withLyrics: true });
  assert.equal(parsed?.title, "Rainy Morning");
  assert.equal(parsed?.artworkPrompt, "ink-wash rainy window");
  assert.equal(parsed?.lyrics, "[verse] drops");
});

test("parsePromptExpansion tolerates ```json fences", () => {
  const raw = "```json\n{\"title\":\"T\",\"artworkPrompt\":\"A\"}\n```";
  const parsed = parsePromptExpansion(raw, { withLyrics: false });
  assert.equal(parsed?.title, "T");
  assert.equal(parsed?.artworkPrompt, "A");
  assert.equal(parsed?.lyrics, undefined);
});

test("parsePromptExpansion caps long strings", () => {
  const raw = JSON.stringify({
    title: "x".repeat(200),
    artworkPrompt: "y".repeat(500),
    lyrics: "z".repeat(1000),
  });
  const parsed = parsePromptExpansion(raw, { withLyrics: true });
  assert.equal(parsed?.title.length, 50);
  assert.equal(parsed?.artworkPrompt.length, 280);
  assert.ok((parsed?.lyrics ?? "").length <= 400);
});

test("parsePromptExpansion returns null for garbage so caller can fall back", () => {
  const parsed = parsePromptExpansion("not json at all", { withLyrics: true });
  assert.equal(parsed, null);
});

test("buildPromptExpansionSystem mentions lyrics instruction only when withLyrics", () => {
  const withLyrics = buildPromptExpansionSystem({ withLyrics: true });
  const instrumental = buildPromptExpansionSystem({ withLyrics: false });
  assert.match(withLyrics, /lyrics/i);
  assert.doesNotMatch(instrumental, /\blyrics\b/i);
});
