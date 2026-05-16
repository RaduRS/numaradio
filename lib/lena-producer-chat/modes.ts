
/** Phase 3 modes for chat-reply Producer. silence is NEVER valid (direct
 *  @lena mentions ALWAYS get a spoken response — see memory:
 *  feedback_lena_never_ignores_direct_mention). */
export type ChatMode = "answer" | "callback";

export interface ChatDecision {
  mode: ChatMode;
  targetFocus: string;
  /** Optional ref to a recentShoutouts entry id when mode='callback'. */
  callbackTo: string | null;
  lengthHint: "short" | "medium";
  tone: "dry" | "warm" | "playful" | "low-key";
}

export const LENGTH_WORDS: Record<ChatDecision["lengthHint"], { min: number; max: number }> = {
  short: { min: 4, max: 25 },
  medium: { min: 25, max: 45 },
};
