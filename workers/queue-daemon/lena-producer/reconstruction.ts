// workers/queue-daemon/lena-producer/reconstruction.ts

import type { PrismaClient } from "@prisma/client";
import type { ProducerMode, ShiftEvent } from "./shift-event.ts";

type PrismaSlice = Pick<PrismaClient, "playHistory" | "chatter" | "shoutout">;

const PRODUCER_MODES: ReadonlySet<string> = new Set<ProducerMode>([
  "opinion",
  "callback",
  "aside",
  "answer",
  "shoutout_read",
  "shoutout_with_request",
  "queue_pick",
  "accept_request",
  "accept_request_deferred",
  "decline_request",
  "silence",
]);

export async function reconstructEvents(deps: {
  prisma: PrismaSlice;
  stationId: string;
  sinceMs: number;
  nowMs: number;
}): Promise<ShiftEvent[]> {
  const since = new Date(deps.sinceMs);

  const [plays, chatters, shoutouts] = await Promise.all([
    deps.prisma.playHistory.findMany({
      where: { stationId: deps.stationId, startedAt: { gte: since }, segmentType: "audio_track" },
      orderBy: { startedAt: "asc" },
      select: {
        id: true,
        trackId: true,
        titleSnapshot: true,
        startedAt: true,
        // Track.key does not exist in this schema — ShiftEvent.key is set to null below.
        track: { select: { artistDisplay: true, genre: true, bpm: true } },
      },
    }),
    deps.prisma.chatter.findMany({
      where: { stationId: deps.stationId, airedAt: { gte: since } },
      orderBy: { airedAt: "asc" },
      select: { id: true, chatterType: true, script: true, airedAt: true, producerVersion: true },
    }),
    // Shoutout doesn't have an explicit "airedAt" — we treat the row createdAt as
    // the closest available proxy. Phase 2 may switch to JOIN through Track→PlayHistory.
    // Schema uses `requesterName` (not `handle`); we map it onto ShiftEvent.handle.
    deps.prisma.shoutout.findMany({
      where: { stationId: deps.stationId, createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      select: { id: true, cleanText: true, requesterName: true, createdAt: true },
    }),
  ]);

  const events: ShiftEvent[] = [];

  for (const p of plays) {
    events.push({
      type: "track_aired",
      id: p.id,
      trackId: p.trackId ?? p.id,
      title: p.titleSnapshot ?? "(unknown)",
      artist: p.track?.artistDisplay ?? null,
      genre: p.track?.genre ?? null,
      bpm: p.track?.bpm ?? null,
      key: null,
      airedAt: p.startedAt.getTime(),
    });
  }

  for (const c of chatters) {
    const isProducerMode = c.producerVersion != null && PRODUCER_MODES.has(c.chatterType);
    events.push({
      type: "lena_line_aired",
      id: c.id,
      mode: isProducerMode ? (c.chatterType as ProducerMode) : "legacy",
      targetFocus: null,
      text: c.script,
      airedAt: c.airedAt.getTime(),
      trigger: isProducerMode ? "auto_track_boundary" : "legacy",
      addressedListener: null,
    });
  }

  for (const s of shoutouts) {
    events.push({
      type: "shoutout_aired",
      id: s.id,
      handle: s.requesterName ?? "anonymous",
      originalText: s.cleanText ?? "",
      airedAt: s.createdAt.getTime(),
    });
  }

  events.sort((a, b) => airedAt(a) - airedAt(b));
  return events;
}

function airedAt(e: ShiftEvent): number {
  return e.type === "operator_force" ? e.forcedAt : e.airedAt;
}
