/* ─── Cinematic Camera & Terrain-Aware Motion Engine ───────────────────────
   Deterministic camera keyframe interpolation, angle wrapping,
   geodesic eye position calculation, and 3D terrain ground clearance.
   ─────────────────────────────────────────────────────────────────── */

import type { RoutePoint, CameraMode, CameraKeyframe, CameraEasing, Journey } from './types';
import { destinationPoint, normalizeLng, shortestLngDelta } from './geo';
import { getAllPoints } from './journey';
import { computeTimelineSchedule } from './timeline';

export interface EvaluatedCameraState {
  /** Target position on the map center */
  center: { lng: number; lat: number };
  /** Camera heading in degrees [0, 360) */
  bearing: number;
  /** Camera tilt angle in degrees [0, 85] */
  pitch: number;
  /** Camera zoom level */
  zoom: number;
  /** 3D geographical position of the camera eye */
  cameraEye: RoutePoint;
  /** Ground elevation directly below the camera eye in meters */
  groundElevationAtCamera: number;
  /** Geometric altitude of the camera eye above sea level before clearance */
  calculatedCameraAltitude: number;
  /** Safe effective altitude of the camera eye after clearance */
  effectiveCameraAltitude: number;
  /** Ground clearance in meters (cameraEye.ele - groundElevationAtCamera) */
  clearanceMetres: number;
  /** Final clamped pitch angle that maintains safe clearance */
  clampedPitch: number;
  /** Whether pitch was clamped or altitude elevated to avert terrain collision */
  isClippingAverted: boolean;
  /** Active camera mode */
  mode: CameraMode;
  /** Active keyframe ID if evaluated between keyframes */
  activeKeyframeId?: string;
  /** Look-ahead lead target position, if applicable */
  lookAheadTarget?: RoutePoint;
}

export interface CameraClearanceResult {
  targetElevation: number;
  groundElevationAtCamera: number;
  calculatedCameraAltitude: number;
  effectiveCameraAltitude: number;
  clearanceMetres: number;
  clampedPitch: number;
  isClippingAverted: boolean;
}

export interface CameraClearanceOptions {
  minClearanceMetres?: number;
  maxPitch?: number;
}

/**
 * Approximate ground resolution in meters per pixel at a given latitude and zoom level.
 */
export function getMetersPerPixel(lat: number, zoom: number): number {
  const earthCircumference = 40075016.686; // meters
  return (earthCircumference * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom + 8);
}

/**
 * Applies easing function to normalize progress u in [0, 1].
 * Fully deterministic mathematical curve.
 */
export function applyEasing(u: number, easing: CameraEasing = 'easeInOutCubic'): number {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(u) ? u : 0));
  switch (easing) {
    case 'linear':
      return clamped;
    case 'easeInQuad':
      return clamped * clamped;
    case 'easeOutQuad':
      return clamped * (2 - clamped);
    case 'easeInOutQuad':
      return clamped < 0.5 ? 2 * clamped * clamped : -1 + (4 - 2 * clamped) * clamped;
    case 'smoothstep':
      return clamped * clamped * (3 - 2 * clamped);
    case 'easeInOutCubic':
    default:
      return clamped < 0.5
        ? 4 * clamped * clamped * clamped
        : (clamped - 1) * (2 * clamped - 2) * (2 * clamped - 2) + 1;
  }
}

/**
 * Interpolates between two angles in degrees using the shortest angular path.
 * Correctly wraps across 0 / 360 degrees boundary.
 */
export function interpolateAngle(fromDeg: number, toDeg: number, t: number): number {
  const delta = ((toDeg - fromDeg + 540) % 360) - 180;
  const interpolated = fromDeg + delta * t;
  return ((interpolated % 360) + 360) % 360;
}

/**
 * Interpolates between two geographic coordinates handling antimeridian wrapping.
 */
export function interpolatePosition(from: RoutePoint, to: RoutePoint, t: number): RoutePoint {
  const deltaLng = shortestLngDelta(from.lng, to.lng);
  const lng = normalizeLng(from.lng + deltaLng * t);
  const lat = from.lat + (to.lat - from.lat) * t;

  let ele: number | undefined;
  if (from.ele != null && to.ele != null) {
    ele = from.ele + (to.ele - from.ele) * t;
  } else {
    ele = from.ele ?? to.ele;
  }

  return { lng, lat, ele };
}

/**
 * Calculates 3D camera eye coordinates and distance given target, bearing, pitch, and zoom.
 */
