/* ─── Render Domain Types & Contracts ────────────────────────────────
   Defines the unified RenderFrame contract composing spatial journey state,
   cinematic camera pose, story overlays, and media assets for one instant.
   ─────────────────────────────────────────────────────────────────── */

import type {
  RoutePoint,
  CameraMode,
  Stop,
  AspectRatio,
  VideoCodec,
  MediaAsset,
  StoryScene,
  TransitionType,
} from '../types';
import type { EvaluatedAudioState } from '../audio/types';

export interface RenderCameraPose {
  center: RoutePoint;
  bearing: number;
  pitch: number;
  zoom: number;
  eye: RoutePoint;
  altitude: number;
  mode: CameraMode;
}

export interface RenderStoryOverlay {
  activeScene: StoryScene | null;
  title?: string;
  subtitle?: string;
  caption?: string;
  activeMedia: MediaAsset[];
  transition?: {
    type: TransitionType;
    progress: number; // 0..1
    fromSceneId?: string;
    toSceneId: string;
  };
  isStopHighlight: boolean;
  activeStopName?: string;
  activeStopId?: string;
}

export type MediaResourceState = 'ready' | 'loading' | 'missing' | 'error' | 'unsupported';

export interface RenderResourceState {
  mapReady: boolean;
  terrainReady: boolean;
  mediaStatus: Record<string, MediaResourceState>;
  errors: string[];
}

export interface RenderFrameMetadata {
  width: number;
  height: number;
  fps: number;
  aspectRatio: AspectRatio;
}

/**
 * Unified render-frame contract capturing the exact state of one visual instant.
 */
export interface RenderFrame {
  /** 0-based frame sequence number */
  frameIndex: number;
  /** Exact presentation timestamp in seconds along the journey timeline */
  timestampSeconds: number;
  /** Total journey duration in seconds */
  totalDurationSeconds: number;
  /** Normalized spatial progress along route (0..1) */
  spatialProgress: number;
  /** Geographic position of the traveler */
  position: RoutePoint;
  /** Traveler forward heading in degrees (0..360) */
  bearing: number;
  /** Active route segment index */
  segmentIndex: number;
  /** Whether the traveler is currently dwelling at a stop */
  isDwelling: boolean;
  /** The stop currently dwelling at or highlighting, if any */
  activeStop: Stop | null;
  /** Normalized dwell progress (0..1), if dwelling */
  dwellProgress: number;
  /** Complete cinematic camera pose */
  camera: RenderCameraPose;
  /** Complete narrative story overlays, captions, and transitions */
  story: RenderStoryOverlay;
  /** Evaluated audio playback state (clips, gains, master volume) */
  audio?: EvaluatedAudioState;
  /** Asynchronous resource readiness status */
  resources: RenderResourceState;
  /** Target resolution and display metadata */
  metadata: RenderFrameMetadata;
}

export interface RenderEvaluationOptions {
  width?: number;
  height?: number;
  fps?: number;
  aspectRatio?: AspectRatio;
  /** Known resource readiness status (optional) */
  resources?: Partial<RenderResourceState>;
  /** Optional terrain elevation at camera eye */
  groundEleAtCameraEye?: number;
}

export interface ExportJobConfig {
  profileName: string;
  width: number;
  height: number;
  fps: number;
  bitrateMbps: number;
  codec: VideoCodec;
  aspectRatio: AspectRatio;
  /** Whether to export synchronized audio track (default true) */
  includeAudio?: boolean;
  /** Audio bitrate in kbps (default 128) */
  audioBitrateKbps?: number;
  /** Optional time range in seconds (defaults to full journey) */
  timeRange?: {
    startTime: number;
    endTime: number;
  };
}

export interface ExportProgress {
  currentFrame: number;
  totalFrames: number;
  percent: number; // 0..100
  phase: 'preparing' | 'rendering' | 'encoding' | 'muxing' | 'complete' | 'cancelled' | 'error';
  elapsedMs: number;
  estimatedRemainingMs: number;
  message?: string;
}

export type ExportProgressCallback = (progress: ExportProgress) => void;

export interface ExportResult {
  blob: Blob;
  mimeType: string;
  filename: string;
  durationSeconds: number;
  totalFrames: number;
  width: number;
  height: number;
  sizeBytes: number;
  hasAudioTrack?: boolean;
  audioCodec?: string;
  audioChannels?: number;
  audioSampleRate?: number;
}

/**
 * Determinism classification for rendering attributes:
 * Explains which values are purely mathematical (reproducible anywhere)
 * versus which depend on external asynchronous browser/hardware conditions.
 */
export interface DeterminismReport {
  mathematicalDeterminism: {
    spatialPosition: boolean;
    travelerBearing: boolean;
    stopDwellTiming: boolean;
    cameraPositionAndAngles: boolean;
    storySceneSelection: boolean;
    titleAndCaptionTimings: boolean;
    transitionProgress: boolean;
  };
  environmentalDeterminism: {
    mapTileRasterization: 'asynchronous-network-cache-dependent';
    terrainMeshSampling: 'asynchronous-dem-tile-dependent';
    fontGlyphLayout: 'local-font-metrics-dependent';
    videoHardwareEncoding: 'browser-gpu-codec-dependent';
  };
}
