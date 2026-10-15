/* ─── Media Handling & EXIF Extraction Engine ──────────────────────────
   Zero-dependency media validation and pure EXIF metadata parser.
   Reads genuine GPS coordinates and capture timestamps without fabrication.
   ─────────────────────────────────────────────────────────────────── */

import type { MediaAsset } from './types';
import type { RoutePoint } from '../types';

export const SUPPORTED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.svg', '.avif', '.gif'];
export const SUPPORTED_VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov'];

/**
 * Checks whether a filename or MIME type is a supported visual image.
 */
export function isSupportedImageFormat(filenameOrMime: string): boolean {
  const lower = filenameOrMime.toLowerCase();
  if (lower.startsWith('image/')) return true;
  return SUPPORTED_IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Checks whether a filename or MIME type is a supported media asset.
 */
export function isSupportedMediaFormat(filenameOrMime: string): boolean {
  const lower = filenameOrMime.toLowerCase();
  if (lower.startsWith('image/') || lower.startsWith('video/')) return true;
  return (
    SUPPORTED_IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext)) ||
    SUPPORTED_VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext))
  );
}

export interface ExtractedExifData {
  hasExif: boolean;
  capturedAt?: string;
  geoPosition?: RoutePoint;
  cameraModel?: string;
}

/**
 * Pure binary parser for JPEG APP1 Exif metadata.
 * Extracts real GPS coordinates and capture timestamps without dependencies.
 * If data is absent, malformed, or corrupt, returns clean undefined fields.
 */
export function parseJpegExif(buffer: ArrayBuffer): ExtractedExifData {
  const result: ExtractedExifData = { hasExif: false };
  if (!buffer || buffer.byteLength < 32) return result;

  const view = new DataView(buffer);

  // Check JPEG SOI marker (0xFFD8)
  if (view.getUint16(0) !== 0xffd8) {
    return result;
  }

  let offset = 2;
  const length = buffer.byteLength;

  // Scan through JPEG markers looking for APP1 (0xFFE1)
  while (offset < length - 4) {
    const marker = view.getUint16(offset);
    offset += 2;

    if (marker === 0xffe1) {
      // APP1 marker found
      const app1Length = view.getUint16(offset);
      offset += 2;

      // Check for Exif header "Exif\0\0"
      if (
        view.getUint8(offset) === 0x45 &&
        view.getUint8(offset + 1) === 0x78 &&
        view.getUint8(offset + 2) === 0x69 &&
        view.getUint8(offset + 3) === 0x66 &&
        view.getUint8(offset + 4) === 0x00 &&
        view.getUint8(offset + 5) === 0x00
      ) {
        result.hasExif = true;
        const tiffOffset = offset + 6;
        parseTiffHeader(view, tiffOffset, app1Length - 8, result);
      }
      break;
    } else if ((marker & 0xff00) === 0xff00 && marker !== 0xff00) {
      // Skip other variable-length markers
      const markerLength = view.getUint16(offset);
      offset += markerLength;
    } else {
      break;
    }
  }

  return result;
}

/**
 * Parses TIFF header and IFD0 tags inside Exif APP1 segment.
 */
