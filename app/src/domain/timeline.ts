/* ─── Timeline Evaluation ──────────────────────────────────────────────
   Deterministic timeline evaluation: given (journey, time), compute
   the exact visual state (position, bearing, camera, dwell status).
   Stop-aware: pauses at stops with configured durationAtStop.
   Shared identically between interactive preview and video export.
   ─────────────────────────────────────────────────────────────────── */

import type { Journey, RoutePoint, Scene, CameraParams, Stop, TransportMode } from './types';
import { computeCumulativeDistances, interpolateRoute, haversineDistance } from './geo';
import { getAllPoints } from './journey';
import { evaluateCameraAtTime, type EvaluatedCameraState } from './camera';
import { evaluateStoryAtTime, type EvaluatedStoryState, type StoryScene } from './story';

export interface FrameState {
  /** Current position on the route */
  position: RoutePoint;
  /** Bearing in degrees (0-360) */
  bearing: number;
  /** Spatial progress along the route (0-1) */
  progress: number;
  /** Active scene */
  scene: Scene | null;
  /** Camera parameters for this frame */
  camera: CameraParams | null;
  /** Evaluated cinematic camera state (if keyframes or camera director active) */
  cameraState?: EvaluatedCameraState | null;
  /** Evaluated story overlays, titles, captions, media callouts, and transitions */
  storyState?: EvaluatedStoryState | null;
  /** Time in seconds */
  time: number;
  /** Whether the traveler is currently dwelling/paused at a stop */
  isDwelling: boolean;
  /** The stop currently dwelling at, if any */
  activeStop: Stop | null;
  /** Progress through the current dwell (0-1), if dwelling */
  dwellProgress: number;
  /** Active segment index */
  activeSegmentIndex: number;
  /** Active transport mode for this frame (e.g. car, bus, train, hike, motorcycle, bike, boat, plane) */
  activeTransportMode?: TransportMode;
}

export interface MotionPhase {
  type: 'move';
  startTime: number;
  endTime: number;
  duration: number;
  startProgress: number;
  endProgress: number;
}

export interface DwellPhase {
  type: 'dwell';
  startTime: number;
  endTime: number;
  duration: number;
  progress: number;
  stop: Stop;
  position: RoutePoint;
}

export type TimelinePhase = MotionPhase | DwellPhase;

export interface TimelineSchedule {
  phases: TimelinePhase[];
  totalDuration: number;
  motionDuration: number;
  dwellDuration: number;
  allPoints: RoutePoint[];
  cumulativeDistances: number[];
  totalDistance: number;
}

interface JourneySpatialCache {
  segmentsRef: Journey['segments'];
  allPoints: RoutePoint[];
  cumulativeDistances: number[];
  totalDistance: number;
  segmentLengths: number[];
}

let spatialCache: JourneySpatialCache | null = null;

/**
 * Clears the spatial progress cache.
 */
export function clearJourneySpatialCache(): void {
  spatialCache = null;
}

/**
 * Returns precomputed cumulative distances, points, and segment lengths for a journey.
 * Caches results keyed to the immutable segments array reference for ultra-fast frame evaluation.
 */
export function getCachedJourneySpatialData(journey: Journey): {
  allPoints: RoutePoint[];
  cumulativeDistances: number[];
  totalDistance: number;
  segmentLengths: number[];
} {
  if (spatialCache && spatialCache.segmentsRef === journey.segments) {
    return spatialCache;
  }

  const allPoints = getAllPoints(journey);
  const cumulativeDistances = computeCumulativeDistances(allPoints);
  const totalDistance = cumulativeDistances[cumulativeDistances.length - 1] ?? 0;

  const segmentLengths: number[] = [];
  for (let i = 0; i < journey.segments.length; i++) {
    const seg = journey.segments[i];
    const segDist = seg.points.length > 1
      ? computeCumulativeDistances(seg.points).slice(-1)[0] ?? 0
      : 0;
    segmentLengths.push(segDist);
  }

  spatialCache = {
    segmentsRef: journey.segments,
    allPoints,
    cumulativeDistances,
    totalDistance,
    segmentLengths,
  };
  return spatialCache;
}

/**
 * Finds the fractional spatial progress (0-1) along the journey for a given stop.
 */
