// lib/show-genre-fit.ts

/**
 * Maps a track's genre string to the ShowBlock values it's compatible
 * with. Used by QueueDirector to reject picks that don't fit the current
 * show-block (e.g. "ambient" doesn't fit Prime Hours; "synthwave" doesn't
 * fit Morning Room).
 *
 * Returns the set of ShowBlock names where this genre is welcome. An
 * unknown genre returns ALL blocks (be permissive, not strict).
 */

export type ShowBlockName = "Night Shift" | "Morning Room" | "Daylight Channel" | "Prime Hours";

const ALL_BLOCKS: ShowBlockName[] = ["Night Shift", "Morning Room", "Daylight Channel", "Prime Hours"];

const GENRE_MAP: Record<string, ShowBlockName[]> = {
  // Late-night moody
  ambient: ["Night Shift"],
  drone: ["Night Shift"],
  "dark ambient": ["Night Shift"],
  // Bright morning
  acoustic: ["Morning Room", "Daylight Channel"],
  folk: ["Morning Room", "Daylight Channel"],
  "indie folk": ["Morning Room", "Daylight Channel"],
  // Daylight/general
  pop: ["Morning Room", "Daylight Channel", "Prime Hours"],
  rock: ["Daylight Channel", "Prime Hours"],
  "indie rock": ["Daylight Channel", "Prime Hours"],
  "pop punk": ["Daylight Channel", "Prime Hours"],
  // Prime hours up-tempo
  electronic: ["Prime Hours", "Night Shift"],
  synth: ["Prime Hours", "Night Shift"],
  synthwave: ["Prime Hours", "Night Shift"],
  house: ["Prime Hours"],
  techno: ["Prime Hours", "Night Shift"],
  // Universal
  jazz: ["Night Shift", "Morning Room", "Daylight Channel"],
  soul: ["Morning Room", "Daylight Channel", "Prime Hours"],
};

export function showsForGenre(genre: string | null | undefined): readonly ShowBlockName[] {
  if (!genre) return ALL_BLOCKS;
  const normalized = genre.toLowerCase().trim();
  // Exact match
  if (GENRE_MAP[normalized]) return GENRE_MAP[normalized];
  // Substring match (e.g. "indie synth-pop" → tries "synth", "pop")
  for (const [key, blocks] of Object.entries(GENRE_MAP)) {
    if (normalized.includes(key)) return blocks;
  }
  // Unknown → permissive
  return ALL_BLOCKS;
}

export function genreFitsShow(genre: string | null | undefined, currentShow: ShowBlockName): boolean {
  return showsForGenre(genre).includes(currentShow);
}
