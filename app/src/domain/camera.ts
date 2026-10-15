/* ─── Camera Terrain Clearance & Geometry Engine ────────────────────────
   Calculates 3D camera eye altitude and terrain clearance to prevent
   camera-ground clipping through mountains during cinematic playback.
   ─────────────────────────────────────────────────────────────────── */

import type { RoutePoint, CameraMode } from './types';

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

  // Determine minimum safe clearance above terrain by camera mode
  const modeMinClearance =
    cameraMode === 'ground' ? 60 : cameraMode === 'chase' ? 120 : cameraMode === 'flyover' ? 250 : 350;
  const minClearance = options.minClearanceMetres ?? modeMinClearance;
  const maxPitch = options.maxPitch ?? 75;

  // Estimated camera distance to target in meters based on zoom level
  const mpp = getMetersPerPixel(target.lat, zoom);
  const distanceToTarget = Math.max(100, mpp * 500); // 500px viewport reference

  // Calculate geometric camera altitude from pitch angle (0° = top-down, 90° = horizontal)
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
    const safeHeightAboveTarget = Math.max(50, requiredCameraAltitude - targetEle);
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
