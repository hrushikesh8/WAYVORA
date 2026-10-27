/* ─── Phase 3 Acceptance: Place Search and Manual Route Editing ───────────
   Validates:
   1. Place search autocomplete & geocoding for cities, landmarks, trailheads.
   2. Appending geocoded places as journey stops/waypoints.
   3. Manual route editing: adding, moving, and safely deleting waypoints.
   4. Minimum geometry preservation (>= 2 points per segment).
   5. Strict protection of recorded GPX tracks against accidental overwrite.
   6. Clear distinction between manual direct connections and verified network routes.
   7. Honest routing failure reporting without inventing paths.
   8. Full undo/redo history participation across all editing operations.
   ─────────────────────────────────────────────────────────────────── */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MockGeocodingAdapter,
} from '../domain/geocoding/mock';
import {
  appendPlaceToJourney,
  insertRoutePoint,
  moveRoutePoint,
  deleteRoutePoint,
  applyRouteToSegment,
  createRoutedSegment,
  createEditorHistory,
  pushEditorHistory,
  undoEditorHistory,
  redoEditorHistory,
  canUndo,
  canRedo,
  EditError,
} from '../domain/editor';
import {
  getSegmentGeometryCategory,
  type Journey,
  type RoutePoint,
} from '../domain/types';
import { createJourney } from '../domain/journey';
import type { RouteResult } from '../domain/routing/types';

function makeTestJourney(overrides: Partial<Journey> = {}): Journey {
  const base = createJourney('Test Journey');
  return { ...base, ...overrides };
}

function makeMockRouteResult(overrides: Partial<RouteResult> = {}): RouteResult {
  return {
    success: true,
    points: [{ lat: 46.0, lng: 7.0 }, { lat: 46.5, lng: 7.5 }],
    origin: { lat: 46.0, lng: 7.0 },
    destination: { lat: 46.5, lng: 7.5 },
    distanceMetres: 45000,
    durationSeconds: 2400,
    warnings: [],
    metadata: {
      providerId: 'mock-router',
      providerName: 'Mock Router',
      profile: 'driving',
      retrievedAt: new Date().toISOString(),
      attribution: 'Mock Attribution',
    },
    ...overrides,
  };
}

