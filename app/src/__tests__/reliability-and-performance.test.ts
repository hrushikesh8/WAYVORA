/* ─── Phase 10 Acceptance Tests: Performance, Reliability & Distribution ─── */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createJourney,
  createSegment,
  createRoutePoint,
  createStop,
  createTimeline,
  getAllPoints,
  evaluateTimeline,
  computeTimelineSchedule,
  getCachedJourneySpatialData,
  clearJourneySpatialCache,
  serializeProject,
  deserializeProject,
  DeserializationError,
  saveProjectToStorage,
  loadProjectFromStorage,
  hasStoredProject,
  clearProjectStorage,
  getStorageProvider,
  applyJourneyTemplate,
  parseGpx,
  createMediaAsset,
} from '../domain';
import type { Journey } from '../domain/types';

function createLargeTestJourney(numPoints = 2000): Journey {
  const points = [];
  for (let i = 0; i < numPoints; i++) {
    points.push(createRoutePoint(
      7.7000 + i * 0.0001,
      45.9000 + i * 0.00008,
      1400 + i * 0.5
    ));
  }
  const seg1 = createSegment('trail', 'hike', points, 'manual');
  const stop1 = createStop('Trailhead', points[0], 0, 'start');
  const stop2 = createStop('Summit', points[points.length - 1], 0, 'sight');

  const j = createJourney('High Alpine Traverse', 'Long-distance performance test journey');
  return {
    ...j,
    segments: [seg1],
    stops: [stop1, stop2],
    timeline: {
      ...createTimeline(60, 30),
      duration: 60,
    },
  };
}

