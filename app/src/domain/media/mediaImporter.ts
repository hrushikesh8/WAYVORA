/* ─── Media Import & Inspection Pipeline ─────────────────────────────
   Validates file formats, checks size boundaries, computes stable fingerprints,
   extracts authentic EXIF/audio/video metadata, and saves binaries to storage.
   ─────────────────────────────────────────────────────────────────── */

import type {
  MediaAsset,
  MediaType,
  MediaImportValidation,
  MediaImportResult,
  ExtractedMediaMetadata,
} from './types';
import {
  MEDIA_SIZE_LIMITS,
  SUPPORTED_PHOTO_EXTS,
  SUPPORTED_VIDEO_EXTS,
  SUPPORTED_AUDIO_EXTS,
} from './types';
import { parseJpegExif } from '../story/media';
import { saveMediaBlob } from './mediaStore';
import { mediaRegistry } from '../render/mediaManager';

/**
 * Validates file extension, MIME type, and size limits.
 */
export function validateMediaFile(file: File): MediaImportValidation {
  const filename = file.name.toLowerCase();
  const mime = (file.type || '').toLowerCase();
  const size = file.size;

  let detectedType: MediaType | null = null;

  // 1. Detect Photo
  if (
    mime.startsWith('image/') ||
    SUPPORTED_PHOTO_EXTS.some((ext) => filename.endsWith(ext))
  ) {
    detectedType = 'photo';
    if (size > MEDIA_SIZE_LIMITS.photo) {
      return {
        valid: false,
        error: `Photo "${file.name}" exceeds the 50MB limit (${(size / 1024 / 1024).toFixed(1)}MB).`,
        detectedType,
      };
    }
  }
  // 2. Detect Video
  else if (
    mime.startsWith('video/') ||
    SUPPORTED_VIDEO_EXTS.some((ext) => filename.endsWith(ext))
  ) {
    detectedType = 'video';
    if (size > MEDIA_SIZE_LIMITS.video) {
      return {
        valid: false,
        error: `Video "${file.name}" exceeds the 500MB limit (${(size / 1024 / 1024).toFixed(1)}MB).`,
        detectedType,
      };
    }
  }
  // 3. Detect Audio
  else if (
    mime.startsWith('audio/') ||
    SUPPORTED_AUDIO_EXTS.some((ext) => filename.endsWith(ext))
  ) {
    detectedType = 'audio';
    if (size > MEDIA_SIZE_LIMITS.audio) {
      return {
        valid: false,
        error: `Audio file "${file.name}" exceeds the 100MB limit (${(size / 1024 / 1024).toFixed(1)}MB).`,
        detectedType,
      };
    }
  } else {
    return {
      valid: false,
      error: `Unsupported file format: "${file.name}". Supported formats: Photos (${SUPPORTED_PHOTO_EXTS.join(', ')}), Videos (${SUPPORTED_VIDEO_EXTS.join(', ')}), Audio (${SUPPORTED_AUDIO_EXTS.join(', ')}).`,
    };
  }

  if (size <= 0) {
    return {
      valid: false,
      error: `File "${file.name}" is empty (0 bytes).`,
      detectedType,
    };
  }

  return { valid: true, detectedType };
}

/**
 * Computes a deterministic content fingerprint for deduplication.
 * Uses SHA-256 over file size, name, and representative bytes (or full buffer).
 */
