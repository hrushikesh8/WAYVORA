/* ─── Journey Factory & Validation ─────────────────────────────────────
   Functions for creating, validating, and mutating journeys.
   Pure functions — no side effects.
   ─────────────────────────────────────────────────────────────────── */

import type {
  Journey,
  JourneySegment,
  Stop,
  RoutePoint,
  SegmentType,
  TransportMode,
  SourceFormat,
  StopType,
  Timeline,
  Scene,
  CameraMode,
  WaypointInput,
} from './types';
import {
  generateId,
  segmentTypeForMode,
  DEFAULT_CAMERA_PARAMS,
  DEFAULT_EXPORT_PROFILES,
} from './types';

// ── Factories ──

export function createRoutePoint(lng: number, lat: number, ele?: number): RoutePoint {
  return { lng, lat, ...(ele != null ? { ele } : {}) };
}

export function createSegment(
  type: SegmentType,
  transportMode: TransportMode,
  points: RoutePoint[],
  sourceFormat: SourceFormat = 'manual',
): JourneySegment {
  return {
    id: generateId(),
    type,
    transportMode,
    points: [...points],
    sourceFormat,
  };
}

export function createStop(
  name: string,
  position: RoutePoint,
  segmentIndex: number,
  type: StopType = 'waypoint',
): Stop {
  return {
    id: generateId(),
    name,
    position: { ...position },
    type,
    segmentIndex,
  };
}

export function createScene(
  name: string,
  cameraMode: CameraMode,
  startPercent: number,
  endPercent: number,
): Scene {
  return {
    id: generateId(),
    name,
    cameraMode,
    startPercent: Math.max(0, Math.min(1, startPercent)),
    endPercent: Math.max(0, Math.min(1, endPercent)),
    params: { ...DEFAULT_CAMERA_PARAMS[cameraMode] },
  };
}

export function createTimeline(duration = 30, fps = 60): Timeline {
  return {
    duration,
    fps,
    scenes: [createScene('Full Journey', 'overview', 0, 1)],
    currentTime: 0,
  };
}

export function createJourney(name: string, description = ''): Journey {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    name,
    description,
    createdAt: now,
    updatedAt: now,
    segments: [],
    stops: [],
    timeline: createTimeline(),
    exportProfiles: [...DEFAULT_EXPORT_PROFILES],
    mediaLibrary: [],
  };
}

// ── Mutations (return new objects) ──

export function addSegmentToJourney(journey: Journey, segment: JourneySegment): Journey {
  return {
    ...journey,
    segments: [...journey.segments, segment],
    updatedAt: new Date().toISOString(),
  };
}

export function addStopToJourney(journey: Journey, stop: Stop): Journey {
  return {
    ...journey,
    stops: [...journey.stops, stop],
    updatedAt: new Date().toISOString(),
  };
}

export function removeSegmentFromJourney(journey: Journey, segmentId: string): Journey {
  const segmentIndex = journey.segments.findIndex(s => s.id === segmentId);
  if (segmentIndex === -1) return journey;
  return {
    ...journey,
    segments: journey.segments.filter(s => s.id !== segmentId),
    stops: journey.stops.filter(s => s.segmentIndex !== segmentIndex)
      .map(s => s.segmentIndex > segmentIndex ? { ...s, segmentIndex: s.segmentIndex - 1 } : s),
    updatedAt: new Date().toISOString(),
  };
}

export function removeStopFromJourney(journey: Journey, stopId: string): Journey {
  return {
    ...journey,
    stops: journey.stops.filter(s => s.id !== stopId),
    updatedAt: new Date().toISOString(),
  };
}

// ── Convenience: build a journey from a list of waypoints ──

export type { WaypointInput };

/**
 * Create a journey from an ordered list of waypoints.
 * Each pair of consecutive waypoints becomes a segment.
 * The first waypoint's mode is ignored (it's the starting point).
 */