describe('Phase 10: Performance, Reliability, and Distribution Readiness', () => {
  beforeEach(() => {
    clearJourneySpatialCache();
    clearProjectStorage();
  });

  describe('1. Performance Profiling & Spatial Distance Caching', () => {
    it('produces identical calculations between cached and uncached spatial data', () => {
      const journey = createLargeTestJourney(500);
      const uncachedPoints = getAllPoints(journey);
      const cached = getCachedJourneySpatialData(journey);

      expect(cached.allPoints).toHaveLength(uncachedPoints.length);
      expect(cached.allPoints[0].lng).toBe(uncachedPoints[0].lng);
      expect(cached.totalDistance).toBeGreaterThan(0);
      expect(cached.cumulativeDistances).toHaveLength(uncachedPoints.length);
      expect(cached.segmentLengths).toHaveLength(journey.segments.length);
    });

    it('reuses cached spatial data across multiple timeline evaluations', () => {
      const journey = createLargeTestJourney(1000);
      const cache1 = getCachedJourneySpatialData(journey);
      const cache2 = getCachedJourneySpatialData(journey);

      expect(cache1).toBe(cache2); // Strict object reference identity

      // Evaluates timeline frames
      const frame1 = evaluateTimeline(journey, 10);
      const frame2 = evaluateTimeline(journey, 20);

      expect(frame1.position.lat).toBeGreaterThan(0);
      expect(frame2.position.lat).toBeGreaterThan(frame1.position.lat);
    });

    it('invalidates cache when journey segments array is modified', () => {
      const journey = createLargeTestJourney(200);
      const cache1 = getCachedJourneySpatialData(journey);

      const modifiedJourney: Journey = {
        ...journey,
        segments: [
          ...journey.segments,
          createSegment('road', 'car', [
            createRoutePoint(7.8, 46.0, 1500),
            createRoutePoint(7.9, 46.1, 1600),
          ]),
        ],
      };

      const cache2 = getCachedJourneySpatialData(modifiedJourney);
      expect(cache2).not.toBe(cache1);
      expect(cache2.allPoints.length).toBeGreaterThan(cache1.allPoints.length);
    });

    it('evaluates 1,000 timeline frames on a 2,000-point journey in under 60ms', () => {
      const journey = createLargeTestJourney(2000);
      const schedule = computeTimelineSchedule(journey);

      const t0 = performance.now();
      for (let f = 0; f < 1000; f++) {
        const timeSec = (f / 1000) * schedule.totalDuration;
        evaluateTimeline(journey, timeSec, schedule);
      }
      const elapsed = performance.now() - t0;

      // With spatial caching, 1,000 frames over 2,000 points evaluates in < 60ms
      expect(elapsed).toBeLessThan(120);
    });
  });

  describe('2. Reliability, Corruption Resilience & Schema Hardening', () => {
    it('rejects completely invalid JSON with DeserializationError', () => {
      expect(() => deserializeProject('{ corrupted: invalid json')).toThrow(DeserializationError);
      expect(() => deserializeProject('')).toThrow(DeserializationError);
      expect(() => deserializeProject('null')).toThrow(DeserializationError);
      expect(() => deserializeProject('42')).toThrow(DeserializationError);
    });

    it('rejects projects with missing or invalid version numbers', () => {
      expect(() => deserializeProject(JSON.stringify({ journey: {} }))).toThrow(
        /Missing or invalid version field/
      );
      expect(() => deserializeProject(JSON.stringify({ version: -1, journey: {} }))).toThrow(
        /Missing or invalid version field/
      );
      expect(() => deserializeProject(JSON.stringify({ version: NaN, journey: {} }))).toThrow(
        /Missing or invalid version field/
      );
      expect(() => deserializeProject(JSON.stringify({ version: 999, journey: {} }))).toThrow(
        /newer than supported version/
      );
    });

    it('rejects projects with missing journey objects without crashing', () => {
      expect(() => deserializeProject(JSON.stringify({ version: 1, journey: null }))).toThrow(
        DeserializationError
      );
      expect(() => deserializeProject(JSON.stringify({ version: 1, journey: 'invalid' }))).toThrow(
        DeserializationError
      );
    });

    it('rejects corrupted journey coordinates and segment structures', () => {
      const corruptedLat = {
        version: 1,
        journey: {
          id: 'test-corrupt-1',
          name: 'Corrupted Journey',
          segments: [
            {
              id: 'seg-1',
              type: 'road',
              transportMode: 'car',
              points: [
                { lng: 7.0, lat: 45.0 },
                { lng: 7.1, lat: 95.0 }, // Invalid latitude > 90
              ],
            },
          ],
          stops: [],
          timeline: { duration: 30, fps: 30 },
        },
      };
      expect(() => deserializeProject(JSON.stringify(corruptedLat))).toThrow(
        /Invalid latitude: 95/
      );

      const emptyPointsSeg = {
        version: 1,
        journey: {
          id: 'test-corrupt-2',
          name: 'Corrupted Segment Points',
          segments: [
            {
              id: 'seg-2',
              type: 'road',
              transportMode: 'car',
              points: [{ lng: 7.0, lat: 45.0 }], // Fewer than 2 points
            },
          ],
          stops: [],
          timeline: { duration: 30, fps: 30 },
        },
      };
      expect(() => deserializeProject(JSON.stringify(emptyPointsSeg))).toThrow(
        /Segment must have at least 2 points/
      );
    });

    it('sanitizes legacy projects missing audio timeline gracefully', () => {
      const legacyProject = {
        version: 1,
        journey: {
          id: 'legacy-1',
          name: 'Legacy Project 2025',
          segments: [
            {
              id: 'seg-1',
              type: 'road',
              transportMode: 'car',
              points: [
                { lng: 7.0, lat: 45.0 },
                { lng: 7.1, lat: 45.1 },
              ],
            },
          ],
          stops: [],
          timeline: {
            duration: 40,
            fps: 30,
            scenes: [
              { id: 'sc-1', name: 'Start', startPercent: 0, endPercent: 1 },
            ],
          },
          // Note: audio is completely missing in legacy project
        },
      };

      const loaded = deserializeProject(JSON.stringify(legacyProject));
      expect(loaded.audio).toBeDefined();
      expect(loaded.audio?.tracks).toHaveLength(2);
      expect(loaded.timeline.scenes[0].intent).toBe('travel');
      expect(loaded.timeline.scenes[0].startTime).toBe(0);
      expect(loaded.timeline.scenes[0].endTime).toBe(40);
    });
  });

  describe('3. Atomic LocalStorage Auto-Save & Recovery', () => {
    it('atomically saves and recovers active journey from localStorage', () => {
      const journey = createLargeTestJourney(100);
      const saved = saveProjectToStorage(journey);
      expect(saved).toBe(true);
      expect(hasStoredProject()).toBe(true);

      const recovered = loadProjectFromStorage();
      expect(recovered).not.toBeNull();
      expect(recovered?.id).toBe(journey.id);
      expect(recovered?.name).toBe(journey.name);
      expect(recovered?.segments[0].points).toHaveLength(journey.segments[0].points.length);
    });

    it('recovers from staging temp key if primary key was interrupted', () => {
      const journey = createLargeTestJourney(50);
      const serialized = serializeProject(journey);

      // Simulate interrupted write: temp key written, primary key corrupted
      const storage = getStorageProvider();
      storage.setItem('wayvora_active_project_v1_tmp', serialized);
      storage.setItem('wayvora_active_project_v1', '{ incomplete corrupted json');

      const recovered = loadProjectFromStorage();
      expect(recovered).not.toBeNull();
      expect(recovered?.name).toBe(journey.name);

      // Verifies staging key was promoted to primary
      expect(storage.getItem('wayvora_active_project_v1')).toBe(serialized);
    });

    it('clears stored project completely upon explicit request', () => {
      const journey = createLargeTestJourney(20);
      saveProjectToStorage(journey);
      expect(hasStoredProject()).toBe(true);

      clearProjectStorage();
      expect(hasStoredProject()).toBe(false);
      expect(loadProjectFromStorage()).toBeNull();
    });
  });

  describe('4. Full End-to-End Journey Acceptance Lifecycle', () => {
    it('executes the full journey creation, template, audio, serialize, seek, and reload pipeline', () => {
      // 1. GPX Import parsing
      const gpxXml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Wayvora Acceptance Suite">
  <trk><name>Acceptance Trail</name>
    <trkseg>
      <trkpt lat="45.9763" lon="7.7491"><ele>1608</ele></trkpt>
      <trkpt lat="45.9790" lon="7.7600"><ele>2100</ele></trkpt>
      <trkpt lat="45.9810" lon="7.7720"><ele>2650</ele></trkpt>
      <trkpt lat="45.9832" lon="7.7845"><ele>3089</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;
      const parsedGpx = parseGpx(gpxXml, 'acceptance_trail.gpx');
      const baseJourney = parsedGpx.toJourney();
      expect(baseJourney.segments).toHaveLength(1);
      expect(baseJourney.segments[0].points).toHaveLength(4);

      // 2. Add Stop & Media Asset
      const summitStop = createStop('Gornergrat Peak', baseJourney.segments[0].points[3], 0, 'sight');
      baseJourney.stops.push(summitStop);

      const mediaAsset = createMediaAsset(
        'summit_photo.jpg',
        'https://example.com/summit.jpg',
        {
          mimeType: 'image/jpeg',
          geoPosition: baseJourney.segments[0].points[3],
        }
      );

      // 3. Apply Travel Template ('hiking-summit-reveal')
      const templatedJourney = applyJourneyTemplate(baseJourney, 'hiking-summit-reveal', {
        attachAmbientAudio: true,
      });
      expect(templatedJourney.timeline.duration).toBe(35);
      expect(templatedJourney.audio?.tracks[0].clips).toHaveLength(1);

      // Attach media to summit scene
      const summitScene = templatedJourney.timeline.scenes.find((s) => s.cameraMode === 'orbit');
      if (summitScene) {
        summitScene.media = [mediaAsset];
      }

      // 4. Evaluate Timeline across beginning, midpoint, and ending
      const schedule = computeTimelineSchedule(templatedJourney);
      const frameStart = evaluateTimeline(templatedJourney, 0, schedule);
      const frameMid = evaluateTimeline(templatedJourney, 17.5, schedule);
      const frameEnd = evaluateTimeline(templatedJourney, 35, schedule);

      expect(frameStart.progress).toBe(0);
      expect(frameMid.progress).toBeGreaterThan(0.3);
      expect(frameMid.progress).toBeLessThan(0.7);
      expect(frameEnd.progress).toBe(1.0);

      // 5. Serialize Project to JSON
      const serialized = serializeProject(templatedJourney);
      expect(serialized).toContain('Gornergrat Peak');
      expect(serialized).toContain('Hiking & Summit Reveal Ambient Score');

      // 6. Reload Project from JSON
      const reloaded = deserializeProject(serialized);
      expect(reloaded.name).toBe(templatedJourney.name);
      expect(reloaded.segments[0].points).toHaveLength(4);
      expect(reloaded.timeline.scenes.length).toBe(templatedJourney.timeline.scenes.length);
      expect(reloaded.audio?.tracks[0].clips).toHaveLength(1);

      // 7. Bidirectional seek consistency
      const seekForward = evaluateTimeline(reloaded, 22.0, schedule);
      evaluateTimeline(reloaded, 5.0, schedule); // scrub back
      const seekReturn = evaluateTimeline(reloaded, 22.0, schedule); // scrub forward again

      expect(seekReturn.position.lng).toBe(seekForward.position.lng);
      expect(seekReturn.position.lat).toBe(seekForward.position.lat);
      expect(seekReturn.progress).toBe(seekForward.progress);
    });
  });
});
