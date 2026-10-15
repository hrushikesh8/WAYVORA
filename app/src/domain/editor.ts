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
  StopType,
  TransportMode,
  ProvenanceMetadata,
} from './types';
import { segmentTypeForMode, generateId } from './types';
import { haversineDistance } from './geo';
import type { RouteResult } from './routing/types';
import type { StoryScene, MediaAsset } from './story/types';
import { applyJourneyTemplate, type JourneyTemplateId, type TemplateApplyOptions } from './templates';

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

/**
 * Applies a verified road routing result to an existing segment.
 * Replaces the segment geometry with high-resolution road points while:
 * - Preserving all other segments (especially GPX trail tracks) untouched.
 * - Recording routing metadata and provenance ('sourceFormat: osrm').
 * - Preserving or updating attached stop positions at segment boundaries.
 * - Enforcing that routeResult must be successful and have >= 2 points.
 */
export function applyRouteToSegment(
  journey: Journey,
  segmentId: string,
  routeResult: RouteResult
): Journey {
  if (!routeResult.success || !routeResult.points || routeResult.points.length < 2) {
    throw new EditError(
      `Cannot apply routing: provider failed or returned fewer than 2 points. (${routeResult.error?.message ?? 'No valid geometry'})`
    );
  }

  const segIndex = journey.segments.findIndex((s) => s.id === segmentId);
  if (segIndex === -1) {
    throw new EditError(`Segment not found with id: ${segmentId}`);
  }

  const existingSeg = journey.segments[segIndex];

  // Clone existing metadata and provenance
  const prevMeta = existingSeg.metadata ?? {};
  const prevProv = typeof prevMeta.provenance === 'object' && prevMeta.provenance !== null
    ? (prevMeta.provenance as Record<string, unknown>)
    : {};

  const updatedSegment: JourneySegment = {
    ...existingSeg,
    type: 'road',
    sourceFormat: 'osrm',
    points: [...routeResult.points],
    metadata: {
      ...prevMeta,
      isModified: true,
      lastModifiedAt: new Date().toISOString(),
      routing: {
        providerId: routeResult.metadata.providerId,
        providerName: routeResult.metadata.providerName,
        profile: routeResult.metadata.profile,
        retrievedAt: routeResult.metadata.retrievedAt,
        distanceMetres: routeResult.distanceMetres,
        durationSeconds: routeResult.durationSeconds,
        attribution: routeResult.metadata.attribution,
        version: routeResult.metadata.version,
      },
      provenance: {
        ...prevProv,
        source: 'routed',
        routedBy: routeResult.metadata.providerId,
        routedAt: routeResult.metadata.retrievedAt,
        routedDistanceMetres: routeResult.distanceMetres,
        routedDurationSeconds: routeResult.durationSeconds,
      },
    },
  };

  const newSegments = [...journey.segments];
  newSegments[segIndex] = updatedSegment;

  // Synchronize stop positions that belong to this segment
  const updatedStops = journey.stops.map((stop) => {
    if (stop.segmentIndex === segIndex && existingSeg.points.length > 0) {
      const firstPt = routeResult.points[0];
      const lastPt = routeResult.points[routeResult.points.length - 1];
      const distToFirst = haversineDistance(stop.position, existingSeg.points[0]);
      const distToLast = haversineDistance(stop.position, existingSeg.points[existingSeg.points.length - 1]);

      if (distToFirst < 100) {
        return { ...stop, position: { ...firstPt } };
      } else if (distToLast < 100) {
        return { ...stop, position: { ...lastPt } };
      }
    }
    return stop;
  });

  return {
    ...journey,
    segments: newSegments,
    stops: updatedStops,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Creates and appends a new road segment from a routing result.
 */
export function createRoutedSegment(
  journey: Journey,
  routeResult: RouteResult,
  mode: TransportMode = 'car'
): { journey: Journey; newSegmentId: string } {
  if (!routeResult.success || !routeResult.points || routeResult.points.length < 2) {
    throw new EditError(
      `Cannot create routed segment: provider failed or returned fewer than 2 points. (${routeResult.error?.message ?? 'No valid geometry'})`
    );
  }

  const newSegmentId = generateId();
  const newSegment: JourneySegment = {
    id: newSegmentId,
    type: 'road',
    transportMode: mode,
    sourceFormat: 'osrm',
    points: [...routeResult.points],
    metadata: {
      isModified: false,
      routing: {
        providerId: routeResult.metadata.providerId,
        providerName: routeResult.metadata.providerName,
        profile: routeResult.metadata.profile,
        retrievedAt: routeResult.metadata.retrievedAt,
        distanceMetres: routeResult.distanceMetres,
        durationSeconds: routeResult.durationSeconds,
        attribution: routeResult.metadata.attribution,
        version: routeResult.metadata.version,
      },
      provenance: {
        source: 'routed',
        routedBy: routeResult.metadata.providerId,
        routedAt: routeResult.metadata.retrievedAt,
        routedDistanceMetres: routeResult.distanceMetres,
        routedDurationSeconds: routeResult.durationSeconds,
      },
    },
  };

  const updatedJourney: Journey = {
    ...journey,
    segments: [...journey.segments, newSegment],
    updatedAt: new Date().toISOString(),
  };

  return {
    journey: updatedJourney,
    newSegmentId,
  };
}

// ── Story Scene & Media Editing Operations ──

/**
 * Adds a story scene to the journey timeline.
 */
export function addStoryScene(journey: Journey, scene: StoryScene): Journey {
  const existingScenes = (journey.timeline.scenes ?? []) as StoryScene[];
  const updatedScenes = [...existingScenes, scene].sort((a, b) => a.startTime - b.startTime);

  return {
    ...journey,
    timeline: {
      ...journey.timeline,
      scenes: updatedScenes,
    },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Updates an existing story scene in the journey timeline.
 */
export function updateStoryScene(
  journey: Journey,
  sceneId: string,
  updates: Partial<StoryScene>
): Journey {
  const existingScenes = (journey.timeline.scenes ?? []) as StoryScene[];
  const sceneIndex = existingScenes.findIndex((s) => s.id === sceneId);
  if (sceneIndex === -1) {
    throw new EditError(`Story scene not found with id: ${sceneId}`);
  }

  const updatedScene = { ...existingScenes[sceneIndex], ...updates };
  const updatedScenes = [...existingScenes];
  updatedScenes[sceneIndex] = updatedScene;
  updatedScenes.sort((a, b) => a.startTime - b.startTime);

  return {
    ...journey,
    timeline: {
      ...journey.timeline,
      scenes: updatedScenes,
    },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Deletes a story scene from the journey timeline.
 */
export function deleteStoryScene(journey: Journey, sceneId: string): Journey {
  const existingScenes = (journey.timeline.scenes ?? []) as StoryScene[];
  const updatedScenes = existingScenes.filter((s) => s.id !== sceneId);

  return {
    ...journey,
    timeline: {
      ...journey.timeline,
      scenes: updatedScenes,
    },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Reorders story scenes by moving a scene from one index to another.
 */
export function reorderStoryScenes(
  journey: Journey,
  fromIndex: number,
  toIndex: number
): Journey {
  const existingScenes = [...((journey.timeline.scenes ?? []) as StoryScene[])];
  if (
    fromIndex < 0 ||
    fromIndex >= existingScenes.length ||
    toIndex < 0 ||
    toIndex >= existingScenes.length
  ) {
    throw new EditError(`Invalid reorder indices: from ${fromIndex} to ${toIndex}`);
  }

  const [moved] = existingScenes.splice(fromIndex, 1);
  existingScenes.splice(toIndex, 0, moved);

  return {
    ...journey,
    timeline: {
      ...journey.timeline,
      scenes: existingScenes,
    },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Attaches a media asset (photo/video) to a story scene.
 */
export function attachMediaToScene(
  journey: Journey,
  sceneId: string,
  media: MediaAsset
): Journey {
  const existingScenes = (journey.timeline.scenes ?? []) as StoryScene[];
  const sceneIndex = existingScenes.findIndex((s) => s.id === sceneId);
  if (sceneIndex === -1) {
    throw new EditError(`Scene not found with id: ${sceneId}`);
  }

  const targetScene = existingScenes[sceneIndex];
  const existingMedia = targetScene.media ?? [];
  const updatedScene: StoryScene = {
    ...targetScene,
    media: [...existingMedia.filter((m) => m.id !== media.id), { ...media, sceneId }],
  };

  const updatedScenes = [...existingScenes];
  updatedScenes[sceneIndex] = updatedScene;

  return {
    ...journey,
    timeline: {
      ...journey.timeline,
      scenes: updatedScenes,
    },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Attaches a media asset to a stop.
 */
export function attachMediaToStop(
  journey: Journey,
  stopId: string,
  media: MediaAsset
): Journey {
  const stopIndex = journey.stops.findIndex((s) => s.id === stopId);
  if (stopIndex === -1) {
    throw new EditError(`Stop not found with id: ${stopId}`);
  }

  const targetStop = journey.stops[stopIndex];
  const existingMedia = targetStop.media ?? [];
  const updatedStop = {
    ...targetStop,
    media: [...existingMedia.filter((m) => m.id !== media.id), { ...media, stopId }],
  };

  const updatedStops = [...journey.stops];
  updatedStops[stopIndex] = updatedStop;

  return {
    ...journey,
    stops: updatedStops,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Removes a media asset anywhere from the journey (scenes or stops).
 */
export function removeMedia(journey: Journey, mediaId: string): Journey {
  // Remove from scenes
  const existingScenes = (journey.timeline.scenes ?? []) as StoryScene[];
  const updatedScenes = existingScenes.map((sc) => ({
    ...sc,
    media: sc.media ? sc.media.filter((m) => m.id !== mediaId) : [],
  }));

  // Remove from stops
  const updatedStops = journey.stops.map((st) => ({
    ...st,
    media: st.media ? st.media.filter((m) => m.id !== mediaId) : [],
  }));

  return {
    ...journey,
    timeline: {
      ...journey.timeline,
      scenes: updatedScenes,
    },
    stops: updatedStops,
    updatedAt: new Date().toISOString(),
  };
}

// ── Audio Timeline Operations ──

import type { AudioClip } from './audio/types';
import { createDefaultAudioTimeline, validateAudioClip } from './audio/mixer';

/**
 * Adds an audio clip to a designated track in the journey audio timeline.
 */
export function addAudioClip(journey: Journey, trackId: string, clip: AudioClip): Journey {
  const audio = journey.audio ? { ...journey.audio } : createDefaultAudioTimeline();
  const tracks = [...(audio.tracks || [])];
  const trackIndex = tracks.findIndex((t) => t.id === trackId);

  if (trackIndex === -1) {
    throw new EditError(`Audio track not found with id: ${trackId}`);
  }

  const duration = journey.timeline.duration || 60;
  const validationErrors = validateAudioClip(clip, duration);
  if (validationErrors.length > 0) {
    throw new EditError(`Invalid audio clip: ${validationErrors.join(', ')}`);
  }

  const targetTrack = tracks[trackIndex];
  const updatedClips = [...targetTrack.clips, clip].sort(
    (a, b) => a.timelineStartSeconds - b.timelineStartSeconds
  );

  tracks[trackIndex] = {
    ...targetTrack,
    clips: updatedClips,
  };

  return {
    ...journey,
    audio: {
      ...audio,
      tracks,
    },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Updates an existing audio clip across any track in the journey audio timeline.
 */
export function updateAudioClip(
  journey: Journey,
  clipId: string,
  updates: Partial<AudioClip>
): Journey {
  const audio = journey.audio ? { ...journey.audio } : createDefaultAudioTimeline();
  const tracks = [...(audio.tracks || [])];
  let found = false;

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    const clipIndex = track.clips.findIndex((c) => c.id === clipId);
    if (clipIndex !== -1) {
      found = true;
      const updatedClip = { ...track.clips[clipIndex], ...updates };
      const duration = journey.timeline.duration || 60;
      const validationErrors = validateAudioClip(updatedClip, duration);
      if (validationErrors.length > 0) {
        throw new EditError(`Invalid audio clip updates: ${validationErrors.join(', ')}`);
      }

      const updatedClips = [...track.clips];
      updatedClips[clipIndex] = updatedClip;
      updatedClips.sort((a, b) => a.timelineStartSeconds - b.timelineStartSeconds);

      tracks[i] = {
        ...track,
        clips: updatedClips,
      };
      break;
    }
  }

  if (!found) {
    throw new EditError(`Audio clip not found with id: ${clipId}`);
  }

  return {
    ...journey,
    audio: {
      ...audio,
      tracks,
    },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Deletes an audio clip from whichever track contains it.
 */
export function deleteAudioClip(journey: Journey, clipId: string): Journey {
  const audio = journey.audio ? { ...journey.audio } : createDefaultAudioTimeline();
  const tracks = (audio.tracks || []).map((t) => ({
    ...t,
    clips: t.clips.filter((c) => c.id !== clipId),
  }));

  return {
    ...journey,
    audio: {
      ...audio,
      tracks,
    },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Updates an audio track volume and mute state.
 */
export function setAudioTrackVolume(
  journey: Journey,
  trackId: string,
  volume: number,
  muted?: boolean
): Journey {
  const audio = journey.audio ? { ...journey.audio } : createDefaultAudioTimeline();
  const tracks = (audio.tracks || []).map((t) => {
    if (t.id === trackId) {
      return {
        ...t,
        volume: Math.max(0, Math.min(2.0, volume)),
        ...(muted != null ? { muted } : {}),
      };
    }
    return t;
  });

  return {
    ...journey,
    audio: {
      ...audio,
      tracks,
    },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Sets master audio output volume.
 */
export function setMasterAudioVolume(journey: Journey, volume: number): Journey {
  const audio = journey.audio ? { ...journey.audio } : createDefaultAudioTimeline();
  return {
    ...journey,
    audio: {
      ...audio,
      masterVolume: Math.max(0, Math.min(2.0, volume)),
    },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Applies a cinematic preset template to the journey.
 */
export function applyTemplateToJourney(
  journey: Journey,
  templateId: JourneyTemplateId,
  options?: TemplateApplyOptions
): Journey {
  return applyJourneyTemplate(journey, templateId, options);
}

/**
 * Appends a geocoded place as a new destination or waypoint in the journey.
 * Preserves existing route order, segment provenance, and IDs.
 */
export function appendPlaceToJourney(
  journey: Journey,
  place: { name: string; lng: number; lat: number; ele?: number },
  options: {
    transportMode?: TransportMode;
    stopType?: StopType;
  } = {}
): { journey: Journey; newStopId: string; newSegmentId?: string } {
  validateCoordinates(place.lat, place.lng);

  const newStopId = generateId();
  const point: RoutePoint = {
    lng: place.lng,
    lat: place.lat,
    ...(place.ele != null ? { ele: place.ele } : {}),
  };

  // Case A: Journey has no segments yet
  if (journey.segments.length === 0) {
    const startStop: Stop = {
      id: newStopId,
      name: place.name || 'Start Location',
      position: point,
      type: 'start',
      segmentIndex: 0,
    };

    return {
      journey: {
        ...journey,
        stops: [startStop],
        updatedAt: new Date().toISOString(),
      },
      newStopId,
    };
  }

  // Case B: Connect from previous terminal point to the new destination
  const lastSegIndex = journey.segments.length - 1;
  const lastSegment = journey.segments[lastSegIndex];
  const lastPoint = lastSegment.points[lastSegment.points.length - 1];

  const mode = options.transportMode ?? lastSegment.transportMode ?? 'car';
  const type = segmentTypeForMode(mode);
  const newSegmentId = generateId();

  const newSegment: JourneySegment = {
    id: newSegmentId,
    type,
    transportMode: mode,
    points: [{ ...lastPoint }, { ...point }],
    sourceFormat: 'manual',
    metadata: {
      isModified: true,
      lastModifiedAt: new Date().toISOString(),
    },
  };

  // Update previous terminal stop from 'end' to 'waypoint'
  const updatedStops = journey.stops.map((s) => {
    if (s.type === 'end') {
      return { ...s, type: 'waypoint' as StopType };
    }
    return s;
  });

  const newStop: Stop = {
    id: newStopId,
    name: place.name || `Waypoint ${updatedStops.length + 1}`,
    position: point,
    type: options.stopType ?? 'end',
    segmentIndex: journey.segments.length,
  };

  const updatedJourney: Journey = {
    ...journey,
    segments: [...journey.segments, newSegment],
    stops: [...updatedStops, newStop],
    updatedAt: new Date().toISOString(),
  };

  return {
    journey: updatedJourney,
    newStopId,
    newSegmentId,
  };
}






