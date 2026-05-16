
export type ShoutoutMode = "shoutout_classic" | "shoutout_inline" | "shoutout_quote" | "shoutout_callback";

export interface ShoutoutDecision {
  mode: ShoutoutMode;
  /** One phrase the Writer should center on. */
  targetFocus: string;
  /** When mode='shoutout_callback', the id of a recent shoutout/Lena-line event. */
  callbackTo: string | null;
  lengthHint: "short" | "medium";
  tone: "dry" | "warm" | "playful" | "low-key";
}

export const LENGTH_WORDS: Record<ShoutoutDecision["lengthHint"], { min: number; max: number }> = {
  short: { min: 12, max: 30 },
  medium: { min: 30, max: 60 },
};
