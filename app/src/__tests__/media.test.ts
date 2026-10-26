/* ─── Media Library & Local-First Import Test Suite ──────────────────
   Comprehensive automated unit and integration tests covering:
   - File format validation and size limit boundaries
   - Content fingerprinting and duplicate detection
   - EXIF extraction, coordinate preservation, and absence integrity
   - Local-first binary persistence (save, retrieve, delete)
   - ObjectURL hydration and missing-blob recovery across reloads
   - Scene and audio track associations with immutable undo/redo
   - Project serialization roundtrip and backward-compatible migration
   ─────────────────────────────────────────────────────────────────── */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  validateMediaFile,
  computeMediaFingerprint,
  importMediaFile,
  extractMediaMetadata,
  reviveMediaUrls,
  cleanupMediaUrls,
  filterMediaLibrary,
  saveMediaBlob,
  getMediaBlob,
  deleteMediaBlob,
  clearMediaBlobStore,
  MEDIA_SIZE_LIMITS,
  type MediaAsset,
} from '../domain/media';
import {
  addMediaToLibrary,
  removeMediaFromLibrary,
  assignMediaToScene,
  removeMediaFromScene,
  addMediaToAudioTrack,
  createEditorHistory,
  undoEditorHistory,
  redoEditorHistory,
} from '../domain/editor';
import { journeyFromWaypoints } from '../domain/journey';
import { createDefaultAudioTimeline } from '../domain/audio/mixer';
import { serializeProject, deserializeProject } from '../domain/serialization';
import { MIXED_JOURNEY_WAYPOINTS } from './fixtures';
import type { StoryScene } from '../domain/types';

