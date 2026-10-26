# ADR-019: Local-First Media Library, Binary Persistence & Story Integration

**Status**: ACCEPTED  
**Date**: 2026-10-26  
**Domain**: Media Library, Asset Ingestion, EXIF Metadata Extraction, IndexedDB Binary Storage, Lifecycle Hydration, Story & Audio Integration  

---

## 1. Context & Problem Statement

WAYVORA transforms GPX routes and journeys into cinematic stories. To support user-owned photos, videos, and soundtrack recordings without relying on remote cloud storage or compromising browser memory limits, Phase 7 introduces a local-first Media Library and Import Workflow.

Key challenges and design constraints:
1. **Binary Size vs. Project Serialization**: Embedding multi-megabyte images, videos, or audio files as base64 strings into `.wayvora.json` project files would bloat file sizes, degrade autosave performance, and risk `localStorage` quota exhaustion (5MB limit).
2. **Object URL Expiration**: Browser `blob:` URLs generated during file import expire immediately when the user reloads or closes the tab. The system must retain binary data locally and revive fresh URLs transparently upon reload.
3. **Metadata Authenticity & Provenance**: Real EXIF data (capture timestamps, GPS coordinates, elevation, camera hardware) must be accurately extracted and displayed. Missing metadata must never be fabricated.
4. **Resilient Associations**: Media assets can be associated with journeys, story scenes, and audio timeline tracks. Removing an asset from the library must cascade safely without destroying scene timing, transitions, title cards, or audio sync.
5. **Format Validation & Limits**: Strict format validation against practical browser capabilities with explicit file size limits (50MB photos, 100MB audio, 500MB videos).

---

## 2. Architectural Decisions

### 2.1 Separation of Binary Storage and Project Metadata
- **Binary Persistence Engine** (`app/src/domain/media/mediaStore.ts`):
  - Uses browser **IndexedDB** (`wayvora_media_store_v1`, object store `media_blobs`) to store raw `Blob` and `File` objects indexed by a deterministic `storageKey` (`blob_${assetId}`).
  - Provides a seamless `MemoryBlobStore` fallback for Node.js/Vitest unit test environments where `window.indexedDB` is undefined.
  - Keeps `.wayvora.json` project files lightweight (< 50KB) by storing only metadata (`id`, `filename`, `type`, `dimensions`, `durationSeconds`, `fingerprint`, `storageKey`, `exif`) and omitting binary payloads.

### 2.2 Deterministic Fingerprinting & Deduplication
- **Content Fingerprinting** (`app/src/domain/media/mediaImporter.ts`):
  - Samples file chunks (first 16KB, middle 16KB, last 16KB) concatenated with file size, name, and MIME type to produce a fast, non-blocking 64-bit content hash.
  - Detects duplicate imports before saving to IndexedDB, returning the existing asset and notifying the user.

### 2.3 Authentic Metadata Extraction
- **Zero-Fabrication Policy**:
  - Leverages `parseJpegExif` to extract GPS coordinates, altitude, capture timestamp, and camera model.
  - Video and audio dimensions and durations are inspected via transient off-screen `<video>` and `<audio>` DOM elements with timeout bounds.
  - Fields absent from the source media remain strictly `undefined`—no synthetic locations or timestamps are ever generated.

### 2.4 Lifecycle Hydration & Session URL Management
- **Startup Rehydration** (`app/src/domain/media/mediaLifecycle.ts`):
  - On application mount or project deserialization, `reviveMediaUrls` traverses `journey.mediaLibrary`, stop attachments, and story scenes.
  - Retrieves stored blobs from IndexedDB by `storageKey` and mints fresh `blob:` URLs via `mediaRegistry.createTrackedUrl(blob)`.
  - If a blob cannot be found (e.g. cleared browser storage), sets `isMissing: true` to render an informative placeholder while preserving scene structure and user edits.
- **Teardown**:
  - `cleanupMediaUrls` revokes tracked object URLs to prevent browser memory leaks.

### 2.5 Story Scene & Audio Timeline Integration
- **Story Scenes**:
  - Scenes can attach one or more library media assets (`scene.media: MediaAsset[]`).
  - Removing an asset from the media library safely unlinks it from referencing scenes and stops without altering scene start times, end times, captions, or camera transitions.
- **Audio Soundscapes**:
  - Audio assets in the media library can be dropped directly onto music or voiceover tracks (`addMediaToAudioTrack`), adopting authentic duration metadata.

---

## 3. Data Model Additions

```typescript
export interface MediaDimensions {
  width: number;
  height: number;
  aspectRatio: number;
}

export interface MediaAsset {
  id: string;
  type: 'photo' | 'video' | 'audio';
  url: string;
  filename: string;
  storageKey?: string;
  fingerprint?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  sizeBytes?: number;
  mimeType?: string;
  title?: string;
  geoPosition?: RoutePoint;
  timestamp?: string;
  cameraModel?: string;
  isMissing?: boolean;
}

export interface Journey {
  // ... existing fields ...
  mediaLibrary?: MediaAsset[];
}
```

---

## 4. Migration & Backward Compatibility

- `deserializeProject` ensures older `.wayvora.json` files without `mediaLibrary` are initialized with an empty array (`mediaLibrary: []`).
- Existing `stop.media` and `scene.media` arrays continue to be fully supported and are automatically rehydrated across reloads.
- No breaking schema changes were introduced to the journey structure or audio timelines.

---

## 5. Consequences & Trade-offs

- **Pros**:
  - Instant local loading with zero network overhead.
  - Project JSON remains tiny and exportable via text/clipboard.
  - No storage quota bottlenecks from base64 encoding.
  - Full undo/redo support for all media library modifications.
- **Trade-offs**:
  - Exporting a `.wayvora.json` file to another computer does not transfer IndexedDB binary assets unless a future bundle archive format (e.g. `.wayvorazip`) is implemented.
  - In-browser video rendering relies on native browser codec decoding (MP4/H.264/WebM). Imported video files can be previewed in the browser and attached to story scenes, but their moving frames are not yet rendered in offline exports (offline export renders the verified metadata badge and card structure).
