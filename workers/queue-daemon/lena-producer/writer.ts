// workers/queue-daemon/lena-producer/writer.ts

import type { ProducerDecision } from "./modes.ts";
import type { ProducerContext } from "./producer-context.ts";
import { buildOpinionPrompt } from "./writers/opinion.ts";
import { buildAsidePrompt } from "./writers/aside.ts";
import { buildCallbackPrompt } from "./writers/callback.ts";
import { buildQueuePickPrompt } from "./writers/queue-pick.ts";

export interface WriterDeps {
  llm: (prompts: { system: string; user: string }) => Promise<string>;
}

export async function runWriter(
  decision: ProducerDecision,
  ctx: ProducerContext,
  recentAiredLines: readonly string[],
  deps: WriterDeps,
): Promise<string | null> {
  if (decision.mode === "silence") return null;

  let prompts: { system: string; user: string };
  if (decision.mode === "opinion") prompts = buildOpinionPrompt(decision, ctx, recentAiredLines);
  else if (decision.mode === "aside") prompts = buildAsidePrompt(decision, ctx, recentAiredLines);
  else if (decision.mode === "callback") prompts = buildCallbackPrompt(decision, ctx, recentAiredLines);
  else if (decision.mode === "queue_pick") prompts = buildQueuePickPrompt(decision, ctx, recentAiredLines);
  else throw new Error(`unsupported mode for Phase 2: ${decision.mode}`);

  const raw = await deps.llm(prompts);
  return raw.trim();
}
