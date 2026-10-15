/* ─── Timeline Evaluation ──────────────────────────────────────────────
   Deterministic timeline evaluation: given (journey, time), compute
   the exact visual state (position, bearing, camera).
   This module is shared between preview and export.
   ─────────────────────────────────────────────────────────────────── */

import type { Journey, RoutePoint, Scene, CameraParams } from './types';
import { computeCumulativeDistances, interpolateRoute } from './geo';
import { getAllPoints } from './journey';

export interface FrameState {
  /** Current position on the route */
  position: RoutePoint;
  /** Bearing in degrees (0-360) */
  bearing: number;
  /** Progress along the route (0-1) */
  progress: number;
  /** Active scene */
  scene: Scene | null;
  /** Camera parameters for this frame */
  camera: CameraParams | null;
  /** Time in seconds */
  time: number;
}

/**
 * Evaluate the timeline at a specific time and return the complete frame state.
 * This is a pure function — deterministic output for the same inputs.
 */
export function evaluateTimeline(journey: Journey, timeSeconds: number): FrameState {
  const { timeline } = journey;
  const duration = timeline.duration;

  // Clamp time
  const t = Math.max(0, Math.min(duration, timeSeconds));
  const progress = duration > 0 ? t / duration : 0;

  // Get all route points
  const allPoints = getAllPoints(journey);
  const cumulativeDistances = computeCumulativeDistances(allPoints);

  // Interpolate position
  const { point, bearing } = interpolateRoute(allPoints, cumulativeDistances, progress);

  // Find active scene
  const activeScene = findActiveScene(timeline.scenes, progress);

  return {
    position: point,
    bearing,
    progress,
    scene: activeScene,
    camera: activeScene?.params ?? null,
    time: t,
  };
}

/**
 * Find the scene that covers the given progress value.
 */
function findActiveScene(scenes: Scene[], progress: number): Scene | null {
  for (const scene of scenes) {
    if (progress >= scene.startPercent && progress <= scene.endPercent) {
      return scene;
    }
  }
  // Fall back to last scene if we're past all scenes
  return scenes.length > 0 ? scenes[scenes.length - 1] : null;
}

/**
 * Generate all frame states for an export.
 * Returns an iterator for memory efficiency.
 */
export function* generateFrames(journey: Journey): Generator<FrameState> {
  const { timeline } = journey;
  const totalFrames = Math.ceil(timeline.duration * timeline.fps);

  for (let frame = 0; frame <= totalFrames; frame++) {
    const timeSeconds = frame / timeline.fps;
    yield evaluateTimeline(journey, timeSeconds);
  }
}

/**
 * Compute the frame index for a given time.
 */
export function timeToFrame(timeSeconds: number, fps: number): number {
  return Math.round(timeSeconds * fps);
}

/**
 * Compute the time for a given frame index.
 */
export function frameToTime(frame: number, fps: number): number {
  return frame / fps;
}
