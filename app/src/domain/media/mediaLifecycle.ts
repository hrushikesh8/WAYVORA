/* ─── Media Lifecycle & URL Hydration ────────────────────────────────
   Re-hydrates temporary ObjectURLs across browser sessions using stored blobs,
   manages URL revocations, and provides pure filtering/query operations.
   ─────────────────────────────────────────────────────────────────── */

import type { Journey, StoryScene, Stop } from '../types';
import type { MediaAsset, MediaFilter } from './types';
import { getMediaBlob } from './mediaStore';
import { mediaRegistry } from '../render/mediaManager';

/**
 * Hydrates and revives object URLs for all assets in the journey
 * (library, story scenes, and stops) from the local IndexedDB binary store.
 * If a blob is missing or deleted, marks `isMissing: true` without failing.
 */
export async function reviveMediaUrls(journey: Journey): Promise<Journey> {
  const urlCache = new Map<string, string>(); // storageKey -> fresh ObjectURL

  async function resolveAssetUrl(asset: MediaAsset): Promise<MediaAsset> {
    if (!asset.storageKey) {
      // Legacy asset without storageKey
      return asset;
    }

    if (urlCache.has(asset.storageKey)) {
      return {
        ...asset,
        url: urlCache.get(asset.storageKey)!,
        isMissing: false,
      };
    }

    try {
      const blob = await getMediaBlob(asset.storageKey);
      if (blob) {
        const freshUrl = mediaRegistry.createTrackedUrl(blob);
        urlCache.set(asset.storageKey, freshUrl);
        return {
          ...asset,
          url: freshUrl,
          isMissing: false,
        };
      } else {
        // Blob not in storage (e.g. cleared browser storage)
        return {
          ...asset,
          isMissing: true,
        };
      }
    } catch (err) {
      console.warn(`[WAYVORA Media] Failed to revive blob for key "${asset.storageKey}":`, err);
      return {
        ...asset,
        isMissing: true,
      };
    }
  }

  // 1. Revive Media Library
  const revivedLibrary: MediaAsset[] = [];
  if (Array.isArray(journey.mediaLibrary)) {
    for (const asset of journey.mediaLibrary) {
      revivedLibrary.push(await resolveAssetUrl(asset));
    }
  }

  // 2. Revive Scenes Media
  const revivedScenes: StoryScene[] = [];
  if (Array.isArray(journey.timeline.scenes)) {
    for (const scene of journey.timeline.scenes as StoryScene[]) {
      if (Array.isArray(scene.media) && scene.media.length > 0) {
        const resolvedMedia: MediaAsset[] = [];
        for (const m of scene.media) {
          resolvedMedia.push(await resolveAssetUrl(m));
        }
        revivedScenes.push({ ...scene, media: resolvedMedia });
      } else {
        revivedScenes.push(scene);
      }
    }
  }

  // 3. Revive Stops Media
  const revivedStops: Stop[] = [];
  if (Array.isArray(journey.stops)) {
    for (const stop of journey.stops) {
      if (Array.isArray(stop.media) && stop.media.length > 0) {
        const resolvedMedia: MediaAsset[] = [];
        for (const m of stop.media) {
          resolvedMedia.push(await resolveAssetUrl(m));
        }
        revivedStops.push({ ...stop, media: resolvedMedia });
      } else {
        revivedStops.push(stop);
      }
    }
  }

  return {
    ...journey,
    mediaLibrary: revivedLibrary,
    timeline: {
      ...journey.timeline,
      scenes: revivedScenes,
    },
    stops: revivedStops,
  };
}

/**
 * Revokes all tracked browser ObjectURLs to free memory.
 */
export function cleanupMediaUrls(): void {
  mediaRegistry.cleanupAll();
}

/**
 * Pure filter function for searching and segmenting the media library.
 */
export function filterMediaLibrary(
  library: MediaAsset[] | undefined,
  filter: MediaFilter
): MediaAsset[] {
  if (!library || !Array.isArray(library)) return [];

  return library.filter((asset) => {
    // 1. Type filter
    if (filter.type && filter.type !== 'all') {
      if (asset.type !== filter.type) return false;
    }

    // 2. Search query filter
    if (filter.searchQuery && filter.searchQuery.trim() !== '') {
      const q = filter.searchQuery.trim().toLowerCase();
      const inFilename = asset.filename.toLowerCase().includes(q);
      const inTitle = (asset.title || '').toLowerCase().includes(q);
      const inCaption = (asset.caption || '').toLowerCase().includes(q);
      const inCamera = (asset.cameraModel || '').toLowerCase().includes(q);
      if (!inFilename && !inTitle && !inCaption && !inCamera) return false;
    }

    return true;
  });
}
