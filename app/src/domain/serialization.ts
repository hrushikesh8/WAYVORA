/* ─── Serialization ────────────────────────────────────────────────────
   Save and load .wayvora.json project files.
   Handles version migration for forward compatibility.
   ─────────────────────────────────────────────────────────────────── */

import type { Journey, WayvoraProject } from './types';
import { CURRENT_PROJECT_VERSION } from './types';
import { validateJourney } from './journey';

/**
 * Serialize a journey to a .wayvora.json string.
 */
export function serializeProject(journey: Journey): string {
  const project: WayvoraProject = {
    version: CURRENT_PROJECT_VERSION,
    journey,
  };
  return JSON.stringify(project, null, 2);
}

/**
 * Deserialize a .wayvora.json string into a Journey.
 * Validates the result and throws on invalid data.
 */
export function deserializeProject(json: string): Journey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new DeserializationError('Invalid JSON');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new DeserializationError('Project must be an object');
  }

  const project = parsed as Record<string, unknown>;

  // Version check
  if (typeof project.version !== 'number' || !Number.isFinite(project.version) || project.version < 1) {
    throw new DeserializationError('Missing or invalid version field');
  }
  if (project.version > CURRENT_PROJECT_VERSION) {
    throw new DeserializationError(
      `Project version ${project.version} is newer than supported version ${CURRENT_PROJECT_VERSION}. ` +
      `Please update Wayvora.`
    );
  }

  // Migrate from older versions if needed
  const journey = migrateProject(project.version, project.journey);

  // Validate
  const errors = validateJourney(journey);
  if (errors.length > 0) {
    throw new DeserializationError(
      `Invalid journey data: ${errors.map(e => `${e.field}: ${e.message}`).join('; ')}`
    );
  }

  return journey;
}

import { createDefaultAudioTimeline } from './audio/mixer';

/**
 * Migrate a project from an older version to the current version.
 * Handles missing fields and guarantees structural stability.
 */
