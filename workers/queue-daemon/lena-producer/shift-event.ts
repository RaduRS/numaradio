// workers/queue-daemon/lena-producer/shift-event.ts

/**
 * ShiftEvent: a discriminated union representing every observable thing that
 * happens during Lena's current shift. ShiftMemory keeps a rolling log of
 * these and derives views (counters, mood, callback pool) from them.
 *
 * All timestamps are Unix epoch milliseconds (Date.now() compatible).
 */

export type ProducerMode =
  | "opinion"
  | "callback"
  | "aside"
  | "answer"
  | "shoutout_read"
  | "shoutout_with_request"
  | "queue_pick"
  | "accept_request"
  | "accept_request_deferred"
  | "decline_request"
  | "silence";

export type TriggerSource =
  | "auto_track_boundary"
  | "youtube_chat_mention"
  | "youtube_chat_shoutout"
  | "youtube_chat_request"
  | "youtube_chat_shoutout_with_request"
  | "operator_force";

export type ShiftEvent =
  | {
      type: "track_aired";
      id: string; // PlayHistory row id
      trackId: string;
      title: string;
      artist: string | null;
      genre: string | null;
      bpm: number | null;
      key: string | null;
      airedAt: number;
    }
  | {
      type: "lena_line_aired";
      id: string; // Chatter row id
      mode: ProducerMode | "legacy"; // "legacy" for pre-Producer rows
      targetFocus: string | null;
      text: string;
      airedAt: number;
      trigger: TriggerSource | "legacy";
      addressedListener: string | null;
    }
  | {
      type: "shoutout_aired";
      id: string; // Shoutout row id
      handle: string;
      originalText: string;
      airedAt: number;
    }
  | {
      type: "youtube_mention";
      id: string; // YouTube message id
      handle: string;
      text: string;
      intent: "shoutout" | "reply" | "request" | "shoutout_with_request" | "noise";
      airedAt: number;
    }
  | {
      type: "operator_force";
      hint: string;
      forcedAt: number;
    };

export type ShiftEventType = ShiftEvent["type"];

/** Compile-time exhaustiveness helper — call from a default case in switches over ShiftEvent.type. */
export function assertNever(x: never): never {
  throw new Error(`Unexpected ShiftEvent type: ${JSON.stringify(x)}`);
}