function parseTiffHeader(
  view: DataView,
  tiffOffset: number,
  _maxLen: number,
  out: ExtractedExifData
): void {
  if (tiffOffset + 8 > view.byteLength) return;

  // Endianness: 0x4949 ('II') = Little Endian, 0x4D4D ('MM') = Big Endian
  const byteOrder = view.getUint16(tiffOffset);
  let littleEndian = false;
  if (byteOrder === 0x4949) {
    littleEndian = true;
  } else if (byteOrder === 0x4d4d) {
    littleEndian = false;
  } else {
    return;
  }

  // Check 42 magic number
  if (view.getUint16(tiffOffset + 2, littleEndian) !== 0x002a) {
    return;
  }

  const ifd0Offset = view.getUint32(tiffOffset + 4, littleEndian);
  if (ifd0Offset < 8 || tiffOffset + ifd0Offset + 2 > view.byteLength) {
    return;
  }

  let exifSubIfdOffset: number | null = null;
  let gpsSubIfdOffset: number | null = null;

  // Parse IFD0
  const ifd0Start = tiffOffset + ifd0Offset;
  const numEntries0 = view.getUint16(ifd0Start, littleEndian);
  let cur = ifd0Start + 2;

  for (let i = 0; i < numEntries0 && cur + 12 <= view.byteLength; i++, cur += 12) {
    const tag = view.getUint16(cur, littleEndian);
    if (tag === 0x0110) {
      // Model (camera hardware)
      const count = view.getUint32(cur + 4, littleEndian);
      const valOffset = view.getUint32(cur + 8, littleEndian);
      if (count > 0 && count < 64 && tiffOffset + valOffset + count <= view.byteLength) {
        let model = '';
        for (let j = 0; j < count - 1; j++) {
          model += String.fromCharCode(view.getUint8(tiffOffset + valOffset + j));
        }
        out.cameraModel = model.trim();
      }
    } else if (tag === 0x8769) {
      // ExifSubIFD pointer
      exifSubIfdOffset = view.getUint32(cur + 8, littleEndian);
    } else if (tag === 0x8825) {
      // GPSInfoIFD pointer
      gpsSubIfdOffset = view.getUint32(cur + 8, littleEndian);
    }
  }

  // Parse ExifSubIFD for DateTimeOriginal (0x9003)
  if (exifSubIfdOffset && tiffOffset + exifSubIfdOffset + 2 <= view.byteLength) {
    const subStart = tiffOffset + exifSubIfdOffset;
    const numSub = view.getUint16(subStart, littleEndian);
    let subCur = subStart + 2;
    for (let i = 0; i < numSub && subCur + 12 <= view.byteLength; i++, subCur += 12) {
      const tag = view.getUint16(subCur, littleEndian);
      if (tag === 0x9003 || tag === 0x0132) {
        // DateTimeOriginal or DateTime
        const valOffset = view.getUint32(subCur + 8, littleEndian);
        if (tiffOffset + valOffset + 19 <= view.byteLength) {
          let dateStr = '';
          for (let j = 0; j < 19; j++) {
            dateStr += String.fromCharCode(view.getUint8(tiffOffset + valOffset + j));
          }
          // Format "YYYY:MM:DD HH:MM:SS" -> "YYYY-MM-DDTHH:MM:SSZ"
          const parts = dateStr.split(' ');
          if (parts.length === 2) {
            const datePart = parts[0].replace(/:/g, '-');
            out.capturedAt = `${datePart}T${parts[1]}Z`;
          }
        }
      }
    }
  }

  // Parse GPSInfoIFD for Coordinates
  if (gpsSubIfdOffset && tiffOffset + gpsSubIfdOffset + 2 <= view.byteLength) {
    const gpsStart = tiffOffset + gpsSubIfdOffset;
    const numGps = view.getUint16(gpsStart, littleEndian);
    let gpsCur = gpsStart + 2;

    let latRef: string | null = null;
    let latDeg: number | null = null;
    let lngRef: string | null = null;
    let lngDeg: number | null = null;
    let altitude: number | null = null;

    for (let i = 0; i < numGps && gpsCur + 12 <= view.byteLength; i++, gpsCur += 12) {
      const tag = view.getUint16(gpsCur, littleEndian);
      if (tag === 0x0001) {
        // LatitudeRef: 'N' or 'S'
        latRef = String.fromCharCode(view.getUint8(gpsCur + 8));
      } else if (tag === 0x0002) {
        // Latitude (3 rationals: deg, min, sec)
        const valOffset = view.getUint32(gpsCur + 8, littleEndian);
        latDeg = parseRationalCoordinate(view, tiffOffset + valOffset, littleEndian);
      } else if (tag === 0x0003) {
        // LongitudeRef: 'E' or 'W'
        lngRef = String.fromCharCode(view.getUint8(gpsCur + 8));
      } else if (tag === 0x0004) {
        // Longitude (3 rationals)
        const valOffset = view.getUint32(gpsCur + 8, littleEndian);
        lngDeg = parseRationalCoordinate(view, tiffOffset + valOffset, littleEndian);
      } else if (tag === 0x0006) {
        // Altitude
        const valOffset = view.getUint32(gpsCur + 8, littleEndian);
        if (tiffOffset + valOffset + 8 <= view.byteLength) {
          const num = view.getUint32(tiffOffset + valOffset, littleEndian);
          const den = view.getUint32(tiffOffset + valOffset + 4, littleEndian);
          if (den > 0) altitude = num / den;
        }
      }
    }

    if (latDeg != null && lngDeg != null) {
      let finalLat = latDeg;
      let finalLng = lngDeg;
      if (latRef === 'S') finalLat = -finalLat;
      if (lngRef === 'W') finalLng = -finalLng;

      // Validate bounds
      if (
        Number.isFinite(finalLat) &&
        Number.isFinite(finalLng) &&
        finalLat >= -90 &&
        finalLat <= 90 &&
        finalLng >= -180 &&
        finalLng <= 180
      ) {
        out.geoPosition = {
          lat: Math.round(finalLat * 1000000) / 1000000,
          lng: Math.round(finalLng * 1000000) / 1000000,
          ele: altitude != null ? Math.round(altitude) : undefined,
        };
      }
    }
  }
}

/**
 * Decodes 3 rationals (degrees, minutes, seconds) into decimal degrees.
 */
function parseRationalCoordinate(view: DataView, offset: number, littleEndian: boolean): number | null {
  if (offset + 24 > view.byteLength) return null;

  const degNum = view.getUint32(offset, littleEndian);
  const degDen = view.getUint32(offset + 4, littleEndian);
  const minNum = view.getUint32(offset + 8, littleEndian);
  const minDen = view.getUint32(offset + 12, littleEndian);
  const secNum = view.getUint32(offset + 16, littleEndian);
  const secDen = view.getUint32(offset + 20, littleEndian);

  if (degDen === 0 || minDen === 0 || secDen === 0) return null;

  const degrees = degNum / degDen;
  const minutes = minNum / minDen;
  const seconds = secNum / secDen;

  return degrees + minutes / 60 + seconds / 3600;
}

/**
 * Factory helper for creating clean MediaAsset objects.
 * Never embeds large binaries in serialized projects.
 */
export function createMediaAsset(
  filename: string,
  url: string,
  options: Partial<MediaAsset> = {}
): MediaAsset {
  return {
    id: options.id ?? `media-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    type: options.type ?? 'photo',
    url,
    filename,
    title: options.title,
    caption: options.caption,
    attribution: options.attribution,
    mimeType: options.mimeType,
    sizeBytes: options.sizeBytes,
    geoPosition: options.geoPosition,
    timestamp: options.timestamp,
    cameraModel: options.cameraModel,
    stopId: options.stopId,
    sceneId: options.sceneId,
    isMissing: false,
  };
}