export function calculateCameraEyePosition(
  target: RoutePoint,
  bearingDeg: number,
  pitchDeg: number,
  zoom: number,
  explicitDistanceMeters?: number
): { cameraEye: RoutePoint; distanceMeters: number; heightAboveTarget: number } {
  const targetEle = target.ele ?? 0;
  const mpp = getMetersPerPixel(target.lat, zoom);
  const distanceMeters = explicitDistanceMeters ?? Math.max(80, mpp * 500);

  // Azimuth opposite to view bearing (where the camera sits relative to target)
  const eyeAzimuth = (bearingDeg + 180) % 360;

  // Geometry: pitch 0° = straight down (H = D, Dh = 0); pitch 90° = horizontal (H = 0, Dh = D)
  const pitchRad = (Math.max(0, Math.min(85, pitchDeg)) * Math.PI) / 180;
  const horizontalDist = distanceMeters * Math.sin(pitchRad);
  const heightAboveTarget = distanceMeters * Math.cos(pitchRad);

  const eyeGround = destinationPoint(target, eyeAzimuth, horizontalDist);

  return {
    cameraEye: {
      lng: eyeGround.lng,
      lat: eyeGround.lat,
      ele: targetEle + heightAboveTarget,
    },
    distanceMeters,
    heightAboveTarget,
  };
}

/**
 * Deterministically evaluates camera altitude and clearance above terrain.
 * Clamps pitch or elevates camera eye if it would intersect the ground.
 */
export function evaluateCameraClearance(
  target: RoutePoint,
  cameraMode: CameraMode,
  requestedPitch: number,
  zoom: number,
  groundElevationAtCamera?: number,
  options: CameraClearanceOptions = {}
): CameraClearanceResult {
  const targetEle = target.ele ?? 0;
  const cameraGroundEle = groundElevationAtCamera ?? targetEle;

  // Determine minimum safe ground buffer (meters above ground surface)
  const modeMinClearance =
    cameraMode === 'ground' ? 5 : cameraMode === 'chase' ? 15 : cameraMode === 'flyover' ? 30 : 50;
  const minClearance = options.minClearanceMetres ?? modeMinClearance;
  const maxPitch = options.maxPitch ?? 78;

  // Calculate realistic cinematic distance to target by mode
  const mpp = getMetersPerPixel(target.lat, zoom);
  const modeNominalDistance =
    cameraMode === 'ground' ? 40 :
    cameraMode === 'chase' ? 120 :
    cameraMode === 'orbit' ? 150 :
    cameraMode === 'flyover' ? 350 :
    Math.max(500, mpp * 250);
  const distanceToTarget = Math.max(30, modeNominalDistance);

  const pitchRad = (Math.min(maxPitch, Math.max(0, requestedPitch)) * Math.PI) / 180;
  const calculatedHeightAboveTarget = distanceToTarget * Math.cos(pitchRad);
  const calculatedCameraAltitude = targetEle + calculatedHeightAboveTarget;

  // Check clearance relative to the ground terrain directly below camera eye
  const requiredCameraAltitude = cameraGroundEle + minClearance;

  let effectiveCameraAltitude = calculatedCameraAltitude;
  let clampedPitch = requestedPitch;
  let isClippingAverted = false;

  if (calculatedCameraAltitude < requiredCameraAltitude) {
    // Camera is clipping into mountain terrain! Elevate camera eye and gently reduce pitch
    effectiveCameraAltitude = requiredCameraAltitude;
    isClippingAverted = true;

    // Recalculate safe pitch angle that satisfies safe height
    const safeHeightAboveTarget = Math.max(30, requiredCameraAltitude - targetEle);
    const safeCos = Math.min(1.0, safeHeightAboveTarget / distanceToTarget);
    clampedPitch = Math.round((Math.acos(safeCos) * 180) / Math.PI);
    clampedPitch = Math.min(requestedPitch, Math.max(15, clampedPitch));
  }

  return {
    targetElevation: targetEle,
    groundElevationAtCamera: cameraGroundEle,
    calculatedCameraAltitude: Math.round(calculatedCameraAltitude),
    effectiveCameraAltitude: Math.round(effectiveCameraAltitude),
    clearanceMetres: Math.round(effectiveCameraAltitude - cameraGroundEle),
    clampedPitch,
    isClippingAverted,
  };
}

/**
 * Pure deterministic evaluator for camera state given timeline time.
 * Evaluates keyframe interpolation, angle wrapping, and terrain clearance.
 */
