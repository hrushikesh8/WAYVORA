/* ─── Route Editor & Undo/Redo Domain Module ───────────────────────────
   Pure functional operations for journey editing:
   - Segment selection & inspection
   - Point insertion, movement, and safe deletion
   - Stop detail editing and deletion
   - Edit provenance preservation (distinguishing original GPX from modifications)
   - Immutable undo/redo history management
   ─────────────────────────────────────────────────────────────────── */

import type {
  Journey,
  JourneySegment,
  RoutePoint,
  Stop,
  TransportMode,
  ProvenanceMetadata,
} from './types';
import { segmentTypeForMode } from './types';
import { haversineDistance } from './geo';

export class EditError extends Error {
  constructor(message: string) {
    super(`Journey Edit Error: ${message}`);
    this.name = 'EditError';
  }
}

export interface SegmentEditAudit {
  isOriginal: boolean;
  isModified: boolean;
  originalSource?: string;
  originalFilename?: string;
  originalPointCount?: number;
  currentPointCount: number;
  lastModifiedAt?: string;
  editCount: number;
}

/**
 * Validates geographic coordinate values.
 */
export function validateCoordinates(lat: number, lng: number): void {
  if (!Number.isFinite(lat) || Math.abs(lat) > 90) {
    throw new EditError(`Invalid latitude: ${lat}. Must be between -90 and +90.`);
  }
  if (!Number.isFinite(lng) || Math.abs(lng) > 180) {
    throw new EditError(`Invalid longitude: ${lng}. Must be between -180 and +180.`);
  }
}

/**
 * Finds a segment in a journey by ID.
 */
export function findSegment(journey: Journey, segmentId: string): JourneySegment {
  const seg = journey.segments.find((s) => s.id === segmentId);
  if (!seg) {
    throw new EditError(`Segment not found with id: ${segmentId}`);
  }
  return seg;
}

/**
 * Returns an edit audit comparing current segment geometry with original import provenance.
 */
export function getSegmentEditAudit(segment: JourneySegment): SegmentEditAudit {
  const meta = segment.metadata ?? {};
  const prov = typeof meta.provenance === 'object' && meta.provenance !== null
    ? (meta.provenance as ProvenanceMetadata)
    : undefined;

  const isOriginal = meta.isOriginalImport === true && meta.isModified !== true;
  const isModified = meta.isModified === true;

  return {
    isOriginal,
    isModified,
    originalSource: prov?.source,
    originalFilename: prov?.filename,
    originalPointCount: prov?.originalPointCount,
    currentPointCount: segment.points.length,
    lastModifiedAt: typeof meta.lastModifiedAt === 'string' ? meta.lastModifiedAt : undefined,
    editCount: typeof meta.editCount === 'number' ? meta.editCount : 0,
  };
}

/**
 * Creates updated segment metadata recording user modification while keeping provenance intact.
 */
function recordSegmentModification(segment: JourneySegment): JourneySegment {
  const prevMeta = segment.metadata ?? {};
  const prevCount = typeof prevMeta.editCount === 'number' ? prevMeta.editCount : 0;

  return {
    ...segment,
    metadata: {
      ...prevMeta,
      isModified: true,
      lastModifiedAt: new Date().toISOString(),
      editCount: prevCount + 1,
    },
  };
}

/**
 * Inserts a route point at a specified index in a segment.
 */
