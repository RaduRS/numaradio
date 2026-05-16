import type { ShiftEvent } from "./shift-event.ts";

export interface Mood {
  currentRun: { genre: string | null; count: number; startedAt: number };
  tempoTrend: "rising" | "steady" | "falling";
  avgBpmLast5: number | null;
  topGenreThisHour: string | null;
}

const HOUR_MS = 60 * 60 * 1000;

export function deriveMood(log: readonly ShiftEvent[], nowMs: number): Mood {
  const tracks = log
    .filter((e): e is Extract<ShiftEvent, { type: "track_aired" }> => e.type === "track_aired")
    .sort((a, b) => a.airedAt - b.airedAt);

  if (tracks.length === 0) {
    return {
      currentRun: { genre: null, count: 0, startedAt: 0 },
      tempoTrend: "steady",
      avgBpmLast5: null,
      topGenreThisHour: null,
    };
  }

  // currentRun: walk backwards from latest until genre changes
  const latest = tracks[tracks.length - 1];
  let runCount = 1;
  let runStartedAt = latest.airedAt;
  for (let i = tracks.length - 2; i >= 0; i -= 1) {
    if (tracks[i].genre === latest.genre && latest.genre !== null) {
      runCount += 1;
      runStartedAt = tracks[i].airedAt;
    } else {
      break;
    }
  }

  // tempoTrend + avgBpmLast5
  const last5 = tracks.slice(-5);
  const bpms = last5.map((t) => t.bpm).filter((b): b is number => b !== null);
  const avgBpmLast5 = bpms.length > 0 ? Math.round(bpms.reduce((s, n) => s + n, 0) / bpms.length) : null;

  let tempoTrend: Mood["tempoTrend"] = "steady";
  if (bpms.length >= 3) {
    const first = bpms[0];
    const last = bpms[bpms.length - 1];
    const delta = last - first;
    if (delta >= 8) tempoTrend = "rising";
    else if (delta <= -8) tempoTrend = "falling";
  }

  // topGenreThisHour
  const cutoff = nowMs - HOUR_MS;
  const recentGenres = tracks
    .filter((t) => t.airedAt >= cutoff && t.genre !== null)
    .map((t) => t.genre!);
  const counts = new Map<string, number>();
  for (const g of recentGenres) counts.set(g, (counts.get(g) ?? 0) + 1);
  let topGenreThisHour: string | null = null;
  let topCount = 0;
  for (const [g, n] of counts) {
    if (n > topCount) {
      topGenreThisHour = g;
      topCount = n;
    }
  }

  return {
    currentRun: { genre: latest.genre, count: runCount, startedAt: runStartedAt },
    tempoTrend,
    avgBpmLast5,
    topGenreThisHour,
  };
}
