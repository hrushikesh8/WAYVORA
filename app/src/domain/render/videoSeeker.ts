/* ─── Video Frame Seeker Engine ──────────────────────────────────────
   Provides deterministic, frame-accurate seeking of HTML5 video assets
   for offline canvas composition and WebCodecs export.
   Muted off-screen elements ensure zero interference with audio mixing.
   ─────────────────────────────────────────────────────────────────── */

import type { Journey, MediaAsset } from '../types';

export interface VideoSeekerStatus {
  isReady: boolean;
  duration: number;
  videoWidth: number;
  videoHeight: number;
  lastSeekedTime: number;
  seekCount: number;
  timeoutCount: number;
  error?: string;
}

export class VideoFrameSeeker {
  private video: HTMLVideoElement | null = null;
  private asset: MediaAsset;
  private isReady = false;
  private duration = 0;
  private videoWidth = 0;
  private videoHeight = 0;
  private lastSeekedTime = -1;
  private seekCount = 0;
  private timeoutCount = 0;
  private lastError: string | undefined = undefined;
  private currentSeekPromise: Promise<HTMLVideoElement | null> | null = null;
  private isDisposed = false;

  constructor(asset: MediaAsset) {
    this.asset = asset;
  }

  /**
   * Initializes the video element and awaits initial metadata readiness.
   */
  async initialize(timeoutMs = 4000): Promise<boolean> {
    if (!this.asset.url) {
      this.lastError = 'Asset URL is empty';
      return false;
    }

    if (typeof window === 'undefined' || typeof document === 'undefined') {
      this.lastError = 'Browser DOM environment is not available';
      return false;
    }

    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.muted = true;
      video.volume = 0;
      video.playsInline = true;
      video.preload = 'auto';
      video.crossOrigin = 'anonymous';

      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const cleanupListeners = () => {
        if (timer) clearTimeout(timer);
        video.removeEventListener('loadeddata', onReady);
        video.removeEventListener('canplay', onReady);
        video.removeEventListener('error', onError);
      };

      const onReady = () => {
        if (settled) return;
        settled = true;
        cleanupListeners();

        this.video = video;
        this.duration = Number.isFinite(video.duration) ? video.duration : (this.asset.durationSeconds ?? 0);
        this.videoWidth = video.videoWidth || this.asset.width || 0;
        this.videoHeight = video.videoHeight || this.asset.height || 0;
        this.isReady = true;
        this.lastError = undefined;
        resolve(true);
      };

      const onError = () => {
        if (settled) return;
        settled = true;
        cleanupListeners();
        this.isReady = false;
        this.lastError = 'Failed to load video element or decode metadata';
        resolve(false);
      };

      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanupListeners();
        // If readyState has metadata at least, accept it
        if (video.readyState >= 1) {
          this.video = video;
          this.duration = Number.isFinite(video.duration) ? video.duration : 0;
          this.videoWidth = video.videoWidth || 0;
          this.videoHeight = video.videoHeight || 0;
          this.isReady = true;
          this.lastError = undefined;
          resolve(true);
        } else {
          this.isReady = false;
          this.lastError = `Video initialization timed out after ${timeoutMs}ms`;
          resolve(false);
        }
      }, timeoutMs);

      video.addEventListener('loadeddata', onReady, { once: true });
      video.addEventListener('canplay', onReady, { once: true });
      video.addEventListener('error', onError, { once: true });

      video.src = this.asset.url;
      video.load();
    });
  }

  /**
   * Seeks video to specific presentation timestamp with bounded timeout.
   * Prevents overlapping seeks, clamps to duration boundaries, and guarantees
   * that timed-out seeks never return stale frames.
   */
  async seekTo(targetSeconds: number, timeoutMs = 350): Promise<HTMLVideoElement | null> {
    if (this.isDisposed || !this.video || !this.isReady) {
      return null;
    }

    // Await any in-flight seek before starting a new one
    if (this.currentSeekPromise) {
      try {
        await this.currentSeekPromise;
      } catch {
        // continue
      }
    }

    const clampedTime = Math.max(0, Math.min(this.duration > 0 ? this.duration : targetSeconds, targetSeconds));

    // If already at approximately the same time AND has valid frame data, return element immediately
    if (this.lastSeekedTime >= 0 && Math.abs(this.lastSeekedTime - clampedTime) < 0.001 && this.video.readyState >= 2) {
      return this.video;
    }

    this.currentSeekPromise = new Promise((resolve) => {
      const video = this.video;
      if (!video) {
        resolve(null);
        return;
      }

      let timer: ReturnType<typeof setTimeout> | undefined;

      const onSeeked = () => {
        if (timer) clearTimeout(timer);
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onError);
        if (video.readyState >= 2) {
          this.lastSeekedTime = video.currentTime;
          this.seekCount++;
          this.lastError = undefined;
          resolve(video);
        } else {
          this.lastError = `Seeked to ${video.currentTime.toFixed(3)}s but frame data not yet ready (readyState ${video.readyState} < 2)`;
          resolve(null);
        }
      };

      const onError = () => {
        if (timer) clearTimeout(timer);
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onError);
        this.lastError = `Video element encountered error during seek to ${clampedTime.toFixed(3)}s`;
        resolve(null);
      };

      timer = setTimeout(() => {
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onError);
        this.timeoutCount++;
        this.lastError = `Seek timed out at ${clampedTime.toFixed(3)}s (exceeded ${timeoutMs}ms limit)`;
        // Never return stale video element on timeout
        resolve(null);
      }, timeoutMs);

      video.addEventListener('seeked', onSeeked, { once: true });
      video.addEventListener('error', onError, { once: true });

      try {
        video.currentTime = clampedTime;
      } catch (err) {
        if (timer) clearTimeout(timer);
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onError);
        this.lastError = `Failed to set video.currentTime: ${err instanceof Error ? err.message : String(err)}`;
        resolve(null);
      }
    });

    try {
      const res = await this.currentSeekPromise;
      return res;
    } finally {
      this.currentSeekPromise = null;
    }
  }

  getStatus(): VideoSeekerStatus {
    return {
      isReady: this.isReady,
      duration: this.duration,
      videoWidth: this.videoWidth,
      videoHeight: this.videoHeight,
      lastSeekedTime: this.lastSeekedTime,
      seekCount: this.seekCount,
      timeoutCount: this.timeoutCount,
      error: this.lastError,
    };
  }

  getVideoElement(): HTMLVideoElement | null {
    return this.video;
  }

  dispose(): void {
    this.isDisposed = true;
    if (this.video) {
      try {
        this.video.pause();
        this.video.removeAttribute('src');
        this.video.load();
      } catch {
        // ignore
      }
      this.video = null;
    }
    this.isReady = false;
  }
}

