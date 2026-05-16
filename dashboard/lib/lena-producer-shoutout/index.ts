import { fetchShoutoutContext, type ShoutoutTrigger, type PrismaSlice } from "./shoutout-context";
import type { ShoutoutMode } from "./modes";
import { runShoutoutProducer } from "./producer";
import { runShoutoutWriter } from "./writer";

export interface LenaShoutoutResult {
  text: string;
  mode: ShoutoutMode;
}

export interface LenaSpeakShoutoutArgs {
  trigger: ShoutoutTrigger;
  prisma: PrismaSlice;
  stationId: string;
  nowMs: number;
  llm: (prompts: { system: string; user: string }) => Promise<string>;
}

export async function lenaSpeakShoutout(args: LenaSpeakShoutoutArgs): Promise<LenaShoutoutResult | null> {
  let ctx;
  try {
    ctx = await fetchShoutoutContext({ prisma: args.prisma, stationId: args.stationId, trigger: args.trigger, nowMs: args.nowMs });
  } catch { return null; }
  const decision = await runShoutoutProducer(ctx, { llm: args.llm });
  const recentAired = ctx.recentLenaLines.slice(0, 3).map((l) => l.text);
  try {
    const text = await runShoutoutWriter(decision, ctx, recentAired, { llm: args.llm });
    if (!text) return null;
    return { text, mode: decision.mode };
  } catch { return null; }
}
