/* ─── Geo Utilities Tests ──────────────────────────────────────────── */

import { describe, it, expect } from 'vitest';
import {
  haversineDistance,
  computeCumulativeDistances,
  totalDistance,
  bearing,
  interpolateRoute,
  normalizeLng,
  shortestLngDelta,
  computeBounds,
} from '../domain/geo';
import { LONDON, PARIS, NEW_YORK, EQUATOR_ROUTE } from './fixtures';

describe('haversineDistance', () => {
  it('London to Paris ≈ 343 km', () => {
    const dist = haversineDistance(LONDON, PARIS);
    expect(dist).toBeGreaterThan(340_000);
    expect(dist).toBeLessThan(350_000);
  });

  it('same point returns 0', () => {
    expect(haversineDistance(LONDON, LONDON)).toBe(0);
  });

  it('London to New York ≈ 5,570 km', () => {
    const dist = haversineDistance(LONDON, NEW_YORK);
    expect(dist).toBeGreaterThan(5_500_000);
    expect(dist).toBeLessThan(5_600_000);
  });

  it('handles antimeridian crossing', () => {
    const a = { lng: 179, lat: 0 };
    const b = { lng: -179, lat: 0 };
    const dist = haversineDistance(a, b);
    // 2 degrees at equator ≈ 222 km
    expect(dist).toBeGreaterThan(200_000);
    expect(dist).toBeLessThan(250_000);
  });
});

describe('normalizeLng', () => {
  it('passes through valid values', () => {
    expect(normalizeLng(0)).toBe(0);
    expect(normalizeLng(90)).toBe(90);
    expect(normalizeLng(-90)).toBe(-90);
  });

  it('wraps values > 180', () => {
    expect(normalizeLng(181)).toBeCloseTo(-179);
    expect(normalizeLng(360)).toBeCloseTo(0);
    expect(normalizeLng(540)).toBeCloseTo(180);
  });

  it('wraps values < -180', () => {
    expect(normalizeLng(-181)).toBeCloseTo(179);
    expect(normalizeLng(-360)).toBeCloseTo(0);
  });

  it('handles NaN and Infinity', () => {
    expect(normalizeLng(NaN)).toBe(0);
    expect(normalizeLng(Infinity)).toBe(0);
  });
});

describe('shortestLngDelta', () => {
  it('simple delta', () => {
    expect(shortestLngDelta(0, 10)).toBeCloseTo(10);
    expect(shortestLngDelta(10, 0)).toBeCloseTo(-10);
  });

  it('antimeridian: shortest path is across the date line', () => {
    expect(shortestLngDelta(170, -170)).toBeCloseTo(20);
    expect(shortestLngDelta(-170, 170)).toBeCloseTo(-20);
  });
});

describe('bearing', () => {
  it('due east along equator', () => {
    const b = bearing({ lng: 0, lat: 0 }, { lng: 10, lat: 0 });
    expect(b).toBeCloseTo(90, 0);
  });

  it('due north', () => {
    const b = bearing({ lng: 0, lat: 0 }, { lng: 0, lat: 10 });
    expect(b).toBeCloseTo(0, 0);
  });

  it('due south', () => {
    const b = bearing({ lng: 0, lat: 10 }, { lng: 0, lat: 0 });
    expect(b).toBeCloseTo(180, 0);
  });
});

describe('computeCumulativeDistances', () => {
  it('empty array returns empty', () => {
    expect(computeCumulativeDistances([])).toEqual([]);
  });

  it('single point returns [0]', () => {
    expect(computeCumulativeDistances([LONDON])).toEqual([0]);
  });

  it('monotonically increasing', () => {
    const dists = computeCumulativeDistances(EQUATOR_ROUTE);
    expect(dists).toHaveLength(EQUATOR_ROUTE.length);
    expect(dists[0]).toBe(0);
    for (let i = 1; i < dists.length; i++) {
      expect(dists[i]).toBeGreaterThan(dists[i - 1]);
    }
  });
});

describe('totalDistance', () => {
  it('empty returns 0', () => {
    expect(totalDistance([])).toBe(0);
  });

  it('equator route ≈ 1,113 km (10 degrees)', () => {
    const dist = totalDistance(EQUATOR_ROUTE);
    // 10 degrees at equator ≈ 1,113 km
    expect(dist).toBeGreaterThan(1_100_000);
    expect(dist).toBeLessThan(1_120_000);
  });
});

describe('interpolateRoute', () => {
  const dists = computeCumulativeDistances(EQUATOR_ROUTE);

  it('progress=0 returns first point', () => {
    const result = interpolateRoute(EQUATOR_ROUTE, dists, 0);
    expect(result.point.lng).toBeCloseTo(0);
    expect(result.point.lat).toBeCloseTo(0);
  });

  it('progress=1 returns last point', () => {
    const result = interpolateRoute(EQUATOR_ROUTE, dists, 1);
    expect(result.point.lng).toBeCloseTo(10);
    expect(result.point.lat).toBeCloseTo(0);
  });

  it('progress=0.5 returns midpoint ≈ lng 5', () => {
    const result = interpolateRoute(EQUATOR_ROUTE, dists, 0.5);
    expect(result.point.lng).toBeCloseTo(5, 0);
    expect(result.point.lat).toBeCloseTo(0);
  });

  it('bearing is approximately east for equator route', () => {
    const result = interpolateRoute(EQUATOR_ROUTE, dists, 0.5);
    expect(result.bearing).toBeCloseTo(90, 0);
  });

  it('handles empty route', () => {
    const result = interpolateRoute([], [], 0.5);
    expect(result.point.lng).toBe(0);
    expect(result.point.lat).toBe(0);
  });

  it('handles single point route', () => {
    const result = interpolateRoute([LONDON], [0], 0.5);
    expect(result.point.lng).toBeCloseTo(LONDON.lng);
    expect(result.point.lat).toBeCloseTo(LONDON.lat);
  });

  it('clamps progress < 0 to start', () => {
    const result = interpolateRoute(EQUATOR_ROUTE, dists, -0.5);
    expect(result.point.lng).toBeCloseTo(0);
  });

  it('clamps progress > 1 to end', () => {
    const result = interpolateRoute(EQUATOR_ROUTE, dists, 1.5);
    expect(result.point.lng).toBeCloseTo(10);
  });

  it('interpolates elevation', () => {
    const points = [
      { lng: 0, lat: 0, ele: 100 },
      { lng: 10, lat: 0, ele: 200 },
    ];
    const d = computeCumulativeDistances(points);
    const result = interpolateRoute(points, d, 0.5);
    expect(result.point.ele).toBeCloseTo(150, 0);
  });
});

describe('computeBounds', () => {
  it('returns null for empty', () => {
    expect(computeBounds([])).toBeNull();
  });

  it('computes bounds of equator route', () => {
    const bounds = computeBounds(EQUATOR_ROUTE)!;
    expect(bounds.minLng).toBe(0);
    expect(bounds.maxLng).toBe(10);
    expect(bounds.minLat).toBe(0);
    expect(bounds.maxLat).toBe(0);
  });

  it('computes bounds of London and Paris', () => {
    const bounds = computeBounds([LONDON, PARIS])!;
    expect(bounds.minLng).toBeCloseTo(LONDON.lng);
    expect(bounds.maxLng).toBeCloseTo(PARIS.lng);
    expect(bounds.minLat).toBeCloseTo(PARIS.lat);
    expect(bounds.maxLat).toBeCloseTo(LONDON.lat);
  });
});
