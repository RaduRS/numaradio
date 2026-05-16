// workers/queue-daemon/lena-producer/notify-listener.ts

import { Client as PgClient } from "pg";
import type { ShiftEvent, ShiftEventType } from "./shift-event.ts";

const NOTIFY_CHANNEL = "lena_event";
const RECONNECT_BACKOFF_MS = [500, 1_000, 2_000, 5_000, 10_000, 30_000] as const;
const POLL_INTERVAL_MS = 5_000;

const VALID_TYPES: ReadonlySet<ShiftEventType> = new Set<ShiftEventType>([
  "track_aired",
  "lena_line_aired",
  "shoutout_aired",
  "youtube_mention",
  "operator_force",
]);

export function parseNotifyPayload(raw: string): ShiftEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const type = obj.type;
  if (typeof type !== "string" || !VALID_TYPES.has(type as ShiftEventType)) return null;
  if (typeof obj.id !== "string") return null;
  // Per-type minimal sanity check — full validation is the consumer's job
  switch (type) {
    case "track_aired":
      if (typeof obj.airedAt !== "number" || typeof obj.trackId !== "string") return null;
      break;
    case "lena_line_aired":
      if (typeof obj.airedAt !== "number" || typeof obj.text !== "string") return null;
      break;
    case "shoutout_aired":
      if (typeof obj.airedAt !== "number" || typeof obj.handle !== "string") return null;
      break;
    case "youtube_mention":
      if (typeof obj.airedAt !== "number" || typeof obj.text !== "string") return null;
      break;
    case "operator_force":
      if (typeof obj.forcedAt !== "number" || typeof obj.hint !== "string") return null;
      break;
  }
  return parsed as ShiftEvent;
}

export interface NotifyListenerOpts {
  connectionString: string;
  onEvent: (event: ShiftEvent) => void;
  /** Called when the listener moves between healthy/unhealthy states (for logs/metrics). */
  onHealthChange?: (state: "healthy" | "reconnecting" | "polling") => void;
  /** Called to fetch any rows newer than the last seen high-water marks. Implementation in Task 12. */
  pollForMissedEvents?: () => Promise<ShiftEvent[]>;
}

export class NotifyListener {
  #opts: NotifyListenerOpts;
  #client: PgClient | null = null;
  #stopped = false;
  #reconnectAttempt = 0;
  #pollTimer: NodeJS.Timeout | null = null;

  constructor(opts: NotifyListenerOpts) {
    this.#opts = opts;
  }

  async start(): Promise<void> {
    this.#stopped = false;
    await this.#connect();
    this.#startPolling();
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#pollTimer) clearInterval(this.#pollTimer);
    await this.#client?.end().catch(() => {});
    this.#client = null;
  }

  async #connect(): Promise<void> {
    if (this.#stopped) return;
    const client = new PgClient({ connectionString: this.#opts.connectionString });

    client.on("notification", (msg) => {
      if (msg.channel !== NOTIFY_CHANNEL || !msg.payload) return;
      const ev = parseNotifyPayload(msg.payload);
      if (ev) this.#opts.onEvent(ev);
    });

    client.on("error", () => {
      this.#opts.onHealthChange?.("reconnecting");
      this.#scheduleReconnect();
    });

    client.on("end", () => {
      if (!this.#stopped) {
        this.#opts.onHealthChange?.("reconnecting");
        this.#scheduleReconnect();
      }
    });

    try {
      await client.connect();
      await client.query(`LISTEN ${NOTIFY_CHANNEL}`);
      this.#client = client;
      this.#reconnectAttempt = 0;
      this.#opts.onHealthChange?.("healthy");
    } catch {
      await client.end().catch(() => {});
      this.#scheduleReconnect();
    }
  }

  #scheduleReconnect(): void {
    if (this.#stopped) return;
    const backoff = RECONNECT_BACKOFF_MS[Math.min(this.#reconnectAttempt, RECONNECT_BACKOFF_MS.length - 1)];
    this.#reconnectAttempt += 1;
    setTimeout(() => this.#connect(), backoff);
  }

  #startPolling(): void {
    if (!this.#opts.pollForMissedEvents) return;
    this.#pollTimer = setInterval(async () => {
      try {
        const missed = await this.#opts.pollForMissedEvents!();
        for (const ev of missed) this.#opts.onEvent(ev);
      } catch {
        // swallow — next tick retries
      }
    }, POLL_INTERVAL_MS);
  }
}
