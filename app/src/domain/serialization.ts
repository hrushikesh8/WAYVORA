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
  if (typeof project.version !== 'number') {
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

/**
 * Migrate a project from an older version to the current version.
 * Currently only v1 exists, so this is a no-op placeholder.
 */
function migrateProject(fromVersion: number, journeyRaw: unknown): Journey {
  if (fromVersion === 1) {
    const journey = journeyRaw as Journey;
    if (journey.timeline?.scenes) {
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
        } as any;
      });
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
