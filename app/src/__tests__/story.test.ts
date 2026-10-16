import { describe, it, expect } from 'vitest';
import {
  isSupportedImageFormat,
  isSupportedMediaFormat,
  parseJpegExif,
  createMediaAsset,
} from '../domain/story/media';
import {
  evaluateStoryAtTime,
  validateStoryScenes,
  validateTitleCards,
  generateDefaultStoryScenes,
  generateDefaultTitleCards,
} from '../domain/story/evaluator';
import type { StoryScene, MediaAsset, StoryTitleCards } from '../domain/story/types';
import { journeyFromWaypoints } from '../domain/journey';
import { MIXED_JOURNEY_WAYPOINTS } from './fixtures';
import {
  createEditorHistory,
  pushEditorHistory,
  undoEditorHistory,
  redoEditorHistory,
  addStoryScene,
  updateStoryScene,
  deleteStoryScene,
  reorderStoryScenes,
  updateTitleCards,
  associateSceneWithStop,
  associateSceneWithSegment,
  deleteStop,
  attachMediaToScene,
  attachMediaToStop,
  removeMedia,
} from '../domain/editor';
import { serializeProject, deserializeProject } from '../domain/serialization';
import { evaluateRenderFrame } from '../domain/render/contract';

describe('Story Domain, Media Handling & Scene Evaluator', () => {
  describe('Media Format Validation', () => {
    it('accepts standard image and video formats', () => {
      expect(isSupportedImageFormat('photo.jpg')).toBe(true);
      expect(isSupportedImageFormat('IMAGE.PNG')).toBe(true);
      expect(isSupportedImageFormat('view.webp')).toBe(true);
      expect(isSupportedImageFormat('image/jpeg')).toBe(true);
      expect(isSupportedImageFormat('route.gpx')).toBe(false);
      expect(isSupportedImageFormat('binary.exe')).toBe(false);

      expect(isSupportedMediaFormat('clip.mp4')).toBe(true);
      expect(isSupportedMediaFormat('video/webm')).toBe(true);
      expect(isSupportedMediaFormat('document.pdf')).toBe(false);
    });
  });

  describe('EXIF Parser (parseJpegExif)', () => {
    it('returns hasExif=false for non-JPEG or corrupted buffers', () => {
      const empty = new ArrayBuffer(10);
      expect(parseJpegExif(empty).hasExif).toBe(false);

      const fakeHeader = new Uint8Array([0x00, 0x00, 0x11, 0x22]).buffer;
      expect(parseJpegExif(fakeHeader).hasExif).toBe(false);
    });

    it('extracts real GPS coordinates from synthetic valid APP1 Exif buffer', () => {
      // Build a minimal valid JPEG with APP1 Exif header
      const buffer = new ArrayBuffer(256);
      const view = new DataView(buffer);

      // JPEG SOI: 0xFFD8
      view.setUint16(0, 0xffd8);
      // APP1 Marker: 0xFFE1
      view.setUint16(2, 0xffe1);
      // APP1 Length: 200 bytes
      view.setUint16(4, 200);

      // "Exif\0\0"
      const exifMagic = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
      exifMagic.forEach((b, i) => view.setUint8(6 + i, b));

      // TIFF Header at offset 12: 'II' (Little Endian: 0x4949)
      const tiffOffset = 12;
      view.setUint16(tiffOffset, 0x4949); // Little Endian
      view.setUint16(tiffOffset + 2, 0x002a, true); // 42 magic
      view.setUint32(tiffOffset + 4, 8, true); // IFD0 offset relative to TIFF header (offset 20)

      // IFD0 at offset 20: 1 entry (GPSInfoIFDPointer: 0x8825)
      const ifd0 = tiffOffset + 8;
      view.setUint16(ifd0, 1, true); // 1 entry
      view.setUint16(ifd0 + 2, 0x8825, true); // GPSInfo tag
      view.setUint16(ifd0 + 4, 4, true); // LONG
      view.setUint32(ifd0 + 6, 1, true); // count 1
      view.setUint32(ifd0 + 10, 30, true); // GPS IFD at tiffOffset + 30 (offset 42)

      // GPS IFD at tiffOffset + 30 (offset 42): 4 entries (LatRef, Lat, LngRef, Lng)
      const gpsIfd = tiffOffset + 30;
      view.setUint16(gpsIfd, 4, true);

      // Entry 1: LatRef ('N' = 0x4E)
      view.setUint16(gpsIfd + 2, 0x0001, true);
      view.setUint16(gpsIfd + 4, 2, true); // ASCII
      view.setUint32(gpsIfd + 6, 2, true); // count
      view.setUint8(gpsIfd + 10, 0x4e); // 'N'

      // Entry 2: Lat (3 rationals: 46/1 deg, 30/1 min, 0/1 sec = 46.5 deg)
      // Store rationals at tiffOffset + 80
      const latRationals = tiffOffset + 80;
      view.setUint16(gpsIfd + 14, 0x0002, true);
      view.setUint16(gpsIfd + 16, 5, true); // RATIONAL
      view.setUint32(gpsIfd + 18, 3, true); // 3 rationals
      view.setUint32(gpsIfd + 22, 80, true); // offset relative to TIFF

      view.setUint32(latRationals, 46, true);
      view.setUint32(latRationals + 4, 1, true);
      view.setUint32(latRationals + 8, 30, true);
      view.setUint32(latRationals + 12, 1, true);
      view.setUint32(latRationals + 16, 0, true);
      view.setUint32(latRationals + 20, 1, true);

      // Entry 3: LngRef ('E' = 0x45)
      view.setUint16(gpsIfd + 26, 0x0003, true);
      view.setUint16(gpsIfd + 28, 2, true);
      view.setUint32(gpsIfd + 30, 2, true);
      view.setUint8(gpsIfd + 34, 0x45); // 'E'

      // Entry 4: Lng (3 rationals: 8/1 deg, 0/1 min, 0/1 sec = 8.0 deg)
      const lngRationals = tiffOffset + 110;
      view.setUint16(gpsIfd + 38, 0x0004, true);
      view.setUint16(gpsIfd + 40, 5, true);
      view.setUint32(gpsIfd + 42, 3, true);
      view.setUint32(gpsIfd + 46, 110, true);

      view.setUint32(lngRationals, 8, true);
      view.setUint32(lngRationals + 4, 1, true);
      view.setUint32(lngRationals + 8, 0, true);
      view.setUint32(lngRationals + 12, 1, true);
      view.setUint32(lngRationals + 16, 0, true);
      view.setUint32(lngRationals + 20, 1, true);

      const parsed = parseJpegExif(buffer);
      expect(parsed.hasExif).toBe(true);
      expect(parsed.geoPosition).toBeDefined();
      expect(parsed.geoPosition?.lat).toBeCloseTo(46.5, 4);
      expect(parsed.geoPosition?.lng).toBeCloseTo(8.0, 4);
    });
  });

  describe('evaluateStoryAtTime (deterministic overlays)', () => {
    const sampleMedia: MediaAsset = createMediaAsset('summit.jpg', 'blob:http://localhost/1234', {
      title: 'Summit Vista',
      caption: 'Clear weather on the high ridge.',
    });

    const scenes: StoryScene[] = [
      {
        id: 'sc-1',
        name: 'Valley Departure',
        intent: 'establishing',
        startTime: 0,
        endTime: 10,
        cameraMode: 'overview',
        params: { zoom: 10, pitch: 40, bearing: 0, rotationSpeed: 0 },
        title: 'Alpine Tour Begins',
        subtitle: 'Departing from the valley floor',
        caption: 'Morning mist over the meadows.',
        transition: { type: 'fade', duration: 1.0 },
      },
      {
        id: 'sc-2',
        name: 'Ridge Climb',
        intent: 'highlight',
        startTime: 10,
        endTime: 25,
        cameraMode: 'chase',
        params: { zoom: 14, pitch: 60, bearing: 45, rotationSpeed: 0 },
        title: 'Steep Ascent',
        subtitle: 'Switchbacks on scree',
        caption: 'Climbing toward the pass.',
        media: [sampleMedia],
        transition: { type: 'dissolve', duration: 1.5 },
      },
      {
        id: 'sc-3',
        name: 'Summit Arrival',
        intent: 'arrival',
        startTime: 25,
        endTime: 40,
        cameraMode: 'overview',
        params: { zoom: 11, pitch: 45, bearing: 0, rotationSpeed: 0 },
        title: 'Summit Reached',
        subtitle: '4,421m elevation',
        caption: 'Panoramic views across the range.',
      },
    ];

    it('returns exact active scene and title within title duration', () => {
      // At t = 2s (within Scene 1 title window)
      const res1 = evaluateStoryAtTime(scenes, 2);
      expect(res1.activeScene?.id).toBe('sc-1');
      expect(res1.title).toBe('Alpine Tour Begins');
      expect(res1.caption).toBe('Morning mist over the meadows.');

      // At t = 7s (past the 4.5s title display window)
      const res2 = evaluateStoryAtTime(scenes, 7);
      expect(res2.activeScene?.id).toBe('sc-1');
      expect(res2.title).toBeUndefined(); // title disappears after title window
      expect(res2.caption).toBe('Morning mist over the meadows.');
    });

    it('evaluates transition progress entering scene #2', () => {
      // Scene 2 starts at t = 10s with 1.5s transition
      // At t = 10.75s, progress should be 0.5 (50%)
      const res = evaluateStoryAtTime(scenes, 10.75);
      expect(res.activeScene?.id).toBe('sc-2');
      expect(res.transition).toBeDefined();
      expect(res.transition?.type).toBe('dissolve');
      expect(res.transition?.progress).toBeCloseTo(0.5, 2);
      expect(res.transition?.fromSceneId).toBe('sc-1');
      expect(res.transition?.toSceneId).toBe('sc-2');
    });

    it('surfaces active media assets during scene #2', () => {
      const res = evaluateStoryAtTime(scenes, 18);
      expect(res.activeMedia.length).toBe(1);
      expect(res.activeMedia[0].filename).toBe('summit.jpg');
    });

    it('is 100% deterministic on repeated evaluations', () => {
      const eval1 = evaluateStoryAtTime(scenes, 14.32);
      const eval2 = evaluateStoryAtTime(scenes, 14.32);

      expect(eval1.activeScene?.id).toBe(eval2.activeScene?.id);
      expect(eval1.title).toBe(eval2.title);
      expect(eval1.caption).toBe(eval2.caption);
      expect(eval1.transition).toEqual(eval2.transition);
    });
  });

  describe('generateDefaultStoryScenes', () => {
    it('synthesizes narrative scenes covering departure, stops, and arrival', () => {
      const journey = journeyFromWaypoints('Alps Tour', MIXED_JOURNEY_WAYPOINTS);
      journey.stops[1].durationAtStop = 10;

      const scenes = generateDefaultStoryScenes(journey);
      expect(scenes.length).toBeGreaterThanOrEqual(3);

      expect(scenes[0].intent).toBe('establishing');
      expect(scenes[0].startTime).toBe(0);

      const last = scenes[scenes.length - 1];
      expect(last.intent).toBe('arrival');
      expect(last.endTime).toBe(journey.timeline.duration);

      const errors = validateStoryScenes(scenes);
      expect(errors).toEqual([]);
    });
  });

  describe('Story Editor Operations & Undo/Redo Integration', () => {
    it('supports add, update, delete, and undo/redo of scenes and media', () => {
      let journey = journeyFromWaypoints('Edit Journey', MIXED_JOURNEY_WAYPOINTS);
      let history = createEditorHistory(journey);

      const newScene: StoryScene = {
        id: 'custom-scene-1',
        name: 'Sunset Valley',
        intent: 'highlight',
        startTime: 5,
        endTime: 15,
        cameraMode: 'chase',
        params: { zoom: 14, pitch: 60, bearing: 0, rotationSpeed: 0 },
        title: 'Golden Hour',
        caption: 'Warm glow over the peaks.',
      };

      // 1. Add Scene
      journey = addStoryScene(journey, newScene);
      history = pushEditorHistory(history, journey);
      expect((journey.timeline.scenes as StoryScene[]).some((s) => s.id === 'custom-scene-1')).toBe(true);

      // 2. Attach Media to Scene
      const photo: MediaAsset = createMediaAsset('vista.jpg', 'blob:http://localhost/vista');
      journey = attachMediaToScene(journey, 'custom-scene-1', photo);
      history = pushEditorHistory(history, journey);
      const attachedScene = (journey.timeline.scenes as StoryScene[]).find((s) => s.id === 'custom-scene-1');
      expect(attachedScene?.media?.length).toBe(1);

      // 3. Update Scene
      journey = updateStoryScene(journey, 'custom-scene-1', { title: 'Sunset Glow Updated' });
      history = pushEditorHistory(history, journey);
      const updatedScene = (journey.timeline.scenes as StoryScene[]).find((s) => s.id === 'custom-scene-1');
      expect(updatedScene?.title).toBe('Sunset Glow Updated');

      // 4. Undo twice -> reverts to state before media attachment and update
      history = undoEditorHistory(history);
      history = undoEditorHistory(history);
      journey = history.present;
      const revertedScene = (journey.timeline.scenes as StoryScene[]).find((s) => s.id === 'custom-scene-1');
      expect(revertedScene?.title).toBe('Golden Hour');
      expect(revertedScene?.media?.length ?? 0).toBe(0);

      // 5. Redo -> re-applies media attachment
      history = redoEditorHistory(history);
      journey = history.present;
      const redoneScene = (journey.timeline.scenes as StoryScene[]).find((s) => s.id === 'custom-scene-1');
      expect(redoneScene?.media?.length).toBe(1);

      // 6. Attach and remove media from a Stop
      const stopMedia = createMediaAsset('stop-photo.jpg', 'blob:http://localhost/stop-photo');
      const stopId = journey.stops[0].id;
      journey = attachMediaToStop(journey, stopId, stopMedia);
      expect(journey.stops[0].media?.length).toBe(1);
      journey = removeMedia(journey, stopMedia.id);
      expect(journey.stops[0].media?.length).toBe(0);

      // 7. Delete Scene
      journey = deleteStoryScene(journey, 'custom-scene-1');
      expect((journey.timeline.scenes as StoryScene[]).some((s) => s.id === 'custom-scene-1')).toBe(false);
    });
  });

  describe('Project Serialization & Migration', () => {
    it('roundtrips story scenes and media metadata without embedding binary payloads', () => {
      let journey = journeyFromWaypoints('Serialize Story', MIXED_JOURNEY_WAYPOINTS);
      const photo = createMediaAsset('alps.jpg', 'images/alps.jpg', {
        title: 'Eiger North Face',
        geoPosition: { lng: 8.0, lat: 46.5, ele: 2400 },
        timestamp: '2026-10-15T08:30:00Z',
      });

      const scene: StoryScene = {
        id: 'sc-roundtrip',
        name: 'Eiger Pass',
        intent: 'highlight',
        startTime: 10,
        endTime: 20,
        cameraMode: 'chase',
        params: { zoom: 14, pitch: 60, bearing: 30, rotationSpeed: 0 },
        title: 'Eiger Pass',
        caption: 'Passing beneath the iconic north face.',
        media: [photo],
      };

      journey = addStoryScene(journey, scene);
      const json = serializeProject(journey);

      // Verify that no large data: URLs or binary base64 bloat is stored
      expect(json).not.toContain('data:image');
      expect(json).toContain('"name": "Eiger Pass"');
      expect(json).toContain('"filename": "alps.jpg"');

      // Deserialize and verify integrity
      const loaded = deserializeProject(json);
      const loadedScene = (loaded.timeline.scenes as StoryScene[]).find((s) => s.id === 'sc-roundtrip');
      expect(loadedScene).toBeDefined();
      expect(loadedScene?.title).toBe('Eiger Pass');
      expect(loadedScene?.media?.[0].geoPosition?.lat).toBe(46.5);
    });

    it('migrates legacy project without titleCards with zero errors', () => {
      let journey = journeyFromWaypoints('Legacy Story', MIXED_JOURNEY_WAYPOINTS);
      // Strip titleCards if any
      delete (journey.timeline as any).titleCards;
      const json = serializeProject(journey);
      const loaded = deserializeProject(json);
      expect(loaded.timeline.scenes).toBeDefined();
    });
  });

  describe('Phase 5: Multi-Scene Reordering, Linking & Deletion Resilience', () => {
    it('reorders scenes and supports full undo/redo', () => {
      let journey = journeyFromWaypoints('Reorder Story', MIXED_JOURNEY_WAYPOINTS);
      journey = { ...journey, timeline: { ...journey.timeline, scenes: [] } };
      let history = createEditorHistory(journey);

      const sceneA: StoryScene = {
        id: 'scene-alpha',
        name: 'Scene Alpha',
        intent: 'establishing',
        startTime: 0,
        endTime: 10,
        cameraMode: 'overview',
        params: { zoom: 10, pitch: 40, bearing: 0, rotationSpeed: 0 },
      };
      const sceneB: StoryScene = {
        id: 'scene-beta',
        name: 'Scene Beta',
        intent: 'travel',
        startTime: 10,
        endTime: 20,
        cameraMode: 'chase',
        params: { zoom: 14, pitch: 60, bearing: 0, rotationSpeed: 0 },
      };

      journey = addStoryScene(journey, sceneA);
      journey = addStoryScene(journey, sceneB);
      history = pushEditorHistory(history, journey);

      expect((journey.timeline.scenes as StoryScene[])[0].id).toBe('scene-alpha');
      expect((journey.timeline.scenes as StoryScene[])[1].id).toBe('scene-beta');

      // Reorder: Move Beta (index 1) to index 0
      journey = reorderStoryScenes(journey, 1, 0);
      history = pushEditorHistory(history, journey);
      expect((journey.timeline.scenes as StoryScene[])[0].id).toBe('scene-beta');
      expect((journey.timeline.scenes as StoryScene[])[1].id).toBe('scene-alpha');

      // Undo reorder
      history = undoEditorHistory(history);
      journey = history.present;
      expect((journey.timeline.scenes as StoryScene[])[0].id).toBe('scene-alpha');
      expect((journey.timeline.scenes as StoryScene[])[1].id).toBe('scene-beta');

      // Redo reorder
      history = redoEditorHistory(history);
      journey = history.present;
      expect((journey.timeline.scenes as StoryScene[])[0].id).toBe('scene-beta');
      expect((journey.timeline.scenes as StoryScene[])[1].id).toBe('scene-alpha');
    });

    it('associates scene with stop and segment, and cleanly clears stopId when stop is deleted without deleting scene', () => {
      let journey = journeyFromWaypoints('Link Story', MIXED_JOURNEY_WAYPOINTS);
      const targetStop = journey.stops[1];
      const targetSegment = journey.segments[0];

      const scene: StoryScene = {
        id: 'scene-linked',
        name: 'Stop & Segment Scene',
        intent: 'stop',
        startTime: 5,
        endTime: 15,
        cameraMode: 'orbit',
        params: { zoom: 14, pitch: 60, bearing: 0, rotationSpeed: 30 },
      };
      journey = addStoryScene(journey, scene);

      // Associate with stop and segment
      journey = associateSceneWithStop(journey, 'scene-linked', targetStop.id);
      journey = associateSceneWithSegment(journey, 'scene-linked', targetSegment.id);

      let sc = (journey.timeline.scenes as StoryScene[]).find((s) => s.id === 'scene-linked');
      expect(sc?.stopId).toBe(targetStop.id);
      expect(sc?.segmentId).toBe(targetSegment.id);

      // Deleting stop cleans up stopId reference in scene, but DOES NOT delete the scene or the segment
      journey = deleteStop(journey, targetStop.id);
      sc = (journey.timeline.scenes as StoryScene[]).find((s) => s.id === 'scene-linked');
      expect(sc).toBeDefined();
      expect(sc?.stopId).toBeUndefined();
      expect(sc?.segmentId).toBe(targetSegment.id);

      // Deleting scene DOES NOT delete the journey, waypoint, or segment
      journey = deleteStoryScene(journey, 'scene-linked');
      expect((journey.timeline.scenes as StoryScene[]).some((s) => s.id === 'scene-linked')).toBe(false);
      expect(journey.segments.length).toBeGreaterThanOrEqual(1);
      expect(journey.stops.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Phase 5: Story Timing & Title Card Validation', () => {
    it('validates scene start time, end time, and transition duration limits', () => {
      const invalidScenes: StoryScene[] = [
        {
          id: 'sc-neg',
          name: 'Negative Start',
          intent: 'travel',
          startTime: -5,
          endTime: 10,
          cameraMode: 'chase',
          params: { zoom: 14, pitch: 60, bearing: 0, rotationSpeed: 0 },
        },
        {
          id: 'sc-inverted',
          name: 'Inverted Times',
          intent: 'travel',
          startTime: 10,
          endTime: 8,
          cameraMode: 'chase',
          params: { zoom: 14, pitch: 60, bearing: 0, rotationSpeed: 0 },
        },
        {
          id: 'sc-long-trans',
          name: 'Overly Long Transition',
          intent: 'travel',
          startTime: 20,
          endTime: 22, // 2s duration
          cameraMode: 'chase',
          params: { zoom: 14, pitch: 60, bearing: 0, rotationSpeed: 0 },
          transition: { type: 'crossfade', duration: 5 }, // 5s transition > 2s scene
        },
      ];

      const errors = validateStoryScenes(invalidScenes);
      expect(errors.length).toBeGreaterThanOrEqual(3);
      expect(errors.some((e) => e.includes('start time cannot be negative'))).toBe(true);
      expect(errors.some((e) => e.includes('must be greater than start time'))).toBe(true);
      expect(errors.some((e) => e.includes('exceeds scene duration'))).toBe(true);
    });

    it('validates title card settings for empty titles and zero/negative duration', () => {
      const invalidTitleCards: StoryTitleCards = {
        opening: {
          enabled: true,
          title: '   ', // empty
          duration: 3.5,
        },
        closing: {
          enabled: true,
          title: 'Closing',
          duration: 0, // invalid <= 0
        },
      };

      const errors = validateTitleCards(invalidTitleCards);
      expect(errors.length).toBe(2);
      expect(errors[0]).toContain('Opening title card must have a title');
      expect(errors[1]).toContain('Closing title card duration must be greater than 0s');

      const valid = generateDefaultTitleCards(journeyFromWaypoints('Tour', MIXED_JOURNEY_WAYPOINTS));
      expect(validateTitleCards(valid)).toEqual([]);

      let journey = journeyFromWaypoints('Tour', MIXED_JOURNEY_WAYPOINTS);
      journey = updateTitleCards(journey, valid);
      expect(journey.timeline.titleCards?.opening?.title).toBe('Tour');
    });
  });

  describe('Phase 5: Cinematic Opening and Closing Title Card Evaluation', () => {
    it('evaluates opening title card with smooth fade-in, motion, and fade-out', () => {
      const titleCards: StoryTitleCards = {
        opening: {
          enabled: true,
          title: 'Alpine Odyssey',
          subtitle: 'A high-altitude expedition',
          duration: 4.0,
          motion: 'slow-zoom',
        },
        closing: {
          enabled: true,
          title: 'Expedition Complete',
          duration: 4.0,
          motion: 'fade',
        },
      };

      // At t = 0s (opening starts: fade in beginning)
      const res0 = evaluateStoryAtTime([], 0, [], null, { titleCards, totalDuration: 60 });
      expect(res0.activeTitleCard).toBeDefined();
      expect(res0.activeTitleCard?.type).toBe('opening');
      expect(res0.activeTitleCard?.title).toBe('Alpine Odyssey');
      expect(res0.activeTitleCard?.progress).toBe(0);
      expect(res0.activeTitleCard?.opacity).toBeCloseTo(0, 2);

      // At t = 2s (mid-opening: full opacity 1.0, progress 0.5)
      const resMid = evaluateStoryAtTime([], 2.0, [], null, { titleCards, totalDuration: 60 });
      expect(resMid.activeTitleCard).toBeDefined();
      expect(resMid.activeTitleCard?.type).toBe('opening');
      expect(resMid.activeTitleCard?.opacity).toBe(1.0);
      expect(resMid.activeTitleCard?.progress).toBeCloseTo(0.5, 2);
      expect(resMid.activeTitleCard?.motion).toBe('slow-zoom');

      // At t = 5s (post-opening, before closing: no title card active)
      const res5 = evaluateStoryAtTime([], 5.0, [], null, { titleCards, totalDuration: 60 });
      expect(res5.activeTitleCard).toBeUndefined();

      // At t = 58s (mid-closing: total 60s, close duration 4s -> start at 56s, t=58s is progress 0.5)
      const resClose = evaluateStoryAtTime([], 58.0, [], null, { titleCards, totalDuration: 60 });
      expect(resClose.activeTitleCard).toBeDefined();
      expect(resClose.activeTitleCard?.type).toBe('closing');
      expect(resClose.activeTitleCard?.title).toBe('Expedition Complete');
      expect(resClose.activeTitleCard?.progress).toBeCloseTo(0.5, 2);
      expect(resClose.activeTitleCard?.opacity).toBe(1.0);
    });
  });

  describe('Phase 5: Transition Set (Cut, Crossfade, Fade-Black) Evaluation', () => {
    const scenes: StoryScene[] = [
      {
        id: 'sc-1',
        name: 'Scene 1',
        intent: 'travel',
        startTime: 0,
        endTime: 10,
        cameraMode: 'chase',
        params: { zoom: 14, pitch: 60, bearing: 0, rotationSpeed: 0 },
      },
      {
        id: 'sc-2',
        name: 'Scene 2',
        intent: 'travel',
        startTime: 10,
        endTime: 20,
        cameraMode: 'chase',
        params: { zoom: 14, pitch: 60, bearing: 0, rotationSpeed: 0 },
        transition: { type: 'crossfade', duration: 2.0 },
      },
      {
        id: 'sc-3',
        name: 'Scene 3',
        intent: 'stop',
        startTime: 20,
        endTime: 30,
        cameraMode: 'orbit',
        params: { zoom: 14, pitch: 60, bearing: 0, rotationSpeed: 30 },
        transition: { type: 'fade-black', duration: 1.0 },
      },
      {
        id: 'sc-4',
        name: 'Scene 4',
        intent: 'travel',
        startTime: 30,
        endTime: 40,
        cameraMode: 'chase',
        params: { zoom: 14, pitch: 60, bearing: 0, rotationSpeed: 0 },
        transition: { type: 'cut', duration: 0 },
      },
    ];

    it('evaluates crossfade transition progress smoothly', () => {
      // Scene 2 starts at 10s with 2s crossfade. At t=11s, progress = 0.5
      const res = evaluateStoryAtTime(scenes, 11);
      expect(res.transition).toBeDefined();
      expect(res.transition?.type).toBe('crossfade');
      expect(res.transition?.progress).toBeCloseTo(0.5, 2);
      expect(res.transition?.fromSceneId).toBe('sc-1');
      expect(res.transition?.toSceneId).toBe('sc-2');
    });

    it('evaluates fade-black transition smoothly', () => {
      // Scene 3 starts at 20s with 1s fade-black. At t=20.5s, progress = 0.5
      const res = evaluateStoryAtTime(scenes, 20.5);
      expect(res.transition).toBeDefined();
      expect(res.transition?.type).toBe('fade-black');
      expect(res.transition?.progress).toBeCloseTo(0.5, 2);
    });

    it('omits transition overlay for cut transition (instantaneous)', () => {
      // Scene 4 starts at 30s with cut transition
      const res = evaluateStoryAtTime(scenes, 30.1);
      expect(res.transition).toBeUndefined();
    });
  });

  describe('Phase 5: Export Parity (evaluateRenderFrame)', () => {
    it('composes activeTitleCard and transition into RenderFrame at explicit timestamps', () => {
      let journey = journeyFromWaypoints('Render Parity', MIXED_JOURNEY_WAYPOINTS);
      journey.timeline.duration = 40;
      journey.timeline.titleCards = {
        opening: {
          enabled: true,
          title: 'Opening Showcase',
          duration: 3.0,
          motion: 'slow-zoom',
        },
      };

      const scene1: StoryScene = {
        id: 'sc-r1',
        name: 'R1',
        intent: 'travel',
        startTime: 0,
        endTime: 20,
        cameraMode: 'chase',
        params: { zoom: 14, pitch: 60, bearing: 0, rotationSpeed: 0 },
      };
      const scene2: StoryScene = {
        id: 'sc-r2',
        name: 'R2',
        intent: 'travel',
        startTime: 20,
        endTime: 40,
        cameraMode: 'chase',
        params: { zoom: 14, pitch: 60, bearing: 0, rotationSpeed: 0 },
        transition: { type: 'fade-black', duration: 1.0 },
      };
      journey = addStoryScene(journey, scene1);
      journey = addStoryScene(journey, scene2);

      // Frame at t = 1.5s (mid opening title card)
      const frameOpening = evaluateRenderFrame(journey, 1.5);
      expect(frameOpening.story.activeTitleCard).toBeDefined();
      expect(frameOpening.story.activeTitleCard?.title).toBe('Opening Showcase');
      expect(frameOpening.story.activeTitleCard?.opacity).toBe(1.0);

      // Frame at t = 20.5s (mid fade-black transition into Scene 2)
      const frameTransition = evaluateRenderFrame(journey, 20.5);
      expect(frameTransition.story.transition?.type).toBe('fade-black');
      expect(frameTransition.story.transition?.progress).toBeCloseTo(0.5, 2);
    });
  });
});