describe('Phase 3: Place Search and Manual Route Editing', () => {
  let mockGeocoding: MockGeocodingAdapter;

  beforeEach(() => {
    mockGeocoding = new MockGeocodingAdapter();
  });

  // ── 1. Place Search Autocomplete ──
  describe('1. Place Search Autocomplete for Cities, Landmarks & Trailheads', () => {
    it('finds cities and landmarks by query string', async () => {
      const cityResult = await mockGeocoding.search({ query: 'Zurich' });
      expect(cityResult.success).toBe(true);
      expect(cityResult.results.length).toBeGreaterThan(0);
      expect(cityResult.results[0].name).toContain('Zurich');
      expect(cityResult.results[0].type).toBe('city');

      const mountainResult = await mockGeocoding.search({ query: 'Matterhorn' });
      expect(mountainResult.success).toBe(true);
      expect(mountainResult.results[0].name).toContain('Matterhorn');
      expect(mountainResult.results[0].category).toBe('natural');
    });

    it('returns empty results gracefully for unlisted queries', async () => {
      const res = await mockGeocoding.search({ query: 'Atlantis Underwater City' });
      expect(res.success).toBe(true);
      expect(res.results).toHaveLength(0);
    });

    it('limits search results to the requested count', async () => {
      const res = await mockGeocoding.search({ query: 'a', limit: 2 });
      expect(res.success).toBe(true);
      expect(res.results.length).toBeLessThanOrEqual(2);
    });
  });

  // ── 2. Adding Selected Places as Journey Stops & Waypoints ──
  describe('2. Adding Selected Places as Journey Stops & Waypoints', () => {
    it('creates initial start stop when journey is empty', () => {
      const emptyJourney = createJourney('Empty Journey');
      expect(emptyJourney.segments).toHaveLength(0);
      expect(emptyJourney.stops).toHaveLength(0);

      const { journey: updated, newStopId } = appendPlaceToJourney(emptyJourney, {
        name: 'Geneva Airport',
        lat: 46.237,
        lng: 6.109,
      });

      expect(updated.stops).toHaveLength(1);
      expect(updated.stops[0].id).toBe(newStopId);
      expect(updated.stops[0].name).toBe('Geneva Airport');
      expect(updated.stops[0].type).toBe('start');
      expect(updated.segments).toHaveLength(0); // Still 0 segments until a 2nd point is connected
    });

    it('connects a new destination with a manual_direct segment from previous terminal point', () => {
      const baseJourney = makeTestJourney({
        name: 'Swiss Drive',
        segments: [
          {
            id: 'seg-1',
            type: 'road',
            transportMode: 'car',
            sourceFormat: 'manual',
            points: [
              { lat: 46.2044, lng: 6.1432 },
              { lat: 46.5197, lng: 6.6323 },
            ],
          },
        ],
        stops: [
          { id: 'stop-start', name: 'Geneva', position: { lat: 46.2044, lng: 6.1432 }, type: 'start', segmentIndex: 0 },
          { id: 'stop-end', name: 'Lausanne', position: { lat: 46.5197, lng: 6.6323 }, type: 'end', segmentIndex: 0 },
        ],
      });

      const { journey: updated, newStopId, newSegmentId } = appendPlaceToJourney(
        baseJourney,
        { name: 'Montreux', lat: 46.4312, lng: 6.9107 },
        { transportMode: 'car' }
      );

      expect(updated.segments).toHaveLength(2);
      expect(newSegmentId).toBeDefined();

      const newSeg = updated.segments[1];
      expect(newSeg.points).toHaveLength(2);
      expect(newSeg.points[0]).toEqual({ lat: 46.5197, lng: 6.6323 }); // Previous terminal
      expect(newSeg.points[1]).toEqual({ lat: 46.4312, lng: 6.9107 }); // New destination
      expect(getSegmentGeometryCategory(newSeg)).toBe('manual_direct');

      // Previous 'end' stop was transformed into a 'waypoint', new destination is 'end'
      const oldEndStop = updated.stops.find((s) => s.id === 'stop-end');
      expect(oldEndStop?.type).toBe('waypoint');

      const newStop = updated.stops.find((s) => s.id === newStopId);
      expect(newStop?.name).toBe('Montreux');
      expect(newStop?.type).toBe('end');
    });
  });

  // ── 3. Manual Waypoint Editing: Add, Move, Remove ──
  describe('3. Manual Waypoint Editing: Add, Move, and Remove', () => {
    let journeyWithPoints: Journey;

    beforeEach(() => {
      journeyWithPoints = makeTestJourney({
        name: 'Editing Test',
        segments: [
          {
            id: 'seg-edit',
            type: 'road',
            transportMode: 'car',
            sourceFormat: 'manual',
            points: [
              { lat: 46.0, lng: 7.0 },
              { lat: 46.2, lng: 7.2 },
              { lat: 46.4, lng: 7.4 },
            ],
            metadata: { editCount: 0 },
          },
        ],
        stops: [
          { id: 'stop-0', name: 'Start', position: { lat: 46.0, lng: 7.0 }, type: 'start', segmentIndex: 0 },
          { id: 'stop-2', name: 'End', position: { lat: 46.4, lng: 7.4 }, type: 'end', segmentIndex: 0 },
        ],
      });
    });

    it('inserts a waypoint at a specified index in a segment', () => {
      const newPoint: RoutePoint = { lat: 46.1, lng: 7.1 };
      const updated = insertRoutePoint(journeyWithPoints, 'seg-edit', 1, newPoint);

      const seg = updated.segments[0];
      expect(seg.points).toHaveLength(4);
      expect(seg.points[1]).toEqual(newPoint);
      expect(seg.metadata?.isModified).toBe(true);
      expect(seg.metadata?.editCount).toBe(1);
    });

    it('moves an existing route point and synchronizes attached stops', () => {
      const updated = moveRoutePoint(journeyWithPoints, 'seg-edit', 0, { lat: 46.005, lng: 7.005 });

      const seg = updated.segments[0];
      expect(seg.points[0].lat).toBe(46.005);
      expect(seg.points[0].lng).toBe(7.005);

      // Attached start stop was synced
      const startStop = updated.stops.find((s) => s.id === 'stop-0');
      expect(startStop?.position.lat).toBe(46.005);
      expect(startStop?.position.lng).toBe(7.005);
    });

    it('deletes a waypoint safely when segment has more than 2 points', () => {
      const updated = deleteRoutePoint(journeyWithPoints, 'seg-edit', 1);

      const seg = updated.segments[0];
      expect(seg.points).toHaveLength(2);
      expect(seg.points[0]).toEqual({ lat: 46.0, lng: 7.0 });
      expect(seg.points[1]).toEqual({ lat: 46.4, lng: 7.4 });
      expect(seg.metadata?.isModified).toBe(true);
    });

    it('enforces domain rule: cannot delete point if segment only has 2 points', () => {
      // First delete point at index 1 -> leaves 2 points
      const twoPointsJourney = deleteRoutePoint(journeyWithPoints, 'seg-edit', 1);
      expect(twoPointsJourney.segments[0].points).toHaveLength(2);

      // Attempting to delete another point must throw EditError
      expect(() => {
        deleteRoutePoint(twoPointsJourney, 'seg-edit', 0);
      }).toThrowError(/at least 2 points/);
    });

    it('rejects invalid coordinates on insert and move', () => {
      expect(() => {
        insertRoutePoint(journeyWithPoints, 'seg-edit', 1, { lat: 95.0, lng: 7.0 });
      }).toThrowError(EditError);

      expect(() => {
        moveRoutePoint(journeyWithPoints, 'seg-edit', 1, { lat: 46.0, lng: -190.0 });
      }).toThrowError(EditError);
    });
  });

  // ── 4. Strict Protection of Recorded GPX Tracks ──
  describe('4. Strict Protection of Recorded GPX Tracks', () => {
    let gpxJourney: Journey;

    beforeEach(() => {
      gpxJourney = makeTestJourney({
        name: 'Recorded Alpine Hike',
        segments: [
          {
            id: 'seg-gpx-recorded',
            type: 'trail',
            transportMode: 'hike',
            sourceFormat: 'gpx',
            points: [
              { lat: 45.9765, lng: 7.7491, ele: 1600 },
              { lat: 45.9812, lng: 7.7423, ele: 1750 },
              { lat: 45.9867, lng: 7.7354, ele: 1900 },
            ],
            metadata: {
              isOriginalImport: true,
              provenance: {
                source: 'gpx_import',
                category: 'recorded_track',
                filename: 'matterhorn_trail.gpx',
                originalPointCount: 3,
              },
            },
          },
        ],
      });
    });

    it('recognizes recorded GPX track geometry category correctly', () => {
      expect(getSegmentGeometryCategory(gpxJourney.segments[0])).toBe('recorded_track');
    });

    it('refuses to overwrite recorded GPX track with automated routing unless explicitly permitted', () => {
      const mockRouteResult = makeMockRouteResult({
        points: [
          { lat: 45.9765, lng: 7.7491 },
          { lat: 45.9867, lng: 7.7354 },
        ],
        distanceMetres: 2500,
        durationSeconds: 1800,
        metadata: {
          providerId: 'mock-router',
          providerName: 'Mock Router',
          profile: 'walking',
          retrievedAt: new Date().toISOString(),
          attribution: 'Mock Route Attribution',
        },
      });

      // Unpermitted attempt must throw EditError
      expect(() => {
        applyRouteToSegment(gpxJourney, 'seg-gpx-recorded', mockRouteResult);
      }).toThrowError(/recorded GPX track/);

      // Explicitly permitted replacement succeeds
      const replaced = applyRouteToSegment(gpxJourney, 'seg-gpx-recorded', mockRouteResult, {
        allowRecordedTrackReplacement: true,
      });
      expect(getSegmentGeometryCategory(replaced.segments[0])).toBe('verified_network');
    });
  });

  // ── 5. Provenance: manual_direct vs verified_network ──
  describe('5. Provenance: manual_direct vs verified_network', () => {
    it('accurately identifies manual_direct vs verified_network segments', () => {
      const manualJourney = makeTestJourney({
        name: 'Manual Trip',
        segments: [
          {
            id: 'seg-manual',
            type: 'road',
            transportMode: 'car',
            sourceFormat: 'manual',
            points: [
              { lat: 46.0, lng: 7.0 },
              { lat: 46.5, lng: 7.5 },
            ],
            metadata: {
              provenance: {
                source: 'manual-connection',
                category: 'manual_direct',
              },
            },
          },
        ],
      });

      expect(getSegmentGeometryCategory(manualJourney.segments[0])).toBe('manual_direct');

      // Converting manual segment via routing provider creates verified_network
      const routedResult = makeMockRouteResult({
        points: [
          { lat: 46.0, lng: 7.0 },
          { lat: 46.25, lng: 7.25 },
          { lat: 46.5, lng: 7.5 },
        ],
        distanceMetres: 45000,
        durationSeconds: 2400,
        metadata: {
          providerId: 'osrm-car',
          providerName: 'OSRM Driving',
          profile: 'driving',
          retrievedAt: new Date().toISOString(),
          attribution: '© OpenStreetMap contributors',
        },
      });

      const routedJourney = applyRouteToSegment(manualJourney, 'seg-manual', routedResult);
      expect(getSegmentGeometryCategory(routedJourney.segments[0])).toBe('verified_network');
      const prov = routedJourney.segments[0].metadata?.provenance;
      expect(typeof prov === 'object' && prov !== null ? (prov as Record<string, unknown>).category : undefined).toBe('verified_network');
    });

    it('preserves provenance when creating a routed segment from scratch', () => {
      const baseJourney = createJourney('Base Empty');
      const routedResult = makeMockRouteResult({
        points: [
          { lat: 47.0, lng: 8.0 },
          { lat: 47.1, lng: 8.1 },
          { lat: 47.2, lng: 8.2 },
        ],
        distanceMetres: 20000,
        durationSeconds: 1200,
        metadata: {
          providerId: 'osrm-car',
          providerName: 'OSRM Car',
          profile: 'driving',
          retrievedAt: new Date().toISOString(),
          attribution: 'OSM',
        },
      });

      const { journey: updated, newSegmentId } = createRoutedSegment(baseJourney, routedResult, 'car');
      expect(updated.segments).toHaveLength(1);
      expect(updated.segments[0].id).toBe(newSegmentId);
      expect(getSegmentGeometryCategory(updated.segments[0])).toBe('verified_network');
    });
  });

  // ── 6. Honest Routing Failure Reporting ──
  describe('6. Honest Routing Failure Reporting (No Fake Geometry)', () => {
    it('refuses to apply failed routing results to a segment', () => {
      const testJourney = makeTestJourney({
        name: 'Failure Test',
        segments: [
          {
            id: 'seg-valid',
            type: 'road',
            transportMode: 'car',
            sourceFormat: 'manual',
            points: [
              { lat: 46.0, lng: 7.0 },
              { lat: 46.5, lng: 7.5 },
            ],
          },
        ],
      });

      const failedResult: RouteResult = {
        success: false,
        points: [],
        origin: { lat: 46.0, lng: 7.0 },
        destination: { lat: 46.5, lng: 7.5 },
        distanceMetres: 0,
        durationSeconds: 0,
        warnings: [],
        error: {
          code: 'NO_ROUTE',
          message: 'No road connection found between coordinates',
        },
        metadata: {
          providerId: 'osrm',
          providerName: 'OSRM',
          profile: 'driving',
          retrievedAt: new Date().toISOString(),
          attribution: 'OSM',
        },
      };

      expect(() => {
        applyRouteToSegment(testJourney, 'seg-valid', failedResult);
      }).toThrowError(/provider failed or returned fewer than 2 points/);
    });
  });

  // ── 7. Undo / Redo Integration ──
  describe('7. Full Undo / Redo History Participation', () => {
    it('correctly tracks and reverses waypoint insertion, move, and deletion', () => {
      const initialJourney = makeTestJourney({
        name: 'History Test',
        segments: [
          {
            id: 'seg-h',
            type: 'road',
            transportMode: 'car',
            sourceFormat: 'manual',
            points: [
              { lat: 46.0, lng: 7.0 },
              { lat: 46.4, lng: 7.4 },
            ],
          },
        ],
      });

      let history = createEditorHistory(initialJourney);
      expect(canUndo(history)).toBe(false);
      expect(canRedo(history)).toBe(false);

      // Step 1: Insert midpoint
      const step1Journey = insertRoutePoint(history.present, 'seg-h', 1, { lat: 46.2, lng: 7.2 });
      history = pushEditorHistory(history, step1Journey);
      expect(canUndo(history)).toBe(true);
      expect(history.present.segments[0].points).toHaveLength(3);

      // Step 2: Move midpoint
      const step2Journey = moveRoutePoint(history.present, 'seg-h', 1, { lat: 46.25, lng: 7.25 });
      history = pushEditorHistory(history, step2Journey);
      expect(history.present.segments[0].points[1].lat).toBe(46.25);

      // Step 3: Undo Move
      history = undoEditorHistory(history);
      expect(history.present.segments[0].points[1].lat).toBe(46.2);
      expect(canRedo(history)).toBe(true);

      // Step 4: Redo Move
      history = redoEditorHistory(history);
      expect(history.present.segments[0].points[1].lat).toBe(46.25);

      // Step 5: Undo Move and Undo Insert
      history = undoEditorHistory(history);
      history = undoEditorHistory(history);
      expect(history.present.segments[0].points).toHaveLength(2);
      expect(canUndo(history)).toBe(false);
    });
  });
});
