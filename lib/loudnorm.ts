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
