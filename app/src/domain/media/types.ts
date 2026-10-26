/* ─── Media Library Domain Types ─────────────────────────────────────
   Local-first media asset models, import validation, metadata structures,
   and query filter contracts for WAYVORA's cinematic asset library.
   ─────────────────────────────────────────────────────────────────── */

import type { RoutePoint, MediaType, MediaAsset } from '../types';

export type { MediaType, MediaAsset };

export interface MediaDimensions {
  width: number;
  height: number;
}

export interface ExtractedMediaMetadata {
  hasExif?: boolean;
  capturedAt?: string;
  geoPosition?: RoutePoint;
  cameraModel?: string;
  dimensions?: MediaDimensions;
  durationSeconds?: number;
  sampleRate?: number;
  channelCount?: number;
}

export interface MediaImportValidation {
  valid: boolean;
  error?: string;
  detectedType?: MediaType;
}

export interface MediaImportResult {
  success: boolean;
  asset?: MediaAsset;
  error?: string;
  isDuplicate?: boolean;
}

export interface MediaFilter {
  type?: MediaType | 'all';
  searchQuery?: string;
}

export const MEDIA_SIZE_LIMITS = {
  photo: 50 * 1024 * 1024,   // 50 MB
  audio: 100 * 1024 * 1024,  // 100 MB
  video: 500 * 1024 * 1024,  // 500 MB
} as const;

export const SUPPORTED_PHOTO_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.svg', '.avif', '.gif'];
export const SUPPORTED_VIDEO_EXTS = ['.mp4', '.webm', '.ogg', '.mov'];
export const SUPPORTED_AUDIO_EXTS = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'];
