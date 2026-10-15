/* ─── Journey Domain Tests ─────────────────────────────────────────── */

import { describe, it, expect } from 'vitest';
import {
  createJourney,
  createSegment,
  createStop,
  createRoutePoint,
  addSegmentToJourney,
  addStopToJourney,
  removeSegmentFromJourney,
  removeStopFromJourney,
  journeyFromWaypoints,
  validateJourney,
  getAllPoints,
} from '../domain/journey';
import { SF_TO_LA_WAYPOINTS, MIXED_JOURNEY_WAYPOINTS } from './fixtures';

describe('createJourney', () => {
  it('creates an empty journey with defaults', () => {
    const journey = createJourney('Test Journey', 'A simple description');
    expect(journey.id).toBeTruthy();
    expect(journey.name).toBe('Test Journey');
    expect(journey.description).toBe('A simple description');
    expect(journey.segments).toHaveLength(0);
    expect(journey.stops).toHaveLength(0);
    expect(journey.timeline.duration).toBe(30);
    expect(journey.timeline.fps).toBe(60);
    expect(journey.exportProfiles.length).toBeGreaterThan(0);
  });
});

describe('journeyFromWaypoints', () => {
  it('creates empty journey if waypoints is empty', () => {
    const journey = journeyFromWaypoints('Empty', []);
    expect(journey.segments).toHaveLength(0);
    expect(journey.stops).toHaveLength(0);
  });

  it('builds a pure road journey from waypoints', () => {
    const journey = journeyFromWaypoints('California Roadtrip', SF_TO_LA_WAYPOINTS);
    expect(journey.name).toBe('California Roadtrip');
    expect(journey.segments).toHaveLength(SF_TO_LA_WAYPOINTS.length - 1);
    expect(journey.stops).toHaveLength(SF_TO_LA_WAYPOINTS.length);

    expect(journey.stops[0].type).toBe('start');
    expect(journey.stops[journey.stops.length - 1].type).toBe('end');
    expect(journey.stops[1].type).toBe('waypoint');

    // All segments should be road
    for (const seg of journey.segments) {
      expect(seg.type).toBe('road');
      expect(seg.transportMode).toBe('car');
      expect(seg.points).toHaveLength(2);
    }
  });

  it('builds a unified mixed road and trail journey', () => {
    const journey = journeyFromWaypoints('Swiss Alps Adventure', MIXED_JOURNEY_WAYPOINTS);
    expect(journey.stops).toHaveLength(MIXED_JOURNEY_WAYPOINTS.length);

    // Verify segments correspond to modes
    const segmentModes = journey.segments.map(s => s.transportMode);
    expect(segmentModes).toContain('train');
    expect(segmentModes).toContain('bus');
    expect(segmentModes).toContain('hike');

    // Check hike segments are categorized as trail
    const hikeSegments = journey.segments.filter(s => s.transportMode === 'hike');
    for (const seg of hikeSegments) {
      expect(seg.type).toBe('trail');
    }
  });
});

describe('journey mutations', () => {
  it('adds and removes segments and updates stops indexes', () => {
    let journey = createJourney('Mutation Test');
    const p1 = createRoutePoint(0, 0);
    const p2 = createRoutePoint(1, 1);
    const seg1 = createSegment('road', 'car', [p1, p2]);
    const seg2 = createSegment('trail', 'hike', [p2, createRoutePoint(2, 2)]);

    journey = addSegmentToJourney(journey, seg1);
    journey = addSegmentToJourney(journey, seg2);
    expect(journey.segments).toHaveLength(2);

    const stop1 = createStop('Stop 1', p1, 0, 'start');
    const stop2 = createStop('Stop 2', p2, 1, 'waypoint');
    journey = addStopToJourney(journey, stop1);
    journey = addStopToJourney(journey, stop2);
    expect(journey.stops).toHaveLength(2);

    // Remove first segment
    journey = removeSegmentFromJourney(journey, seg1.id);
    expect(journey.segments).toHaveLength(1);
    expect(journey.segments[0].id).toBe(seg2.id);
    // stop2 segment index should be shifted from 1 to 0
    expect(journey.stops).toHaveLength(1);
    expect(journey.stops[0].segmentIndex).toBe(0);

    // Remove stop
    journey = removeStopFromJourney(journey, journey.stops[0].id);
    expect(journey.stops).toHaveLength(0);
  });
});

describe('getAllPoints', () => {
  it('deduplicates adjacent identical points across segments', () => {
    const p1 = createRoutePoint(0, 0);
    const p2 = createRoutePoint(1, 1);
    const p3 = createRoutePoint(2, 2);

    const seg1 = createSegment('road', 'car', [p1, p2]);
    const seg2 = createSegment('road', 'car', [p2, p3]);

    let journey = createJourney('Points Test');
    journey = addSegmentToJourney(journey, seg1);
    journey = addSegmentToJourney(journey, seg2);

    const all = getAllPoints(journey);
    expect(all).toHaveLength(3); // p1, p2, p3 without duplicating p2
    expect(all[0].lat).toBe(0);
    expect(all[1].lat).toBe(1);
    expect(all[2].lat).toBe(2);
  });
});

describe('validateJourney', () => {
  it('validates a correct journey with no errors', () => {
    const journey = journeyFromWaypoints('Valid Trip', SF_TO_LA_WAYPOINTS);
    const errors = validateJourney(journey);
    expect(errors).toHaveLength(0);
  });

  it('catches missing name and invalid coordinates', () => {
    let journey = createJourney('   ');
    const seg = createSegment('road', 'car', [
      createRoutePoint(200, 100), // invalid lng & lat
      createRoutePoint(0, 0),
    ]);
    journey = addSegmentToJourney(journey, seg);

    const errors = validateJourney(journey);
    expect(errors.some(e => e.field === 'name')).toBe(true);
    expect(errors.some(e => e.field.includes('.lat'))).toBe(true);
    expect(errors.some(e => e.field.includes('.lng'))).toBe(true);
  });
});