function migrateProject(fromVersion: number, journeyRaw: unknown): Journey {
  if (fromVersion === 1) {
    if (!journeyRaw || typeof journeyRaw !== 'object') {
      throw new DeserializationError('Project is missing a valid journey object');
    }
    const raw = journeyRaw as Record<string, unknown>;
    const journey = { ...raw } as unknown as Journey;

    // Ensure segments and stops are arrays
    if (!Array.isArray(journey.segments)) {
      journey.segments = [];
    }
    if (!Array.isArray(journey.stops)) {
      journey.stops = [];
    }

    // Ensure timeline structure exists
    if (!journey.timeline || typeof journey.timeline !== 'object') {
      journey.timeline = {
        duration: 30,
        fps: 60,
        scenes: [],
        currentTime: 0,
      };
    } else {
      if (typeof journey.timeline.duration !== 'number' || journey.timeline.duration <= 0 || !Number.isFinite(journey.timeline.duration)) {
        journey.timeline.duration = 30;
      }
      if (typeof journey.timeline.fps !== 'number' || journey.timeline.fps <= 0 || !Number.isFinite(journey.timeline.fps)) {
        journey.timeline.fps = 30;
      }
    }

    if (journey.timeline.scenes) {
      const dur = journey.timeline.duration || 60;
      journey.timeline.scenes = (journey.timeline.scenes as any[]).map((sc: any) => {
        const startTime =
          sc.startTime != null ? (sc.startTime as number) : ((sc.startPercent as number) ?? 0) * dur;
        const endTime =
          sc.endTime != null ? (sc.endTime as number) : ((sc.endPercent as number) ?? 1) * dur;
        return {
          ...sc,
          intent: (sc.intent as string) ?? 'travel',
          startTime: Math.round(startTime * 10) / 10,
          endTime: Math.round(endTime * 10) / 10,
          media: Array.isArray(sc.media) ? sc.media : [],
          stopId: sc.stopId ? String(sc.stopId) : undefined,
          segmentId: sc.segmentId ? String(sc.segmentId) : undefined,
          dwellDuration: typeof sc.dwellDuration === 'number' ? sc.dwellDuration : undefined,
          transition: sc.transition ? { type: sc.transition.type ?? 'cut', duration: Number(sc.transition.duration ?? 0.8) } : undefined,
        } as any;
      });
    }

    if (journey.timeline.titleCards && typeof journey.timeline.titleCards === 'object') {
      const tc = journey.timeline.titleCards as any;
      journey.timeline.titleCards = {
        opening: tc.opening
          ? {
              enabled: Boolean(tc.opening.enabled),
              title: String(tc.opening.title || ''),
              subtitle: tc.opening.subtitle ? String(tc.opening.subtitle) : undefined,
              duration: typeof tc.opening.duration === 'number' ? tc.opening.duration : 3.5,
              motion: tc.opening.motion ?? 'slow-zoom',
            }
          : undefined,
        closing: tc.closing
          ? {
              enabled: Boolean(tc.closing.enabled),
              title: String(tc.closing.title || ''),
              subtitle: tc.closing.subtitle ? String(tc.closing.subtitle) : undefined,
              duration: typeof tc.closing.duration === 'number' ? tc.closing.duration : 3.5,
              motion: tc.closing.motion ?? 'fade',
            }
          : undefined,
      };
    }

    if (!journey.audio) {
      journey.audio = createDefaultAudioTimeline();
    } else {
      const rawAudio = journey.audio as any;
      journey.audio = {
        masterVolume: typeof rawAudio.masterVolume === 'number' ? rawAudio.masterVolume : 1.0,
        sampleRate: rawAudio.sampleRate ?? 44100,
        channelCount: rawAudio.channelCount ?? 2,
        ducking: rawAudio.ducking
          ? {
              enabled: Boolean(rawAudio.ducking.enabled),
              attenuation: typeof rawAudio.ducking.attenuation === 'number' ? rawAudio.ducking.attenuation : 0.3,
              attackSeconds: typeof rawAudio.ducking.attackSeconds === 'number' ? rawAudio.ducking.attackSeconds : 0.4,
              releaseSeconds: typeof rawAudio.ducking.releaseSeconds === 'number' ? rawAudio.ducking.releaseSeconds : 0.8,
              marginSeconds: typeof rawAudio.ducking.marginSeconds === 'number' ? rawAudio.ducking.marginSeconds : 0.2,
            }
          : undefined,
        tracks: Array.isArray(rawAudio.tracks)
          ? rawAudio.tracks.map((t: any) => ({
              id: String(t.id || ''),
              name: String(t.name || ''),
              type: t.type || 'music',
              volume: typeof t.volume === 'number' ? t.volume : 1.0,
              muted: Boolean(t.muted),
              clips: Array.isArray(t.clips)
                ? t.clips.map((c: any) => ({
                    id: String(c.id || ''),
                    name: String(c.name || ''),
                    type: c.type || t.type || 'music',
                    assetUrl: String(c.assetUrl || ''),
                    filename: c.filename ? String(c.filename) : undefined,
                    timelineStartSeconds: typeof c.timelineStartSeconds === 'number' ? c.timelineStartSeconds : 0,
                    sourceTrimInSeconds: typeof c.sourceTrimInSeconds === 'number' ? c.sourceTrimInSeconds : 0,
                    durationSeconds: typeof c.durationSeconds === 'number' ? c.durationSeconds : 10,
                    volume: typeof c.volume === 'number' ? c.volume : 1.0,
                    fadeInSeconds: typeof c.fadeInSeconds === 'number' ? c.fadeInSeconds : 0,
                    fadeOutSeconds: typeof c.fadeOutSeconds === 'number' ? c.fadeOutSeconds : 0,
                    sceneId: c.sceneId ? String(c.sceneId) : undefined,
                    muted: Boolean(c.muted),
                    metadata: c.metadata && typeof c.metadata === 'object' ? c.metadata : undefined,
                  }))
                : [],
            }))
          : [],
      };
    }

    return journey;
  }
  throw new DeserializationError(`Unknown project version: ${fromVersion}`);
}

/**
 * Download a journey as a .wayvora.json file.
 */
export function downloadProject(journey: Journey): void {
  const json = serializeProject(journey);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sanitizeFilename(journey.name)}.wayvora.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Read a .wayvora.json file and return the Journey.
 */
export function readProjectFile(file: File): Promise<Journey> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const journey = deserializeProject(reader.result as string);
        resolve(journey);
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => reject(new DeserializationError('Failed to read file'));
    reader.readAsText(file);
  });
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'journey';
}

export class DeserializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeserializationError';
  }
}
