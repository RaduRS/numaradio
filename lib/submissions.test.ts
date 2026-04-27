import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidEmail,
  isValidName,
  normalizeEmail,
  normalizeName,
  sniffMp3,
  sniffImage,
  audioStorageKey,
  artworkStorageKey,
} from "./submissions.ts";

test("isValidEmail accepts well-formed addresses", () => {
  assert.equal(isValidEmail("a@b.co"), true);
  assert.equal(isValidEmail("first.last+tag@sub.example.com"), true);
});

test("isValidEmail rejects bad shapes", () => {
  assert.equal(isValidEmail(""), false);
  assert.equal(isValidEmail("no-at-sign"), false);
  assert.equal(isValidEmail("@nohost.com"), false);
  assert.equal(isValidEmail("nohost@"), false);
  assert.equal(isValidEmail("a@b"), false);
});

test("isValidName trims and enforces 2..80 chars", () => {
  assert.equal(isValidName("A"), false);
  assert.equal(isValidName("Ab"), true);
  assert.equal(isValidName("  Ab  "), true);
  assert.equal(isValidName("x".repeat(80)), true);
  assert.equal(isValidName("x".repeat(81)), false);
});

test("sniffMp3 accepts ID3-tagged MP3", () => {
  // ID3 header: 'I' 'D' '3' followed by version + flags + size
  const buf = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  assert.equal(sniffMp3(buf), true);
});

test("sniffMp3 accepts raw MPEG audio frames (FF FB / FF F3)", () => {
  assert.equal(sniffMp3(Buffer.from([0xFF, 0xFB, 0x90, 0x00])), true);
  assert.equal(sniffMp3(Buffer.from([0xFF, 0xF3, 0x90, 0x00])), true);
});

test("sniffMp3 rejects non-MP3 bytes", () => {
  assert.equal(sniffMp3(Buffer.from([0x00, 0x00, 0x00])), false);
  assert.equal(sniffMp3(Buffer.from([0x52, 0x49, 0x46, 0x46])), false); // 'RIFF' (WAV)
  assert.equal(sniffMp3(Buffer.from([])), false);
});

test("sniffImage detects PNG", () => {
  const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  assert.equal(sniffImage(png), "png");
});

test("sniffImage detects JPEG", () => {
  const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);
  assert.equal(sniffImage(jpeg), "jpeg");
});

test("sniffImage returns null for unknown bytes", () => {
  assert.equal(sniffImage(Buffer.from([0x00, 0x00])), null);
  assert.equal(sniffImage(Buffer.from([])), null);
});

test("audioStorageKey + artworkStorageKey produce stable paths", () => {
  assert.equal(audioStorageKey("abc123"), "submissions/abc123.mp3");
  assert.equal(artworkStorageKey("abc123", "png"), "submissions/abc123.png");
  assert.equal(artworkStorageKey("abc123", "jpeg"), "submissions/abc123.jpg");
});

test("normalizeEmail trims and lowercases", () => {
  assert.equal(normalizeEmail("  Foo@Bar.COM  "), "foo@bar.com");
  assert.equal(normalizeEmail("a@b.co"), "a@b.co");
});

test("normalizeName trims (preserves case)", () => {
  assert.equal(normalizeName("  Mihai  "), "Mihai");
  assert.equal(normalizeName("Mihai"), "Mihai");
});

test("sniffMp3 accepts MPEG-1 Layer III with CRC (FF FA)", () => {
  assert.equal(sniffMp3(Buffer.from([0xFF, 0xFA, 0x90, 0x00])), true);
});

test("sniffMp3 accepts MPEG-2.5 Layer III (FF E3 / E2 / E0)", () => {
  assert.equal(sniffMp3(Buffer.from([0xFF, 0xE3, 0x90, 0x00])), true);
  assert.equal(sniffMp3(Buffer.from([0xFF, 0xE2, 0x90, 0x00])), true);
  assert.equal(sniffMp3(Buffer.from([0xFF, 0xE0, 0x90, 0x00])), true);
});
