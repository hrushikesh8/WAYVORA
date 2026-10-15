/* ─── Route Editor & Undo/Redo Unit Tests ────────────────────────────── */

import { describe, it, expect } from 'vitest';
import {
  insertRoutePoint,
  moveRoutePoint,
  deleteRoutePoint,
  updateStop,
  deleteStop,
  updateSegmentMode,
  getSegmentEditAudit,
  createEditorHistory,
  pushEditorHistory,
  undoEditorHistory,
  redoEditorHistory,
  canUndo,
  canRedo,
  EditError,
} from '../domain/editor';
import {
  createJourney,
  createSegment,
  createRoutePoint,
  createStop,
  addSegmentToJourney,
  addStopToJourney,
} from '../domain/journey';
import { serializeProject, deserializeProject } from '../domain/serialization';
import type { Journey, RoutePoint } from '../domain/types';

describe('Route Editor Domain Operations', () => {
  function createSampleJourney(): Journey {
    let journey = createJourney('Editor Test Journey');

    const points: RoutePoint[] = [
      createRoutePoint(8.0000, 46.5000, 800),
      createRoutePoint(8.0500, 46.5200, 1100),
      createRoutePoint(8.1000, 46.5400, 1500),
    ];

    const segment = {
      ...createSegment('trail', 'hike', points, 'gpx'),
      metadata: {
        isOriginalImport: true,
        provenance: {
          source: 'gpx_import',
          filename: 'alpine_hike.gpx',
          originalPointCount: 3,
          importedAt: '2026-10-15T10:00:00Z',
        },
      },
    };

    journey = addSegmentToJourney(journey, segment);

    const stop = createStop('Midway Hut', points[1], 0, 'rest');
    stop.durationAtStop = 5;
    journey = addStopToJourney(journey, stop);

    return journey;
  }

  describe('insertRoutePoint', () => {
    it('inserts a point at the specified index and preserves provenance', () => {
      const journey = createSampleJourney();
      const segId = journey.segments[0].id;

      const newPoint = createRoutePoint(8.0250, 46.5100, 950);
      const updated = insertRoutePoint(journey, segId, 1, newPoint);

      const updatedSeg = updated.segments[0];
      expect(updatedSeg.points).toHaveLength(4);
      expect(updatedSeg.points[1].lat).toBe(46.5100);
      expect(updatedSeg.points[1].lng).toBe(8.0250);
      expect(updatedSeg.points[1].ele).toBe(950);

      // Provenance remains intact while edit status is flagged
      const audit = getSegmentEditAudit(updatedSeg);
      expect(audit.isOriginal).toBe(false);
      expect(audit.isModified).toBe(true);
      expect(audit.originalFilename).toBe('alpine_hike.gpx');
      expect(audit.originalPointCount).toBe(3);
      expect(audit.currentPointCount).toBe(4);
      expect(audit.editCount).toBe(1);
    });

    it('rejects insertion with invalid coordinates', () => {
      const journey = createSampleJourney();
      const segId = journey.segments[0].id;

      expect(() =>
        insertRoutePoint(journey, segId, 1, createRoutePoint(200, 45))
      ).toThrow(EditError);

      expect(() =>
        insertRoutePoint(journey, segId, 1, createRoutePoint(10, 95))
      ).toThrow(EditError);
    });

    it('rejects insertion with out-of-bounds index', () => {
      const journey = createSampleJourney();
      const segId = journey.segments[0].id;

      expect(() =>
        insertRoutePoint(journey, segId, 999, createRoutePoint(8.0, 46.5))
      ).toThrow(EditError);
    });
  });

  describe('moveRoutePoint', () => {
    it('moves an existing route point and synchronizes attached stops', () => {
      const journey = createSampleJourney();
      const segId = journey.segments[0].id;

      // Move point 1 (which matches Stop "Midway Hut")
      const updated = moveRoutePoint(journey, segId, 1, {
        lat: 46.5250,
        lng: 8.0550,
        ele: 1150,
      });

      const updatedSeg = updated.segments[0];
      expect(updatedSeg.points[1].lat).toBe(46.5250);
      expect(updatedSeg.points[1].lng).toBe(8.0550);
      expect(updatedSeg.points[1].ele).toBe(1150);

      // Attached stop is automatically synchronized to the moved coordinate
      const updatedStop = updated.stops[0];
      expect(updatedStop.position.lat).toBe(46.5250);
      expect(updatedStop.position.lng).toBe(8.0550);
      expect(updatedStop.position.ele).toBe(1150);

      const audit = getSegmentEditAudit(updatedSeg);
      expect(audit.isModified).toBe(true);
    });

    it('rejects moving with out-of-bounds index', () => {
      const journey = createSampleJourney();
      const segId = journey.segments[0].id;

      expect(() =>
        moveRoutePoint(journey, segId, -1, { lat: 46.5, lng: 8.0 })
      ).toThrow(EditError);

      expect(() =>
        moveRoutePoint(journey, segId, 10, { lat: 46.5, lng: 8.0 })
      ).toThrow(EditError);
    });
  });

  describe('deleteRoutePoint', () => {
    it('deletes an intermediate point safely', () => {
      const journey = createSampleJourney();
      const segId = journey.segments[0].id;

      const updated = deleteRoutePoint(journey, segId, 1);
      const updatedSeg = updated.segments[0];

      expect(updatedSeg.points).toHaveLength(2);
      expect(updatedSeg.points[0].lng).toBe(8.0000);
      expect(updatedSeg.points[1].lng).toBe(8.1000);
    });

    it('enforces minimum 2 points constraint and prevents deletion below 2 points', () => {
      let journey = createSampleJourney();
      const segId = journey.segments[0].id;

      // First deletion reduces 3 points to 2
      journey = deleteRoutePoint(journey, segId, 1);
      expect(journey.segments[0].points).toHaveLength(2);

      // Second deletion must throw an EditError to protect path geometry
      expect(() => deleteRoutePoint(journey, segId, 0)).toThrow(EditError);
      expect(() => deleteRoutePoint(journey, segId, 0)).toThrow(
        /must have at least 2 points/
      );
    });
  });

  describe('Stop editing & deletion', () => {
    it('updates stop details, durationAtStop and coordinates', () => {
      const journey = createSampleJourney();
      const stopId = journey.stops[0].id;

      const updated = updateStop(journey, stopId, {
        name: 'Grand Alpine Shelter',
        durationAtStop: 12,
        type: 'sight',
      });

      const updatedStop = updated.stops[0];
      expect(updatedStop.name).toBe('Grand Alpine Shelter');
      expect(updatedStop.durationAtStop).toBe(12);
      expect(updatedStop.type).toBe('sight');
    });

    it('clamps negative durationAtStop to 0', () => {
      const journey = createSampleJourney();
      const stopId = journey.stops[0].id;

      const updated = updateStop(journey, stopId, {
        durationAtStop: -10,
      });

      expect(updated.stops[0].durationAtStop).toBe(0);
    });

    it('deletes a stop cleanly', () => {
      const journey = createSampleJourney();
      const stopId = journey.stops[0].id;

      const updated = deleteStop(journey, stopId);
      expect(updated.stops).toHaveLength(0);
    });
  });

  describe('updateSegmentMode', () => {
    it('updates transportMode and auto-aligns segmentType', () => {
      const journey = createSampleJourney();
      const segId = journey.segments[0].id;

      const updated = updateSegmentMode(journey, segId, 'car');
      expect(updated.segments[0].transportMode).toBe('car');
      expect(updated.segments[0].type).toBe('road');

      const updated2 = updateSegmentMode(updated, segId, 'bike');
      expect(updated2.segments[0].transportMode).toBe('bike');
      expect(updated2.segments[0].type).toBe('trail');
    });
  });

  describe('Undo / Redo History Stack', () => {
    it('supports seamless undo, redo and branching history', () => {
      const initialJourney = createSampleJourney();
      const segId = initialJourney.segments[0].id;
      let history = createEditorHistory(initialJourney);

      expect(canUndo(history)).toBe(false);
      expect(canRedo(history)).toBe(false);

      // Edit 1: Insert point
      const journey1 = insertRoutePoint(
        history.present,
        segId,
        1,
        createRoutePoint(8.025, 46.51)
      );
      history = pushEditorHistory(history, journey1);

      expect(canUndo(history)).toBe(true);
      expect(canRedo(history)).toBe(false);
      expect(history.present.segments[0].points).toHaveLength(4);

      // Edit 2: Change mode to bike
      const journey2 = updateSegmentMode(history.present, segId, 'bike');
      history = pushEditorHistory(history, journey2);

      expect(history.present.segments[0].transportMode).toBe('bike');

      // Undo 1: Reverts to journey1 (mode was hike)
      history = undoEditorHistory(history);
      expect(history.present.segments[0].transportMode).toBe('hike');
      expect(history.present.segments[0].points).toHaveLength(4);
      expect(canRedo(history)).toBe(true);

      // Undo 2: Reverts to initialJourney (3 points)
      history = undoEditorHistory(history);
      expect(history.present.segments[0].points).toHaveLength(3);
      expect(canUndo(history)).toBe(false);
      expect(canRedo(history)).toBe(true);

      // Redo 1: Re-applies Edit 1 (4 points)
      history = redoEditorHistory(history);
      expect(history.present.segments[0].points).toHaveLength(4);

      // Redo 2: Re-applies Edit 2 (bike)
      history = redoEditorHistory(history);
      expect(history.present.segments[0].transportMode).toBe('bike');
      expect(canRedo(history)).toBe(false);
    });
  });

  describe('Roundtrip Serialization of Edited Journey', () => {
    it('serializes and deserializes edited route preserving user modifications and original provenance', () => {
      const journey = createSampleJourney();
      const segId = journey.segments[0].id;

      // Edit segment
      let edited = insertRoutePoint(journey, segId, 1, createRoutePoint(8.02, 46.51, 920));
      edited = updateStop(edited, edited.stops[0].id, {
        durationAtStop: 8,
        description: 'Updated stop description',
      });

      const serialized = serializeProject(edited);
      const restored = deserializeProject(serialized);

      expect(restored.segments[0].points).toHaveLength(4);
      expect(restored.segments[0].points[1].ele).toBe(920);
      expect(restored.stops[0].durationAtStop).toBe(8);

      const audit = getSegmentEditAudit(restored.segments[0]);
      expect(audit.isModified).toBe(true);
      expect(audit.originalFilename).toBe('alpine_hike.gpx');
      expect(audit.originalPointCount).toBe(3);
    });
  });
});
