import { test } from "node:test";
import assert from "node:assert/strict";
import { isLatinScript, isEnglish } from "./text-script.ts";

test("isLatinScript accepts plain English", () => {
  assert.equal(isLatinScript("shoutout to Marek please"), true);
});

test("isLatinScript still accepts Latin-script non-English (German, French, Spanish)", () => {
  // These pass the script check but MUST fail the English check below.
  assert.equal(isLatinScript("café für meine Freunde"), true);
  assert.equal(isLatinScript("je voudrais une chanson"), true);
  assert.equal(isLatinScript("¿cómo estás?"), true);
});

test("isLatinScript rejects non-Latin (Bengali, CJK, Cyrillic)", () => {
  assert.equal(
    isLatinScript("বাংলাদেশের একটা দেশাত্ববোধক গান শোনাও— দেখি তুমি কী পারো?"),
    false,
  );
  assert.equal(isLatinScript("こんにちは、リスナー"), false);
  assert.equal(isLatinScript("你好,主持人"), false);
  assert.equal(isLatinScript("Здравствуй"), false);
});

test("isEnglish accepts plain English", () => {
  assert.equal(isEnglish("shoutout to Marek please"), true);
  assert.equal(isEnglish("play something for my dad"), true);
  assert.equal(
    isEnglish("This one's going out to my mom. She listens every morning."),
    true,
  );
});

test("isEnglish accepts short tokens (names, single words)", () => {
  assert.equal(isEnglish("Glitchd84"), true);
  assert.equal(isEnglish("ok cool"), true);
  assert.equal(isEnglish("merci"), true); // 1 word — too short to measure density
});

test("isEnglish accepts English with stray loanwords (café, über)", () => {
  assert.equal(isEnglish("grabbing a café before work tomorrow"), true);
  assert.equal(isEnglish("the show is über good tonight"), true);
});

test("isEnglish rejects the German prompt that slipped through last time", () => {
  // This is the prompt that produced a German song on Numa Radio.
  assert.equal(
    isEnglish("A song about School. Religion class. in German please."),
    false,
  );
  assert.equal(
    isEnglish("A Country Song. In German. About Homework."),
    false,
  );
});

test("isEnglish rejects 'in <language>' asks for non-English content", () => {
  assert.equal(isEnglish("can you play a song in Spanish for me"), false);
  assert.equal(isEnglish("song in French about Paris"), false);
  assert.equal(isEnglish("auf Deutsch please"), false);
  assert.equal(isEnglish("en español por favor"), false);
});

test("isEnglish rejects dense German / French / Spanish prose", () => {
  assert.equal(isEnglish("Ich möchte ein Lied über mein Hund hören"), false);
  assert.equal(
    isEnglish("Je voudrais une chanson pour ma petite amie ce soir"),
    false,
  );
  assert.equal(
    isEnglish("Quiero una canción romántica para mi novia esta noche"),
    false,
  );
});

test("isEnglish accepts English message that mentions a non-English word", () => {
  // The word "german" appears but the message itself is English and
  // not asking for non-English content.
  assert.equal(
    isEnglish("My grandparents were german immigrants who loved jazz."),
    true,
  );
});