export function evaluateCameraAtTime(
  keyframes: CameraKeyframe[],
  timeSeconds: number,
  fallbackTarget: RoutePoint,
  fallbackBearing: number,
  fallbackMode: CameraMode = 'chase',
  groundElevationAtCamera?: number
): EvaluatedCameraState {
  const t = Math.max(0, Number.isFinite(timeSeconds) ? timeSeconds : 0);

  // If no keyframes exist, construct fallback state from traveler motion
  if (!keyframes || keyframes.length === 0) {
    const pitch = fallbackMode === 'ground' ? 70 : fallbackMode === 'overview' ? 45 : 60;
    const zoom = fallbackMode === 'ground' ? 15.5 : fallbackMode === 'overview' ? 11 : 14;
    const eyeCalc = calculateCameraEyePosition(fallbackTarget, fallbackBearing, pitch, zoom);
    const clearance = evaluateCameraClearance(
      fallbackTarget,
      fallbackMode,
      pitch,
      zoom,
      groundElevationAtCamera
    );

    return {
      center: { lng: fallbackTarget.lng, lat: fallbackTarget.lat },
      bearing: fallbackBearing,
      pitch: clearance.clampedPitch,
      zoom,
      cameraEye: {
        lng: eyeCalc.cameraEye.lng,
        lat: eyeCalc.cameraEye.lat,
        ele: clearance.effectiveCameraAltitude,
      },
      groundElevationAtCamera: clearance.groundElevationAtCamera,
      calculatedCameraAltitude: clearance.calculatedCameraAltitude,
      effectiveCameraAltitude: clearance.effectiveCameraAltitude,
      clearanceMetres: clearance.clearanceMetres,
      clampedPitch: clearance.clampedPitch,
      isClippingAverted: clearance.isClippingAverted,
      mode: fallbackMode,
    };
  }

  // Sort keyframes deterministically by time
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);

  let targetCenter: RoutePoint;
  let targetBearing: number;
  let targetPitch: number;
  let targetZoom: number;
  let targetMode: CameraMode;
  let activeKeyframeId: string | undefined;
  let lookAheadMeters: number | undefined;

  if (t <= sorted[0].time) {
    const k = sorted[0];
    targetCenter = k.targetPosition ?? fallbackTarget;
    targetBearing = k.bearing;
    targetPitch = k.pitch;
    targetZoom = k.zoom;
    targetMode = k.mode;
    activeKeyframeId = k.id;
    lookAheadMeters = k.lookAheadMeters;
  } else if (t >= sorted[sorted.length - 1].time) {
    const k = sorted[sorted.length - 1];
    targetCenter = k.targetPosition ?? fallbackTarget;
    targetBearing = k.bearing;
    targetPitch = k.pitch;
    targetZoom = k.zoom;
    targetMode = k.mode;
    activeKeyframeId = k.id;
    lookAheadMeters = k.lookAheadMeters;
  } else {
    // Find surrounding keyframes
    let idx = 0;
    for (let i = 0; i < sorted.length - 1; i++) {
      if (t >= sorted[i].time && t < sorted[i + 1].time) {
        idx = i;
        break;
      }
    }

    const k0 = sorted[idx];
    const k1 = sorted[idx + 1];
    activeKeyframeId = k0.id;

    const span = k1.time - k0.time;
    const progress = span > 0 ? (t - k0.time) / span : 0;
    const easedProgress = applyEasing(progress, k0.easing ?? 'easeInOutCubic');

    // Interpolate center position
    const p0 = k0.targetPosition ?? fallbackTarget;
    const p1 = k1.targetPosition ?? fallbackTarget;
    targetCenter = interpolatePosition(p0, p1, easedProgress);

    // Interpolate bearing with shortest angular wrap
    targetBearing = interpolateAngle(k0.bearing, k1.bearing, easedProgress);

    // Interpolate pitch and zoom
    targetPitch = k0.pitch + (k1.pitch - k0.pitch) * easedProgress;
    targetZoom = k0.zoom + (k1.zoom - k0.zoom) * easedProgress;
    targetMode = easedProgress < 0.5 ? k0.mode : k1.mode;

    if (k0.lookAheadMeters != null && k1.lookAheadMeters != null) {
      lookAheadMeters = k0.lookAheadMeters + (k1.lookAheadMeters - k0.lookAheadMeters) * easedProgress;
    } else {
      lookAheadMeters = k0.lookAheadMeters ?? k1.lookAheadMeters;
    }
  }

  // Apply look-ahead lead if configured along path
  let lookAheadTarget: RoutePoint | undefined;
  let effectiveCenter = targetCenter;
  if (lookAheadMeters && lookAheadMeters > 0) {
    lookAheadTarget = destinationPoint(targetCenter, targetBearing, lookAheadMeters);
    effectiveCenter = lookAheadTarget;
  }

  // Calculate camera eye position and terrain clearance
  const eyeCalc = calculateCameraEyePosition(effectiveCenter, targetBearing, targetPitch, targetZoom);
  const clearance = evaluateCameraClearance(
    effectiveCenter,
    targetMode,
    targetPitch,
    targetZoom,
    groundElevationAtCamera
  );

  return {
    center: { lng: effectiveCenter.lng, lat: effectiveCenter.lat },
    bearing: Math.round(targetBearing * 10) / 10,
    pitch: clearance.clampedPitch,
    zoom: Math.round(targetZoom * 100) / 100,
    cameraEye: {
      lng: eyeCalc.cameraEye.lng,
      lat: eyeCalc.cameraEye.lat,
      ele: clearance.effectiveCameraAltitude,
    },
    groundElevationAtCamera: clearance.groundElevationAtCamera,
    calculatedCameraAltitude: clearance.calculatedCameraAltitude,
    effectiveCameraAltitude: clearance.effectiveCameraAltitude,
    clearanceMetres: clearance.clearanceMetres,
    clampedPitch: clearance.clampedPitch,
    isClippingAverted: clearance.isClippingAverted,
    mode: targetMode,
    activeKeyframeId,
    lookAheadTarget,
  };
}

