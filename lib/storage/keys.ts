export const storageKeys = {
  trackMasterAudio: (stationSlug: string, trackId: string) =>
    `stations/${stationSlug}/tracks/${trackId}/audio/master.mp3`,
  trackStreamAudio: (stationSlug: string, trackId: string) =>
    `stations/${stationSlug}/tracks/${trackId}/audio/stream.mp3`,
  trackArtwork: (stationSlug: string, trackId: string) =>
    `stations/${stationSlug}/tracks/${trackId}/artwork/primary.webp`,
  requestIntermediate: (stationSlug: string, requestId: string, name: string) =>
    `stations/${stationSlug}/requests/${requestId}/intermediate/${name}`,
  hostInsert: (stationSlug: string, dateKey: string, segmentId: string) =>
    `stations/${stationSlug}/host/${dateKey}/${segmentId}.mp3`,
  waveform: (stationSlug: string, trackId: string) =>
    `stations/${stationSlug}/waveforms/${trackId}.json`,
};

export function publicUrl(storageKey: string): string {
  const base = process.env.B2_BUCKET_PUBLIC_URL;
  if (!base) throw new Error("B2_BUCKET_PUBLIC_URL is not set");
  return `${base}/${storageKey}`;
}
