import type { ShowBlock } from "@prisma/client";

export type ShowMappingInput = {
  bpm: number | null;
  genre: string | null;
  mood: string | null;
};

const NIGHT_MOODS = new Set(["Calm", "Dreamy", "Mellow", "Dark", "Melancholic"]);
const MORNING_MOODS = new Set(["Bright", "Summer", "Uplifting", "Romantic"]);
const PRIME_MOODS = new Set(["Energetic", "Hype", "Groovy"]);

const DAYLIGHT_GENRES = new Set([
  "nudisco", "disco", "funk", "house", "funkyhouse", "lofi", "lo-fi",
]);
const NIGHT_GENRES = new Set(["ambient", "lofi", "lo-fi", "downtempo"]);
const PRIME_GENRES = new Set(["dnb", "drum and bass", "techno", "trance"]);

function lc(s: string | null): string {
  return (s ?? "").trim().toLowerCase();
}

export function inferShowFromMetadata(input: ShowMappingInput): ShowBlock {
  const { bpm, genre, mood } = input;
  const g = lc(genre);

  if (mood && NIGHT_MOODS.has(mood) && (bpm === null || bpm < 95)) return "night_shift";
  if (mood && MORNING_MOODS.has(mood) && (bpm === null || (bpm >= 95 && bpm <= 115))) return "morning_room";
  if (mood && PRIME_MOODS.has(mood) && (bpm === null || bpm > 115)) return "prime_hours";

  if (g && DAYLIGHT_GENRES.has(g) && (bpm === null || (bpm >= 105 && bpm <= 125))) return "daylight_channel";
  if (g && NIGHT_GENRES.has(g)) return "night_shift";
  if (g && PRIME_GENRES.has(g)) return "prime_hours";

  if (bpm !== null && bpm < 90) return "night_shift";
  if (bpm !== null && bpm >= 90 && bpm <= 110) return "morning_room";
  if (bpm !== null && bpm > 125) return "prime_hours";

  return "daylight_channel";
}
