// Loudness backfill poller — runs as a tick in the queue daemon.
// Each tick picks one Track with loudnessLufs IS NULL (excluding voice
// content) and runs lib/loudnormalise-existing-track on it. Catches:
//   - artist submission approvals (created by the Vercel approve route
//     with loudnessLufs=NULL since Vercel can't run ffmpeg)
//   - any track the inline ingest path failed on (raw fallback)
//   - the existing 130-track catalogue, on a leisurely 60s/track cadence
//
// Reuses lib/loudnormalise-existing-track so the backfill script and
// the daemon are guaranteed to behave identically.

import type { PrismaClient } from "@prisma/client";
import {
  loudnormaliseExistingTrack,
  type LoudnormaliseTrackResult,
  type LoudnormaliseTrackDeps,
} from "../../lib/loudnormalise-existing-track.ts";

export interface LoudnormPollerOpts {
  intervalMs?: number;
  processImpl?: (
    prisma: PrismaClient,
    trackId: string,
    deps?: LoudnormaliseTrackDeps,
  ) => Promise<LoudnormaliseTrackResult>;
}

export type TickResult = "idle" | "processed" | "skipped" | "failed";

/**
 * Run one tick of the loudnorm poller. Picks the oldest Track with
 * loudnessLufs IS NULL (excluding voice content) and processes it.
 * Returns "idle" when no work is pending.
 */
export async function runLoudnormTick(
  prisma: PrismaClient,
  opts: LoudnormPollerOpts & { skipIds?: Set<string> } = {},
): Promise<TickResult> {
  const process = opts.processImpl ?? loudnormaliseExistingTrack;
  const skipIds = opts.skipIds ?? new Set<string>();

  const candidate = await prisma.track.findFirst({
    where: {
      loudnessLufs: null,
      ...(skipIds.size > 0 ? { id: { notIn: Array.from(skipIds) } } : {}),
      // Exclude voice content — the helper would skip it anyway, but
      // pre-filtering in SQL avoids loading a row just to discard it.
      NOT: {
        AND: [
          { sourceType: "external_import" },
          { airingPolicy: "request_only" },
          { title: { startsWith: "Shoutout" } },
        ],
      },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true },
  });

  if (!candidate) return "idle";

  const result = await process(prisma, candidate.id);

  if ("ok" in result) {
    console.log(
      `[loudnorm-poller] processed ${candidate.id} "${candidate.title}" ${result.measurement.inputI.toFixed(1)} → ${result.measurement.outputI.toFixed(1)} LUFS`,
    );
    return "processed";
  }
  if ("skipped" in result) {
    console.log(`[loudnorm-poller] skipped:${result.skipped} ${candidate.id}`);
    return "skipped";
  }
  console.warn(`[loudnorm-poller] failed ${candidate.id}: ${result.error}`);
  skipIds.add(candidate.id);
  return "failed";
}

/**
 * Start the poller as a long-running interval. Returns a stop fn.
 */
export function startLoudnormPoller(
  prisma: PrismaClient,
  opts: LoudnormPollerOpts = {},
): { stop: () => void } {
  const intervalMs = opts.intervalMs ?? 60_000;
  const skipIds = new Set<string>();
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async () => {
    if (stopped) return;
    try {
      await runLoudnormTick(prisma, { ...opts, skipIds });
    } catch (err) {
      // Defensive: runLoudnormTick swallows helper errors, so a throw
      // here would mean a bug in the poller itself. Log and continue —
      // never let a poller exception take the daemon down.
      console.error(`[loudnorm-poller] tick threw: ${String(err)}`);
    }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };

  // Fire first tick after one interval (gives the rest of the daemon
  // time to settle on startup).
  timer = setTimeout(tick, intervalMs);

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
