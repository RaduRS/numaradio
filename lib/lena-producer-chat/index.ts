import type { PrismaClient } from "@prisma/client";
import { fetchChatContext, type ChatTrigger } from "./chat-context.ts";
import { runChatProducer } from "./producer.ts";
import { runChatWriter } from "./writer.ts";
import type { ChatMode } from "./modes.ts";

export interface LenaChatResult {
  text: string;
  mode: ChatMode;
  /** Phase 5b: when mode='accept_request' or 'accept_request_deferred',
   *  the trackId that was inserted into the queue. null otherwise. */
  queuedTrackId: string | null;
}

export interface LenaSpeakChatArgs {
  trigger: ChatTrigger;
  prisma: Pick<PrismaClient, "shoutout" | "chatter" | "playHistory" | "queueItem" | "track">;
  stationId: string;
  nowMs: number;
  llm: (prompts: { system: string; user: string }) => Promise<string>;
  /** Phase 5b: passed in when trigger.intent is request/shoutout_with_request. */
  catalogCandidates?: { id: string; title: string; artist: string | null; genre: string | null; bpm: number | null }[];
  /** Phase 5b: injected by the caller so the producer-chat module doesn't
   *  reach into a specific transport. The dashboard exposes an HTTP
   *  endpoint (`/api/internal/lena-queue`) that calls the daemon's
   *  pushHandler — that's the ONLY path that telnets to Liquidsoap +
   *  status-tracks the row. Writing QueueItem rows directly bypasses
   *  the push and trips the reconciler into re-firing every cycle
   *  (the 2026-05-16 "library track played 4× in a row" bug). */
  pushTrackToQueue?: (
    args: { trackId: string; reason: string },
  ) => Promise<{ ok: true; queueItemId: string } | { ok: false; error: string }>;
}

/**
 * Public API for YouTube chat replies.
 *
 * Phase 3 (reply intent): Producer→Writer→{text, mode}. Always returns a
 * line — silence is never a valid outcome. Caller should fall back to
 * legacy generateLenaReply() on null/throw.
 *
 * Phase 5b (request intent): same pipeline plus an injected push call
 * BEFORE the Writer runs when Producer accepts. If push fails (or is
 * unavailable) the decision is downgraded to decline_request
 * reason=queue_full so the Writer line stays honest.
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

  // Phase 5b: if Producer accepted, push to the daemon BEFORE writing the line.
  let queuedTrackId: string | null = null;
  if (
    (decision.mode === "accept_request" || decision.mode === "accept_request_deferred") &&
    decision.pickedTrackId
  ) {
    const reason = `lena_listener_request:${args.trigger.handle.slice(0, 30)}`;
    const pushResult = args.pushTrackToQueue
      ? await args.pushTrackToQueue({ trackId: decision.pickedTrackId, reason }).catch(
          (err) => ({ ok: false as const, error: err instanceof Error ? err.message : "push threw" }),
        )
      : { ok: false as const, error: "no pushTrackToQueue dep" };

    if (pushResult.ok) {
      queuedTrackId = decision.pickedTrackId;
    } else {
      console.warn("[lena-producer-chat] queue push failed — downgrading to decline:", pushResult.error);
      // Couldn't push — downgrade so the Writer doesn't promise a phantom queue
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
