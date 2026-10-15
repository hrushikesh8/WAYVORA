/* ─── Wayvora Domain Types ─────────────────────────────────────────────
   Pure domain model — no UI framework, no map library dependencies.
   These types define the unified journey model that supports both
   road and trail segments in a single timeline.
   ─────────────────────────────────────────────────────────────────── */

// ── Identifiers ──

let _idCounter = 0;
export function generateId(): string {
  return `${Date.now().toString(36)}-${(++_idCounter).toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// ── Route Points ──

export interface RoutePoint {
  lng: number;
  lat: number;
  ele?: number;
  time?: string; // ISO 8601 for serialization
  speed?: number; // m/s
}

// ── Segment Types ──

export type SegmentType = 'road' | 'trail' | 'air' | 'sea';

export type TransportMode =
  | 'car' | 'bus' | 'train' | 'motorcycle' | 'camper' | 'tuktuk' // road
  | 'walk' | 'hike' | 'bike' | 'run'                             // trail
  | 'plane'                                                        // air
  | 'boat' | 'ferry'                                               // sea
  ;

export type SourceFormat = 'manual' | 'gpx' | 'kml' | 'geojson' | 'osrm' | 'computed';

export const SEGMENT_TYPE_MODES: Record<SegmentType, TransportMode[]> = {
  road: ['car', 'bus', 'train', 'motorcycle', 'camper', 'tuktuk'],
  trail: ['walk', 'hike', 'bike', 'run'],
  air: ['plane'],
  sea: ['boat', 'ferry'],
};

export function segmentTypeForMode(mode: TransportMode): SegmentType {
  for (const [type, modes] of Object.entries(SEGMENT_TYPE_MODES)) {
    if ((modes as TransportMode[]).includes(mode)) return type as SegmentType;
  }
  return 'road';
}

// ── Journey Segment ──

export interface ProvenanceMetadata {
  source?: string;
  filename?: string;
  importedAt?: string;
  trackName?: string;
  originalSegmentIndex?: number;
  originalPointCount?: number;
  distanceMetres?: number;
  elevationGainMetres?: number;
  elevationLossMetres?: number;
  [key: string]: unknown;
}

export interface SegmentMetadata {
  provenance?: string | ProvenanceMetadata;
  isOriginalImport?: boolean;
  [key: string]: unknown;
}

export interface JourneySegment {
  id: string;
  type: SegmentType;
  transportMode: TransportMode;
  points: RoutePoint[];
  sourceFormat: SourceFormat;
  metadata?: SegmentMetadata;
}

// ── Stops ──

export type StopType = 'start' | 'end' | 'waypoint' | 'overnight' | 'fuel' | 'food' | 'sight' | 'rest';

export interface Stop {
  id: string;
  name: string;
  position: RoutePoint;
  type: StopType;
  segmentIndex: number; // which segment this stop belongs to
  description?: string;
  durationAtStop?: number; // cinematic dwell duration in seconds
  recordedDuration?: number; // real-world recorded elapsed time (seconds)
  media?: MediaAsset[];
}


// ── Media ──

export type MediaType = 'photo' | 'video' | 'audio';

export interface MediaAsset {
  id: string;
  type: MediaType;
  url: string;
  filename: string;
  title?: string;
  caption?: string;
  attribution?: string;
  mimeType?: string;
  sizeBytes?: number;
  geoPosition?: RoutePoint;
  timestamp?: string;
  cameraModel?: string;
  stopId?: string;
  sceneId?: string;
  isMissing?: boolean;
}

// ── Story & Scenes ──

export type SceneIntent = 'establishing' | 'travel' | 'stop' | 'highlight' | 'arrival';

export type TransitionType = 'cut' | 'fade' | 'dissolve' | 'wipe';

export interface SceneTransition {
  type: TransitionType;
  duration: number; // duration in seconds
}

export type CameraMode = 'overview' | 'flyover' | 'chase' | 'ground' | 'orbit' | 'birdeye';

export interface CameraParams {
  zoom: number;
  pitch: number;
  bearing: number;
  rotationSpeed: number;
}

export const DEFAULT_CAMERA_PARAMS: Record<CameraMode, CameraParams> = {
  overview: { zoom: 10, pitch: 45, bearing: 0, rotationSpeed: 0 },
  flyover: { zoom: 13, pitch: 55, bearing: 0, rotationSpeed: 0 },
  chase: { zoom: 14, pitch: 60, bearing: 0, rotationSpeed: 0 },
  ground: { zoom: 15.5, pitch: 70, bearing: 0, rotationSpeed: 0 },
  orbit: { zoom: 14, pitch: 60, bearing: 0, rotationSpeed: 36 },
  birdeye: { zoom: 11, pitch: 65, bearing: 0, rotationSpeed: 5 },
};

export interface Scene {
  id: string;
  name: string;
  cameraMode: CameraMode;
  startPercent?: number; // 0–1
  endPercent?: number;   // 0–1
  params: CameraParams;
  startTime?: number;
  endTime?: number;
  intent?: SceneIntent;
  title?: string;
  subtitle?: string;
  caption?: string;
  media?: MediaAsset[];
  stopId?: string;
  segmentId?: string;
  transition?: SceneTransition;
  keyframeIds?: string[];
}

export interface StoryScene extends Scene {
  intent: SceneIntent;
  startTime: number;
  endTime: number;
}

export interface EvaluatedStoryState {
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

export type CameraEasing = 'linear' | 'easeInQuad' | 'easeOutQuad' | 'easeInOutQuad' | 'easeInOutCubic' | 'smoothstep';

export interface CameraKeyframe {
  id: string;
  /** Timeline time in seconds */
  time: number;
  /** Target geographic position to frame (if omitted/null, follows traveler on route) */
  targetPosition?: RoutePoint | null;
  /** Cinematic camera mode */
  mode: CameraMode;
  /** Camera orientation and perspective */
  bearing: number; // 0..360 deg
  pitch: number;   // 0..85 deg
  zoom: number;    // Map zoom level
  /** Distance in meters from eye to target */
  distanceMeters?: number;
  /** Look-ahead lead along the route in meters */
  lookAheadMeters?: number;
  /** Target coordinate offset in meters */
  targetOffset?: { x: number; y: number; z: number };
  /** Easing function towards the next keyframe */
  easing?: CameraEasing;
  /** Descriptive label (e.g. "Starting Panorama", "Alpine Ridge Chase", "Summit Orbit") */
  label?: string;
}

// ── Timeline ──

export interface Timeline {
  duration: number; // seconds
  fps: number;
  scenes: Scene[];
  keyframes?: CameraKeyframe[]; // optional cinematic keyframe track
  currentTime: number;
  stopDwell?: boolean; // enable deterministic stop dwell in playback
}


// ── Export ──

export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:5';
export type VideoCodec = 'h264' | 'h265' | 'av1';

export interface ExportProfile {
  name: string;
  width: number;
  height: number;
  aspectRatio: AspectRatio;
  codec: VideoCodec;
  fps: number;
  bitrate: number; // Mbps
}

export const DEFAULT_EXPORT_PROFILES: ExportProfile[] = [
  { name: 'YouTube 1080p', width: 1920, height: 1080, aspectRatio: '16:9', codec: 'h264', fps: 60, bitrate: 8 },
  { name: 'TikTok / Reels', width: 1080, height: 1920, aspectRatio: '9:16', codec: 'h264', fps: 30, bitrate: 6 },
  { name: 'Instagram Square', width: 1080, height: 1080, aspectRatio: '1:1', codec: 'h264', fps: 30, bitrate: 6 },
];

// ── Journey (root aggregate) ──

export interface Journey {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  segments: JourneySegment[];
  stops: Stop[];
  timeline: Timeline;
  exportProfiles: ExportProfile[];
}

// ── Project file format ──

export interface WayvoraProject {
  version: number;
  journey: Journey;
}

export const CURRENT_PROJECT_VERSION = 1;

export interface WaypointInput {
  name: string;
  lng: number;
  lat: number;
  ele?: number;
  mode?: TransportMode;
}