export function findStopSpatialProgress(
  _journey: Journey,
  stop: Stop,
  allPoints: RoutePoint[],
  cumulativeDistances: number[]
): number {
  const totalDist = cumulativeDistances[cumulativeDistances.length - 1] ?? 0;
  if (totalDist === 0 || allPoints.length <= 1) return 0;

  if (stop.type === 'start') return 0;
  if (stop.type === 'end') return 1;

  // Find closest point in allPoints to stop.position
  let closestDist = Infinity;
  let closestIdx = 0;
  for (let i = 0; i < allPoints.length; i++) {
    const pt = allPoints[i];
    const d = haversineDistance(pt, stop.position);
    if (d < closestDist) {
      closestDist = d;
      closestIdx = i;
    }
  }

  const stopDist = cumulativeDistances[closestIdx] ?? 0;
  return Math.max(0, Math.min(1, stopDist / totalDist));
}

/**
 * Computes the deterministic stop-aware timeline schedule.
 * Accurately allocates movement time and stop dwell pauses.
 */
export function computeTimelineSchedule(journey: Journey): TimelineSchedule {
  const { allPoints, cumulativeDistances, totalDistance } = getCachedJourneySpatialData(journey);

  // Filter stops with a configured positive durationAtStop
  const dwellStops = journey.stops
    .filter((s) => (s.durationAtStop ?? 0) > 0)
    .map((stop) => ({
      stop,
      progress: findStopSpatialProgress(journey, stop, allPoints, cumulativeDistances),
      duration: Math.max(0, stop.durationAtStop ?? 0),
    }))
    .sort((a, b) => a.progress - b.progress);

  const dwellDuration = dwellStops.reduce((sum, d) => sum + d.duration, 0);
  const userDuration = journey.timeline.duration > 0 ? journey.timeline.duration : 30;

  let motionDuration = 0;
  let totalDuration = 0;

  if (userDuration > dwellDuration) {
    motionDuration = userDuration - dwellDuration;
    totalDuration = userDuration;
  } else {
    // If dwell time exceeds userDuration, allocate sensible motion time
    motionDuration = Math.max(10, userDuration);
    totalDuration = motionDuration + dwellDuration;
  }

  const phases: TimelinePhase[] = [];

  if (dwellStops.length === 0 || totalDistance === 0) {
    phases.push({
      type: 'move',
      startTime: 0,
      endTime: totalDuration,
      duration: totalDuration,
      startProgress: 0,
      endProgress: 1,
    });
  } else {
    let currentT = 0;
    let currentProg = 0;

    for (const d of dwellStops) {
      if (d.progress > currentProg) {
        const progDelta = d.progress - currentProg;
        const moveT = progDelta * motionDuration;
        phases.push({
          type: 'move',
          startTime: currentT,
          endTime: currentT + moveT,
          duration: moveT,
          startProgress: currentProg,
          endProgress: d.progress,
        });
        currentT += moveT;
        currentProg = d.progress;
      }

      // Add dwell phase
      phases.push({
        type: 'dwell',
        startTime: currentT,
        endTime: currentT + d.duration,
        duration: d.duration,
        progress: d.progress,
        stop: d.stop,
        position: { ...d.stop.position },
      });
      currentT += d.duration;
    }

    // Remaining movement to journey completion
    if (currentProg < 1) {
      const progDelta = 1 - currentProg;
      const moveT = progDelta * motionDuration;
      phases.push({
        type: 'move',
        startTime: currentT,
        endTime: currentT + moveT,
        duration: moveT,
        startProgress: currentProg,
        endProgress: 1,
      });
      currentT += moveT;
    }
  }

  return {
    phases,
    totalDuration,
    motionDuration,
    dwellDuration,
    allPoints,
    cumulativeDistances,
    totalDistance,
  };
}

/**
 * Find active segment index given spatial progress.
 */
function findActiveSegmentIndex(
  journey: Journey,
  progress: number,
  precomputedLengths?: number[],
  precomputedTotalDist?: number
): number {
  if (journey.segments.length <= 1) return 0;
  const lengths = precomputedLengths ?? getCachedJourneySpatialData(journey).segmentLengths;
  const totalDist = precomputedTotalDist ?? getCachedJourneySpatialData(journey).totalDistance;
  const targetDist = progress * totalDist;

  let accumulated = 0;
  for (let i = 0; i < journey.segments.length; i++) {
    const segDist = lengths[i] ?? 0;
    if (targetDist <= accumulated + segDist || i === journey.segments.length - 1) {
      return i;
    }
    accumulated += segDist;
  }
  return 0;
}

/**
 * Returns the effective total duration of a journey taking stop dwell times into account.
 */
export function getEffectiveDuration(journey: Journey): number {
  const schedule = computeTimelineSchedule(journey);
  return schedule.totalDuration;
}

