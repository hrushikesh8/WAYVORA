/* ─── Timeline Domain Tests ────────────────────────────────────────── */

import { describe, it, expect } from 'vitest';
import {
  evaluateTimeline,
  generateFrames,
  timeToFrame,
  frameToTime,
} from '../domain/timeline';
import { journeyFromWaypoints, createScene } from '../domain/journey';
import { SF_TO_LA_WAYPOINTS } from './fixtures';

describe('evaluateTimeline', () => {
  const journey = journeyFromWaypoints('California Roadtrip', SF_TO_LA_WAYPOINTS);

  it('evaluates at t = 0 to first point with progress 0', () => {
    const frame = evaluateTimeline(journey, 0);
    expect(frame.progress).toBe(0);
    expect(frame.time).toBe(0);
    expect(frame.position.lng).toBeCloseTo(SF_TO_LA_WAYPOINTS[0].lng);
    expect(frame.position.lat).toBeCloseTo(SF_TO_LA_WAYPOINTS[0].lat);
  });

  it('evaluates at t = duration to last point with progress 1', () => {
    const duration = journey.timeline.duration;
    const frame = evaluateTimeline(journey, duration);
    expect(frame.progress).toBe(1);
    expect(frame.time).toBe(duration);
    const lastWp = SF_TO_LA_WAYPOINTS[SF_TO_LA_WAYPOINTS.length - 1];
    expect(frame.position.lng).toBeCloseTo(lastWp.lng);
    expect(frame.position.lat).toBeCloseTo(lastWp.lat);
  });

  it('clamps negative time and time beyond duration', () => {
    const fMin = evaluateTimeline(journey, -10);
    expect(fMin.time).toBe(0);
    expect(fMin.progress).toBe(0);

    const fMax = evaluateTimeline(journey, 9999);
    expect(fMax.time).toBe(journey.timeline.duration);
    expect(fMax.progress).toBe(1);
  });

  it('is deterministic: same input always yields exact same frame state', () => {
    const f1 = evaluateTimeline(journey, 15);
    const f2 = evaluateTimeline(journey, 15);
    expect(f1).toEqual(f2);
  });

  it('respects scenes and camera parameters', () => {
    const customJourney = {
      ...journey,
      timeline: {
        ...journey.timeline,
        scenes: [
          createScene('Intro Close-Up', 'chase', 0, 0.5),
          createScene('Wide Overview', 'overview', 0.5, 1.0),
        ],
      },
    };

    const frameIntro = evaluateTimeline(customJourney, customJourney.timeline.duration * 0.25);
    expect(frameIntro.scene?.name).toBe('Intro Close-Up');
    expect(frameIntro.scene?.cameraMode).toBe('chase');

    const frameWide = evaluateTimeline(customJourney, customJourney.timeline.duration * 0.75);
    expect(frameWide.scene?.name).toBe('Wide Overview');
    expect(frameWide.scene?.cameraMode).toBe('overview');
  });
});

describe('generateFrames', () => {
  it('generates the expected number of frames for an export', () => {
    const journey = journeyFromWaypoints('Short Journey', SF_TO_LA_WAYPOINTS);
    journey.timeline.duration = 1; // 1 second
    journey.timeline.fps = 10; // 10 fps -> frames 0..10 = 11 frames

    const frames = Array.from(generateFrames(journey));
    expect(frames).toHaveLength(11);
    expect(frames[0].time).toBe(0);
    expect(frames[10].time).toBe(1);
  });
});

describe('timeToFrame & frameToTime', () => {
  it('converts accurately back and forth', () => {
    const fps = 60;
    const time = 2.5;
    const frame = timeToFrame(time, fps);
    expect(frame).toBe(150);
    expect(frameToTime(frame, fps)).toBe(2.5);
  });
});
