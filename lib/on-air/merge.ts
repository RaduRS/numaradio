export type TrackItem = {
  trackId: string;
  title: string;
  artistDisplay?: string;
  artworkUrl?: string;
  startedAt: string;
  durationSeconds?: number;
};

export type ShoutItem = {
  id: string;
  requesterName?: string;
  text: string;
  airedAt: string;
};

export type OnAirItem =
  | ({ kind: "track"; at: number } & TrackItem)
  | ({ kind: "shout"; at: number } & ShoutItem);

export function mergeOnAirFeed(
  tracks: TrackItem[],
  shouts: ShoutItem[],
  limit: number,
): OnAirItem[] {
  const t: OnAirItem[] = tracks.map((row) => ({
    kind: "track",
    at: new Date(row.startedAt).getTime(),
    ...row,
  }));
  const s: OnAirItem[] = shouts.map((row) => ({
    kind: "shout",
    at: new Date(row.airedAt).getTime(),
    ...row,
  }));
  return [...t, ...s]
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}
