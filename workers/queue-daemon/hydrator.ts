export type StagedItem = { id: string; trackId: string | null; positionIndex: number };

export interface HydrateDeps {
  listStaged(): Promise<StagedItem[]>;
  resolveAssetUrl(trackId: string): Promise<string | null>;
  markFailed(queueItemId: string, reasonCode: string): Promise<void>;
  send(line: string): Promise<void>;
}

export async function hydrate(deps: HydrateDeps): Promise<void> {
  const items = await deps.listStaged();
  for (const item of items) {
    if (!item.trackId) {
      await deps.markFailed(item.id, "hydrate_missing_track");
      continue;
    }
    const url = await deps.resolveAssetUrl(item.trackId);
    if (!url) {
      await deps.markFailed(item.id, "hydrate_missing_asset");
      continue;
    }
    await deps.send(`priority.push ${url}`);
  }
}