describe('Media Library & Local-First Import Domain', () => {
  beforeEach(async () => {
    await clearMediaBlobStore();
  });

  afterEach(() => {
    cleanupMediaUrls();
  });

  describe('1. File Format & Size Limit Validation', () => {
    it('accepts valid photo formats within size boundaries', () => {
      const jpg = new File(['fake-jpg'], 'mountain.jpg', { type: 'image/jpeg' });
      const png = new File(['fake-png'], 'trail.png', { type: 'image/png' });
      const webp = new File(['fake-webp'], 'summit.webp', { type: 'image/webp' });

      expect(validateMediaFile(jpg)).toEqual({ valid: true, detectedType: 'photo' });
      expect(validateMediaFile(png)).toEqual({ valid: true, detectedType: 'photo' });
      expect(validateMediaFile(webp)).toEqual({ valid: true, detectedType: 'photo' });
    });

    it('accepts valid video formats within size boundaries', () => {
      const mp4 = new File(['fake-mp4'], 'drone_flight.mp4', { type: 'video/mp4' });
      const webm = new File(['fake-webm'], 'summit_clip.webm', { type: 'video/webm' });

      expect(validateMediaFile(mp4)).toEqual({ valid: true, detectedType: 'video' });
      expect(validateMediaFile(webm)).toEqual({ valid: true, detectedType: 'video' });
    });

    it('accepts valid audio formats within size boundaries', () => {
      const mp3 = new File(['fake-mp3'], 'ambient_score.mp3', { type: 'audio/mpeg' });
      const wav = new File(['fake-wav'], 'voiceover_intro.wav', { type: 'audio/wav' });

      expect(validateMediaFile(mp3)).toEqual({ valid: true, detectedType: 'audio' });
      expect(validateMediaFile(wav)).toEqual({ valid: true, detectedType: 'audio' });
    });

    it('rejects unsupported file formats gracefully', () => {
      const exe = new File(['malicious'], 'setup.exe', { type: 'application/x-msdownload' });
      const pdf = new File(['document'], 'guide.pdf', { type: 'application/pdf' });
      const zip = new File(['archive'], 'backup.zip', { type: 'application/zip' });

      expect(validateMediaFile(exe).valid).toBe(false);
      expect(validateMediaFile(exe).error).toContain('Unsupported file format');
      expect(validateMediaFile(pdf).valid).toBe(false);
      expect(validateMediaFile(zip).valid).toBe(false);
    });

    it('rejects empty files (0 bytes)', () => {
      const empty = new File([], 'empty.jpg', { type: 'image/jpeg' });
      const val = validateMediaFile(empty);
      expect(val.valid).toBe(false);
      expect(val.error).toContain('is empty (0 bytes)');
    });

    it('enforces documented size limits per media category', () => {
      // Photo limit is 50MB
      const hugePhoto = {
        name: 'huge_panorama.jpg',
        type: 'image/jpeg',
        size: MEDIA_SIZE_LIMITS.photo + 1024,
      } as unknown as File;
      const photoVal = validateMediaFile(hugePhoto);
      expect(photoVal.valid).toBe(false);
      expect(photoVal.error).toContain('exceeds the 50MB limit');

      // Audio limit is 100MB
      const hugeAudio = {
        name: 'full_album.wav',
        type: 'audio/wav',
        size: MEDIA_SIZE_LIMITS.audio + 1024,
      } as unknown as File;
      const audioVal = validateMediaFile(hugeAudio);
      expect(audioVal.valid).toBe(false);
      expect(audioVal.error).toContain('exceeds the 100MB limit');

      // Video limit is 500MB
      const hugeVideo = {
        name: '4k_raw.mp4',
        type: 'video/mp4',
        size: MEDIA_SIZE_LIMITS.video + 1024,
      } as unknown as File;
      const videoVal = validateMediaFile(hugeVideo);
      expect(videoVal.valid).toBe(false);
      expect(videoVal.error).toContain('exceeds the 500MB limit');
    });
  });

  describe('2. Fingerprinting & Deduplication', () => {
    it('produces identical fingerprints for identical files', async () => {
      const content = 'WAYVORA-IDENTICAL-SAMPLE-DATA';
      const file1 = new File([content], 'sample.jpg', { type: 'image/jpeg', lastModified: 1700000000 });
      const file2 = new File([content], 'sample.jpg', { type: 'image/jpeg', lastModified: 1700000000 });

      const fp1 = await computeMediaFingerprint(file1);
      const fp2 = await computeMediaFingerprint(file2);

      expect(fp1).toBe(fp2);
    });

    it('produces distinct fingerprints for files with different content', async () => {
      const file1 = new File(['Content-A'], 'image.jpg', { type: 'image/jpeg' });
      const file2 = new File(['Content-B-Different'], 'image.jpg', { type: 'image/jpeg' });

      const fp1 = await computeMediaFingerprint(file1);
      const fp2 = await computeMediaFingerprint(file2);

      expect(fp1).not.toBe(fp2);
    });

    it('detects existing library duplicates and returns duplicate status', async () => {
      const file = new File(['Unique Photo Content'], 'alps_summit.jpg', { type: 'image/jpeg' });

      // First import
      const res1 = await importMediaFile(file, { existingLibrary: [] });
      expect(res1.success).toBe(true);
      expect(res1.isDuplicate).toBe(false);
      expect(res1.asset).toBeDefined();

      // Second import with existing library
      const res2 = await importMediaFile(file, { existingLibrary: [res1.asset!] });
      expect(res2.success).toBe(true);
      expect(res2.isDuplicate).toBe(true);
      expect(res2.asset?.id).toBe(res1.asset?.id); // references existing asset
    });
  });

  describe('3. Metadata & Provenance Extraction', () => {
    it('preserves real EXIF when present in JPEG buffer', async () => {
      // Build a minimal synthetic JPEG APP1 header with TIFF Little Endian IFD
      const buffer = new ArrayBuffer(128);
      const view = new DataView(buffer);
      view.setUint16(0, 0xffd8); // SOI
      view.setUint16(2, 0xffe1); // APP1
      view.setUint16(4, 30);     // length
      // "Exif\0\0"
      view.setUint8(6, 0x45);
      view.setUint8(7, 0x78);
      view.setUint8(8, 0x69);
      view.setUint8(9, 0x66);
      view.setUint8(10, 0x00);
      view.setUint8(11, 0x00);

      const file = new File([buffer], 'exif_test.jpg', { type: 'image/jpeg' });
      const meta = await extractMediaMetadata(file);
      // Since Exif header is present, hasExif is detected
      expect(meta.hasExif).toBe(true);
      // But GPS was not populated, so geoPosition must be strictly undefined
      expect(meta.geoPosition).toBeUndefined();
      expect(meta.capturedAt).toBeUndefined();
    });

    it('never fabricates GPS coordinates or capture timestamps when absent', async () => {
      const plainPng = new File(['clean-png-bytes'], 'screenshot.png', { type: 'image/png' });
      const meta = await extractMediaMetadata(plainPng);

      expect(meta.geoPosition).toBeUndefined();
      expect(meta.capturedAt).toBeUndefined();
      expect(meta.cameraModel).toBeUndefined();
    });
  });

  describe('4. Local-First Binary Persistence & URL Hydration', () => {
    it('persists and retrieves binary blobs by storageKey', async () => {
      const content = 'BLOB-PERSISTENCE-TEST-DATA';
      const key = 'blob_test_key_123';

      await saveMediaBlob(key, new Blob([content]));
      const retrieved = await getMediaBlob(key);

      expect(retrieved).not.toBeNull();
      const text = await retrieved!.text();
      expect(text).toBe(content);

      await deleteMediaBlob(key);
      const afterDelete = await getMediaBlob(key);
      expect(afterDelete).toBeNull();
    });

    it('revives ObjectURLs across session reloads and handles missing blobs gracefully', async () => {
      let journey = journeyFromWaypoints('Persistence Journey', MIXED_JOURNEY_WAYPOINTS);
      journey.timeline.scenes = [
        {
          id: 'sc-1',
          name: 'Scene 1',
          intent: 'establishing',
          startTime: 0,
          endTime: 10,
          cameraMode: 'overview',
          params: { zoom: 10, pitch: 45, bearing: 0, rotationSpeed: 0 },
          media: [],
        },
      ];

      // Save binary blob into storage for asset 1
      const asset1Key = 'blob_asset_1';
      await saveMediaBlob(asset1Key, new Blob(['asset-1-binary-content']));

      const asset1: MediaAsset = {
        id: 'asset-1',
        type: 'photo',
        url: 'blob:expired-url-1',
        filename: 'valid.jpg',
        storageKey: asset1Key,
      };

      // Asset 2 has storageKey but binary was deleted/cleared
      const asset2: MediaAsset = {
        id: 'asset-2',
        type: 'photo',
        url: 'blob:expired-url-2',
        filename: 'missing.jpg',
        storageKey: 'blob_missing_key_999',
      };

      journey.mediaLibrary = [asset1, asset2];
      journey.timeline.scenes[0].media = [asset1];

      // Revive URLs
      const revived = await reviveMediaUrls(journey);

      // Asset 1 was found: fresh URL created, isMissing is false
      const revivedAsset1 = revived.mediaLibrary?.find((a) => a.id === 'asset-1');
      expect(revivedAsset1?.isMissing).toBe(false);
      expect(revivedAsset1?.url).toMatch(/^blob:/);
      expect(revivedAsset1?.url).not.toBe('blob:expired-url-1'); // URL refreshed

      // Scene 1 media was also refreshed
      expect(revived.timeline.scenes[0].media?.[0].url).toBe(revivedAsset1?.url);

      // Asset 2 was not in storage: marked isMissing = true without throwing
      const revivedAsset2 = revived.mediaLibrary?.find((a) => a.id === 'asset-2');
      expect(revivedAsset2?.isMissing).toBe(true);
    });
  });

  describe('5. Journey & Scene Integration with Undo/Redo', () => {
    it('adds and removes media assets in library and cascades safely to scenes', () => {
      let journey = journeyFromWaypoints('Integration Test', MIXED_JOURNEY_WAYPOINTS);
      journey.timeline.scenes = [
        {
          id: 'sc-alps',
          name: 'Alps Scene',
          intent: 'highlight',
          startTime: 0,
          endTime: 15,
          cameraMode: 'chase',
          params: { zoom: 14, pitch: 60, bearing: 45, rotationSpeed: 0 },
          title: 'Summit Highlight',
          caption: 'Original Caption',
          transition: { type: 'crossfade', duration: 1.0 },
          media: [],
        },
      ];

      const asset: MediaAsset = {
        id: 'asset-matterhorn',
        type: 'photo',
        url: 'blob:http://localhost/test',
        filename: 'matterhorn.jpg',
        title: 'Matterhorn Summit',
      };

      // 1. Add to library
      journey = addMediaToLibrary(journey, asset);
      expect(journey.mediaLibrary).toHaveLength(1);
      expect(journey.mediaLibrary?.[0].filename).toBe('matterhorn.jpg');

      // 2. Assign to scene
      journey = assignMediaToScene(journey, 'sc-alps', 'asset-matterhorn');
      const scene = (journey.timeline.scenes as StoryScene[])[0];
      expect(scene.media).toHaveLength(1);
      expect(scene.media?.[0].id).toBe('asset-matterhorn');

      // 3. Verify scene properties (caption, title, timing, transition) were untouched
      expect(scene.title).toBe('Summit Highlight');
      expect(scene.caption).toBe('Original Caption');
      expect(scene.startTime).toBe(0);
      expect(scene.endTime).toBe(15);
      expect(scene.transition?.type).toBe('crossfade');

      // 4. Remove from scene specifically
      journey = removeMediaFromScene(journey, 'sc-alps', 'asset-matterhorn');
      expect((journey.timeline.scenes as StoryScene[])[0].media).toHaveLength(0);
      // Asset remains in library!
      expect(journey.mediaLibrary).toHaveLength(1);

      // 5. Re-assign and delete from library
      journey = assignMediaToScene(journey, 'sc-alps', 'asset-matterhorn');
      journey = removeMediaFromLibrary(journey, 'asset-matterhorn');
      expect(journey.mediaLibrary).toHaveLength(0);
      // Automatically unlinked from scene
      expect((journey.timeline.scenes as StoryScene[])[0].media).toHaveLength(0);
    });

    it('safely handles media asset deletion referenced across multiple scenes without mutating scene timing, transitions, or captions', () => {
      let journey = journeyFromWaypoints('Multi-Scene Test', MIXED_JOURNEY_WAYPOINTS);
      const scenes: StoryScene[] = [
        {
          id: 'sc-1',
          name: 'First Pass',
          intent: 'establishing',
          startTime: 0,
          endTime: 10,
          cameraMode: 'chase',
          params: { zoom: 12, pitch: 45, bearing: 0, rotationSpeed: 0 },
          title: 'First Pass',
          caption: 'Ascending the valley',
          transition: { type: 'crossfade', duration: 1.5 },
          media: [],
        },
        {
          id: 'sc-2',
          name: 'Summit Plateau',
          intent: 'highlight',
          startTime: 10,
          endTime: 25,
          cameraMode: 'orbit',
          params: { zoom: 14, pitch: 60, bearing: 45, rotationSpeed: 0 },
          title: 'Summit Plateau',
          caption: 'Panoramic view at the peak',
          transition: { type: 'fade-black', duration: 2.0 },
          media: [],
        },
      ];
      journey = {
        ...journey,
        timeline: {
          ...journey.timeline,
          scenes,
          titleCards: {
            opening: { enabled: true, title: 'Epic Journey', duration: 3.0 },
            closing: { enabled: true, title: 'The End', duration: 4.0 },
          },
        },
      };

      const sharedAsset: MediaAsset = {
        id: 'shared-photo',
        type: 'photo',
        filename: 'summit.jpg',
        url: 'blob:summit',
      };
      const unrelatedAsset: MediaAsset = {
        id: 'unrelated-photo',
        type: 'photo',
        filename: 'basecamp.jpg',
        url: 'blob:basecamp',
      };

      journey = addMediaToLibrary(journey, sharedAsset);
      journey = addMediaToLibrary(journey, unrelatedAsset);
      journey = assignMediaToScene(journey, 'sc-1', 'shared-photo');
      journey = assignMediaToScene(journey, 'sc-2', 'shared-photo');
      journey = assignMediaToScene(journey, 'sc-2', 'unrelated-photo');

      expect((journey.timeline.scenes as StoryScene[])[0].media).toHaveLength(1);
      expect((journey.timeline.scenes as StoryScene[])[1].media).toHaveLength(2);

      // Now delete the shared asset from the library
      journey = removeMediaFromLibrary(journey, 'shared-photo');

      const updatedScenes = journey.timeline.scenes as StoryScene[];
      // Shared asset is unlinked from both scenes
      expect(updatedScenes[0].media).toHaveLength(0);
      expect(updatedScenes[1].media).toHaveLength(1);
      expect(updatedScenes[1].media?.[0].id).toBe('unrelated-photo');

      // Crucial: All scene timing, transitions, title cards, captions remain intact
      expect(updatedScenes[0].startTime).toBe(0);
      expect(updatedScenes[0].endTime).toBe(10);
      expect(updatedScenes[0].title).toBe('First Pass');
      expect(updatedScenes[0].caption).toBe('Ascending the valley');
      expect(updatedScenes[0].transition?.type).toBe('crossfade');
      expect(updatedScenes[0].transition?.duration).toBe(1.5);

      expect(updatedScenes[1].startTime).toBe(10);
      expect(updatedScenes[1].endTime).toBe(25);
      expect(updatedScenes[1].title).toBe('Summit Plateau');
      expect(updatedScenes[1].caption).toBe('Panoramic view at the peak');
      expect(updatedScenes[1].transition?.type).toBe('fade-black');
      expect(updatedScenes[1].transition?.duration).toBe(2.0);

      expect(journey.timeline.titleCards?.opening?.title).toBe('Epic Journey');
      expect(journey.timeline.titleCards?.closing?.title).toBe('The End');
      expect(journey.mediaLibrary).toHaveLength(1);
      expect(journey.mediaLibrary?.[0].id).toBe('unrelated-photo');
    });

    it('adds imported audio asset to audio tracks with correct duration and properties', () => {
      let journey = journeyFromWaypoints('Audio Integration Test', MIXED_JOURNEY_WAYPOINTS);
      journey.audio = createDefaultAudioTimeline();

      const audioAsset: MediaAsset = {
        id: 'asset-soundtrack',
        type: 'audio',
        url: 'blob:http://localhost/audio',
        filename: 'alpine_theme.mp3',
        title: 'Alpine Theme Score',
        durationSeconds: 45.0,
      };

      journey = addMediaToLibrary(journey, audioAsset);

      // Find music track
      const musicTrack = journey.audio?.tracks.find((t) => t.type === 'music');
      expect(musicTrack).toBeDefined();

      journey = addMediaToAudioTrack(journey, musicTrack!.id, audioAsset, 5.0);

      const updatedTrack = journey.audio?.tracks.find((t) => t.id === musicTrack!.id);
      expect(updatedTrack?.clips.length).toBeGreaterThanOrEqual(1);

      const addedClip = updatedTrack?.clips.find((c) => c.name === 'Alpine Theme Score');
      expect(addedClip).toBeDefined();
      expect(addedClip?.timelineStartSeconds).toBe(5.0);
      expect(addedClip?.durationSeconds).toBe(45.0);
      expect(addedClip?.assetUrl).toBe('blob:http://localhost/audio');
    });

    it('rejects adding non-audio assets to audio tracks', () => {
      const journey = journeyFromWaypoints('Invalid Audio Add', MIXED_JOURNEY_WAYPOINTS);
      journey.audio = createDefaultAudioTimeline();
      const photoAsset: MediaAsset = {
        id: 'asset-photo',
        type: 'photo',
        url: 'blob:photo',
        filename: 'pic.jpg',
      };

      const musicTrack = journey.audio?.tracks[0];
      expect(() => {
        addMediaToAudioTrack(journey, musicTrack!.id, photoAsset);
      }).toThrow('Cannot add non-audio asset');
    });

    it('supports full undo and redo for library and scene assignments', () => {
      let journey = journeyFromWaypoints('Undo Test', MIXED_JOURNEY_WAYPOINTS);
      let history = createEditorHistory(journey);

      const asset: MediaAsset = {
        id: 'asset-test',
        type: 'photo',
        url: 'blob:test',
        filename: 'photo.jpg',
      };

      journey = addMediaToLibrary(journey, asset);
      history = { ...history, present: journey, past: [...history.past, history.present] };

      expect(journey.mediaLibrary).toHaveLength(1);

      // Undo
      history = undoEditorHistory(history);
      expect(history.present.mediaLibrary?.length ?? 0).toBe(0);

      // Redo
      history = redoEditorHistory(history);
      expect(history.present.mediaLibrary).toHaveLength(1);
    });
  });

  describe('6. Serialization & Migration Compatibility', () => {
    it('roundtrips journey with mediaLibrary losslessly without embedding raw binaries', () => {
      let journey = journeyFromWaypoints('Serialization Test', MIXED_JOURNEY_WAYPOINTS);
      const asset: MediaAsset = {
        id: 'asset-serialize-1',
        type: 'photo',
        url: 'blob:ephemeral',
        filename: 'summit.jpg',
        title: 'High Summit',
        caption: 'Taken at 2240m',
        sizeBytes: 1048576,
        width: 1920,
        height: 1080,
        durationSeconds: undefined,
        geoPosition: { lat: 46.545, lng: 7.97, ele: 2240 },
        timestamp: '2026-08-15T14:30:00Z',
        cameraModel: 'Sony A7IV',
        storageKey: 'blob_asset_serialize_1',
        fingerprint: 'fp_1048576_abc123',
        isMissing: false,
      };

      journey = addMediaToLibrary(journey, asset);

      const json = serializeProject(journey);
      expect(json).not.toContain('base64'); // zero raw binary blobs in JSON
      expect(json).toContain('asset-serialize-1');
      expect(json).toContain('Sony A7IV');

      const restored = deserializeProject(json);
      expect(restored.mediaLibrary).toHaveLength(1);
      const restoredAsset = restored.mediaLibrary![0];
      expect(restoredAsset.id).toBe('asset-serialize-1');
      expect(restoredAsset.filename).toBe('summit.jpg');
      expect(restoredAsset.geoPosition?.ele).toBe(2240);
      expect(restoredAsset.width).toBe(1920);
      expect(restoredAsset.height).toBe(1080);
      expect(restoredAsset.storageKey).toBe('blob_asset_serialize_1');
    });

    it('safely migrates legacy projects without mediaLibrary to current structure', () => {
      const legacyJourney = journeyFromWaypoints('Legacy Project', MIXED_JOURNEY_WAYPOINTS);
      const rawProject = {
        version: 1,
        journey: {
          ...legacyJourney,
          mediaLibrary: undefined, // omitted in legacy
        },
      };

      const json = JSON.stringify(rawProject);
      const migrated = deserializeProject(json);

      expect(migrated.mediaLibrary).toBeDefined();
      expect(Array.isArray(migrated.mediaLibrary)).toBe(true);
      expect(migrated.mediaLibrary).toHaveLength(0);
    });
  });

  describe('7. Query & Filter Operations', () => {
    it('filters assets by category and search query accurately', () => {
      const library: MediaAsset[] = [
        { id: '1', type: 'photo', filename: 'Alpine_Meadow.jpg', title: 'Green Meadow', url: '' },
        { id: '2', type: 'photo', filename: 'Summit_Ridge.png', cameraModel: 'Hasselblad 907X', url: '' },
        { id: '3', type: 'video', filename: 'Drone_Pass.mp4', title: 'Mountain Flyover', url: '' },
        { id: '4', type: 'audio', filename: 'Wind_Gusts.wav', title: 'Alpine Wind', url: '' },
      ];

      // Filter all
      expect(filterMediaLibrary(library, { type: 'all' })).toHaveLength(4);

      // Filter photos
      expect(filterMediaLibrary(library, { type: 'photo' })).toHaveLength(2);

      // Filter videos
      expect(filterMediaLibrary(library, { type: 'video' })).toHaveLength(1);

      // Filter audio
      expect(filterMediaLibrary(library, { type: 'audio' })).toHaveLength(1);

      // Search by keyword in filename
      const searchFilename = filterMediaLibrary(library, { type: 'all', searchQuery: 'ridge' });
      expect(searchFilename).toHaveLength(1);
      expect(searchFilename[0].id).toBe('2');

      // Search by keyword in title
      const searchTitle = filterMediaLibrary(library, { type: 'all', searchQuery: 'flyover' });
      expect(searchTitle).toHaveLength(1);
      expect(searchTitle[0].id).toBe('3');

      // Search by camera hardware model
      const searchCamera = filterMediaLibrary(library, { type: 'all', searchQuery: 'hasselblad' });
      expect(searchCamera).toHaveLength(1);
      expect(searchCamera[0].id).toBe('2');

      // Combined type + search filter
      const combined = filterMediaLibrary(library, { type: 'photo', searchQuery: 'flyover' });
      expect(combined).toHaveLength(0); // flyover is a video, not photo
    });
  });
});
