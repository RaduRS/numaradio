import type { ChatDecision } from "./modes.ts";
import type { ChatContext } from "./chat-context.ts";
import { buildChatAnswerPrompt } from "./writers/answer.ts";
import { buildChatCallbackPrompt } from "./writers/callback.ts";
import { buildAcceptRequestPrompt } from "./writers/accept-request.ts";
import { buildAcceptRequestDeferredPrompt } from "./writers/accept-request-deferred.ts";
import { buildDeclineRequestPrompt } from "./writers/decline-request.ts";

export interface ChatWriterDeps {
  llm: (prompts: { system: string; user: string }) => Promise<string>;
}

export async function runChatWriter(decision: ChatDecision, ctx: ChatContext, deps: ChatWriterDeps): Promise<string | null> {
  let prompts: { system: string; user: string };
  switch (decision.mode) {
    case "answer":
      prompts = buildChatAnswerPrompt(decision, ctx);
      break;
    case "callback":
      prompts = buildChatCallbackPrompt(decision, ctx);
      break;
    case "accept_request":
      prompts = buildAcceptRequestPrompt(decision, ctx);
      break;
    case "accept_request_deferred":
      prompts = buildAcceptRequestDeferredPrompt(decision, ctx);
      break;
    case "decline_request":
      prompts = buildDeclineRequestPrompt(decision, ctx);
      break;
  }
  const raw = await deps.llm(prompts);
  const text = raw.trim();
  return text || null;
}
