// Pulls the first embedded cover image from an MP3 buffer. Used as the
// second tier of the artwork cascade (after a separately-uploaded image,
// before falling back to generation).
//
// music-metadata exposes pictures via parseBuffer's `common.picture`.
// We pick the first one — most MP3s only embed one APIC frame anyway.

import { parseBuffer } from "music-metadata";

export type ExtractedArtwork = {
  buffer: Buffer;
  mimeType: string; // e.g. "image/jpeg" or "image/png"
};

export async function extractId3Artwork(audioBuffer: Buffer): Promise<ExtractedArtwork | null> {
  try {
    const meta = await parseBuffer(audioBuffer, undefined, {
      duration: false,
      skipCovers: false,
    });
    const pic = meta.common.picture?.[0];
    if (!pic || !pic.data || pic.data.length === 0) return null;
    return {
      buffer: Buffer.from(pic.data),
      mimeType: pic.format ?? "image/jpeg",
    };
  } catch {
    return null;
  }
}
