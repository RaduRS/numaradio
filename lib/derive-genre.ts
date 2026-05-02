/**
 * Best-effort genre extraction from a free-text prompt or comment string.
 * Used by:
 *   - the song-worker MiniMax pipeline (when MiniMax doesn't return a
 *     structured genre)
 *   - the backfill script for tracks whose Track.genre column is null
 *
 * The list is opinionated rather than exhaustive — the goal is to label
 * 90%+ of typical listener prompts with something meaningful in the
 * dashboard's /library Genre column. Returns null when no pattern hits;
 * the caller can then choose its own fallback (a generic "Listener Pick"
 * for minimax songs, "Voice" for shoutouts, etc.).
 *
 * Order matters: more specific patterns first. "edm" wins over "dance",
 * "lo-fi" wins over "indie".
 */
const GENRE_PATTERNS: Array<[RegExp, string]> = [
  [/\b(dubstep)\b/i, "Dubstep"],
  [/\b(synthwave|synth-?wave)\b/i, "Synthwave"],
  [/\b(drum.?and.?bass|d.?n.?b)\b/i, "Drum & Bass"],
  [/\b(reggaet?on)\b/i, "Reggaeton"],
  [/\b(k-?pop)\b/i, "K-Pop"],
  [/\b(j-?pop)\b/i, "J-Pop"],
  [/\b(hip-?hop|hiphop)\b/i, "Hip-Hop"],
  [/\b(lo-?fi|lofi)\b/i, "Lo-Fi"],
  [/\b(r-?and-?b|rnb)\b/i, "R&B"],
  [/\b(edm)\b/i, "EDM"],
  [/\b(trap)\b/i, "Trap"],
  [/\b(house)\b/i, "House"],
  [/\b(techno)\b/i, "Techno"],
  [/\b(ambient)\b/i, "Ambient"],
  [/\b(jazz)\b/i, "Jazz"],
  [/\b(indie)\b/i, "Indie"],
  [/\b(metal)\b/i, "Metal"],
  [/\b(country)\b/i, "Country"],
  [/\b(folk)\b/i, "Folk"],
  [/\b(soul)\b/i, "Soul"],
  [/\b(funk)\b/i, "Funk"],
  [/\b(reggae)\b/i, "Reggae"],
  [/\b(dance)\b/i, "Dance"],
  [/\b(rap)\b/i, "Rap"],
  [/\b(blues)\b/i, "Blues"],
  [/\b(classical)\b/i, "Classical"],
  [/\b(punk)\b/i, "Punk"],
  [/\b(disco)\b/i, "Disco"],
  [/\b(electronic)\b/i, "Electronic"],
  [/\b(acoustic)\b/i, "Acoustic"],
  [/\b(rock)\b/i, "Rock"],
  [/\b(pop)\b/i, "Pop"],
];

export function deriveGenreFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const [re, label] of GENRE_PATTERNS) {
    if (re.test(text)) return label;
  }
  return null;
}
