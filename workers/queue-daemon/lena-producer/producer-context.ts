// workers/queue-daemon/lena-producer/producer-context.ts

import type { ShiftMemoryView } from "./shift-memory.ts";

/**
 * Triggers the Producer can handle. Phase 2 supports auto_track_boundary
 * only — Phases 3-5 add youtube_chat_*, operator_force.
 */
export interface AutoTrackBoundaryTrigger {
  source: "auto_track_boundary";
  nextTrack: {
    id: string;
    title: string;
    artist: string | null;
    genre: string | null;
    bpm: number | null;
  };
}

/**
 * Compressed snapshot passed to the Producer LLM. ShiftMemoryView is
 * the raw store; ProducerContext is what the prompt actually sees —
 * pre-digested into strings to keep the prompt small.
 */
export interface ProducerContext {
  trigger: AutoTrackBoundaryTrigger;
  now: { localTime: string; bucket: string };
  show: { name: string; minutesIn: number; minutesUntilNext: number };
  recentTracksSummary: string;
  recentLinesSummary: string;
  callbackPool: { id: string; description: string; minsAgo: number }[];
  counters: {
    msSinceLastLine: number;
    msSinceLastWeatherMention: number;
    msSinceLastStationDrop: number;
    tracksSinceLastShoutout: number;
  };
  mood: {
    currentRun: { genre: string | null; count: number };
    tempoTrend: "rising" | "steady" | "falling";
    avgBpmLast5: number | null;
    topGenreThisHour: string | null;
  };
}

function bucketFor(hour: number): string {
  if (hour < 5) return "late night";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 21) return "evening";
  return "night";
}

function fmtHHMM(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function summarizeRecentTracks(view: ShiftMemoryView): string {
  const tracks = view.events.filter((e) => e.type === "track_aired").slice(-5);
  if (tracks.length === 0) return "(no recent tracks)";
  const genres = new Map<string, number>();
  for (const t of tracks) {
    if (t.type !== "track_aired") continue;
    const g = t.genre ?? "unknown";
    genres.set(g, (genres.get(g) ?? 0) + 1);
  }
  const genreParts = [...genres.entries()].map(([g, n]) => `${n} ${g}`).join(", ");
  const trendPart =
    view.mood.tempoTrend === "rising"
      ? `BPM trending up to ${view.mood.avgBpmLast5}`
      : view.mood.tempoTrend === "falling"
      ? `BPM trending down to ${view.mood.avgBpmLast5}`
      : view.mood.avgBpmLast5 != null
      ? `BPM steady around ${view.mood.avgBpmLast5}`
      : "tempo unclear";
  return `Last ${tracks.length} track${tracks.length === 1 ? "" : "s"}: ${genreParts}; ${trendPart}.`;
}

function summarizeRecentLines(view: ShiftMemoryView): string {
  if (view.recentLines.length === 0) return "(no recent Lena lines this shift)";
  const last3 = view.recentLines.slice(0, 3);
  const parts = last3.map((l) => `${l.mode}`);
  const modeCounts = new Map<string, number>();
  for (const m of view.recentModes) modeCounts.set(m, (modeCounts.get(m) ?? 0) + 1);
  const overIndexed = [...modeCounts.entries()]
    .filter(([, n]) => n >= 3)
    .map(([m, n]) => `${n} ${m}s`)
    .join(", ");
  const overPart = overIndexed ? ` (over-indexed: ${overIndexed})` : "";
  return `Last ${last3.length}: ${parts.join(", ")}.${overPart}`;
}

export function buildProducerContext(deps: {
  memoryView: ShiftMemoryView;
  trigger: AutoTrackBoundaryTrigger;
  nowMs: number;
}): ProducerContext {
  const now = new Date(deps.nowMs);
  return {
    trigger: deps.trigger,
    now: { localTime: fmtHHMM(now), bucket: bucketFor(now.getHours()) },
    show: {
      name: deps.memoryView.show.name,
      minutesIn: deps.memoryView.show.minutesIn,
      minutesUntilNext: deps.memoryView.show.minutesUntilNext,
    },
    recentTracksSummary: summarizeRecentTracks(deps.memoryView),
    recentLinesSummary: summarizeRecentLines(deps.memoryView),
    callbackPool: deps.memoryView.callbackPool.map((c) => ({
      id: c.id,
      description: c.description,
      minsAgo: c.minsAgo,
    })),
    counters: {
      msSinceLastLine: deps.memoryView.counters.msSinceLastLine,
      msSinceLastWeatherMention: deps.memoryView.counters.msSinceLastWeatherMention,
      msSinceLastStationDrop: deps.memoryView.counters.msSinceLastStationDrop,
      tracksSinceLastShoutout: deps.memoryView.counters.tracksSinceLastShoutout,
    },
    mood: {
      currentRun: {
        genre: deps.memoryView.mood.currentRun.genre,
        count: deps.memoryView.mood.currentRun.count,
      },
      tempoTrend: deps.memoryView.mood.tempoTrend,
      avgBpmLast5: deps.memoryView.mood.avgBpmLast5,
      topGenreThisHour: deps.memoryView.mood.topGenreThisHour,
    },
  };
}
