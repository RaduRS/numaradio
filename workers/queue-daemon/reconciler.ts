import type { StagedItem } from "./hydrator.ts";

/**
 * Reconciles the DB's `staged` priority_request QueueItems against
 * Liquidsoap's in-memory `priority.queue`. Run on a timer (~30s) to
 * self-heal silent telnet drops — the daemon's `priority.push` is
 * fire-and-forget over TCP with no ACK, so a half-open socket or
 * server-side stall can leave a track stuck in `staged` forever.
 *
 * Idempotent: reads Liquidsoap's current queue first and only pushes
 * URLs that aren't already there, so listeners never hear the same
 * track twice from a reconciliation tick.
 */
export interface ReconcileDeps {
  listStaged(): Promise<Array<StagedItem & { createdAt: number }>>;
  resolveAssetUrl(trackId: string): Promise<string | null>;
  request(cmd: string, timeoutMs?: number): Promise<string[]>;
  send(line: string): Promise<void>;
  log?: (msg: string) => void;
  minAgeMs?: number;
  now?: () => number;
  /** Returns true if the track has been played at any point since the
   *  queue item was created. The `queueItemCreatedAt` lower bound is
   *  load-bearing: a 5-min recency window misses tracks that aired
   *  e.g. 20 min ago but whose staged row was created 40 min ago —
   *  reconciler then re-pushes them forever (No Rush / EUTHANIZE loop). */
  isTrackRecentlyPlayed?: (trackId: string, queueItemCreatedAt: number) => Promise<boolean>;
  /** NEW: marks a staged row as completed (called when we detected the
   *  track already played but its status didn't transition). */
  markCompleted?: (queueItemId: string) => Promise<void>;
}

export type ReconcileResult = {
  stagedInDb: number;
  inLiquidsoap: number;
  repushed: number;
};

export async function reconcilePriorityQueue(deps: ReconcileDeps): Promise<ReconcileResult> {
  const log = deps.log ?? (() => undefined);
  const now = (deps.now ?? Date.now)();
  const minAgeMs = deps.minAgeMs ?? 10_000;

  const staged = await deps.listStaged();
  const musicStaged = staged.filter((s) => s.queueType !== "shoutout");

  let liquidsoapUrls: Set<string>;
  try {
    liquidsoapUrls = await readLiquidsoapPriorityUrls(deps.request);
  } catch (err) {
    log(`[reconciler] read failed: ${err instanceof Error ? err.message : String(err)}`);
    return { stagedInDb: musicStaged.length, inLiquidsoap: -1, repushed: 0 };
  }

  let repushed = 0;
  for (const item of musicStaged) {
    if (!item.trackId) continue;
    if (now - item.createdAt < minAgeMs) continue;
    const url = await deps.resolveAssetUrl(item.trackId);
    if (!url) continue;
    if (liquidsoapUrls.has(url)) continue;

    // Defense-in-depth: if track was just played, don't re-push.
    // Mark the row as completed so future ticks skip it cleanly.
    if (deps.isTrackRecentlyPlayed) {
      try {
        const recentlyPlayed = await deps.isTrackRecentlyPlayed(item.trackId, item.createdAt);
        if (recentlyPlayed) {
          if (deps.markCompleted) {
            await deps.markCompleted(item.id);
          }
          log(`[reconciler] skipped re-push of ${item.id} (track recently played, marked completed)`);
          continue;
        }
      } catch (err) {
        log(`[reconciler] recent-play check failed for ${item.id}: ${err instanceof Error ? err.message : String(err)}`);
        // Fail-open: proceed with re-push (current behavior)
      }
    }

    try {
      await deps.send(`priority.push ${url}`);
      repushed++;
      log(`[reconciler] re-pushed ${item.id} (${url})`);
    } catch (err) {
      log(`[reconciler] re-push failed for ${item.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { stagedInDb: musicStaged.length, inLiquidsoap: liquidsoapUrls.size, repushed };
}

async function readLiquidsoapPriorityUrls(
  request: (cmd: string, timeoutMs?: number) => Promise<string[]>,
): Promise<Set<string>> {
  const queueLines = await request("priority.queue");
  const rids = queueLines.flatMap((l) => l.split(/\s+/)).filter(Boolean);
  const urls = new Set<string>();
  for (const rid of rids) {
    const meta = await request(`request.metadata ${rid}`);
    const uri = parseInitialUri(meta);
    if (uri) urls.add(uri);
  }
  return urls;
}

function parseInitialUri(metaLines: string[]): string | null {
  for (const line of metaLines) {
    const m = /^initial_uri="(.*)"$/.exec(line);
    if (m) return m[1];
  }
  return null;
}
