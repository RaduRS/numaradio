// Shared shape for the bottom preview-bar player. Library tracks and
// pending submissions both feed into the same audio element so only
// one preview plays at a time across the page.

export interface PreviewSource {
  /** Unique across kinds — e.g. `track:<id>` or `submission:<id>`. */
  key: string;
  title: string;
  artist: string | null;
  artworkUrl: string | null;
  audioUrl: string;
}
