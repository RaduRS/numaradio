import type { PrismaClient } from "@prisma/client";
import { fetchChatContext, type ChatTrigger } from "./chat-context.ts";
import { runChatProducer } from "./producer.ts";
import { runChatWriter } from "./writer.ts";

export interface LenaChatResult {
  text: string;
  mode: "answer" | "callback";
}

export interface LenaSpeakChatArgs {
  trigger: ChatTrigger;
  prisma: Pick<PrismaClient, "shoutout" | "chatter">;
  stationId: string;
  nowMs: number;
  llm: (prompts: { system: string; user: string }) => Promise<string>;
}

/**
 * Phase 3 public API for YouTube chat replies. Always returns a text
 * (or throws on hard failure) — silence is never a valid outcome.
 * Caller should fall back to legacy generateLenaReply() on null/throw.
 */
export async function lenaSpeakChat(args: LenaSpeakChatArgs): Promise<LenaChatResult | null> {
  let ctx;
  try {
    ctx = await fetchChatContext({
      prisma: args.prisma,
      stationId: args.stationId,
      trigger: args.trigger,
      nowMs: args.nowMs,
    });
  } catch {
    return null;
  }
  const decision = await runChatProducer(ctx, { llm: args.llm });
  try {
    const text = await runChatWriter(decision, ctx, { llm: args.llm });
    if (!text) return null;
    return { text, mode: decision.mode };
  } catch {
    return null;
  }
}
