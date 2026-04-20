export type TrackRef = { id: string; stationId: string };

export interface TrackLookup {
  byId(id: string): Promise<TrackRef | null>;
  byTitleArtist(title: string, artist: string | undefined): Promise<TrackRef | null>;
}

export function extractTrackIdFromUrl(url: string): string | null {
  const m = url.match(/\/tracks\/([^/]+)\/audio\//);
  return m?.[1] ?? null;
}

export type ResolveInput = {
  trackId?: string;
  sourceUrl?: string;
  title?: string;
  artist?: string;
};

export async function resolveTrackId(
  input: ResolveInput,
  lookup: TrackLookup,
): Promise<TrackRef | null> {
  if (input.trackId) {
    const hit = await lookup.byId(input.trackId);
    if (hit) return hit;
  }
  if (input.sourceUrl) {
    const id = extractTrackIdFromUrl(input.sourceUrl);
    if (id) {
      const hit = await lookup.byId(id);
      if (hit) return hit;
    }
  }
  if (input.title) {
    const hit = await lookup.byTitleArtist(input.title, input.artist);
    if (hit) return hit;
  }
  return null;
}
