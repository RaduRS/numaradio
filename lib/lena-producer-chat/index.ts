import type { PrismaClient } from "@prisma/client";
import { fetchChatContext, type ChatTrigger } from "./chat-context.ts";
import { runChatProducer } from "./producer.ts";
import { runChatWriter } from "./writer.ts";
import type { ChatMode } from "./modes.ts";
import { createQueueItemAtomically } from "../queue-insert.ts";

export interface LenaChatResult {
  text: string;
  mode: ChatMode;
  /** Phase 5b: when mode='accept_request' or 'accept_request_deferred',
   *  the trackId that was inserted into the queue. null otherwise. */
  queuedTrackId: string | null;
}

export interface LenaSpeakChatArgs {
  trigger: ChatTrigger;
  prisma: Pick<PrismaClient, "shoutout" | "chatter" | "playHistory" | "queueItem" | "track" | "$transaction">;
  stationId: string;
  nowMs: number;
  llm: (prompts: { system: string; user: string }) => Promise<string>;
  /** Phase 5b: passed in when trigger.intent is request/shoutout_with_request. */
  catalogCandidates?: { id: string; title: string; artist: string | null; genre: string | null; bpm: number | null }[];
}

/**
 * Public API for YouTube chat replies.
 *
 * Phase 3 (reply intent): Producer→Writer→{text, mode}. Always returns a
 * line — silence is never a valid outcome. Caller should fall back to
 * legacy generateLenaReply() on null/throw.
 *
 * Phase 5b (request intent): same pipeline plus an atomic queue insert
 * BEFORE the Writer runs when Producer accepts. If insert fails the
 * decision is downgraded to decline_request reason=queue_full so the
 * Writer line stays honest.
 */
export async function lenaSpeakChat(args: LenaSpeakChatArgs): Promise<LenaChatResult | null> {
  let ctx;
  try {
    ctx = await fetchChatContext({
      prisma: args.prisma,
      stationId: args.stationId,
      trigger: args.trigger,
      nowMs: args.nowMs,
      catalogCandidates: args.catalogCandidates,
    });
  } catch {
    return null;
  }

  const decision = await runChatProducer(ctx, { llm: args.llm });

  // Phase 5b: if Producer accepted, insert into queue BEFORE writing the line.
  let queuedTrackId: string | null = null;
  if (
    (decision.mode === "accept_request" || decision.mode === "accept_request_deferred") &&
    decision.pickedTrackId
  ) {
    try {
      await createQueueItemAtomically(args.prisma, args.stationId, {
        stationId: args.stationId,
        queueType: "music",
        sourceObjectType: "track",
        sourceObjectId: decision.pickedTrackId,
        trackId: decision.pickedTrackId,
        priorityBand: "priority_request",
        queueStatus: "planned",
        reasonCode: `lena_listener_request:${args.trigger.handle.slice(0, 30)}`,
        insertedBy: "lena_listener_request",
      } as never);
      queuedTrackId = decision.pickedTrackId;
    } catch (err) {
      console.warn("[lena-producer-chat] queue insert failed — downgrading to decline:", err);
      // Couldn't insert — downgrade so the Writer doesn't promise a phantom queue
      decision.mode = "decline_request";
      decision.declineReason = "queue_full";
      decision.pickedTrackId = null;
    }
  }

  try {
    const text = await runChatWriter(decision, ctx, { llm: args.llm });
    if (!text) return null;
    return { text, mode: decision.mode, queuedTrackId };
  } catch {
    return null;
  }
}