export async function computeMediaFingerprint(file: File): Promise<string> {
  const size = file.size;
  const name = file.name;
  const lastModified = file.lastModified;

  // Sample head, middle, and tail chunks up to 64KB each
  const sampleSize = Math.min(65536, size);
  const headSlice = file.slice(0, sampleSize);
  const tailSlice = file.slice(Math.max(0, size - sampleSize), size);

  const headBuf = await headSlice.arrayBuffer();
  const tailBuf = await tailSlice.arrayBuffer();

  // Combine into unified buffer
  const combined = new Uint8Array(headBuf.byteLength + tailBuf.byteLength);
  combined.set(new Uint8Array(headBuf), 0);
  combined.set(new Uint8Array(tailBuf), headBuf.byteLength);

  // Compute SHA-256 if crypto.subtle is available
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const digest = await crypto.subtle.digest('SHA-256', combined);
      const hashArray = Array.from(new Uint8Array(digest));
      const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
      return `fp_${size}_${hashHex.substring(0, 16)}_${encodeURIComponent(name).substring(0, 16)}`;
    } catch {
      // Fallback below
    }
  }

  // Fast DJB2 hash fallback
  let hash = 5381;
  const view = new DataView(combined.buffer);
  const step = Math.max(1, Math.floor(combined.byteLength / 256));
  for (let i = 0; i < combined.byteLength; i += step) {
    hash = ((hash << 5) + hash) ^ view.getUint8(i);
  }
  return `fp_${size}_${(hash >>> 0).toString(16)}_${encodeURIComponent(name).substring(0, 16)}_${lastModified}`;
}

/**
 * Checks if an asset with the given fingerprint already exists in the library.
 */
export function findDuplicateAsset(
  fingerprint: string,
  existingLibrary?: MediaAsset[]
): MediaAsset | null {
  if (!existingLibrary || existingLibrary.length === 0) return null;
  return existingLibrary.find((m) => m.fingerprint === fingerprint) ?? null;
}

/**
 * Probes image dimensions safely in browser environment.
 */
function probeImageDimensions(file: File): Promise<{ width: number; height: number } | undefined> {
  if (typeof window === 'undefined') return Promise.resolve(undefined);

  return new Promise((resolve) => {
    // Try createImageBitmap first (fastest)
    if (typeof createImageBitmap === 'function') {
      createImageBitmap(file)
        .then((bitmap) => {
          const dims = { width: bitmap.width, height: bitmap.height };
          bitmap.close();
          resolve(dims);
        })
        .catch(() => {
          fallbackImageElement();
        });
      return;
    }
    fallbackImageElement();

    function fallbackImageElement() {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        resolve(undefined);
        URL.revokeObjectURL(url);
      };
      img.src = url;
    }
  });
}

/**
 * Probes video dimensions and duration in browser environment.
 */
function probeVideoMetadata(
  file: File
): Promise<{ width?: number; height?: number; durationSeconds?: number }> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve({});
  }

  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    const url = URL.createObjectURL(file);

    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      video.load();
    };

    timer = setTimeout(() => {
      cleanup();
      resolve({});
    }, 2500);

    video.onloadedmetadata = () => {
      const dur = Number.isFinite(video.duration) ? Math.round(video.duration * 100) / 100 : undefined;
      const res = {
        width: video.videoWidth > 0 ? video.videoWidth : undefined,
        height: video.videoHeight > 0 ? video.videoHeight : undefined,
        durationSeconds: dur,
      };
      cleanup();
      resolve(res);
    };

    video.onerror = () => {
      cleanup();
      resolve({});
    };

    video.src = url;
  });
}

/**
 * Probes audio duration and properties in browser environment.
 */
function probeAudioMetadata(file: File): Promise<{ durationSeconds?: number }> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve({});
  }

  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    const url = URL.createObjectURL(file);
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      URL.revokeObjectURL(url);
      audio.removeAttribute('src');
      audio.load();
    };

    timer = setTimeout(() => {
      cleanup();
      resolve({});
    }, 2500);

    audio.onloadedmetadata = () => {
      const dur = Number.isFinite(audio.duration) ? Math.round(audio.duration * 100) / 100 : undefined;
      cleanup();
      resolve({ durationSeconds: dur });
    };

    audio.onerror = () => {
      cleanup();
      resolve({});
    };

    audio.src = url;
  });
}

