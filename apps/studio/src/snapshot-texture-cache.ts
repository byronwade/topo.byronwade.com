import { Assets, type Texture } from "pixi.js";

import {
  createSnapshotTextureCache,
  DEFAULT_SNAPSHOT_TEXTURE_MAX_BYTES,
  DEFAULT_SNAPSHOT_TEXTURE_MAX_ENTRIES,
} from "@topo/renderer-pixi";

/** Only the selected and nearest snapshots stay actively attached to a scene. */
export const STUDIO_ACTIVE_SNAPSHOT_TEXTURE_LIMIT = 8;

export const studioSnapshotTextureCache = createSnapshotTextureCache({
  maxEntries: DEFAULT_SNAPSHOT_TEXTURE_MAX_ENTRIES,
  maxBytes: DEFAULT_SNAPSHOT_TEXTURE_MAX_BYTES,
  onReleaseError: (error, id) => {
    console.warn(`Topo could not release snapshot texture ${id}`, error);
  },
});

const pendingLoads = new Map<string, Promise<Texture>>();
const pendingUnloads = new Map<string, Promise<void>>();

function releaseAsset(url: string): Promise<void> {
  const pending = Promise.resolve(Assets.unload(url)).finally(() => {
    if (pendingUnloads.get(url) === pending) pendingUnloads.delete(url);
  });
  pendingUnloads.set(url, pending);
  return pending;
}

/** Load once across lazy Studio destinations and register one cache-owned release. */
export function loadStudioSnapshotTexture(
  key: string,
  url: string,
): Promise<Texture> {
  const cached = studioSnapshotTextureCache.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = pendingLoads.get(key);
  if (pending) return pending;

  const request = (async () => {
    await pendingUnloads.get(url);
    const texture = await Assets.load<Texture>(url);
    studioSnapshotTextureCache.set(key, texture, {
      release: () => releaseAsset(url),
    });
    return texture;
  })().finally(() => {
    if (pendingLoads.get(key) === request) pendingLoads.delete(key);
  });
  pendingLoads.set(key, request);
  return request;
}

export function reportStudioTextureCache(
  host: HTMLElement,
  attachedTextureCount: number,
): void {
  const stats = studioSnapshotTextureCache.stats();
  host.dataset.loadedTextureCount = String(attachedTextureCount);
  host.dataset.textureCacheEntries = String(stats.entries);
  host.dataset.textureCacheBytes = String(stats.bytes);
  host.dataset.textureCacheRetained = String(stats.retained);
  host.dataset.textureCacheHits = String(stats.hits);
  host.dataset.textureCacheMisses = String(stats.misses);
  host.dataset.textureCacheEvictions = String(stats.evictions);
  host.dataset.textureCacheReleaseErrors = String(stats.releaseErrors);
  host.dataset.textureCacheMaxEntries = String(stats.maxEntries);
  host.dataset.textureCacheMaxBytes = String(stats.maxBytes);
  host.dataset.textureCacheOverBudget = String(stats.overBudget);
}
