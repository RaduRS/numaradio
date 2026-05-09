// Two-pass ffmpeg loudnorm wrapper. Normalises an MP3 buffer to the
// EBU R128 / streaming-default loudness target (-14 LUFS by default,
// matching Spotify/YouTube/TikTok). Mirrors the spawn pattern from
// lib/sanitize-mp3-audio-only.ts. Streams stdin/stdout — never disk.
//
// Failure mode: any spawn / parse / exit failure throws. Callers should
// catch and fall back to the raw input buffer (so a listener never gets
// blocked on a loudnorm hiccup). Track.loudnessLufs stays NULL and the
// queue-daemon poller picks it up later.

import { spawn } from "node:child_process";

export interface LoudnormJsonPass1 {
  input_i: number;
  input_tp: number;
  input_lra: number;
  input_thresh: number;
  target_offset: number;
}

export interface LoudnormJsonPass2 {
  input_i: number;
  input_tp: number;
  input_lra: number;
  input_thresh: number;
  output_i: number;
  output_tp: number;
  output_lra: number;
  output_thresh: number;
  normalization_type: string;
  target_offset: number;
}

export type LoudnormJson = LoudnormJsonPass1 | LoudnormJsonPass2;

/**
 * Extract the LAST JSON object from ffmpeg loudnorm stderr. Returns
 * null on no-block / malformed-JSON.
 */
export function parseLoudnormStderr(stderr: string): LoudnormJson | null {
  // ffmpeg's loudnorm prints lots of diagnostic lines, then a JSON
  // object as the final non-blank chunk of output. We scan from the
  // end for the last `{ ... }` block.
  const lastClose = stderr.lastIndexOf("}");
  if (lastClose === -1) return null;
  // Walk back to the matching `{` by depth counting.
  let depth = 0;
  let openIdx = -1;
  for (let i = lastClose; i >= 0; i--) {
    const ch = stderr[i];
    if (ch === "}") depth++;
    else if (ch === "{") {
      depth--;
      if (depth === 0) { openIdx = i; break; }
    }
  }
  if (openIdx === -1) return null;
  const candidate = stderr.slice(openIdx, lastClose + 1);
  try {
    const obj = JSON.parse(candidate);
    // Coerce string numbers ffmpeg sometimes emits as `"input_i" : "-23.45"`.
    for (const k of Object.keys(obj)) {
      if (typeof obj[k] === "string" && !isNaN(parseFloat(obj[k]))) {
        obj[k] = parseFloat(obj[k]);
      }
    }
    return obj as LoudnormJson;
  } catch {
    return null;
  }
}

// ─── Public API ─────────────────────────────────────────────────────

export interface LoudnessMeasurement {
  inputI: number;        // pre-correction integrated LUFS
  inputTp: number;       // pre-correction true peak dBTP
  inputLra: number;      // pre-correction loudness range LU
  outputI: number;       // post-correction integrated LUFS (target ± 0.5)
  outputTp: number;      // post-correction true peak dBTP
}

export interface LoudnormResult {
  buffer: Buffer;
  measurement: LoudnessMeasurement;
}

export interface LoudnormOptions {
  /** Target integrated loudness in LUFS. Default -14. */
  targetI?: number;
  /** Target true peak in dBTP. Default -1. */
  targetTp?: number;
  /** Target loudness range in LU. Default 11. */
  targetLra?: number;
  /** Output MP3 bitrate (kbps). Default 192 — matches Icecast. */
  bitrateKbps?: number;
}

const DEFAULTS = {
  targetI: -14,
  targetTp: -1,
  targetLra: 11,
  bitrateKbps: 192,
};

/**
 * Normalise an MP3 buffer to a loudness target via two-pass ffmpeg
 * loudnorm. Throws on ffmpeg / parse failure — caller should catch
 * and fall back to the raw input.
 */
export async function loudnormalise(
  input: Buffer,
  opts: LoudnormOptions = {},
): Promise<LoudnormResult> {
  const o = { ...DEFAULTS, ...opts };

  // Pass 1: measure
  const pass1Stderr = await spawnLoudnormPass1(input, o);
  const m1 = parseLoudnormStderr(pass1Stderr);
  if (!m1 || typeof m1.input_i !== "number") {
    throw new Error(`loudnorm pass1 parse failed; stderr tail: ${pass1Stderr.slice(-200)}`);
  }

  // Pass 2: apply (linear, single-gain)
  const { stdout: pass2Buf, stderr: pass2Stderr } = await spawnLoudnormPass2(input, o, m1);
  const m2 = parseLoudnormStderr(pass2Stderr);
  if (!m2 || !("output_i" in m2) || typeof m2.output_i !== "number") {
    throw new Error(`loudnorm pass2 parse failed; stderr tail: ${pass2Stderr.slice(-200)}`);
  }

  return {
    buffer: pass2Buf,
    measurement: {
      inputI: m1.input_i,
      inputTp: m1.input_tp,
      inputLra: m1.input_lra,
      outputI: m2.output_i,
      outputTp: m2.output_tp,
    },
  };
}

// ─── Internal: spawn helpers ────────────────────────────────────────

function spawnLoudnormPass1(
  input: Buffer,
  o: typeof DEFAULTS,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-hide_banner",
      "-i", "pipe:0",
      "-af", `loudnorm=I=${o.targetI}:TP=${o.targetTp}:LRA=${o.targetLra}:print_format=json`,
      "-f", "null", "-",
    ], { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    ff.stderr.on("data", (c) => { stderr += c.toString("utf8"); });
    ff.stdout.on("data", () => undefined); // drain — null muxer still emits
    ff.on("error", (err) => reject(new Error(`ffmpeg pass1 spawn failed: ${err.message}`)));
    ff.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg pass1 exit ${code}: ${stderr.slice(-200)}`));
        return;
      }
      resolve(stderr);
    });
    ff.stdin.on("error", () => undefined); // EPIPE expected if ffmpeg closes early
    ff.stdin.end(input);
  });
}

function spawnLoudnormPass2(
  input: Buffer,
  o: typeof DEFAULTS,
  m: LoudnormJsonPass1,
): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const filter = [
      `loudnorm=I=${o.targetI}:TP=${o.targetTp}:LRA=${o.targetLra}`,
      `measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}`,
      `measured_thresh=${m.input_thresh}:offset=${m.target_offset}`,
      `linear=true:print_format=json`,
    ].join(":");
    const ff = spawn("ffmpeg", [
      "-hide_banner",
      "-i", "pipe:0",
      "-af", filter,
      "-c:a", "libmp3lame",
      "-b:a", `${o.bitrateKbps}k`,
      "-f", "mp3",
      "pipe:1",
    ], { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let stderr = "";
    ff.stdout.on("data", (c: Buffer) => chunks.push(c));
    ff.stderr.on("data", (c) => { stderr += c.toString("utf8"); });
    ff.on("error", (err) => reject(new Error(`ffmpeg pass2 spawn failed: ${err.message}`)));
    ff.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg pass2 exit ${code}: ${stderr.slice(-200)}`));
        return;
      }
      resolve({ stdout: Buffer.concat(chunks), stderr });
    });
    ff.stdin.on("error", () => undefined);
    ff.stdin.end(input);
  });
}