export interface EvaluateTimelineOptions {
  stopDwell?: boolean;
  schedule?: TimelineSchedule;
}

/**
 * Evaluate the timeline at a specific time and return the complete frame state.
 * Pure function — completely deterministic output for any input.
 * Supports stop dwelling, interpolation without NaNs, and scene tracking.
 */
export function evaluateTimeline(
  journey: Journey,
  timeSeconds: number,
  options?: EvaluateTimelineOptions | TimelineSchedule
): FrameState {
  const { allPoints, cumulativeDistances, segmentLengths, totalDistance } = getCachedJourneySpatialData(journey);

  // Handle empty journey
  if (allPoints.length === 0) {
    const t = Math.max(0, Math.min(journey.timeline.duration, Number.isFinite(timeSeconds) ? timeSeconds : 0));
    const progress = journey.timeline.duration > 0 ? t / journey.timeline.duration : 0;
    return {
      position: { lng: 0, lat: 0 },
      bearing: 0,
      progress,
      scene: null,
      camera: null,
      cameraState: null,
      storyState: null,
      time: t,
      isDwelling: false,
      activeStop: null,
      dwellProgress: 0,
      activeSegmentIndex: 0,
      activeTransportMode: journey.segments[0]?.transportMode ?? 'car',
    };
  }

  // Handle single point journey
  if (allPoints.length === 1) {
    const p = allPoints[0];
    const t = Math.max(0, Math.min(journey.timeline.duration, Number.isFinite(timeSeconds) ? timeSeconds : 0));
    const progress = journey.timeline.duration > 0 ? t / journey.timeline.duration : 0;
    return {
      position: { ...p },
      bearing: 0,
      progress,
      scene: journey.timeline.scenes[0] ?? null,
      camera: journey.timeline.scenes[0]?.params ?? null,
      cameraState: null,
      storyState: null,
      time: t,
      isDwelling: false,
      activeStop: null,
      dwellProgress: 0,
      activeSegmentIndex: 0,
      activeTransportMode: journey.segments[0]?.transportMode ?? 'car',
    };
  }

  // Determine whether stop dwell scheduling is active
  const isScheduleParam = options != null && 'phases' in options;
  const passedSchedule = isScheduleParam
    ? (options as TimelineSchedule)
    : (options as EvaluateTimelineOptions)?.schedule;
  const shouldDwell =
    passedSchedule != null ||
    (isScheduleParam
      ? true
      : ((options as EvaluateTimelineOptions)?.stopDwell ?? (journey.timeline.stopDwell === true)));

  if (!shouldDwell) {
    const duration = journey.timeline.duration;
    const t = Math.max(0, Math.min(duration, Number.isFinite(timeSeconds) ? timeSeconds : 0));
    const progress = duration > 0 ? t / duration : 0;
    const { point, bearing } = interpolateRoute(allPoints, cumulativeDistances, progress);
    const activeSegmentIndex = findActiveSegmentIndex(journey, progress, segmentLengths, totalDistance);
    const activeScene = findActiveScene(journey.timeline.scenes, progress);
    const cameraState = journey.timeline.keyframes && journey.timeline.keyframes.length > 0
      ? evaluateCameraAtTime(journey.timeline.keyframes, t, point, bearing, activeScene?.cameraMode ?? 'chase')
      : null;
    const hasScenes = journey.timeline.scenes && journey.timeline.scenes.length > 0;
    const hasTitleCards = Boolean(journey.timeline.titleCards?.opening?.enabled || journey.timeline.titleCards?.closing?.enabled);
    const storyState = (hasScenes || hasTitleCards)
      ? evaluateStoryAtTime((journey.timeline.scenes ?? []) as StoryScene[], t, journey.stops, null, {
          titleCards: journey.timeline.titleCards,
          totalDuration: duration,
        })
      : null;

    const activeSegment = journey.segments[activeSegmentIndex];
    const activeTransportMode = activeSegment?.transportMode ?? 'car';

    return {
      position: point,
      bearing,
      progress,
      scene: activeScene,
      camera: activeScene?.params ?? null,
      cameraState,
      storyState,
      time: t,
      isDwelling: false,
      activeStop: null,
      dwellProgress: 0,
      activeSegmentIndex,
      activeTransportMode,
    };
  }

  const schedule = passedSchedule ?? computeTimelineSchedule(journey);
  const { phases, totalDuration } = schedule;

  // Clamp time to [0, totalDuration]
  const t = Math.max(0, Math.min(totalDuration, Number.isFinite(timeSeconds) ? timeSeconds : 0));

  // Find the active phase at time t
  // If t lands on an exact boundary between a move phase and a dwell phase,
  // select the dwell phase so the traveler begins pausing immediately upon arrival.
  let activePhase: TimelinePhase | undefined;
  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    const isLast = i === phases.length - 1;
    if (phase.type === 'dwell') {
      if (t >= phase.startTime && (isLast ? t <= phase.endTime : t < phase.endTime)) {
        activePhase = phase;
        break;
      }
    } else {
      if (t >= phase.startTime && (isLast ? t <= phase.endTime : t < phase.endTime)) {
        activePhase = phase;
        break;
      }
    }
  }

  if (!activePhase) {
    activePhase = t <= 0 ? phases[0] : phases[phases.length - 1];
  }

  let position: RoutePoint;
  let bearing: number;
  let spatialProgress = 0;
  let isDwelling = false;
  let activeStop: Stop | null = null;
  let dwellProgress = 0;

  if (activePhase.type === 'dwell') {
    isDwelling = true;
    activeStop = activePhase.stop;
    spatialProgress = activePhase.progress;
    dwellProgress =
      activePhase.duration > 0
        ? Math.max(0, Math.min(1, (t - activePhase.startTime) / activePhase.duration))
        : 1;

    // Use stop position; fallback to interpolated point if coordinates are identical
    const interp = interpolateRoute(allPoints, cumulativeDistances, spatialProgress);
    position = {
      lng: activePhase.position.lng,
      lat: activePhase.position.lat,
      ele: activePhase.position.ele ?? interp.point.ele,
    };
    bearing = interp.bearing;
  } else {
    isDwelling = false;
    activeStop = null;
    dwellProgress = 0;

    const phaseFrac =
      activePhase.duration > 0
        ? Math.max(0, Math.min(1, (t - activePhase.startTime) / activePhase.duration))
        : 0;
    spatialProgress =
      activePhase.startProgress + (activePhase.endProgress - activePhase.startProgress) * phaseFrac;

    const interp = interpolateRoute(allPoints, cumulativeDistances, spatialProgress);
    position = interp.point;
    bearing = interp.bearing;
  }

  const activeSegmentIndex = findActiveSegmentIndex(journey, spatialProgress, segmentLengths, totalDistance);
  const activeScene = findActiveScene(journey.timeline.scenes, spatialProgress);
  const cameraState = journey.timeline.keyframes && journey.timeline.keyframes.length > 0
    ? evaluateCameraAtTime(journey.timeline.keyframes, t, position, bearing, activeScene?.cameraMode ?? 'chase')
    : null;
  const hasScenes = journey.timeline.scenes && journey.timeline.scenes.length > 0;
  const hasTitleCards = Boolean(journey.timeline.titleCards?.opening?.enabled || journey.timeline.titleCards?.closing?.enabled);
  const storyState = (hasScenes || hasTitleCards)
    ? evaluateStoryAtTime((journey.timeline.scenes ?? []) as StoryScene[], t, journey.stops, activeStop, {
        titleCards: journey.timeline.titleCards,
        totalDuration,
      })
    : null;

  const activeSegment = journey.segments[activeSegmentIndex];
  const activeTransportMode = activeSegment?.transportMode ?? 'car';

  return {
    position,
    bearing,
    progress: spatialProgress,
    scene: activeScene,
    camera: activeScene?.params ?? null,
    cameraState,
    storyState,
    time: t,
    isDwelling,
    activeStop,
    dwellProgress,
    activeSegmentIndex,
    activeTransportMode,
  };
}


/**
 * Find the scene that covers the given progress value.
 */
function findActiveScene(scenes: Scene[], progress: number): Scene | null {
  for (const scene of scenes) {
    const sp = scene.startPercent ?? 0;
    const ep = scene.endPercent ?? 1;
    if (progress >= sp && progress <= ep) {
      return scene;
    }
  }
  return scenes.length > 0 ? scenes[scenes.length - 1] : null;
}

/**
 * Generate all frame states for an export.
 * Returns an iterator for memory efficiency.
 */
export function* generateFrames(journey: Journey): Generator<FrameState> {
  const schedule = computeTimelineSchedule(journey);
  const totalFrames = Math.ceil(schedule.totalDuration * journey.timeline.fps);

  for (let frame = 0; frame <= totalFrames; frame++) {
    const timeSeconds = frame / journey.timeline.fps;
    yield evaluateTimeline(journey, timeSeconds, schedule);
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