/**
 * Automatically synthesizes an intelligent, cinematic camera keyframe sequence
 * based on journey duration, transport mode transitions, stops, and mountain passes.
 */
export function generateAutoCamKeyframes(journey: Journey): CameraKeyframe[] {
  const schedule = computeTimelineSchedule(journey);
  const allPoints = getAllPoints(journey);
  const totalDuration = schedule.totalDuration;
  if (totalDuration <= 0 || allPoints.length === 0) return [];

  const keyframes: CameraKeyframe[] = [];

  // Keyframe 1: Establishing Overview Shot (t = 0)
  keyframes.push({
    id: 'autocam-start',
    time: 0,
    mode: 'overview',
    bearing: 15,
    pitch: 42,
    zoom: 10.5,
    easing: 'easeInOutCubic',
    label: 'Establishing Panorama',
  });

  // Keyframe 2: Transition into Smooth Chase (t = ~10% or 4s)
  const chaseStartTime = Math.min(5, totalDuration * 0.12);
  keyframes.push({
    id: 'autocam-chase-start',
    time: Math.round(chaseStartTime * 10) / 10,
    mode: 'chase',
    bearing: 0,
    pitch: 60,
    zoom: 14.2,
    lookAheadMeters: 60,
    easing: 'easeInOutCubic',
    label: 'Road Chase Follow',
  });

  // Stops Keyframes: Gentle Orbit or Panoramic Dwell
  schedule.phases.forEach((phase, idx) => {
    if (phase.type === 'dwell' && phase.duration > 1) {
      // Approach to stop
      keyframes.push({
        id: `autocam-stop-${idx}-arrival`,
        time: Math.max(0, phase.startTime - 1.5),
        mode: 'flyover',
        bearing: 30,
        pitch: 52,
        zoom: 14.5,
        targetPosition: phase.position,
        easing: 'easeInOutQuad',
        label: `Arrival: ${phase.stop.name}`,
      });

      // Mid-dwell orbit
      const midDwell = phase.startTime + phase.duration * 0.5;
      keyframes.push({
        id: `autocam-stop-${idx}-orbit`,
        time: Math.round(midDwell * 10) / 10,
        mode: 'orbit',
        bearing: 180,
        pitch: 58,
        zoom: 15.0,
        targetPosition: phase.position,
        easing: 'easeInOutQuad',
        label: `Stop Dwell: ${phase.stop.name}`,
      });

      // Resume chase after dwell
      keyframes.push({
        id: `autocam-stop-${idx}-resume`,
        time: Math.min(totalDuration, phase.endTime + 1.0),
        mode: 'chase',
        bearing: 0,
        pitch: 62,
        zoom: 14.2,
        lookAheadMeters: 50,
        easing: 'easeInOutCubic',
        label: `Resume Journey`,
      });
    }
  });

  // Final Keyframe: Destination Overview (t = totalDuration)
  const finalStop = journey.stops.find((s) => s.type === 'end') ?? journey.stops[journey.stops.length - 1];
  const finalPos = finalStop?.position ?? allPoints[allPoints.length - 1];

  keyframes.push({
    id: 'autocam-destination',
    time: totalDuration,
    mode: 'overview',
    bearing: 340,
    pitch: 48,
    zoom: 11.5,
    targetPosition: finalPos,
    easing: 'easeInOutCubic',
    label: 'Destination Panorama',
  });

  // Deduplicate by time and sort
  const seenTimes = new Set<number>();
  return keyframes
    .filter((k) => {
      const rounded = Math.round(k.time * 10) / 10;
      if (seenTimes.has(rounded)) return false;
      seenTimes.add(rounded);
      return true;
    })
    .sort((a, b) => a.time - b.time);
}
