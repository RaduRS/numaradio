import type { ChatDecision } from "./modes.ts";
import type { ChatContext } from "./chat-context.ts";
import { buildChatAnswerPrompt } from "./writers/answer.ts";
import { buildChatCallbackPrompt } from "./writers/callback.ts";

export interface ChatWriterDeps {
  llm: (prompts: { system: string; user: string }) => Promise<string>;
}

export async function runChatWriter(decision: ChatDecision, ctx: ChatContext, deps: ChatWriterDeps): Promise<string | null> {
  const prompts = decision.mode === "answer"
    ? buildChatAnswerPrompt(decision, ctx)
    : buildChatCallbackPrompt(decision, ctx);
  const raw = await deps.llm(prompts);
  const text = raw.trim();
  return text || null;
}
