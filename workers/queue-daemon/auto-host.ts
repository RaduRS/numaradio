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

  get tracksSinceVoice(): number {
    return this.#tracksSinceVoice;
  }

  get slotCounter(): number {
    return this.#slotCounter;
  }

  onMusicTrackStart(): TrackStartAction {
    // We count the track even while a prior chatter is still generating —
    // if that chatter later succeeds it will reset the counter; if it fails
    // we're already one step closer to the next opportunity.
    this.#tracksSinceVoice += 1;
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

import { slotTypeFor, promptFor, type ChatterType } from "./chatter-prompts.ts";

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
  flag: { isEnabled(): Promise<boolean> };
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
  logFailure: (entry: { reason: string; detail?: string }) => void;
  sleep?: (ms: number) => Promise<void>;
  /** Injectable clock for testing; defaults to Date.now. */
  now?: () => number;
}

const RETRY_DELAY_MS = 2_000;
/**
 * How many seconds before the current track's end Lena starts speaking.
 * Her ~15s line spans the last 10s of the current track + ~5s of the next,
 * so listeners hear a radio-style back-announce bridging the two songs.
 */
const PUSH_OFFSET_BEFORE_END_SECONDS = 10;

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
  onMusicTrackStart(): TrackStartAction {
    return this.state.onMusicTrackStart();
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
      if (!(await this.deps.flag.isEnabled())) {
        this.state.markFailure();
        return;
      }

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
    const type = slotTypeFor(slot);

    // Back_announce uses the currently-playing track as context — by the
    // time Lena finishes speaking, this track has just ended.
    const context =
      type === "back_announce" && current
        ? { title: current.title, artist: current.artist }
        : {};

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