export function journeyFromWaypoints(
  name: string,
  waypoints: WaypointInput[],
): Journey {
  if (waypoints.length === 0) {
    return createJourney(name);
  }

  let journey = createJourney(name);

  // Add the first stop
  const firstWp = waypoints[0];
  const firstPoint = createRoutePoint(firstWp.lng, firstWp.lat, firstWp.ele);
  journey = addStopToJourney(journey, createStop(firstWp.name, firstPoint, 0, 'start'));

  // Add segments and stops for each subsequent waypoint
  for (let i = 1; i < waypoints.length; i++) {
    const prev = waypoints[i - 1];
    const curr = waypoints[i];
    const mode = curr.mode ?? 'car';
    const type = segmentTypeForMode(mode);

    const startPt = createRoutePoint(prev.lng, prev.lat, prev.ele);
    const endPt = createRoutePoint(curr.lng, curr.lat, curr.ele);

    const segment = createSegment(type, mode, [startPt, endPt], 'manual');
    segment.metadata = {
      provenance: {
        source: 'manual_waypoints',
        category: 'manual_direct',
      },
    };
    journey = addSegmentToJourney(journey, segment);

    const stopType: StopType = i === waypoints.length - 1 ? 'end' : 'waypoint';
    journey = addStopToJourney(journey, createStop(curr.name, endPt, i - 1, stopType));
  }

  return journey;
}

// ── Validation ──

export interface ValidationError {
  field: string;
  message: string;
}

export function validateJourney(journey: Journey): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!journey || typeof journey !== 'object') {
    return [{ field: 'journey', message: 'Journey must be a valid object' }];
  }

  if (!journey.id || typeof journey.id !== 'string') {
    errors.push({ field: 'id', message: 'Journey must have an id' });
  }
  if (!journey.name || typeof journey.name !== 'string' || !journey.name.trim()) {
    errors.push({ field: 'name', message: 'Journey must have a name' });
  }

  if (!Array.isArray(journey.segments)) {
    errors.push({ field: 'segments', message: 'Journey must have a segments array' });
  } else {
    for (let i = 0; i < journey.segments.length; i++) {
      const seg = journey.segments[i];
      if (!seg || typeof seg !== 'object') {
        errors.push({ field: `segments[${i}]`, message: 'Segment must be an object' });
        continue;
      }
      if (!seg.id) errors.push({ field: `segments[${i}].id`, message: 'Segment must have an id' });
      if (!Array.isArray(seg.points) || seg.points.length < 2) {
        errors.push({ field: `segments[${i}].points`, message: 'Segment must have at least 2 points' });
      } else {
        for (let j = 0; j < seg.points.length; j++) {
          const p = seg.points[j];
          if (!p || typeof p !== 'object' || typeof p.lat !== 'number' || typeof p.lng !== 'number') {
            errors.push({ field: `segments[${i}].points[${j}]`, message: 'Point must have numerical lat and lng' });
            continue;
          }
          if (Math.abs(p.lat) > 90) {
            errors.push({ field: `segments[${i}].points[${j}].lat`, message: `Invalid latitude: ${p.lat}` });
          }
          if (Math.abs(p.lng) > 180) {
            errors.push({ field: `segments[${i}].points[${j}].lng`, message: `Invalid longitude: ${p.lng}` });
          }
        }
      }
    }
  }

  if (!Array.isArray(journey.stops)) {
    errors.push({ field: 'stops', message: 'Journey must have a stops array' });
  }

  if (!journey.timeline || typeof journey.timeline !== 'object') {
    errors.push({ field: 'timeline', message: 'Journey must have a timeline object' });
  } else {
    if (typeof journey.timeline.duration !== 'number' || journey.timeline.duration <= 0 || !Number.isFinite(journey.timeline.duration)) {
      errors.push({ field: 'timeline.duration', message: 'Duration must be positive' });
    }
    if (typeof journey.timeline.fps !== 'number' || journey.timeline.fps <= 0 || !Number.isFinite(journey.timeline.fps)) {
      errors.push({ field: 'timeline.fps', message: 'FPS must be positive' });
    }
  }

  return errors;
}

// ── All-points helpers ──

/** Get all RoutePoints across all segments, in order. */
export function getAllPoints(journey: Journey): RoutePoint[] {
  const points: RoutePoint[] = [];
  for (const seg of journey.segments) {
    // Skip the first point of each segment after the first to avoid duplicates
    const start = points.length > 0 && seg.points.length > 0
      && points[points.length - 1].lat === seg.points[0].lat
      && points[points.length - 1].lng === seg.points[0].lng
      ? 1 : 0;
    for (let i = start; i < seg.points.length; i++) {
      points.push(seg.points[i]);
    }
  }
  return points;
}
