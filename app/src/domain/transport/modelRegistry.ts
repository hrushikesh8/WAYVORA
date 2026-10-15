/* ─── 3D Transport Model Registry & Licensing ──────────────────────────
   Centralized registry for 3D glTF/GLB transport models across all 8 canonical
   modes. Missing, unsupported, or unloaded models fall back deterministically
   to 2D vector silhouettes.
   ─────────────────────────────────────────────────────────────────── */

import { MercatorCoordinate } from 'maplibre-gl';
import type { RoutePoint } from '../types';
import type { CanonicalTransportMode, TransportRenderMode } from './types';

export interface TransportModelDefinition {
  mode: CanonicalTransportMode;
  name: string;
  category: 'road' | 'trail' | 'rail' | 'water' | 'air';
  /** Path to glTF/GLB asset under public folder, or undefined if using 2D fallback */
  modelUrl?: string;
  /** Uniform scale multiplier applied to model in real-world metres */
  scale: number;
  /** Base Euler rotation offset [pitch, roll, yaw] in degrees to stand model upright and face North */
  rotationOffset: [number, number, number];
  /** Vertical elevation offset in metres above ground / water surface */
  elevationOffsetMeters: number;
  /** Maximum allowable pitch in degrees along slope/elevation changes */
  maxPitchDegrees: number;
  /** Legal license description */
  license: string;
  /** Mandatory copyright and attribution string */
  attribution: string;
  /** Model author / source creator */
  author?: string;
  /** Documentation or source link */
  sourceUrl?: string;
  /** Initial registration availability */
  status: 'registered' | 'fallback-only';
}

/**
 * 3D Model Registry for all 8 canonical transport modes.
 * Every entry specifies explicit licensing and attribution.
 */
export const TRANSPORT_MODEL_REGISTRY: Record<CanonicalTransportMode, TransportModelDefinition> = {
  car: {
    mode: 'car',
    name: 'WAYVORA Procedural Touring Sedan',
    category: 'road',
    modelUrl: undefined, // Verified in-house procedural 3D model
    scale: 3.5, // Scaled for high cinematic visibility from flyover camera
    rotationOffset: [90, 0, 0], // glTF Y-up to MapLibre Z-up
    elevationOffsetMeters: 0.25,
    maxPitchDegrees: 25,
    license: 'MIT (Original Procedural 3D Mesh)',
    attribution: 'WAYVORA Studio Procedural 3D Touring Sedan (MIT)',
    author: 'WAYVORA Studio',
    status: 'registered',
  },
  airplane: {
    mode: 'airplane',
    name: 'Commercial Airliner Flight',
    category: 'air',
    modelUrl: undefined,
    scale: 2.2,
    rotationOffset: [90, 0, 0],
    elevationOffsetMeters: 45.0, // High cruise altitude above terrain
    maxPitchDegrees: 18,
    license: 'MIT (Original Vector Silhouette)',
    attribution: 'WAYVORA Studio 2D Vector Silhouette (MIT)',
    author: 'WAYVORA Studio',
    status: 'fallback-only',
  },
  boat: {
    mode: 'boat',
    name: 'Nautical Vessel (Watercraft)',
    category: 'water',
    modelUrl: undefined,
    scale: 1.0,
    rotationOffset: [0, 0, 0],
    elevationOffsetMeters: 0.0,
    maxPitchDegrees: 10,
    license: 'MIT (Original Vector Silhouette)',
    attribution: 'WAYVORA Studio 2D Vector Silhouette (MIT)',
    author: 'WAYVORA Studio',
    status: 'fallback-only',
  },
  bus: {
    mode: 'bus',
    name: 'Long-Distance Coach Bus',
    category: 'road',
    modelUrl: undefined, // 2D vector fallback
    scale: 1.0,
    rotationOffset: [0, 0, 0],
    elevationOffsetMeters: 0.0,
    maxPitchDegrees: 20,
    license: 'MIT (Original Vector Silhouette)',
    attribution: 'WAYVORA Studio 2D Vector Silhouette (MIT)',
    author: 'WAYVORA Studio',
    status: 'fallback-only',
  },
  train: {
    mode: 'train',
    name: 'Passenger Rail Locomotive',
    category: 'rail',
    modelUrl: undefined,
    scale: 1.0,
    rotationOffset: [0, 0, 0],
    elevationOffsetMeters: 0.0,
    maxPitchDegrees: 12,
    license: 'MIT (Original Vector Silhouette)',
    attribution: 'WAYVORA Studio 2D Vector Silhouette (MIT)',
    author: 'WAYVORA Studio',
    status: 'fallback-only',
  },
  hiker: {
    mode: 'hiker',
    name: 'Alpine Trekker / Trail Hiker',
    category: 'trail',
    modelUrl: undefined,
    scale: 1.0,
    rotationOffset: [0, 0, 0],
    elevationOffsetMeters: 0.0,
    maxPitchDegrees: 35,
    license: 'MIT (Original Vector Silhouette)',
    attribution: 'WAYVORA Studio 2D Vector Silhouette (MIT)',
    author: 'WAYVORA Studio',
    status: 'fallback-only',
  },
  motorcycle: {
    mode: 'motorcycle',
    name: 'Adventure Touring Motorcycle',
    category: 'road',
    modelUrl: undefined,
    scale: 1.0,
    rotationOffset: [0, 0, 0],
    elevationOffsetMeters: 0.0,
    maxPitchDegrees: 25,
    license: 'MIT (Original Vector Silhouette)',
    attribution: 'WAYVORA Studio 2D Vector Silhouette (MIT)',
    author: 'WAYVORA Studio',
    status: 'fallback-only',
  },
  bicycle: {
    mode: 'bicycle',
    name: 'Touring Cyclist',
    category: 'trail',
    modelUrl: undefined,
    scale: 1.0,
    rotationOffset: [0, 0, 0],
    elevationOffsetMeters: 0.0,
    maxPitchDegrees: 25,
    license: 'MIT (Original Vector Silhouette)',
    attribution: 'WAYVORA Studio 2D Vector Silhouette (MIT)',
    author: 'WAYVORA Studio',
    status: 'fallback-only',
  },
};

