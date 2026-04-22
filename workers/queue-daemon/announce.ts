import {
  announcementPrompt,
  type AnnouncementContext,
} from "./chatter-prompts.ts";

interface StashEntry {
  url: string | null;
  script: string | null;
  failed: boolean;
  ready: Promise<void>;
}

export interface AnnounceLogPushEntry {
  chatterId: string;
  trackId: string;
  url: string;
  script: string;
}

export interface AnnounceLogFailureEntry {
  reason: string;
  detail?: string;
}

export interface AnnounceDeps {
  generateScript: (prompts: { system: string; user: string }) => Promise<string>;
  synthesizeSpeech: (text: string) => Promise<Buffer>;
  uploadChatter: (body: Buffer, chatterId: string) => Promise<string>;
  pushToOverlay: (url: string) => Promise<void>;
  logPush: (entry: AnnounceLogPushEntry) => void;
  logFailure: (entry: AnnounceLogFailureEntry) => void;
  /** Reset the auto-chatter counter so we don't double-up voices. */
  onVoicePushed: () => void;
}

/**
 * Pre-generates and airs an intro over the first seconds of a fresh
 * listener-generated song. Separate from the auto-chatter orchestrator
 * because it's EVENT-driven (on first air of a specific trackId), not
 * rotation-driven.
 *
 * Lifecycle per listener song:
 *   1. schedule(trackId, ctx) — called by pushHandler when a listener song
 *      is pushed to the priority queue. Kicks off background MiniMax +
 *      Deepgram + B2 generation.
 *   2. announceIfPending(trackId) — called by onTrackHandler when any
 *      track starts. If this trackId has a stashed announcement, push
 *      it to overlay_queue (fire-and-forget; awaits generation if still
 *      in progress). Clears the stash when done.
 *
 * State is in-memory only. A daemon restart loses any pending
 * announcements — listener songs that were queued but hadn't aired yet
 * will play without an announcement. Acceptable MVP trade-off.
 */
export class AnnouncementOrchestrator {
  readonly #stash = new Map<string, StashEntry>();
  private readonly deps: AnnounceDeps;

  constructor(deps: AnnounceDeps) {
    this.deps = deps;
  }

  /**
   * Kick off background pre-generation for a listener song's intro.
   * Safe to call multiple times with the same trackId — only the first
   * call runs the pipeline; subsequent calls are no-ops.
   */
  schedule(trackId: string, ctx: AnnouncementContext): void {
    if (this.#stash.has(trackId)) return;
    const entry: StashEntry = {
      url: null,
      script: null,
      failed: false,
      // Placeholder — replaced by #generate's returned promise below.
      ready: Promise.resolve(),
    };
    entry.ready = this.#generate(trackId, ctx, entry);
    this.#stash.set(trackId, entry);
  }

  /**
   * Called from onTrackHandler on every music-track boundary. If this
   * trackId has a stashed announcement, push it to overlay_queue when
   * ready. Non-blocking — returns immediately; push happens async.
   */
  announceIfPending(trackId: string): void {
    const entry = this.#stash.get(trackId);
    if (!entry) return;
    void this.#awaitAndPush(trackId, entry);
  }

  /** Test helper: does the stash currently hold an entry for this track? */
  has(trackId: string): boolean {
    return this.#stash.has(trackId);
  }

  async #generate(
    trackId: string,
    ctx: AnnouncementContext,
    entry: StashEntry,
  ): Promise<void> {
    try {
      const prompts = announcementPrompt(ctx);
      const script = await this.deps.generateScript(prompts);
      const audio = await this.deps.synthesizeSpeech(script);
      const chatterId = `announce-${trackId.slice(0, 10)}-${Date.now().toString(36)}`;
      const url = await this.deps.uploadChatter(audio, chatterId);
      entry.url = url;
      entry.script = script;
    } catch (e) {
      entry.failed = true;
      this.deps.logFailure({
        reason: "listener_song_announce_gen_failed",
        detail: `${trackId}: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  async #awaitAndPush(trackId: string, entry: StashEntry): Promise<void> {
    try {
      await entry.ready;
      if (entry.failed || !entry.url || !entry.script) return;
      try {
        await this.deps.pushToOverlay(entry.url);
      } catch (e) {
        this.deps.logFailure({
          reason: "listener_song_announce_push_failed",
          detail: `${trackId}: ${e instanceof Error ? e.message : String(e)}`,
        });
        return;
      }
      this.deps.logPush({
        chatterId: `announce-${trackId}`,
        trackId,
        url: entry.url,
        script: entry.script,
      });
      this.deps.onVoicePushed();
    } finally {
      this.#stash.delete(trackId);
    }
  }
}
