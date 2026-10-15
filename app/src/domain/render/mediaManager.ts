/* ─── Media Playback & Resource Synchronization ─────────────────────
   Handles image/video asset resolution, timeline synchronization,
   HTML5 video lifecycle, and graceful missing-media handling.
   ─────────────────────────────────────────────────────────────────── */

import type { MediaAsset } from '../types';
import { isSupportedImageFormat } from '../story/media';

export { isSupportedImageFormat };

export type MediaPlaybackStatus = 'ready' | 'loading' | 'missing' | 'error' | 'unsupported';

export interface ActiveMediaPlayback {
  asset: MediaAsset;
  status: MediaPlaybackStatus;
  /** Presentation time within this media item in seconds */
  mediaTimeSeconds: number;
  /** Whether the media is currently visible/active at the timeline time */
  isActive: boolean;
  /** Error message or missing asset diagnostic */
  errorMessage?: string;
  isVideo: boolean;
  isImage: boolean;
}

const SUPPORTED_VIDEO_EXTS = ['.mp4', '.webm', '.ogg'];

export function isSupportedVideoFormat(filename: string, mimeType?: string): boolean {
  if (mimeType) {
    const mt = mimeType.toLowerCase();
    if (mt.startsWith('video/mp4') || mt.startsWith('video/webm') || mt.startsWith('video/ogg')) {
      return true;
    }
  }
  const lower = filename.toLowerCase();
  return SUPPORTED_VIDEO_EXTS.some((ext) => lower.endsWith(ext));
}

/**
 * Registry of active browser ObjectURLs to prevent memory leaks.
 */
class BrowserMediaRegistry {
  private activeBlobUrls = new Set<string>();

  createTrackedUrl(blob: Blob): string {
    const url = URL.createObjectURL(blob);
    this.activeBlobUrls.add(url);
    return url;
  }

  revoke(url: string): void {
    if (this.activeBlobUrls.has(url)) {
      URL.revokeObjectURL(url);
      this.activeBlobUrls.delete(url);
    }
  }

  cleanupAll(): void {
    for (const url of this.activeBlobUrls) {
      URL.revokeObjectURL(url);
    }
    this.activeBlobUrls.clear();
  }

  getActiveCount(): number {
    return this.activeBlobUrls.size;
  }
}

export const mediaRegistry = new BrowserMediaRegistry();

/**
 * Resolves media playback state relative to the story scene timeline.
 */
export function resolveMediaPlayback(
  asset: MediaAsset,
  timelineTime: number,
  sceneStartTime: number,
  sceneEndTime: number
): ActiveMediaPlayback {
  const isVideo = isSupportedVideoFormat(asset.filename, asset.mimeType);
  const isImage = isSupportedImageFormat(asset.mimeType || asset.filename);

  const isActive = timelineTime >= sceneStartTime && timelineTime <= sceneEndTime;
  const elapsedInScene = Math.max(0, timelineTime - sceneStartTime);

  // Check if asset is unsupported format
  if (!isVideo && !isImage) {
    return {
      asset,
      status: 'unsupported',
      mediaTimeSeconds: elapsedInScene,
      isActive,
      isVideo: false,
      isImage: false,
      errorMessage: `Format not supported for browser playback: "${asset.filename}"`,
    };
  }

  // Check if explicitly marked missing or URL is invalid/empty
  if (asset.isMissing || !asset.url || asset.url.trim() === '') {
    return {
      asset,
      status: 'missing',
      mediaTimeSeconds: elapsedInScene,
      isActive,
      isVideo,
      isImage,
      errorMessage: `Source file missing: "${asset.filename}" (file not found or session blob expired)`,
    };
  }

  return {
    asset,
    status: 'ready',
    mediaTimeSeconds: elapsedInScene,
    isActive,
    isVideo,
    isImage,
  };
}

/**
 * Synchronizes an HTML5 <video> element with the story timeline.
 * Handles muted playback, play/pause state, and seeking with zero unhandled promise rejections.
 */
export function synchronizeVideoElement(
  videoEl: HTMLVideoElement,
  targetTimeSeconds: number,
  isPlaying: boolean
): void {
  try {
    // HTML5 video in travel timelines must be muted for smooth seeking and autoplay compliance
    videoEl.muted = true;

    // Only update currentTime if significantly drifted to avoid stutter
    if (Math.abs(videoEl.currentTime - targetTimeSeconds) > 0.08) {
      videoEl.currentTime = Math.max(0, targetTimeSeconds);
    }

    if (isPlaying && videoEl.paused) {
      const playPromise = videoEl.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          // Ignore autoplay interruption or user policy rejections
        });
      }
    } else if (!isPlaying && !videoEl.paused) {
      videoEl.pause();
    }
  } catch {
    // Safeguard against detached element errors
  }
}
