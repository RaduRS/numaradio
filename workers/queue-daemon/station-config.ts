export type AutoHostMode = "auto" | "forced_on" | "forced_off";
export type VoiceProvider = "deepgram" | "vertex";

/** Common shape for any 3-state forced-toggle block on the Station row. */
export interface StationConfigBlock {
  mode: AutoHostMode;
  forcedUntil: Date | null;
  forcedBy: string | null;
}

/** Snapshot of all daemon-relevant Station settings. Single Prisma fetch
 *  covers every block, then the cache hands the same object out for the
 *  TTL so we don't hammer Neon under chatter load. */
export interface StationConfig {
  autoHost: StationConfigBlock;
  worldAside: StationConfigBlock;
  /** YouTube chat poll cadence in ms (operator-tunable). */
  youtubeChatPollMs: number;
  /** Which TTS backend to use for all synthesized speech (chatter,
   *  shoutouts, world asides, replies). Toggled from the dashboard. */
  voiceProvider: VoiceProvider;
}

export interface StationConfigCacheOpts {
  ttlMs: number;
  fetchOnce: () => Promise<StationConfig>;
  now?: () => number;
}

const BLOCK_FALLBACK: StationConfigBlock = {
  mode: "auto",
  forcedUntil: null,
  forcedBy: null,
};

const FALLBACK: StationConfig = {
  autoHost: BLOCK_FALLBACK,
  worldAside: BLOCK_FALLBACK,
  youtubeChatPollMs: 90_000,
  voiceProvider: "deepgram",
};

export class StationConfigCache {
  private readonly ttlMs: number;
  private readonly fetchOnce: () => Promise<StationConfig>;
  private readonly now: () => number;
  private cached: StationConfig | null = null;
  private fetchedAt = -Infinity;

  constructor(opts: StationConfigCacheOpts) {
    this.ttlMs = opts.ttlMs;
    this.fetchOnce = opts.fetchOnce;
    this.now = opts.now ?? (() => Date.now());
  }

  async read(): Promise<StationConfig> {
    const age = this.now() - this.fetchedAt;
    if (this.cached && age < this.ttlMs) return this.cached;
    try {
      const v = await this.fetchOnce();
      this.cached = v;
      this.fetchedAt = this.now();
      return v;
    } catch (err) {
      console.warn(
        "[station-config] fetch failed, using previous value:",
        err instanceof Error ? err.message : err,
      );
      return this.cached ?? FALLBACK;
    }
  }

  invalidate(): void {
    this.fetchedAt = -Infinity;
  }
}
