import { test } from "node:test";
import assert from "node:assert/strict";
import { extractId3Artwork } from "./extract-id3-artwork.ts";

test("extractId3Artwork returns null for buffer without artwork", async () => {
  // 10-byte ID3 header, version 3, no APIC frame.
  const buf = Buffer.concat([
    Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
    Buffer.alloc(100, 0),
  ]);
  const result = await extractId3Artwork(buf);
  assert.equal(result, null);
});

test("extractId3Artwork returns null for empty buffer", async () => {
  const result = await extractId3Artwork(Buffer.alloc(0));
  assert.equal(result, null);
});
