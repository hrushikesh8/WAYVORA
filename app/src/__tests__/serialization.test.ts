/* ─── Serialization Tests ─────────────────────────────────────────── */

import { describe, it, expect } from 'vitest';
import {
  serializeProject,
  deserializeProject,
  DeserializationError,
} from '../domain/serialization';
import { journeyFromWaypoints } from '../domain/journey';
import { MIXED_JOURNEY_WAYPOINTS } from './fixtures';
import { CURRENT_PROJECT_VERSION } from '../domain/types';

describe('serialization and deserialization', () => {
  const originalJourney = journeyFromWaypoints('Swiss Alps', MIXED_JOURNEY_WAYPOINTS);

  it('round-trips a complete journey without data loss', () => {
    const jsonString = serializeProject(originalJourney);
    expect(typeof jsonString).toBe('string');

    const parsed = JSON.parse(jsonString);
    expect(parsed.version).toBe(CURRENT_PROJECT_VERSION);
    expect(parsed.journey.name).toBe('Swiss Alps');

    const restoredJourney = deserializeProject(jsonString);
    expect(restoredJourney.id).toBe(originalJourney.id);
    expect(restoredJourney.name).toBe(originalJourney.name);
    expect(restoredJourney.segments).toHaveLength(originalJourney.segments.length);
    expect(restoredJourney.stops).toHaveLength(originalJourney.stops.length);
    expect(restoredJourney.timeline.duration).toBe(originalJourney.timeline.duration);
  });

  it('rejects invalid JSON string', () => {
    expect(() => deserializeProject('{ corrupted: json')).toThrow(DeserializationError);
  });

  it('rejects missing or unsupported project versions', () => {
    const noVersion = JSON.stringify({ journey: originalJourney });
    expect(() => deserializeProject(noVersion)).toThrow(DeserializationError);

    const futureVersion = JSON.stringify({ version: 999, journey: originalJourney });
    expect(() => deserializeProject(futureVersion)).toThrow(DeserializationError);
  });

  it('rejects projects with invalid journey structure', () => {
    const invalidJourney = JSON.stringify({
      version: CURRENT_PROJECT_VERSION,
      journey: {
        id: 'bad-journey',
        name: '', // Empty name violates validation
        segments: [],
        stops: [],
        timeline: { duration: -5, fps: 60, scenes: [], currentTime: 0 },
      },
    });
    expect(() => deserializeProject(invalidJourney)).toThrow(DeserializationError);
  });
});
