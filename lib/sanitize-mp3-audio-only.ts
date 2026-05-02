// Strip every non-audio stream (e.g. Suno's embedded MJPEG cover art
// delivered as a "video stream") from an MP3 buffer. Liquidsoap's
// content-type guard expects `audio=pcm(stereo)` and intermittently
// fails on dual-stream MP3s — same root cause as the 2026-05-02 "Stay
// got skipped to Silhouette" incident.
//
// Lossless (no re-encode, just remux). Preserves duration, bitrate,
// and ID3v2 tags (title, artist) — only the separate video stream is
// dropped. Streams via stdin/stdout so we never touch disk.
//
// Requires ffmpeg in PATH. The Suno ingest path runs on Orion where
// ffmpeg is installed; the Vercel submissions path does not, so this
// helper is only called from the Orion-side caller. The scan-and-
// repair script catches anything that slips past.

import { spawn } from "node:child_process";

export interface SanitizeResult {
  /** The audio-only buffer. Equal to `input` if no change was needed. */
  buffer: Buffer;
  /** Did we actually drop a stream? */
  changed: boolean;
  /** Bytes removed (input.length - output.length). */
  bytesRemoved: number;
}

/**
 * Probe + remux. If the input has only audio streams, returns it
 * unchanged (cheap probe, no remux). If it has additional streams
 * (e.g. embedded MJPEG artwork), returns a new buffer with only the
 * audio stream(s).
 */
export async function sanitizeMp3AudioOnly(input: Buffer): Promise<SanitizeResult> {
  const streamCount = await countStreams(input);
  if (streamCount <= 1) {
    return { buffer: input, changed: false, bytesRemoved: 0 };
  }
  const cleaned = await remuxAudioOnly(input);
  return { buffer: cleaned, changed: true, bytesRemoved: input.length - cleaned.length };
}

async function countStreams(input: Buffer): Promise<number> {
  // ffprobe -show_streams reads from stdin; we count newline-separated
  // [STREAM] blocks. Cheap — ffprobe stops once headers are parsed.
  return new Promise<number>((resolve, reject) => {
    const probe = spawn("ffprobe", [
      "-v", "error",
      "-show_streams",
      "-print_format", "default",
      "-i", "pipe:0",
    ], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    probe.stdout.on("data", (c) => { stdout += c.toString("utf8"); });
    probe.stderr.on("data", (c) => { stderr += c.toString("utf8"); });
    probe.on("error", (err) => reject(new Error(`ffprobe spawn failed: ${err.message}`)));
    probe.on("close", (code) => {
      if (code !== 0 && stdout.length === 0) {
        reject(new Error(`ffprobe exit ${code}: ${stderr.slice(0, 200)}`));
        return;
      }
      const matches = stdout.match(/^\[STREAM\]/gm);
      resolve(matches ? matches.length : 0);
    });
    // ffprobe closes stdin once it has enough header data → EPIPE is
    // expected and harmless. Swallow stdin errors so they don't bubble
    // to an unhandled rejection.
    probe.stdin.on("error", () => undefined);
    probe.stdin.end(input);
  });
}

async function remuxAudioOnly(input: Buffer): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-v", "error",
      "-i", "pipe:0",
      "-map", "0:a",       // audio streams only
      "-c:a", "copy",      // no re-encode (lossless, fast)
      "-f", "mp3",
      "pipe:1",
    ], { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let stderr = "";
    ff.stdout.on("data", (c: Buffer) => chunks.push(c));
    ff.stderr.on("data", (c) => { stderr += c.toString("utf8"); });
    ff.on("error", (err) => reject(new Error(`ffmpeg spawn failed: ${err.message}`)));
    ff.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(0, 200)}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    ff.stdin.on("error", () => undefined);
    ff.stdin.end(input);
  });
}
