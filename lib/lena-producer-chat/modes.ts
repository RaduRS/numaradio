
/** Phase 3 modes for chat-reply Producer (answer/callback) plus Phase 5b
 *  request-family modes (accept_request / accept_request_deferred /
 *  decline_request). silence is NEVER valid here — direct @lena mentions
 *  ALWAYS get a spoken response (see memory:
 *  feedback_lena_never_ignores_direct_mention). */
export type ChatMode =
  | "answer"
  | "callback"
  | "accept_request"
  | "accept_request_deferred"
  | "decline_request";

export type DeclineReason =
  | "recently_aired"
  | "not_in_catalog"
  | "wrong_show_block"
  | "same_artist_too_soon"
  | "queue_full";

export interface ChatDecision {
  mode: ChatMode;
  targetFocus: string;
  /** Optional ref to a recentShoutouts entry id when mode='callback'. */
  callbackTo: string | null;
  lengthHint: "short" | "medium";
  tone: "dry" | "warm" | "playful" | "low-key";
  /** Phase 5b: when mode='accept_request' or 'accept_request_deferred',
   *  the chosen catalog track id (must be one of ctx.catalogCandidates). */
  pickedTrackId: string | null;
  /** Phase 5b: when mode='decline_request', the reason code. */
  declineReason: DeclineReason | null;
}

export const LENGTH_WORDS: Record<ChatDecision["lengthHint"], { min: number; max: number }> = {
  short: { min: 4, max: 25 },
  medium: { min: 25, max: 45 },
};