/**
 * Extracts metadata (EXIF, dimensions, duration) from an imported file.
 * Preserves genuine provenance; missing values remain strictly undefined.
 */
export async function extractMediaMetadata(file: File): Promise<ExtractedMediaMetadata> {
  const validation = validateMediaFile(file);
  const type = validation.detectedType;
  const result: ExtractedMediaMetadata = {};

  if (type === 'photo') {
    // 1. Parse JPEG EXIF
    const buffer = await file.arrayBuffer();
    const exif = parseJpegExif(buffer);
    result.hasExif = exif.hasExif;
    result.capturedAt = exif.capturedAt;
    result.geoPosition = exif.geoPosition;
    result.cameraModel = exif.cameraModel;

    // 2. Measure dimensions
    const dims = await probeImageDimensions(file);
    if (dims) result.dimensions = dims;
  } else if (type === 'video') {
    const videoMeta = await probeVideoMetadata(file);
    if (videoMeta.width && videoMeta.height) {
      result.dimensions = { width: videoMeta.width, height: videoMeta.height };
    }
    if (videoMeta.durationSeconds) {
      result.durationSeconds = videoMeta.durationSeconds;
    }
  } else if (type === 'audio') {
    const audioMeta = await probeAudioMetadata(file);
    if (audioMeta.durationSeconds) {
      result.durationSeconds = audioMeta.durationSeconds;
    }
  }

  return result;
}

/**
 * Complete media import orchestration:
 * - Validates file
 * - Computes fingerprint
 * - Checks for duplicates
 * - Extracts metadata
 * - Stores binary blob in MediaStore
 * - Generates tracked ObjectURL
 * - Produces immutable MediaAsset
 */
export async function importMediaFile(
  file: File,
  options: { existingLibrary?: MediaAsset[] } = {}
): Promise<MediaImportResult> {
  // 1. Validation
  const validation = validateMediaFile(file);
  if (!validation.valid || !validation.detectedType) {
    return {
      success: false,
      error: validation.error || 'Invalid media file',
    };
  }

  const type = validation.detectedType;

  // 2. Fingerprinting & Duplicate Check
  const fingerprint = await computeMediaFingerprint(file);
  const duplicate = findDuplicateAsset(fingerprint, options.existingLibrary);
  if (duplicate) {
    return {
      success: true,
      asset: duplicate,
      isDuplicate: true,
    };
  }

  // 3. Metadata Extraction
  let metadata: ExtractedMediaMetadata = {};
  try {
    metadata = await extractMediaMetadata(file);
  } catch (err) {
    console.warn(`[WAYVORA Media] Failed to extract metadata for ${file.name}:`, err);
  }

  // 4. Persistence in MediaStore
  const assetId = `asset_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const storageKey = `blob_${assetId}`;

  try {
    await saveMediaBlob(storageKey, file);
  } catch (err) {
    console.error(`[WAYVORA Media] Storage write error for ${file.name}:`, err);
    return {
      success: false,
      error: `Failed to persist file in local storage: ${(err as Error).message}`,
    };
  }

  // 5. Tracked ObjectURL
  const trackedUrl = mediaRegistry.createTrackedUrl(file);

  // 6. Build MediaAsset
  const title = file.name.replace(/\.[^/.]+$/, '');
  const asset: MediaAsset = {
    id: assetId,
    type,
    url: trackedUrl,
    filename: file.name,
    title,
    mimeType: file.type || undefined,
    sizeBytes: file.size,
    width: metadata.dimensions?.width,
    height: metadata.dimensions?.height,
    durationSeconds: metadata.durationSeconds,
    geoPosition: metadata.geoPosition,
    timestamp: metadata.capturedAt,
    cameraModel: metadata.cameraModel,
    fingerprint,
    storageKey,
    isMissing: false,
    createdAt: new Date().toISOString(),
  };

  return {
    success: true,
    asset,
    isDuplicate: false,
  };
}
