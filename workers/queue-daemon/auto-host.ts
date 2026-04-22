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
