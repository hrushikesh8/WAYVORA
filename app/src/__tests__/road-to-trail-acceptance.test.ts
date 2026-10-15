/* ─── WAYVORA Road-to-Trail Acceptance Test & Boundary Suite ─────────
   Comprehensive verification for mixed-modal journeys (road + trail).
   
   GEOGRAPHIC PROVENANCE DISCLAIMER:
   All coordinates and elevations in this test are SYNTHETIC test fixture data,
   modeled on approximate topological relationships of an alpine valley-to-peak
   ascent. They are explicitly marked for testing and NOT real surveyed GIS data.
   ─────────────────────────────────────────────────────────────────── */

import { describe, it, expect } from 'vitest';
import {
  createJourney,
  createSegment,
  createStop,
  createScene,
  validateJourney,
  getAllPoints,
  addSegmentToJourney,
  addStopToJourney,
} from '../domain/journey';
import { evaluateTimeline } from '../domain/timeline';
import {
  serializeProject,
  deserializeProject,
  DeserializationError,
} from '../domain/serialization';
import {
  haversineDistance,
  computeCumulativeDistances,
  interpolateRoute,
  shortestLngDelta,
} from '../domain/geo';
import type { Journey, JourneySegment, Stop, RoutePoint } from '../domain/types';

/**
 * SYNTHETIC FIXTURE: Alpine Road-to-Trail Mixed Journey
 * - Segment 1: Road drive along valley floor (4 points, car mode, low gradient)
 * - Transfer Stop: Stechelberg Trailhead (rest, 15 min gear prep, mode shift)
 * - Segment 2: Denser hiking trail ascent (10 points, hike mode, steep elevation climb)
 */
function createSyntheticMixedJourney(): Journey {
  const journey = createJourney(
    'Synthetic Alpine Valley-to-Peak Mixed Route',
    'Explicit synthetic demonstration data for road-to-trail milestone acceptance testing.'
  );

  journey.timeline.duration = 40; // 40 seconds
  journey.timeline.fps = 60;
  journey.timeline.scenes = [
    createScene('Valley Road Approach', 'overview', 0, 0.35),
    createScene('Trailhead Transition', 'flyover', 0.35, 0.45),
    createScene('Alpine Ridge Ascent', 'chase', 0.45, 1.0),
  ];

  // Segment 1: Road Drive (Valley floor)
  const roadPoints: RoutePoint[] = [
    { lng: 7.9000, lat: 46.6000, ele: 795, time: '2026-07-01T08:00:00Z' },
    { lng: 7.9150, lat: 46.5920, ele: 840, time: '2026-07-01T08:08:00Z' },
    { lng: 7.9280, lat: 46.5810, ele: 890, time: '2026-07-01T08:15:00Z' },
    { lng: 7.9350, lat: 46.5700, ele: 915, time: '2026-07-01T08:22:00Z' }, // Shared transition point
  ];

  const roadSegment: JourneySegment = {
    ...createSegment('road', 'car', roadPoints, 'manual'),
    metadata: {
      provenance: 'synthetic_demonstration_fixture',
      classification: 'Valley Secondary Road',
      speedLimitKmh: 60,
    },
  };

  // Segment 2: Hiking Trail (Steep Ascent)
  const trailPoints: RoutePoint[] = [
    { lng: 7.9350, lat: 46.5700, ele: 915, time: '2026-07-01T08:37:00Z' }, // Shared transition point
    { lng: 7.9380, lat: 46.5680, ele: 1040 },
    { lng: 7.9420, lat: 46.5650, ele: 1180 },
    { lng: 7.9450, lat: 46.5620, ele: 1320 },
    { lng: 7.9490, lat: 46.5590, ele: 1475 },
    { lng: 7.9530, lat: 46.5560, ele: 1650 },
    { lng: 7.9570, lat: 46.5530, ele: 1820 },
    { lng: 7.9620, lat: 46.5500, ele: 1980 },
    { lng: 7.9660, lat: 46.5480, ele: 2110 },
    { lng: 7.9700, lat: 46.5450, ele: 2240, time: '2026-07-01T12:15:00Z' },
  ];

  const trailSegment: JourneySegment = {
    ...createSegment('trail', 'hike', trailPoints, 'manual'),
    metadata: {
      provenance: 'synthetic_demonstration_fixture',
      difficulty: 'T3_mountain_hiking',
      surface: 'rock_and_dirt',
    },
  };

  // Stops
  const stops: Stop[] = [
    {
      ...createStop('Valley Gateway', roadPoints[0], 0, 'start'),
      description: 'Vehicle journey departure',
      durationAtStop: 0,
    },
    {
      ...createStop('Stechelberg Trailhead & Gear Transfer', roadPoints[3], 0, 'rest'),
      description: 'Vehicle parked. 15-minute rest, boots on, trekking poles prepared.',
      durationAtStop: 900, // 15 minutes
    },
    {
      ...createStop('Tree Line Vista Point', trailPoints[4], 1, 'sight'),
      description: 'Panoramic valley viewpoint above tree line',
      durationAtStop: 300,
    },
    {
      ...createStop('Mountain Hut Peak Summit', trailPoints[9], 1, 'end'),
      description: 'Final trail summit destination at 2240m elevation',
      durationAtStop: 0,
    },
  ];

  let res = addSegmentToJourney(journey, roadSegment);
  res = addSegmentToJourney(res, trailSegment);
  for (const st of stops) {
    res = addStopToJourney(res, st);
  }

  return res;
}

