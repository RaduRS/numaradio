import type { ShoutoutDecision } from "./modes.ts";
import type { ShoutoutContext } from "./shoutout-context.ts";
import { buildClassicShoutoutPrompt } from "./writers/classic.ts";
import { buildInlineShoutoutPrompt } from "./writers/inline.ts";
import { buildQuoteShoutoutPrompt } from "./writers/quote.ts";
import { buildCallbackShoutoutPrompt } from "./writers/callback.ts";

export interface ShoutoutWriterDeps {
  llm: (prompts: { system: string; user: string }) => Promise<string>;
}

export async function runShoutoutWriter(
  decision: ShoutoutDecision,
  ctx: ShoutoutContext,
  recentAired: readonly string[],
  deps: ShoutoutWriterDeps,
): Promise<string | null> {
  let prompts: { system: string; user: string };
  switch (decision.mode) {
    case "shoutout_classic": prompts = buildClassicShoutoutPrompt(decision, ctx, recentAired); break;
    case "shoutout_inline": prompts = buildInlineShoutoutPrompt(decision, ctx, recentAired); break;
    case "shoutout_quote": prompts = buildQuoteShoutoutPrompt(decision, ctx, recentAired); break;
    case "shoutout_callback": prompts = buildCallbackShoutoutPrompt(decision, ctx, recentAired); break;
  }
  const raw = await deps.llm(prompts);
  return raw.trim() || null;
}
