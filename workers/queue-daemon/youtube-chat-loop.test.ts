import { test } from "node:test";
import assert from "node:assert/strict";
import { isLatinScript } from "../../lib/text-script.ts";

test("isLatinScript accepts plain English", () => {
  assert.equal(isLatinScript("shoutout to Marek please"), true);
});

test("isLatinScript accepts English with accented Latin (é, à, ñ, ü, ß)", () => {
  assert.equal(isLatinScript("café für meine Freunde"), true);
  assert.equal(isLatinScript("¿cómo estás?"), true);
});

test("isLatinScript rejects Bengali", () => {
  // Translation: "Play me a Bangladeshi patriotic song — let's see what you can do?"
  assert.equal(
    isLatinScript("বাংলাদেশের একটা দেশাত্ববোধক গান শোনাও— দেখি তুমি কী পারো?"),
    false,
  );
});

test("isLatinScript rejects CJK", () => {
  assert.equal(isLatinScript("こんにちは、リスナー"), false);
  assert.equal(isLatinScript("你好,主持人"), false);
  assert.equal(isLatinScript("안녕하세요"), false);
});

test("isLatinScript rejects Arabic and Hebrew", () => {
  assert.equal(isLatinScript("مرحبا بكم"), false);
  assert.equal(isLatinScript("שלום"), false);
});

test("isLatinScript rejects Cyrillic", () => {
  assert.equal(isLatinScript("Привет, как дела?"), false);
});

test("isLatinScript tolerates a sprinkle of foreign chars in mostly-Latin text", () => {
  // 80% threshold: one foreign char in a longer English sentence stays accepted
  assert.equal(isLatinScript("greetings from Tokyo 東 visiting today"), true);
});

test("isLatinScript handles emoji + numbers + punctuation as neutral", () => {
  // After stripping non-letter chars these are pure Latin
  assert.equal(isLatinScript("hey 👋 thanks for the music!! 🎶"), true);
  assert.equal(isLatinScript("call me at 555-1234 please"), true);
});

test("isLatinScript treats pure-punctuation/digit input as accepted (length filter handles it)", () => {
  assert.equal(isLatinScript("123!?"), true);
  assert.equal(isLatinScript("...."), true);
});
