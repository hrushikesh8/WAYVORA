/* ─── Stop-Aware Playback Unit & Acceptance Tests ───────────────────── */

import { describe, it, expect } from 'vitest';
import {
  evaluateTimeline,
  computeTimelineSchedule,
  getEffectiveDuration,
  generateFrames,
} from '../domain/timeline';
import {
  createJourney,
  createSegment,
  createRoutePoint,
  createStop,
  addSegmentToJourney,
  addStopToJourney,
} from '../domain/journey';
import type { Journey, RoutePoint } from '../domain/types';

describe('Stop-Aware Deterministic Playback', () => {
  // Build a test journey: 2 segments (Road + Trail) with intermediate rest stop
  function createTestJourneyWithDwell(): Journey {
    let journey = createJourney('Alpine Expedition', 'Test route with scheduled dwell');
    journey.timeline.duration = 30; // 30s base timeline
    journey.timeline.stopDwell = true;

    // Segment 0: Valley Drive (2 points, ~10km)
    const seg0Points: RoutePoint[] = [
      createRoutePoint(8.0000, 46.6000, 800),
      createRoutePoint(8.1000, 46.6000, 1000),
    ];
    const seg0 = createSegment('road', 'car', seg0Points, 'manual');
    journey = addSegmentToJourney(journey, seg0);

    // Stop 0: Valley Departure (start, no dwell)
    journey = addStopToJourney(
      journey,
      createStop('Valley Start', seg0Points[0], 0, 'start')
    );

    // Stop 1: Trailhead Hub (rest stop with 6 seconds dwell)
    const trailheadStop = {
      ...createStop('Trailhead Hub', seg0Points[1], 0, 'rest'),
      durationAtStop: 6, // 6 seconds dwell
    };
    journey = addStopToJourney(journey, trailheadStop);

    // Segment 1: Mountain Trail (2 points, ~10km)
    const seg1Points: RoutePoint[] = [
      createRoutePoint(8.1000, 46.6000, 1000),
      createRoutePoint(8.2000, 46.6000, 2200),
    ];
    const seg1 = createSegment('trail', 'hike', seg1Points, 'manual');
    journey = addSegmentToJourney(journey, seg1);

    // Stop 2: Mountain Summit (end stop with 4 seconds dwell)
    const summitStop = {
      ...createStop('Mountain Summit', seg1Points[1], 1, 'end'),
      durationAtStop: 4, // 4 seconds dwell
    };
    journey = addStopToJourney(journey, summitStop);

    return journey;
  }

  it('computes timeline schedule with motion and dwell phases', () => {
    const journey = createTestJourneyWithDwell();
    const schedule = computeTimelineSchedule(journey);

    expect(schedule.dwellDuration).toBe(10); // 6s + 4s
    expect(schedule.motionDuration).toBe(20); // 30s total - 10s dwell = 20s motion
    expect(schedule.totalDuration).toBe(30);

    // Phases:
    // Phase 0: Move to Trailhead (progress 0 -> 0.5, duration 10s: t=0..10)
    // Phase 1: Dwell at Trailhead (duration 6s: t=10..16)
    // Phase 2: Move to Summit (progress 0.5 -> 1.0, duration 10s: t=16..26)
    // Phase 3: Dwell at Summit (duration 4s: t=26..30)
    expect(schedule.phases).toHaveLength(4);
    expect(schedule.phases[0].type).toBe('move');
    expect(schedule.phases[0].startTime).toBe(0);
    expect(schedule.phases[0].endTime).toBeCloseTo(10);

    expect(schedule.phases[1].type).toBe('dwell');
    expect(schedule.phases[1].startTime).toBeCloseTo(10);
    expect(schedule.phases[1].endTime).toBeCloseTo(16);
    expect((schedule.phases[1] as any).stop.name).toBe('Trailhead Hub');

    expect(schedule.phases[2].type).toBe('move');
    expect(schedule.phases[2].startTime).toBeCloseTo(16);
    expect(schedule.phases[2].endTime).toBeCloseTo(26);

    expect(schedule.phases[3].type).toBe('dwell');
    expect(schedule.phases[3].startTime).toBeCloseTo(26);
    expect(schedule.phases[3].endTime).toBeCloseTo(30);
    expect((schedule.phases[3] as any).stop.name).toBe('Mountain Summit');
  });

  it('dwells at stops deterministically with zero motion and accurate dwell progress', () => {
    const journey = createTestJourneyWithDwell();

    // 1. Before dwell (t = 5s): Moving along road
    const fBefore = evaluateTimeline(journey, 5);
    expect(fBefore.isDwelling).toBe(false);
    expect(fBefore.activeStop).toBeNull();
    expect(fBefore.progress).toBeCloseTo(0.25);
    expect(fBefore.position.lng).toBeCloseTo(8.05);

    // 2. Exactly at start of dwell (t = 10s)
    const fDwellStart = evaluateTimeline(journey, 10);
    expect(fDwellStart.isDwelling).toBe(true);
    expect(fDwellStart.activeStop?.name).toBe('Trailhead Hub');
    expect(fDwellStart.position.lng).toBeCloseTo(8.1000);
    expect(fDwellStart.position.ele).toBe(1000);
    expect(fDwellStart.dwellProgress).toBeCloseTo(0);

    // 3. Midway through dwell (t = 13s, 3s into 6s dwell)
    const fDwellMid = evaluateTimeline(journey, 13);
    expect(fDwellMid.isDwelling).toBe(true);
    expect(fDwellMid.activeStop?.name).toBe('Trailhead Hub');
    expect(fDwellMid.position.lng).toBeCloseTo(8.1000);
    expect(fDwellMid.position.ele).toBe(1000);
    expect(fDwellMid.dwellProgress).toBeCloseTo(0.5);

    // 4. Exactly at end of dwell (t = 16s)
    const fDwellEnd = evaluateTimeline(journey, 16);
    expect(fDwellEnd.position.lng).toBeCloseTo(8.1000);

    // 5. After dwell (t = 21s): Moving up trail
    const fAfter = evaluateTimeline(journey, 21);
    expect(fAfter.isDwelling).toBe(false);
    expect(fAfter.activeStop).toBeNull();
    expect(fAfter.progress).toBeCloseTo(0.75);
    expect(fAfter.position.lng).toBeCloseTo(8.15);
    expect(fAfter.position.ele).toBeCloseTo(1600);

    // 6. Final summit dwell (t = 28s, 2s into 4s summit dwell)
    const fSummit = evaluateTimeline(journey, 28);
    expect(fSummit.isDwelling).toBe(true);
    expect(fSummit.activeStop?.name).toBe('Mountain Summit');
    expect(fSummit.position.lng).toBeCloseTo(8.2000);
    expect(fSummit.position.ele).toBe(2200);
    expect(fSummit.dwellProgress).toBeCloseTo(0.5);
  });

  it('supports seeking back and forth across dwell boundaries with deterministic reversibility', () => {
    const journey = createTestJourneyWithDwell();

    const tSeek = 12.5;
    const frameA = evaluateTimeline(journey, tSeek);
    const frameB = evaluateTimeline(journey, tSeek);

    expect(frameA).toEqual(frameB);
    expect(frameA.isDwelling).toBe(true);
    expect(frameA.dwellProgress).toBeCloseTo((12.5 - 10) / 6);
  });

  it('handles stops with missing elevation or timestamps without producing NaNs', () => {
    let journey = createJourney('Missing Data Route');
    journey.timeline.duration = 20;
    journey.timeline.stopDwell = true;

    // Points with no elevation and no time
    const points: RoutePoint[] = [
      createRoutePoint(2.3522, 48.8566), // Paris (no ele)
      createRoutePoint(4.8357, 45.7640), // Lyon (no ele)
    ];
    const seg = createSegment('road', 'car', points, 'manual');
    journey = addSegmentToJourney(journey, seg);

    // Stop with 5s dwell and no elevation
    const stop = {
      ...createStop('Midway Rest', points[0], 0, 'rest'),
      durationAtStop: 5,
    };
    journey = addStopToJourney(journey, stop);

    const f1 = evaluateTimeline(journey, 2.5);
    expect(f1.position.lng).toBeDefined();
    expect(Number.isNaN(f1.position.lng)).toBe(false);
    expect(Number.isNaN(f1.position.lat)).toBe(false);
    expect(f1.position.ele).toBeUndefined(); // no elevation without NaN

    const f2 = evaluateTimeline(journey, 15);
    expect(Number.isNaN(f2.position.lng)).toBe(false);
    expect(Number.isNaN(f2.bearing)).toBe(false);
  });

  it('expands total timeline duration when dwell times exceed configured timeline duration', () => {
    let journey = createJourney('Heavy Rest Route');
    journey.timeline.duration = 10; // small 10s budget
    journey.timeline.stopDwell = true;

    const points = [createRoutePoint(0, 0, 0), createRoutePoint(1, 1, 100)];
    journey = addSegmentToJourney(journey, createSegment('trail', 'hike', points));

    // Two stops with 15s dwell each = 30s total dwell
    journey = addStopToJourney(journey, {
      ...createStop('Stop 1', points[0], 0, 'rest'),
      durationAtStop: 15,
    });
    journey = addStopToJourney(journey, {
      ...createStop('Stop 2', points[1], 0, 'rest'),
      durationAtStop: 15,
    });

    const effDuration = getEffectiveDuration(journey);
    // Must expand to accommodate motion (min 10s) + 30s dwell = 40s
    expect(effDuration).toBe(40);

    const fEnd = evaluateTimeline(journey, effDuration);
    expect(fEnd.time).toBe(40);
    expect(fEnd.isDwelling).toBe(true);
    expect(fEnd.position.lng).toBe(1);
  });

  it('generates export frames accurately including dwell frames', () => {
    const journey = createTestJourneyWithDwell();
    journey.timeline.duration = 4;
    journey.timeline.fps = 2; // 8 frames total
    // Stop with 2s dwell
    journey.stops[1].durationAtStop = 2;

    const frames = Array.from(generateFrames(journey));
    expect(frames.length).toBeGreaterThan(0);

    // Check that at least some frames have isDwelling === true
    const dwellingFrames = frames.filter((f) => f.isDwelling);
    expect(dwellingFrames.length).toBeGreaterThan(0);
    expect(dwellingFrames[0].activeStop).toBeDefined();
  });
});
