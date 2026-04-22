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

export interface NowPlayingInfo {
  title: string;
  artist: string;
}

export interface AutoHostDeps {
  flag: { isEnabled(): Promise<boolean> };
  resolveNowPlaying: () => Promise<NowPlayingInfo | null>;
  generateScript: (prompts: { system: string; user: string }) => Promise<string>;
  synthesizeSpeech: (text: string) => Promise<Buffer>;
  uploadChatter: (body: Buffer, chatterId: string) => Promise<string>;
  pushToOverlay: (url: string) => Promise<void>;
  logPush: (entry: { chatterId: string; type: ChatterType; slot: number; url: string }) => void;
  logFailure: (entry: { reason: string; detail?: string }) => void;
  sleep?: (ms: number) => Promise<void>;
}

const RETRY_DELAY_MS = 2_000;

function makeChatterId(): string {
  return `chatter-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class AutoHostOrchestrator {
  readonly state = new AutoHostStateMachine();
  private readonly deps: AutoHostDeps;
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
  }

  /**
   * Run one chatter cycle end-to-end. Caller decides when — typically when
   * onMusicTrackStart returned "trigger".
   */
  async runChatter(): Promise<void> {
    if (this.state.isInFlight()) return;
    this.state.markInFlight();

    try {
      if (!(await this.deps.flag.isEnabled())) {
        this.state.markFailure(); // no-op for counter, but releases in-flight + resets tracks
        // Release the music counter fully rather than leaving it at 0 — the
        // markFailure() does that already. No slotCounter change (correct;
        // feature is off, rotation shouldn't advance).
        return;
      }

      const ok = await this.attempt();
      if (ok) return;

      // Retry once.
      await (this.deps.sleep ?? defaultSleep)(RETRY_DELAY_MS);
      const ok2 = await this.attempt();
      if (!ok2) this.state.markFailure();
    } catch (err) {
      // Defensive catch — should never happen because attempt() never rethrows.
      this.deps.logFailure({
        reason: "auto_chatter_unexpected",
        detail: err instanceof Error ? err.message : String(err),
      });
      this.state.markFailure();
    }
  }

  private async attempt(): Promise<boolean> {
    const slot = this.state.slotCounter % 20;
    const type = slotTypeFor(slot);

    // 1. gather track context for back_announce
    let context: { title?: string; artist?: string } = {};
    if (type === "back_announce") {
      try {
        const np = await this.deps.resolveNowPlaying();
        if (np) context = { title: np.title, artist: np.artist };
      } catch {
        // non-fatal — back_announce falls back to generic wording
      }
    }

    // 2. MiniMax script
    const prompts = promptFor(type, context);
    let script: string;
    try {
      script = await this.deps.generateScript(prompts);
    } catch (e) {
      this.deps.logFailure({
        reason: "auto_chatter_script_failed",
        detail: e instanceof Error ? e.message : String(e),
      });
      return false;
    }

    // 3. Deepgram TTS
    let audio: Buffer;
    try {
      audio = await this.deps.synthesizeSpeech(script);
    } catch (e) {
      this.deps.logFailure({
        reason: "auto_chatter_tts_failed",
        detail: e instanceof Error ? e.message : String(e),
      });
      return false;
    }

    // 4. B2 upload
    const chatterId = makeChatterId();
    let url: string;
    try {
      url = await this.deps.uploadChatter(audio, chatterId);
    } catch (e) {
      this.deps.logFailure({
        reason: "auto_chatter_b2_failed",
        detail: e instanceof Error ? e.message : String(e),
      });
      return false;
    }

    // 5. Liquidsoap overlay_queue push
    try {
      await this.deps.pushToOverlay(url);
    } catch (e) {
      this.deps.logFailure({
        reason: "auto_chatter_push_failed",
        detail: e instanceof Error ? e.message : String(e),
      });
      return false;
    }

    this.deps.logPush({ chatterId, type, slot, url });
    this.state.markSuccess();
    return true;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