describe('Road-to-Trail Mixed Journey Acceptance Test', () => {
  const mixedJourney = createSyntheticMixedJourney();

  it('validates the complete mixed road-to-trail journey with zero errors', () => {
    const errors = validateJourney(mixedJourney);
    expect(errors).toEqual([]);
  });

  it('contains expected multi-modal structure and metadata', () => {
    expect(mixedJourney.segments).toHaveLength(2);
    expect(mixedJourney.segments[0].type).toBe('road');
    expect(mixedJourney.segments[0].transportMode).toBe('car');
    expect(mixedJourney.segments[0].points).toHaveLength(4);
    expect(mixedJourney.segments[0].metadata?.provenance).toBe('synthetic_demonstration_fixture');

    expect(mixedJourney.segments[1].type).toBe('trail');
    expect(mixedJourney.segments[1].transportMode).toBe('hike');
    expect(mixedJourney.segments[1].points).toHaveLength(10);
    expect(mixedJourney.segments[1].metadata?.difficulty).toBe('T3_mountain_hiking');

    expect(mixedJourney.stops).toHaveLength(4);
    expect(mixedJourney.stops[1].type).toBe('rest');
    expect(mixedJourney.stops[1].durationAtStop).toBe(900);
    expect(mixedJourney.stops[1].description).toContain('boots on');
  });

  it('deduplicates the shared transition waypoint between road and trail', () => {
    const allPts = getAllPoints(mixedJourney);
    // 4 points (road) + 10 points (trail) - 1 shared = 13 points
    expect(allPts).toHaveLength(13);

    // Transition point is index 3
    const transitionPt = allPts[3];
    expect(transitionPt.lng).toBe(7.9350);
    expect(transitionPt.lat).toBe(46.5700);
    expect(transitionPt.ele).toBe(915);

    // Next point is the first trail switchback
    const firstSwitchback = allPts[4];
    expect(firstSwitchback.lng).toBe(7.9380);
    expect(firstSwitchback.ele).toBe(1040);
  });

  it('evaluates accurately across timeline progression from road to mountain summit', () => {
    const duration = mixedJourney.timeline.duration;

    // t = 0 (Road start)
    const fStart = evaluateTimeline(mixedJourney, 0);
    expect(fStart.progress).toBe(0);
    expect(fStart.position.lng).toBeCloseTo(7.9000);
    expect(fStart.position.lat).toBeCloseTo(46.6000);
    expect(fStart.position.ele).toBe(795);
    expect(fStart.scene?.name).toBe('Valley Road Approach');

    // t = 10s (Midway through road drive)
    const fMidRoad = evaluateTimeline(mixedJourney, 10);
    expect(fMidRoad.progress).toBeCloseTo(10 / duration);
    expect(fMidRoad.position.ele).toBeGreaterThan(795);
    expect(fMidRoad.position.ele).toBeLessThan(915);

    // t = 40s (Final mountain hut summit)
    const fEnd = evaluateTimeline(mixedJourney, duration);
    expect(fEnd.progress).toBe(1);
    expect(fEnd.position.lng).toBeCloseTo(7.9700);
    expect(fEnd.position.lat).toBeCloseTo(46.5450);
    expect(fEnd.position.ele).toBe(2240);
    expect(fEnd.scene?.name).toBe('Alpine Ridge Ascent');
  });

  it('serializes to versioned .wayvora.json and deserializes without loss', () => {
    const json = serializeProject(mixedJourney);
    expect(typeof json).toBe('string');

    const reloaded = deserializeProject(json);

    // Verify root fields
    expect(reloaded.id).toBe(mixedJourney.id);
    expect(reloaded.name).toBe(mixedJourney.name);
    expect(reloaded.description).toBe(mixedJourney.description);

    // Verify segments & metadata
    expect(reloaded.segments).toHaveLength(2);
    expect(reloaded.segments[0].metadata).toEqual(mixedJourney.segments[0].metadata);
    expect(reloaded.segments[1].metadata).toEqual(mixedJourney.segments[1].metadata);

    // Verify stops & durationAtStop
    expect(reloaded.stops).toHaveLength(4);
    expect(reloaded.stops[1].durationAtStop).toBe(900);
    expect(reloaded.stops[1].description).toBe(mixedJourney.stops[1].description);

    // Re-evaluate at multiple points and ensure exact determinism
    const timeSamples = [0, 5, 12, 20, 28, 35, 40];
    for (const t of timeSamples) {
      const origFrame = evaluateTimeline(mixedJourney, t);
      const reloadedFrame = evaluateTimeline(reloaded, t);

      expect(reloadedFrame.progress).toBeCloseTo(origFrame.progress, 6);
      expect(reloadedFrame.position.lng).toBeCloseTo(origFrame.position.lng, 6);
      expect(reloadedFrame.position.lat).toBeCloseTo(origFrame.position.lat, 6);
      expect(reloadedFrame.position.ele).toBeCloseTo(origFrame.position.ele ?? 0, 6);
      expect(reloadedFrame.bearing).toBeCloseTo(origFrame.bearing, 4);
      expect(reloadedFrame.scene?.name).toBe(origFrame.scene?.name);
    }
  });
});

