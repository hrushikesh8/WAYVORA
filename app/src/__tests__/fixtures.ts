/* ─── Test Fixtures ────────────────────────────────────────────────────
   Clearly labelled test data for domain model tests.
   These are synthetic coordinates — not fabricated real geography.
   ─────────────────────────────────────────────────────────────────── */

import type { RoutePoint, WaypointInput } from '../domain/types';

/**
 * Test fixture: A road journey from San Francisco to Los Angeles.
 * Coordinates are approximate city centers — used only for testing
 * distance calculations and route interpolation.
 */
export const SF_TO_LA_WAYPOINTS: WaypointInput[] = [
  { name: 'San Francisco', lng: -122.4194, lat: 37.7749, mode: 'car' },
  { name: 'San Jose', lng: -121.8863, lat: 37.3382, mode: 'car' },
  { name: 'Fresno', lng: -119.7871, lat: 36.7378, mode: 'car' },
  { name: 'Bakersfield', lng: -119.0187, lat: 35.3733, mode: 'car' },
  { name: 'Los Angeles', lng: -118.2437, lat: 34.0522, mode: 'car' },
];

/**
 * Test fixture: A mixed journey with road and trail segments.
 * This is the key test case for Wayvora's unified journey model.
 */
export const MIXED_JOURNEY_WAYPOINTS: WaypointInput[] = [
  { name: 'Zurich', lng: 8.5417, lat: 47.3769 },
  { name: 'Interlaken', lng: 7.8632, lat: 46.6863, mode: 'train' },
  { name: 'Grindelwald', lng: 8.0413, lat: 46.6243, mode: 'bus' },
  { name: 'First Summit', lng: 8.0573, lat: 46.6590, ele: 2168, mode: 'hike' },
  { name: 'Bachalpsee', lng: 8.0282, lat: 46.6716, ele: 2265, mode: 'hike' },
  { name: 'Grindelwald Return', lng: 8.0413, lat: 46.6243, mode: 'hike' },
  { name: 'Zurich Return', lng: 8.5417, lat: 47.3769, mode: 'train' },
];

/**
 * Test fixture: A simple two-point segment for basic geo testing.
 */
export const LONDON: RoutePoint = { lng: -0.1276, lat: 51.5072 };
export const PARIS: RoutePoint = { lng: 2.3522, lat: 48.8566 };
export const NEW_YORK: RoutePoint = { lng: -74.006, lat: 40.7128 };
export const TOKYO: RoutePoint = { lng: 139.6917, lat: 35.6895 };

/**
 * A simple straight-line route for interpolation testing.
 * Points along the equator at 0°N, from 0°E to 10°E.
 */
export const EQUATOR_ROUTE: RoutePoint[] = [
  { lng: 0, lat: 0 },
  { lng: 2, lat: 0 },
  { lng: 5, lat: 0 },
  { lng: 8, lat: 0 },
  { lng: 10, lat: 0 },
];
