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
 */
export class AutoHostStateMachine {
  tracksSinceVoice = 0;
  slotCounter = 0;
  private inFlight = false;

  onMusicTrackStart(): TrackStartAction {
    this.tracksSinceVoice += 1;
    if (this.inFlight) return "idle";
    if (this.tracksSinceVoice >= 2) return "trigger";
    return "idle";
  }

  onVoicePushed(): void {
    this.tracksSinceVoice = 0;
    // If we had a generation in flight when a shoutout preempted us,
    // cancel the in-flight marker; the orchestrator will see
    // shouldCancel() and drop its pending push.
    this.inFlight = false;
  }

  markInFlight(): void {
    this.inFlight = true;
  }

  isInFlight(): boolean {
    return this.inFlight;
  }

  markSuccess(): void {
    this.slotCounter = (this.slotCounter + 1) >>> 0;
    this.tracksSinceVoice = 0;
    this.inFlight = false;
  }

  markFailure(): void {
    // slotCounter unchanged — same type retries next opportunity
    this.tracksSinceVoice = 0;
    this.inFlight = false;
  }
}
