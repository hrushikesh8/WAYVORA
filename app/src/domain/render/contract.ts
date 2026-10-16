/* ─── Render Frame Evaluator & Deterministic Contract ───────────────
   Composes spatial timeline, cinematic camera, story overlays, and media
   into a unified RenderFrame at explicit timestamps.
   ─────────────────────────────────────────────────────────────────── */

import type { Journey, RoutePoint } from '../types';
import { evaluateTimeline, computeTimelineSchedule } from '../timeline';
import { calculateCameraEyePosition } from '../camera';
import type {
  RenderFrame,
  RenderEvaluationOptions,
  RenderCameraPose,
  RenderStoryOverlay,
  DeterminismReport,
} from './types';
import { evaluateAudioTimelineAtTime } from '../audio/mixer';

/**
 * Evaluates a complete RenderFrame for a given journey at an explicit timestamp.
 * Pure mathematical composition: repeated calls with identical parameters
 * return mathematically equivalent frames.
 */
export function evaluateRenderFrame(
  journey: Journey,
  timeSeconds: number,
  options?: RenderEvaluationOptions
): RenderFrame {
  const fps = options?.fps ?? journey.timeline.fps ?? 30;
  const width = options?.width ?? 1920;
  const height = options?.height ?? 1080;
  const aspectRatio = options?.aspectRatio ?? '16:9';

  const schedule = computeTimelineSchedule(journey);
  const totalDuration = schedule.totalDuration || journey.timeline.duration || 60;
  const clampedTime = Math.max(0, Math.min(totalDuration, timeSeconds));
  const frameIndex = Math.round(clampedTime * fps);

  // Evaluate base timeline (composed of spatial movement, stops, camera & story)
  const frameState = evaluateTimeline(journey, clampedTime, schedule);

  // 1. Resolve camera pose
  let camera: RenderCameraPose;
  if (frameState.cameraState) {
    camera = {
      center: frameState.cameraState.center,
      bearing: frameState.cameraState.bearing,
      pitch: frameState.cameraState.pitch,
      zoom: frameState.cameraState.zoom,
      eye: frameState.cameraState.cameraEye,
      altitude: frameState.cameraState.effectiveCameraAltitude,
      mode: frameState.cameraState.mode,
    };
  } else {
    // Fallback: camera follows traveler directly
    const mode = frameState.scene?.cameraMode ?? 'chase';
    const zoom = frameState.camera?.zoom ?? 14;
    const pitch = frameState.camera?.pitch ?? 60;
    const bearing = frameState.bearing;
    const target: RoutePoint = frameState.position;
    const eyeCalc = calculateCameraEyePosition(target, bearing, pitch, zoom);
    const altitude = (target.ele ?? 0) + eyeCalc.heightAboveTarget;

    camera = {
      center: target,
      bearing,
      pitch,
      zoom,
      eye: eyeCalc.cameraEye,
      altitude,
      mode,
    };
  }

  // 2. Resolve story overlay
  let story: RenderStoryOverlay;
  if (frameState.storyState) {
    story = {
      activeScene: frameState.storyState.activeScene,
      title: frameState.storyState.title,
      subtitle: frameState.storyState.subtitle,
      caption: frameState.storyState.caption,
      activeMedia: frameState.storyState.activeMedia,
      transition: frameState.storyState.transition,
      isStopHighlight: frameState.storyState.isStopHighlight,
      activeStopName: frameState.storyState.activeStopName,
      activeStopId: frameState.storyState.activeStopId,
      activeTitleCard: frameState.storyState.activeTitleCard,
    };
  } else {
    story = {
      activeScene: null,
      activeMedia: [],
      isStopHighlight: frameState.isDwelling,
      activeStopName: frameState.activeStop?.name,
      activeStopId: frameState.activeStop?.id,
    };
  }

  // 3. Resolve resource readiness
  const resources = {
    mapReady: options?.resources?.mapReady ?? true,
    terrainReady: options?.resources?.terrainReady ?? true,
    mediaStatus: options?.resources?.mediaStatus ?? {},
    errors: options?.resources?.errors ?? [],
  };

  return {
    frameIndex,
    timestampSeconds: clampedTime,
    totalDurationSeconds: totalDuration,
    spatialProgress: frameState.progress,
    position: frameState.position,
    bearing: frameState.bearing,
    segmentIndex: frameState.activeSegmentIndex,
    transportMode: frameState.activeTransportMode,
    isDwelling: frameState.isDwelling,
    activeStop: frameState.activeStop,
    dwellProgress: frameState.dwellProgress,
    camera,
    story,
    audio: evaluateAudioTimelineAtTime(journey.audio, clampedTime),
    resources,
    metadata: {
      width,
      height,
      fps,
      aspectRatio,
    },
  };
}

/**
 * Generator yielding sequential RenderFrames across the entire journey
 * on a fixed-step grid (dt = 1 / fps).
 */
export function* generateRenderFrames(
  journey: Journey,
  options?: RenderEvaluationOptions
): Generator<RenderFrame> {
  const fps = options?.fps ?? journey.timeline.fps ?? 30;
  const schedule = computeTimelineSchedule(journey);
  const totalDuration = schedule.totalDuration || journey.timeline.duration || 60;
  const totalFrames = Math.ceil(totalDuration * fps);

  for (let i = 0; i <= totalFrames; i++) {
    const time = i / fps;
    yield evaluateRenderFrame(journey, time, { ...options, fps });
  }
}

/**
 * Returns formal classification of what state is mathematically deterministic
 * versus what state depends on external browser runtime environments.
 */
export function classifyDeterminism(): DeterminismReport {
  return {
    mathematicalDeterminism: {
      spatialPosition: true,
      travelerBearing: true,
      stopDwellTiming: true,
      cameraPositionAndAngles: true,
      storySceneSelection: true,
      titleAndCaptionTimings: true,
      transitionProgress: true,
    },
    environmentalDeterminism: {
      mapTileRasterization: 'asynchronous-network-cache-dependent',
      terrainMeshSampling: 'asynchronous-dem-tile-dependent',
      fontGlyphLayout: 'local-font-metrics-dependent',
      videoHardwareEncoding: 'browser-gpu-codec-dependent',
    },
  };
}
