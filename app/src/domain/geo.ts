/* ─── Geo Utilities ────────────────────────────────────────────────────
   Pure mathematical functions for geographic calculations.
   No external dependencies.
   ─────────────────────────────────────────────────────────────────── */

import type { RoutePoint } from './types';

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const EARTH_RADIUS_M = 6_371_000;

/** Convert degrees to radians */
export function toRad(deg: number): number {
  return deg * DEG_TO_RAD;
}

/** Convert radians to degrees */
export function toDeg(rad: number): number {
  return rad * RAD_TO_DEG;
}

/** Normalize longitude to -180..180 */
export function normalizeLng(lng: number): number {
  if (!Number.isFinite(lng)) return 0;
  const n = ((lng + 180) % 360 + 360) % 360 - 180;
  return n === -180 && lng > 0 ? 180 : n;
}

/** Shortest longitude delta (handles antimeridian) */
export function shortestLngDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

/**
 * Haversine distance between two points in metres.
 * Standard formula — not copyrightable, common mathematical formula.
 */
export function haversineDistance(a: RoutePoint, b: RoutePoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(shortestLngDelta(a.lng, b.lng));
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = Math.min(1, sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * Compute cumulative distances along a route (in metres).
 * Returns an array of the same length as `points`, where [0] = 0
 * and [i] = total distance from start to point i.
 */
export function computeCumulativeDistances(points: RoutePoint[]): number[] {
  if (points.length === 0) return [];
  const distances = [0];
  for (let i = 1; i < points.length; i++) {
    distances.push(distances[i - 1] + haversineDistance(points[i - 1], points[i]));
  }
  return distances;
}

/** Total distance of a route in metres */
export function totalDistance(points: RoutePoint[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) {
    d += haversineDistance(points[i - 1], points[i]);
  }
  return d;
}

/**
 * Forward bearing from point a to point b, in degrees [0..360).
 */
export function bearing(a: RoutePoint, b: RoutePoint): number {
  const dLng = toRad(shortestLngDelta(a.lng, b.lng));
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Destination point given start point, initial bearing (deg), and distance (metres).
 * Pure spherical geodesics formula.
 */
export function destinationPoint(
  start: RoutePoint,
  bearingDeg: number,
  distanceMeters: number
): RoutePoint {
  if (distanceMeters === 0) return { ...start };
  const dByR = distanceMeters / EARTH_RADIUS_M;
  const brng = toRad(bearingDeg);
  const lat1 = toRad(start.lat);
  const lng1 = toRad(start.lng);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(dByR) +
    Math.cos(lat1) * Math.sin(dByR) * Math.cos(brng)
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(brng) * Math.sin(dByR) * Math.cos(lat1),
    Math.cos(dByR) - Math.sin(lat1) * Math.sin(lat2)
  );

  return {
    lng: normalizeLng(toDeg(lng2)),
    lat: toDeg(lat2),
    ele: start.ele,
  };
}

/**
 * Interpolate position along a route by fractional progress (0..1).
 * Uses cumulative distances for uniform speed.
 * Returns the interpolated RoutePoint and bearing.
 */
export function interpolateRoute(
  points: RoutePoint[],
  cumulativeDistances: number[],
  progress: number,
): { point: RoutePoint; bearing: number } {
  if (points.length === 0) {
    return { point: { lng: 0, lat: 0 }, bearing: 0 };
  }
  if (points.length === 1 || progress <= 0) {
    const p = points[0];
    const b = points.length > 1 ? bearing(points[0], points[1]) : 0;
    return { point: { ...p }, bearing: b };
  }
  if (progress >= 1) {
    const p = points[points.length - 1];
    const b = points.length > 1 ? bearing(points[points.length - 2], points[points.length - 1]) : 0;
    return { point: { ...p }, bearing: b };
  }

  const totalDist = cumulativeDistances[cumulativeDistances.length - 1];
  if (totalDist === 0) {
    return { point: { ...points[0] }, bearing: 0 };
  }

  const targetDist = progress * totalDist;

  // Binary search for segment
  let lo = 0;
  let hi = cumulativeDistances.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cumulativeDistances[mid] <= targetDist) lo = mid;
    else hi = mid;
  }

  const segStart = cumulativeDistances[lo];
  const segEnd = cumulativeDistances[hi];
  const segLen = segEnd - segStart;
  const t = segLen > 0 ? (targetDist - segStart) / segLen : 0;

  const a = points[lo];
  const b_pt = points[hi];

  const lng = a.lng + shortestLngDelta(a.lng, b_pt.lng) * t;
  const lat = a.lat + (b_pt.lat - a.lat) * t;
  const ele = (a.ele != null && b_pt.ele != null)
    ? a.ele + (b_pt.ele - a.ele) * t
    : a.ele ?? b_pt.ele;

  const brng = bearing(a, b_pt);

  return {
    point: { lng: normalizeLng(lng), lat, ele },
    bearing: brng,
  };
}

/**
 * Compute bounds of a set of points.
 */
export function computeBounds(points: RoutePoint[]): {
  minLng: number; maxLng: number;
  minLat: number; maxLat: number;
} | null {
  if (points.length === 0) return null;
  let minLng = Infinity, maxLng = -Infinity;
  let minLat = Infinity, maxLat = -Infinity;
  for (const p of points) {
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
  }
  return { minLng, maxLng, minLat, maxLat };
}
