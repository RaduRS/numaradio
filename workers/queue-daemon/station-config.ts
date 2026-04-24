export type AutoHostMode = "auto" | "forced_on" | "forced_off";

export interface StationConfig {
  mode: AutoHostMode;
  forcedUntil: Date | null;
  forcedBy: string | null;
}

export interface StationConfigCacheOpts {
  ttlMs: number;
  fetchOnce: () => Promise<StationConfig>;
  now?: () => number;
}

const AUTO_FALLBACK: StationConfig = {
  mode: "auto",
  forcedUntil: null,
  forcedBy: null,
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
      return this.cached ?? AUTO_FALLBACK;
    }
  }

  invalidate(): void {
    this.fetchedAt = -Infinity;
  }
}
