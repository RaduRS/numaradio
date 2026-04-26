export type TrackStartAction = "idle" | "trigger";

/**
 * Pure state machine for Lena auto-chatter.
 *
 * External hooks:
 *   - onMusicTrackStart() called once per music track boundary
 *   - onVoicePushed()     called when any voice (shoutout or our own chatter)
 *                         is pushed to overlay_queue
 *   - markInFlight()      caller has started generation
 *   - markSuccess()       chatter aired — advance slotCounter
 *   - markFailure()       generation failed after retry — keep slotCounter
 *
 * Invariant: markSuccess() / markFailure() must only be called between a
 * markInFlight() and the next voice event. Calling them otherwise is a
 * composition bug and will throw.
 */
export class AutoHostStateMachine {
  #tracksSinceVoice = 0;
  #slotCounter = 0;
  #inFlight = false;
  #recentArtists: string[] = [];

  get tracksSinceVoice(): number {
    return this.#tracksSinceVoice;
  }

  get slotCounter(): number {
    return this.#slotCounter;
  }

  /** Last 3 aired artists, newest-first. Cleared on daemon restart. */
  get recentArtists(): readonly string[] {
    return this.#recentArtists;
  }

  /**
   * @param artist  Optional artist name of the track that just started.
   *                Empty strings and undefined are ignored (unresolved lookups).
   */
  onMusicTrackStart(artist?: string): TrackStartAction {
    // We count the track even while a prior chatter is still generating —
    // if that chatter later succeeds it will reset the counter; if it fails
    // we're already one step closer to the next opportunity.
    this.#tracksSinceVoice += 1;
    if (artist && artist.length > 0) {
      this.#recentArtists.unshift(artist);
      if (this.#recentArtists.length > 3) this.#recentArtists.length = 3;
    }
    if (this.#inFlight) return "idle";
    if (this.#tracksSinceVoice >= 2) return "trigger";
    return "idle";
  }

  onVoicePushed(): void {
    this.#tracksSinceVoice = 0;
    // Cancel any generation in flight — the voice slot is already taken.
    this.#inFlight = false;
  }

  markInFlight(): void {
    this.#inFlight = true;
  }

  isInFlight(): boolean {
    return this.#inFlight;
  }

  markSuccess(): void {
    if (!this.#inFlight) {
      throw new Error("markSuccess called without markInFlight");
    }
    this.#slotCounter += 1;
    this.#tracksSinceVoice = 0;
    this.#inFlight = false;
  }

  markFailure(): void {
    if (!this.#inFlight) {
      throw new Error("markFailure called without markInFlight");
    }
    this.#tracksSinceVoice = 0;
    this.#inFlight = false;
  }
}

import { slotTypeFor, promptFor, type ChatterType, type PromptContext } from "./chatter-prompts.ts";
import { showForHour, timeOfDayFor, formatLocalTime } from "../../lib/schedule.ts";
import type { StationConfig } from "./station-config.ts";

export interface CurrentTrackInfo {
  title: string;
  artist: string;
  /** Unix ms. Used to compute the target push time. */
  startedAtMs: number;
  /**
   * Null when unknown — orchestrator skips the pre-end wait and pushes
   * immediately (equivalent to the old at-track-boundary behaviour).
   */
  durationSeconds: number | null;
}

export interface AutoHostDeps {
  /** Reads the current tri-state config (cached ~30s by caller). */
  config: () => Promise<StationConfig>;
  /**
   * Raw Icecast listener count for the stream mount. Returns null on
   * any fetch / parse error — in auto mode, null means "skip the break"
   * (fail-closed, don't shout to no one).
   */
  getListenerCount: () => Promise<number | null>;
  /**
   * Called when runChatter() discovers an expired forced_* state. The
   * caller performs an atomic UPDATE ... WHERE autoHostForcedUntil =
   * <entry.forcedUntil> to avoid racing with a concurrent operator toggle,
   * and invalidates the config cache. Must not rethrow.
   */
  revertExpired: (entry: {
    fromMode: "forced_on" | "forced_off";
    forcedUntil: Date;
  }) => Promise<void>;
  /**
   * Returns the currently-playing music track. Used for two things:
   *   - back_announce context: "That was <title> by <artist>" — at generation
   *     time this is the track CURRENTLY playing, but by the time Lena
   *     finishes speaking (her speech starts 10s before end of this track
   *     and continues into the next) it will have just ended.
   *   - push scheduling: startedAtMs + durationSeconds tell the orchestrator
   *     when to push (target = trackEnd − PUSH_OFFSET_BEFORE_END_SECONDS).
   */
  resolveCurrentTrack: () => Promise<CurrentTrackInfo | null>;
  generateScript: (prompts: { system: string; user: string }) => Promise<string>;
  synthesizeSpeech: (text: string) => Promise<Buffer>;
  uploadChatter: (body: Buffer, chatterId: string) => Promise<string>;
  pushToOverlay: (url: string) => Promise<void>;
  logPush: (entry: { chatterId: string; type: ChatterType; slot: number; url: string; script: string }) => void;
  /** Persist the chatter row to Neon so the public site can surface it
   *  as "what Lena just said". Optional — daemon keeps broadcasting if
   *  the DB is briefly unavailable. */
  persistChatter?: (entry: { chatterId: string; type: ChatterType; slot: number; url: string; script: string }) => Promise<void>;
  logFailure: (entry: { reason: string; detail?: string }) => void;
  sleep?: (ms: number) => Promise<void>;
  /** Injectable clock for testing; defaults to Date.now. */
  now?: () => number;
  /** Injectable [0,1) random source for testing; defaults to Math.random. */
  randomGate?: () => number;
}

const RETRY_DELAY_MS = 2_000;
/**
 * How many seconds before the current track's end Lena starts speaking.
 * With a ~15s speech and a 15s offset, Lena finishes roughly at the
 * track boundary — her voice overlays the outro of the current track
 * and lands just as the next track begins. Standard radio-DJ style.
 */
const PUSH_OFFSET_BEFORE_END_SECONDS = 15;

function makeChatterId(): string {
  return `chatter-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

interface ReadyAsset {
  chatterId: string;
  type: ChatterType;
  slot: number;
  url: string;
  script: string;
}

export class AutoHostOrchestrator {
  readonly state = new AutoHostStateMachine();
  private readonly deps: AutoHostDeps;
  /**
   * Invalidated by onVoicePushed(). A runChatter() that's sleeping until
   * its push window compares its local run-token to this field before
   * pushing; a mismatch means a shoutout took the slot while we waited.
   */
  #currentRun: symbol | null = null;

  constructor(deps: AutoHostDeps) {
    this.deps = deps;
  }

  /**
   * External hooks delegated from queue-daemon index.ts.
   */
  onMusicTrackStart(artist?: string): TrackStartAction {
    return this.state.onMusicTrackStart(artist);
  }
  onVoicePushed(): void {
    this.state.onVoicePushed();
    // Invalidate any run that's sleeping before its push — the slot is gone.
    this.#currentRun = null;
  }

  /**
   * Generate a chatter, wait until ~10s before the current track ends,
   * then push to overlay_queue. Caller fires this when onMusicTrackStart
   * returns "trigger". Never rethrows — all failures land in lastFailures.
   */
  async runChatter(): Promise<void> {
    if (this.state.isInFlight()) return;
    this.state.markInFlight();
    const myRun = Symbol("autoHostRun");
    this.#currentRun = myRun;

    try {
      // Tri-state gating: auto / forced_on / forced_off.
      // Expired forced_* lazy-reverts to auto then evaluates.
      const gateNow = (this.deps.now ?? Date.now)();
      let cfg = await this.deps.config();
      if (cfg.mode !== "auto" && cfg.forcedUntil && cfg.forcedUntil.getTime() <= gateNow) {
        await this.deps.revertExpired({
          fromMode: cfg.mode,
          forcedUntil: cfg.forcedUntil,
        });
        cfg = { mode: "auto", forcedUntil: null, forcedBy: null };
      }
      if (cfg.mode === "forced_off") {
        this.state.markFailure();
        return;
      }
      if (cfg.mode === "auto") {
        const listeners = await this.deps.getListenerCount();
        if (listeners === null || listeners < 5) {
          this.state.markFailure();
          return;
        }
      }
      // forced_on or auto-with-enough-listeners → proceed

      // Snapshot current-track info BEFORE generation so timing is
      // anchored to what's playing when we fire, not whatever is playing
      // 10s later after MiniMax/Deepgram round-trips.
      const current = await this.safeResolveCurrentTrack();

      // Generate, with one retry on failure.
      let asset = await this.generateAsset(current);
      if (!asset) {
        await (this.deps.sleep ?? defaultSleep)(RETRY_DELAY_MS);
        if (this.#currentRun !== myRun) return;
        asset = await this.generateAsset(current);
      }
      if (!asset) {
        this.state.markFailure();
        return;
      }

      // Wait until ~10s before the current track ends before pushing.
      // If duration is unknown OR we're already past the target, push now.
      if (current?.durationSeconds != null) {
        const now = (this.deps.now ?? Date.now)();
        const pushAtMs =
          current.startedAtMs +
          (current.durationSeconds - PUSH_OFFSET_BEFORE_END_SECONDS) * 1000;
        const waitMs = pushAtMs - now;
        if (waitMs > 0) {
          await (this.deps.sleep ?? defaultSleep)(waitMs);
        }
      }

      // Shoutout during the wait? Discard — the slot is already taken.
      if (this.#currentRun !== myRun) return;

      // Push to overlay_queue.
      try {
        await this.deps.pushToOverlay(asset.url);
      } catch (e) {
        this.deps.logFailure({
          reason: "auto_chatter_push_failed",
          detail: e instanceof Error ? e.message : String(e),
        });
        this.state.markFailure();
        return;
      }

      this.deps.logPush({ ...asset });
      // Best-effort DB write so the public site can mirror the script as
      // "Lena · just now". Failure here is non-fatal — the broadcast is
      // already on air, the in-memory ring buffer captured it for the
      // dashboard, and the public site falls back to its quote pool.
      if (this.deps.persistChatter) {
        try {
          await this.deps.persistChatter({ ...asset });
        } catch (e) {
          this.deps.logFailure({
            reason: "auto_chatter_persist_failed",
            detail: e instanceof Error ? e.message : String(e),
          });
        }
      }
      this.state.markSuccess();
    } catch (err) {
      // Defensive catch — should never happen because generateAsset never rethrows.
      this.deps.logFailure({
        reason: "auto_chatter_unexpected",
        detail: err instanceof Error ? err.message : String(err),
      });
      if (this.state.isInFlight()) this.state.markFailure();
    }
  }

  private async safeResolveCurrentTrack(): Promise<CurrentTrackInfo | null> {
    try {
      return await this.deps.resolveCurrentTrack();
    } catch {
      return null;
    }
  }

  /**
   * Run the full pipeline (script → TTS → B2 upload) and return the
   * asset on success. Never rethrows — on failure logs a specific reason
   * and returns null so the caller can retry or give up.
   */
  private async generateAsset(
    current: CurrentTrackInfo | null,
  ): Promise<ReadyAsset | null> {
    const slot = this.state.slotCounter % 20;
    const rotationType = slotTypeFor(slot);
    // If back_announce lands but we can't resolve the current track, fall
    // back to filler — the "that one" / "the artist" default-substitution in
    // promptFor would otherwise air literally ("That was 'that one' by the
    // artist. Good one."), which is worse than a generic station-ID line.
    const type: ChatterType =
      rotationType === "back_announce" && !current ? "filler" : rotationType;

    // All variants get the optional context channel (show / recent artists /
    // slot position) so Lena can weave station-aware texture when it fits.
    const now = (this.deps.now ?? Date.now)();
    // Throttle show-name context to 15% of breaks. MiniMax anchors on
    // whatever's in the Context block — passing `currentShow` on every call
    // produces a "Prime Hours in here" opener every ~6 min, which gets
    // grating over a multi-hour listening session. 15% means roughly one
    // show-name reference per ~40 min of airtime — frequent enough to
    // establish station identity, rare enough to not feel canned.
    const nowDate = new Date(now);
    const includeShow = (this.deps.randomGate ?? Math.random)() < 0.15;
    const currentShow = includeShow
      ? showForHour(nowDate.getHours()).name
      : undefined;
    // For back_announce, drop the first ring entry — it's the artist of the
    // currently-playing track, already named in the "by X" clause of the
    // prompt. Including it again pushes MiniMax toward false "second X in a
    // row" framing even when only one X-track played.
    const recentArtists =
      type === "back_announce"
        ? [...this.state.recentArtists].slice(1)
        : [...this.state.recentArtists];

    const context: PromptContext = {
      ...(type === "back_announce" && current
        ? { title: current.title, artist: current.artist }
        : {}),
      ...(currentShow ? { currentShow } : {}),
      ...(recentArtists.length > 0 ? { recentArtists } : {}),
      slotsSinceOpening: slot,
      // Always pass wall-clock context. Without it MiniMax pattern-matches
      // example shapes like "tonight" regardless of the actual hour — that's
      // how a shoutout_cta fired at 08:40 ended up saying "tonight" on air.
      localTime: formatLocalTime(nowDate),
      timeOfDay: timeOfDayFor(nowDate.getHours()),
    };

    const prompts = promptFor(type, context);
    let script: string;
    try {
      script = await this.deps.generateScript(prompts);
    } catch (e) {
      this.deps.logFailure({
        reason: "auto_chatter_script_failed",
        detail: e instanceof Error ? e.message : String(e),
      });
      return null;
    }

    let audio: Buffer;
    try {
      audio = await this.deps.synthesizeSpeech(script);
    } catch (e) {
      this.deps.logFailure({
        reason: "auto_chatter_tts_failed",
        detail: e instanceof Error ? e.message : String(e),
      });
      return null;
    }

    const chatterId = makeChatterId();
    let url: string;
    try {
      url = await this.deps.uploadChatter(audio, chatterId);
    } catch (e) {
      this.deps.logFailure({
        reason: "auto_chatter_b2_failed",
        detail: e instanceof Error ? e.message : String(e),
      });
      return null;
    }

    return { chatterId, type, slot, url, script };
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
