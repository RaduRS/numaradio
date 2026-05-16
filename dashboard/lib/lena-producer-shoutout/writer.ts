import type { ShoutoutDecision } from "./modes";
import type { ShoutoutContext } from "./shoutout-context";
import { buildClassicShoutoutPrompt } from "./writers/classic";
import { buildInlineShoutoutPrompt } from "./writers/inline";
import { buildQuoteShoutoutPrompt } from "./writers/quote";
import { buildCallbackShoutoutPrompt } from "./writers/callback";

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
