// workers/queue-daemon/lena-producer/fallbacks.ts

import type { ProducerDecision } from "./modes.ts";

/**
 * Deterministic last-resort decision when the Producer LLM call fails
 * twice in a row. For auto_track_boundary, fall back to a short low-key
 * aside — never "silence" as a fallback (we'd rather have a generic
 * line than dead air).
 */
export function safeDefaultDecision(args: { source: "auto_track_boundary" }): ProducerDecision {
  if (args.source === "auto_track_boundary") {
    return {
      mode: "aside",
      targetFocus: "station vibe",
      callbackTo: null,
      lengthHint: "short",
      tone: "low-key",
      addressListener: null,
      queueAction: null,
    };
  }
  throw new Error(`safeDefaultDecision: unsupported source ${args.source}`);
}