describe('Boundary Conditions & Robustness Suite', () => {
  it('handles empty journey gracefully in validation and evaluation', () => {
    const emptyJourney = createJourney('Empty Route');
    const errors = validateJourney(emptyJourney);
    expect(errors).toEqual([]); // Empty journey is structurally valid before adding points

    const frame = evaluateTimeline(emptyJourney, 10);
    expect(frame.progress).toBeCloseTo(10 / emptyJourney.timeline.duration);
    expect(frame.position.lng).toBe(0);
    expect(frame.position.lat).toBe(0);
  });

  it('rejects malformed segment with fewer than 2 points', () => {
    const j = createJourney('Malformed');
    const badSeg = createSegment('road', 'car', [{ lng: 10, lat: 20 }]);
    const journeyWithBadSeg = addSegmentToJourney(j, badSeg);

    const errors = validateJourney(journeyWithBadSeg);
    expect(errors.some(e => e.message.includes('at least 2 points'))).toBe(true);
  });

  it('rejects out-of-bounds geographic coordinates', () => {
    const j = createJourney('Invalid Coords');
    const seg = createSegment('road', 'car', [
      { lng: 185.0, lat: 45.0 }, // Invalid lng > 180
      { lng: 10.0, lat: -95.0 }, // Invalid lat < -90
    ]);
    const invalidJourney = addSegmentToJourney(j, seg);

    const errors = validateJourney(invalidJourney);
    expect(errors.some(e => e.field.includes('.lng'))).toBe(true);
    expect(errors.some(e => e.field.includes('.lat'))).toBe(true);
  });

  it('handles routes with missing elevation seamlessly without throwing or NaN', () => {
    const j = createJourney('No Elevation');
    const seg = createSegment('road', 'car', [
      { lng: 8.0, lat: 47.0 }, // No ele
      { lng: 8.5, lat: 47.2 }, // No ele
    ]);
    const noEleJourney = addSegmentToJourney(j, seg);

    const frame = evaluateTimeline(noEleJourney, 15);
    expect(frame.position.ele).toBeUndefined();
    expect(Number.isNaN(frame.position.lat)).toBe(false);
    expect(Number.isNaN(frame.position.lng)).toBe(false);
  });

  it('interpolates elevation when only one endpoint has elevation data', () => {
    const points: RoutePoint[] = [
      { lng: 0, lat: 0, ele: 1000 },
      { lng: 1, lat: 0 }, // ele undefined
    ];
    const dists = computeCumulativeDistances(points);
    const interp = interpolateRoute(points, dists, 0.5);
    // When one point lacks elevation, fallback is the available endpoint elevation
    expect(interp.point.ele).toBe(1000);
  });

  it('rejects invalid timeline duration or fps in validation', () => {
    const j = createJourney('Zero Duration');
    j.timeline.duration = 0;
    j.timeline.fps = -10;

    const errors = validateJourney(j);
    expect(errors.some(e => e.field === 'timeline.duration')).toBe(true);
    expect(errors.some(e => e.field === 'timeline.fps')).toBe(true);
  });

  it('safely handles timeline evaluation when duration is zero without division by zero', () => {
    const j = createJourney('Zero Dur Test');
    j.timeline.duration = 0;
    const frame = evaluateTimeline(j, 5);
    expect(frame.progress).toBe(0);
    expect(Number.isFinite(frame.progress)).toBe(true);
  });

  it('handles antimeridian crossing accurately across 180° meridian', () => {
    const ptA: RoutePoint = { lng: 179.5, lat: -16.5 };
    const ptB: RoutePoint = { lng: -179.5, lat: -16.5 };

    // Shortest delta across date line should be 1.0 degree, NOT 359 degrees
    const delta = shortestLngDelta(ptA.lng, ptB.lng);
    expect(delta).toBeCloseTo(1.0, 4);

    // Distance should be ~106 km, NOT ~39,000 km
    const dist = haversineDistance(ptA, ptB);
    expect(dist).toBeGreaterThan(100_000);
    expect(dist).toBeLessThan(120_000);

    // Route interpolation at 50% must cross the antimeridian line (180° or -180°)
    const pts = [ptA, ptB];
    const dists = computeCumulativeDistances(pts);
    const mid = interpolateRoute(pts, dists, 0.5);
    expect(Math.abs(mid.point.lng)).toBeCloseTo(180, 2);
  });

  it('rejects corrupted JSON and version anomalies in deserialization', () => {
    expect(() => deserializeProject('')).toThrow(DeserializationError);
    expect(() => deserializeProject('{ invalid: json }')).toThrow(DeserializationError);
    expect(() => deserializeProject('null')).toThrow(DeserializationError);
    expect(() => deserializeProject(JSON.stringify({ version: 2, journey: {} }))).toThrow(
      DeserializationError
    );
  });
});