/**
 * Returns the model definition for the specified canonical transport mode.
 */
export function getModelDefinition(mode: CanonicalTransportMode): TransportModelDefinition {
  return TRANSPORT_MODEL_REGISTRY[mode] ?? TRANSPORT_MODEL_REGISTRY.car;
}

/**
 * Checks whether a 3D model asset is registered for the specified mode.
 */
export function has3DModelAsset(mode: CanonicalTransportMode): boolean {
  const def = TRANSPORT_MODEL_REGISTRY[mode];
  return Boolean(def && def.status === 'registered');
}

/**
 * Resolves whether 3D model or 2D vector silhouette should be active
 * given user preference, asset availability, and load status.
 */
export function resolveTransportRenderMode(
  mode: CanonicalTransportMode,
  setting: TransportRenderMode = 'auto',
  isModelLoaded: boolean = false
): '3d-model' | '2d-svg' {
  if (setting === '2d-icon') {
    return '2d-svg';
  }

  const hasAsset = has3DModelAsset(mode);
  if (!hasAsset) {
    return '2d-svg'; // Deterministic fallback
  }

  if (setting === '3d-model') {
    return isModelLoaded ? '3d-model' : '2d-svg';
  }

  // 'auto' mode: use 3D if registered and loaded, otherwise 2D
  return isModelLoaded ? '3d-model' : '2d-svg';
}

export interface EvaluatedTransportPose3D {
  mercatorX: number;
  mercatorY: number;
  mercatorZ: number;
  mercatorScale: number;
  effectiveElevationMeters: number;
  bearing: number;
  pitch: number;
  roll: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
}

/**
 * Evaluates the 3D position, orientation, and Mercator scale for a transport entity.
 * Clamps slope pitch to realistic physical limits rather than assuming wheel physics.
 */
export function calculateTransportPose3D(
  position: RoutePoint,
  bearing: number,
  mode: CanonicalTransportMode,
  options: {
    groundElevation?: number;
    elevationDelta?: number;
    distanceDeltaMeters?: number;
    userScaleMultiplier?: number;
  } = {}
): EvaluatedTransportPose3D {
  const def = getModelDefinition(mode);
  const ground = options.groundElevation ?? position.ele ?? 0;
  const effectiveElevation = Math.max(0, ground + def.elevationOffsetMeters);

  // Compute Mercator Coordinate
  const mc = MercatorCoordinate.fromLngLat(
    [position.lng, position.lat],
    effectiveElevation
  );

  // Compute terrain gradient pitch (clamped to realistic vehicle capabilities)
  let pitch = 0;
  if (options.elevationDelta && options.distanceDeltaMeters && options.distanceDeltaMeters > 0.5) {
    const rawPitchDeg =
      (Math.atan2(options.elevationDelta, options.distanceDeltaMeters) * 180) / Math.PI;
    pitch = Math.max(-def.maxPitchDegrees, Math.min(def.maxPitchDegrees, rawPitchDeg));
  }

  const scaleMultiplier = options.userScaleMultiplier ?? 1.0;
  const mercatorScale = mc.meterInMercatorCoordinateUnits() * def.scale * scaleMultiplier;

  // Base rotation offset to stand model upright and align yaw
  const [basePitch, baseRoll, baseYaw] = def.rotationOffset;
  const normalizedBearing = ((bearing % 360) + 360) % 360;

  // Rotation in radians
  const rotationX = ((basePitch + pitch) * Math.PI) / 180;
  const rotationY = (baseRoll * Math.PI) / 180;
  const rotationZ = ((baseYaw + normalizedBearing) * Math.PI) / 180;

  return {
    mercatorX: mc.x,
    mercatorY: mc.y,
    mercatorZ: mc.z,
    mercatorScale,
    effectiveElevationMeters: effectiveElevation,
    bearing: normalizedBearing,
    pitch,
    roll: baseRoll,
    rotationX,
    rotationY,
    rotationZ,
  };
}
