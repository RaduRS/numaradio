export interface StationFlagCacheOpts {
  ttlMs: number;
  fetchOnce: () => Promise<boolean>;
  now?: () => number;
}

export class StationFlagCache {
  private readonly ttlMs: number;
  private readonly fetchOnce: () => Promise<boolean>;
  private readonly now: () => number;
  private cached: boolean | null = null;
  private fetchedAt = -Infinity;

  constructor(opts: StationFlagCacheOpts) {
    this.ttlMs = opts.ttlMs;
    this.fetchOnce = opts.fetchOnce;
    this.now = opts.now ?? (() => Date.now());
  }

  async isEnabled(): Promise<boolean> {
    const age = this.now() - this.fetchedAt;
    if (this.cached !== null && age < this.ttlMs) return this.cached;
    try {
      const v = await this.fetchOnce();
      this.cached = v;
      this.fetchedAt = this.now();
      return v;
    } catch (err) {
      // Preserve the previous known-good value on transient errors.
      // Log once so operators can see it in journalctl.
      console.warn(
        "[station-flag] fetch failed, using previous value:",
        err instanceof Error ? err.message : err,
      );
      return this.cached ?? false;
    }
  }
}