/**
 * Prepares video seekers for all video assets referenced in journey scenes.
 */
export async function prepareVideoSeekers(
  journey: Journey
): Promise<Map<string, VideoFrameSeeker>> {
  const seekers = new Map<string, VideoFrameSeeker>();

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return seekers;
  }

  const videoAssets: MediaAsset[] = [];

  // Inspect media library
  if (journey.mediaLibrary) {
    for (const m of journey.mediaLibrary) {
      if (m.type === 'video' && m.url && !seekers.has(m.id)) {
        videoAssets.push(m);
      }
    }
  }

  // Inspect scenes
  if (journey.timeline?.scenes) {
    for (const sc of journey.timeline.scenes) {
      if (sc.media) {
        for (const m of sc.media) {
          if (m.type === 'video' && m.url && !seekers.has(m.id)) {
            videoAssets.push(m);
          }
        }
      }
    }
  }

  // Inspect stops
  if (journey.stops) {
    for (const st of journey.stops) {
      if (st.media) {
        for (const m of st.media) {
          if (m.type === 'video' && m.url && !seekers.has(m.id)) {
            videoAssets.push(m);
          }
        }
      }
    }
  }

  await Promise.all(
    videoAssets.map(async (asset) => {
      const seeker = new VideoFrameSeeker(asset);
      const ok = await seeker.initialize();
      if (ok) {
        seekers.set(asset.id, seeker);
      } else {
        seeker.dispose();
      }
    })
  );

  return seekers;
}

/**
 * Disposes all video seekers and releases media decoder resources.
 */
export function cleanupVideoSeekers(seekers: Map<string, VideoFrameSeeker>): void {
  for (const seeker of seekers.values()) {
    try {
      seeker.dispose();
    } catch {
      // ignore cleanup errors
    }
  }
  seekers.clear();
}
