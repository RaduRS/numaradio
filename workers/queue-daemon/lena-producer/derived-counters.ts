import type { ShiftEvent } from "./shift-event.ts";

export interface Counters {
  msSinceLastLine: number;
  msSinceLastWeatherMention: number;
  msSinceLastTimeCheck: number;
  msSinceLastStationDrop: number;
  tracksSinceLastShoutout: number;
}

const WEATHER_RE = /\b(rain|sun|sunny|snow|wind|storm|cloud|fog|warm|cold|chilly|breeze|drizzle|frost)\b/i;
const TIME_CHECK_RE = /\b(o'?clock|half past|quarter (to|past)|gone \d|just gone|tonight at|this hour)\b/i;
const STATION_DROP_RE = /\bnuma\s*radio\b/i;

export function deriveCounters(log: readonly ShiftEvent[], nowMs: number): Counters {
  let lastLine = -Infinity;
  let lastWeather = -Infinity;
  let lastTime = -Infinity;
  let lastStation = -Infinity;
  let lastShoutout = -Infinity;
  let tracksAfterShoutout = 0;

  for (const e of log) {
    if (e.type === "lena_line_aired") {
      if (e.airedAt > lastLine) lastLine = e.airedAt;
      if (WEATHER_RE.test(e.text) && e.airedAt > lastWeather) lastWeather = e.airedAt;
      if (TIME_CHECK_RE.test(e.text) && e.airedAt > lastTime) lastTime = e.airedAt;
      if (STATION_DROP_RE.test(e.text) && e.airedAt > lastStation) lastStation = e.airedAt;
    } else if (e.type === "shoutout_aired") {
      if (e.airedAt > lastShoutout) lastShoutout = e.airedAt;
    }
  }

  for (const e of log) {
    if (e.type === "track_aired" && e.airedAt > lastShoutout) {
      tracksAfterShoutout += 1;
    }
  }

  const since = (t: number) => (t === -Infinity ? Infinity : nowMs - t);

  return {
    msSinceLastLine: since(lastLine),
    msSinceLastWeatherMention: since(lastWeather),
    msSinceLastTimeCheck: since(lastTime),
    msSinceLastStationDrop: since(lastStation),
    tracksSinceLastShoutout: tracksAfterShoutout,
  };
}