export function insertRoutePoint(
  journey: Journey,
  segmentId: string,
  index: number,
  point: RoutePoint
): Journey {
  validateCoordinates(point.lat, point.lng);

  const segmentIndex = journey.segments.findIndex((s) => s.id === segmentId);
  if (segmentIndex === -1) {
    throw new EditError(`Segment not found with id: ${segmentId}`);
  }

  const segment = journey.segments[segmentIndex];
  if (index < 0 || index > segment.points.length) {
    throw new EditError(
      `Insertion index ${index} out of bounds for segment with ${segment.points.length} points`
    );
  }

  const updatedPoints = [...segment.points];
  updatedPoints.splice(index, 0, { ...point });

  const updatedSegment = recordSegmentModification({
    ...segment,
    points: updatedPoints,
  });

  const updatedSegments = [...journey.segments];
  updatedSegments[segmentIndex] = updatedSegment;

  return {
    ...journey,
    segments: updatedSegments,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Moves an existing route point to new coordinates.
 * Also synchronizes any Stop positioned at this point.
 */
export function moveRoutePoint(
  journey: Journey,
  segmentId: string,
  pointIndex: number,
  newCoords: { lat: number; lng: number; ele?: number }
): Journey {
  validateCoordinates(newCoords.lat, newCoords.lng);

  const segmentIndex = journey.segments.findIndex((s) => s.id === segmentId);
  if (segmentIndex === -1) {
    throw new EditError(`Segment not found with id: ${segmentId}`);
  }

  const segment = journey.segments[segmentIndex];
  if (pointIndex < 0 || pointIndex >= segment.points.length) {
    throw new EditError(
      `Point index ${pointIndex} out of bounds for segment with ${segment.points.length} points`
    );
  }

  const oldPoint = segment.points[pointIndex];
  const updatedPoint: RoutePoint = {
    ...oldPoint,
    lat: newCoords.lat,
    lng: newCoords.lng,
    ...(newCoords.ele != null ? { ele: newCoords.ele } : {}),
  };

  const updatedPoints = [...segment.points];
  updatedPoints[pointIndex] = updatedPoint;

  const updatedSegment = recordSegmentModification({
    ...segment,
    points: updatedPoints,
  });

  const updatedSegments = [...journey.segments];
  updatedSegments[segmentIndex] = updatedSegment;

  // Synchronize any stop that was located near or at the old point
  const updatedStops = journey.stops.map((stop) => {
    if (stop.segmentIndex === segmentIndex) {
      const dist = haversineDistance(stop.position, oldPoint);
      if (dist < 10) {
        // Stop is attached to this point
        return {
          ...stop,
          position: { ...updatedPoint },
        };
      }
    }
    return stop;
  });

  return {
    ...journey,
    segments: updatedSegments,
    stops: updatedStops,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Removes a route point from a segment safely.
 * Enforces the domain rule that every segment must have at least 2 points.
 */
export function deleteRoutePoint(
  journey: Journey,
  segmentId: string,
  pointIndex: number
): Journey {
  const segmentIndex = journey.segments.findIndex((s) => s.id === segmentId);
  if (segmentIndex === -1) {
    throw new EditError(`Segment not found with id: ${segmentId}`);
  }

  const segment = journey.segments[segmentIndex];
  if (segment.points.length <= 2) {
    throw new EditError(
      'Cannot delete point: a segment must have at least 2 points to define a valid path.'
    );
  }

  if (pointIndex < 0 || pointIndex >= segment.points.length) {
    throw new EditError(
      `Point index ${pointIndex} out of bounds for segment with ${segment.points.length} points`
    );
  }

  const updatedPoints = segment.points.filter((_, idx) => idx !== pointIndex);

  const updatedSegment = recordSegmentModification({
    ...segment,
    points: updatedPoints,
  });

  const updatedSegments = [...journey.segments];
  updatedSegments[segmentIndex] = updatedSegment;

  return {
    ...journey,
    segments: updatedSegments,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Updates properties of an existing stop.
 */
export function updateStop(
  journey: Journey,
  stopId: string,
  updates: Partial<Omit<Stop, 'id'>>
): Journey {
  const stopIndex = journey.stops.findIndex((s) => s.id === stopId);
  if (stopIndex === -1) {
    throw new EditError(`Stop not found with id: ${stopId}`);
  }

  const currentStop = journey.stops[stopIndex];
  const updatedStop: Stop = {
    ...currentStop,
    ...updates,
    ...(updates.durationAtStop != null
      ? { durationAtStop: Math.max(0, updates.durationAtStop) }
      : {}),
  };

  if (updates.position) {
    validateCoordinates(updates.position.lat, updates.position.lng);
  }

  const updatedStops = [...journey.stops];
  updatedStops[stopIndex] = updatedStop;

  return {
    ...journey,
    stops: updatedStops,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Deletes a stop from the journey.
 */
export function deleteStop(journey: Journey, stopId: string): Journey {
  const stopIndex = journey.stops.findIndex((s) => s.id === stopId);
  if (stopIndex === -1) {
    throw new EditError(`Stop not found with id: ${stopId}`);
  }

  return {
    ...journey,
    stops: journey.stops.filter((s) => s.id !== stopId),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Changes a segment's transport mode and updates its type accordingly.
 */
export function updateSegmentMode(
  journey: Journey,
  segmentId: string,
  mode: TransportMode
): Journey {
  const segmentIndex = journey.segments.findIndex((s) => s.id === segmentId);
  if (segmentIndex === -1) {
    throw new EditError(`Segment not found with id: ${segmentId}`);
  }

  const segment = journey.segments[segmentIndex];
  const updatedSegment = recordSegmentModification({
    ...segment,
    transportMode: mode,
    type: segmentTypeForMode(mode),
  });

  const updatedSegments = [...journey.segments];
  updatedSegments[segmentIndex] = updatedSegment;

  return {
    ...journey,
    segments: updatedSegments,
    updatedAt: new Date().toISOString(),
  };
}

// ── Immutable Undo / Redo History Stack ──

export interface EditorHistory {
  past: Journey[];
  present: Journey;
  future: Journey[];
  maxHistory: number;
}

/**
 * Initializes a new editor history stack.
 */
export function createEditorHistory(initialJourney: Journey, maxHistory = 50): EditorHistory {
  return {
    past: [],
    present: initialJourney,
    future: [],
    maxHistory,
  };
}

/**
 * Pushes a new journey state onto the undo stack and clears redo history.
 */
export function pushEditorHistory(history: EditorHistory, nextJourney: Journey): EditorHistory {
  const newPast = [...history.past, history.present];
  if (newPast.length > history.maxHistory) {
    newPast.shift();
  }

  return {
    past: newPast,
    present: nextJourney,
    future: [],
    maxHistory: history.maxHistory,
  };
}

/**
 * Checks whether an undo operation can be performed.
 */
export function canUndo(history: EditorHistory): boolean {
  return history.past.length > 0;
}

/**
 * Checks whether a redo operation can be performed.
 */
export function canRedo(history: EditorHistory): boolean {
  return history.future.length > 0;
}

/**
 * Performs an undo operation.
 */
export function undoEditorHistory(history: EditorHistory): EditorHistory {
  if (!canUndo(history)) return history;

  const newPast = [...history.past];
  const previous = newPast.pop()!;

  return {
    past: newPast,
    present: previous,
    future: [history.present, ...history.future],
    maxHistory: history.maxHistory,
  };
}

/**
 * Performs a redo operation.
 */
export function redoEditorHistory(history: EditorHistory): EditorHistory {
  if (!canRedo(history)) return history;

  const newFuture = [...history.future];
  const next = newFuture.shift()!;

  return {
    past: [...history.past, history.present],
    present: next,
    future: newFuture,
    maxHistory: history.maxHistory,
  };
}
