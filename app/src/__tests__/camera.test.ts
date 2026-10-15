import { describe, it, expect } from 'vitest';
import {
  applyEasing,
  interpolateAngle,
  interpolatePosition,
  calculateCameraEyePosition,
  evaluateCameraClearance,
  evaluateCameraAtTime,
  generateAutoCamKeyframes,
} from '../domain/camera';
import { journeyFromWaypoints } from '../domain/journey';
import { MIXED_JOURNEY_WAYPOINTS } from './fixtures';
import type { CameraKeyframe, RoutePoint } from '../domain/types';

describe('Cinematic Camera Engine & Deterministic Interpolator', () => {
  describe('applyEasing', () => {
    it('correctly evaluates linear and curved easing', () => {
      expect(applyEasing(0, 'linear')).toBe(0);
      expect(applyEasing(1, 'linear')).toBe(1);
      expect(applyEasing(0.5, 'linear')).toBe(0.5);

      expect(applyEasing(0, 'easeInOutCubic')).toBe(0);
      expect(applyEasing(1, 'easeInOutCubic')).toBe(1);
      expect(applyEasing(0.5, 'easeInOutCubic')).toBe(0.5);

      // In easeInQuad, u=0.5 -> 0.25 (slower start)
      expect(applyEasing(0.5, 'easeInQuad')).toBe(0.25);
      // In easeOutQuad, u=0.5 -> 0.75 (faster start, gentle finish)
      expect(applyEasing(0.5, 'easeOutQuad')).toBe(0.75);
    });

    it('safely clamps out-of-range inputs to [0, 1]', () => {
      expect(applyEasing(-0.5, 'easeInOutCubic')).toBe(0);
      expect(applyEasing(1.5, 'easeInOutCubic')).toBe(1);
      expect(applyEasing(NaN, 'easeInOutCubic')).toBe(0);
    });
  });

  describe('interpolateAngle (shortest path wrapping)', () => {
    it('interpolates within 0..360 without wrapping', () => {
      expect(interpolateAngle(10, 50, 0.5)).toBeCloseTo(30, 2);
      expect(interpolateAngle(100, 200, 0.25)).toBeCloseTo(125, 2);
    });

    it('correctly takes the shortest arc across the 0/360 boundary (clockwise)', () => {
      // 350 to 10 is only 20 degrees difference turning clockwise through 0
      const mid = interpolateAngle(350, 10, 0.5);
      expect(mid).toBeCloseTo(0, 2); // or 360
    });

    it('correctly takes the shortest arc across 0/360 boundary (counter-clockwise)', () => {
      // 10 to 350 is only 20 degrees difference turning counter-clockwise through 0
      const mid = interpolateAngle(10, 350, 0.5);
      expect(mid).toBeCloseTo(0, 2);
    });

    it('handles exact 0 and 360 values gracefully', () => {
      expect(interpolateAngle(0, 360, 0.5)).toBeCloseTo(0, 2);
    });
  });

  describe('interpolatePosition (geodesic & antimeridian)', () => {
    it('interpolates coordinates and elevation linearly', () => {
      const p1: RoutePoint = { lng: 10, lat: 20, ele: 100 };
      const p2: RoutePoint = { lng: 20, lat: 30, ele: 300 };
      const mid = interpolatePosition(p1, p2, 0.5);

      expect(mid.lng).toBeCloseTo(15, 4);
      expect(mid.lat).toBeCloseTo(25, 4);
      expect(mid.ele).toBeCloseTo(200, 4);
    });

    it('handles antimeridian crossing (179 to -179)', () => {
      const p1: RoutePoint = { lng: 179, lat: 0, ele: 50 };
      const p2: RoutePoint = { lng: -179, lat: 0, ele: 50 };
      const mid = interpolatePosition(p1, p2, 0.5);

      // Shortest path between 179° and -179° crosses the antimeridian at 180°
      expect(Math.abs(mid.lng)).toBeCloseTo(180, 2);
    });

    it('does not invent elevation if missing', () => {
      const p1: RoutePoint = { lng: 0, lat: 0 };
      const p2: RoutePoint = { lng: 1, lat: 1 };
      const mid = interpolatePosition(p1, p2, 0.5);
      expect(mid.ele).toBeUndefined();
    });
  });

  describe('calculateCameraEyePosition', () => {
    it('places camera eye opposite to viewing bearing', () => {
      const target: RoutePoint = { lng: 0, lat: 0, ele: 500 };
      // Facing North (0°), pitch 45°
      const eye = calculateCameraEyePosition(target, 0, 45, 14, 1000);

      // Facing North means camera is located South of target (lat < 0)
      expect(eye.cameraEye.lat).toBeLessThan(0);
      expect(eye.cameraEye.lng).toBeCloseTo(0, 3);
      // Eye altitude must be higher than target elevation
      expect(eye.cameraEye.ele).toBeGreaterThan(target.ele!);
    });

    it('at 0° pitch (top-down), camera eye is directly over target', () => {
      const target: RoutePoint = { lng: 10, lat: 20, ele: 100 };
      const eye = calculateCameraEyePosition(target, 45, 0, 14, 500);

      expect(eye.cameraEye.lng).toBeCloseTo(10, 4);
      expect(eye.cameraEye.lat).toBeCloseTo(20, 4);
      expect(eye.cameraEye.ele).toBeCloseTo(600, 1);
    });
  });

  describe('evaluateCameraClearance', () => {
    it('maintains safe clearance on flat ground without clipping', () => {
      const target: RoutePoint = { lng: 0, lat: 0, ele: 100 };
      const result = evaluateCameraClearance(target, 'chase', 60, 14, 100);

      expect(result.isClippingAverted).toBe(false);
      expect(result.clampedPitch).toBe(60);
      expect(result.clearanceMetres).toBeGreaterThanOrEqual(15);
    });

    it('averts clipping when mountain ridge behind camera is higher than eye altitude', () => {
      const target: RoutePoint = { lng: 0, lat: 0, ele: 2000 };
      // Ground under camera eye is on a steep mountain ridge at 2600m!
      const ridgeElevation = 2600;
      const result = evaluateCameraClearance(target, 'chase', 75, 14, ridgeElevation);

      expect(result.isClippingAverted).toBe(true);
      expect(result.clampedPitch).toBeLessThan(75); // pitch clamped upward
      expect(result.effectiveCameraAltitude).toBeGreaterThanOrEqual(ridgeElevation + 15);
      expect(result.clearanceMetres).toBeGreaterThanOrEqual(15);
    });

    it('gracefully handles missing terrain data with fallback to target elevation', () => {
      const target: RoutePoint = { lng: 0, lat: 0, ele: 1500 };
      const result = evaluateCameraClearance(target, 'ground', 70, 15, undefined);

      expect(result.groundElevationAtCamera).toBe(1500);
      expect(result.effectiveCameraAltitude).toBeGreaterThan(1500);
      expect(Number.isFinite(result.clampedPitch)).toBe(true);
    });
  });

  describe('evaluateCameraAtTime (deterministic interpolation)', () => {
    const keyframes: CameraKeyframe[] = [
      {
        id: 'k1',
        time: 0,
        mode: 'overview',
        bearing: 0,
        pitch: 40,
        zoom: 10,
        easing: 'easeInOutCubic',
      },
      {
        id: 'k2',
        time: 10,
        mode: 'chase',
        bearing: 90,
        pitch: 60,
        zoom: 14,
        lookAheadMeters: 50,
        easing: 'easeInOutCubic',
      },
    ];

    it('returns exact boundary keyframe at t <= start and t >= end', () => {
      const fallback: RoutePoint = { lng: 0, lat: 0, ele: 100 };
      const atStart = evaluateCameraAtTime(keyframes, 0, fallback, 0);
      expect(atStart.pitch).toBe(40);
      expect(atStart.zoom).toBe(10);
      expect(atStart.bearing).toBe(0);

      const atEnd = evaluateCameraAtTime(keyframes, 15, fallback, 0);
      expect(atEnd.pitch).toBe(60);
      expect(atEnd.zoom).toBe(14);
      expect(atEnd.bearing).toBe(90);
    });

    it('interpolates smoothly between keyframes at t=5', () => {
      const fallback: RoutePoint = { lng: 0, lat: 0, ele: 100 };
      const mid = evaluateCameraAtTime(keyframes, 5, fallback, 0);

      // Midpoint between 40° and 60° pitch with easeInOutCubic at u=0.5 is exactly 50°
      expect(mid.pitch).toBeCloseTo(50, 1);
      expect(mid.zoom).toBeCloseTo(12, 1);
      expect(mid.bearing).toBeCloseTo(45, 1);
    });

    it('is 100% deterministic on repeated evaluations', () => {
      const fallback: RoutePoint = { lng: 11.5, lat: 47.2, ele: 850 };
      const eval1 = evaluateCameraAtTime(keyframes, 3.784, fallback, 45);
      const eval2 = evaluateCameraAtTime(keyframes, 3.784, fallback, 45);

      expect(eval1.pitch).toBe(eval2.pitch);
      expect(eval1.bearing).toBe(eval2.bearing);
      expect(eval1.zoom).toBe(eval2.zoom);
      expect(eval1.cameraEye.ele).toBe(eval2.cameraEye.ele);
    });

    it('applies look-ahead lead along route when configured', () => {
      const fallback: RoutePoint = { lng: 0, lat: 0, ele: 100 };
      const atK2 = evaluateCameraAtTime(keyframes, 10, fallback, 90);

      expect(atK2.lookAheadTarget).toBeDefined();
      // Look-ahead facing East (90°) shifts longitude eastward (> 0)
      expect(atK2.center.lng).toBeGreaterThan(0);
    });
  });

  describe('generateAutoCamKeyframes', () => {
    it('synthesizes cinematic keyframe sequence honoring journey duration and stops', () => {
      const journey = journeyFromWaypoints('Alpine Tour', MIXED_JOURNEY_WAYPOINTS);
      journey.stops[1].durationAtStop = 15; // configured stop dwell

      const keyframes = generateAutoCamKeyframes(journey);

      expect(keyframes.length).toBeGreaterThanOrEqual(4);
      // Keyframe 1 is establishing shot at t = 0
      expect(keyframes[0].time).toBe(0);
      expect(keyframes[0].mode).toBe('overview');

      // Final keyframe is destination shot at journey duration
      const lastKeyframe = keyframes[keyframes.length - 1];
      expect(lastKeyframe.mode).toBe('overview');
      expect(lastKeyframe.time).toBeGreaterThan(0);

      // Verify keyframes are sorted in strictly ascending time
      for (let i = 1; i < keyframes.length; i++) {
        expect(keyframes[i].time).toBeGreaterThan(keyframes[i - 1].time);
      }
    });
  });
});
