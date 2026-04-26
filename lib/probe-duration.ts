// Frame-accurate audio duration probe.
//
// Uses music-metadata with `{ duration: true }`, which forces a full
// file/stream scan and counts actual frames — bypassing the unreliable
// Xing/VBRI header estimate that defaults give. Pure JS, no system
// dependency on ffmpeg. ffprobe would be slightly faster on HTTP byte-
// range fetches, but isn't installed on the target machine, and the
// accuracy difference for our well-formed MP3s is negligible.
//
// Three input shapes:
//   probeDurationSeconds("/abs/path/to/file.mp3")         — local file
//   probeDurationSeconds("https://cdn/.../file.mp3")      — HTTP(S) URL
//   probeDurationSeconds(Buffer.from(...))                — bytes
//
// Returns duration in seconds (float, not rounded — caller decides),
// or null on any failure. Failures don't throw; callers fall back to
// whatever default they prefer.

import { parseFile, parseBuffer, parseStream } from "music-metadata";
import { Readable } from "node:stream";

export interface ProbeOpts {
  /** Per-probe timeout in ms. Defaults to 30s for HTTP, since the full
   *  file gets streamed for an accurate scan. */
  timeoutMs?: number;
}

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

export async function probeDurationSeconds(
  input: string | Buffer,
  opts: ProbeOpts = {},
): Promise<number | null> {
  const timeoutMs = opts.timeoutMs ?? 30_000;

  try {
    if (Buffer.isBuffer(input)) {
      const meta = await withTimeout(
        parseBuffer(input, { mimeType: "audio/mpeg" }, { duration: true }),
        timeoutMs,
      );
      return finite(meta?.format?.duration);
    }
    if (typeof input === "string") {
      if (isHttpUrl(input)) {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), timeoutMs);
        try {
          const res = await fetch(input, { signal: ac.signal });
          if (!res.ok || !res.body) return null;
          // Adapt the web ReadableStream to a Node Readable for music-metadata.
          const nodeStream = Readable.fromWeb(res.body as never);
          const contentType = res.headers.get("content-type") ?? "audio/mpeg";
          const meta = await parseStream(
            nodeStream,
            { mimeType: contentType },
            { duration: true },
          );
          return finite(meta?.format?.duration);
        } finally {
          clearTimeout(t);
        }
      }
      // Local file path
      const meta = await withTimeout(
        parseFile(input, { duration: true }),
        timeoutMs,
      );
      return finite(meta?.format?.duration);
    }
    return null;
  } catch {
    return null;
  }
}

function finite(n: number | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (err) => { clearTimeout(t); reject(err); },
    );
  });
}
