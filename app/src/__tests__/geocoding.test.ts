/* ─── Geocoding & Place Search Unit Tests ─────────────────────────────
   Validates coordinate checks, display name parsing, provider adapters,
   stale-response cancellation, journey waypoint integration, and undo/redo.
   ─────────────────────────────────────────────────────────────────── */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isValidCoordinate,
  formatPhotonDisplayName,
  PhotonGeocodingAdapter,
} from '../domain/geocoding/photon';
import {
  MockGeocodingAdapter,
} from '../domain/geocoding/mock';
import {
  appendPlaceToJourney,
  createEditorHistory,
  pushEditorHistory,
  undoEditorHistory,
  redoEditorHistory,
  canUndo,
  canRedo,
} from '../domain/editor';
import { createJourney } from '../domain/journey';
import type { Journey } from '../domain/types';
import { getFullExportAttribution } from '../domain/map';

describe('Geocoding & Place Search Domain', () => {
  describe('Coordinate Validation (isValidCoordinate)', () => {
    it('accepts valid coordinates within boundaries', () => {
      expect(isValidCoordinate(0, 0)).toBe(true);
      expect(isValidCoordinate(8.5417, 47.3769)).toBe(true); // Zurich
      expect(isValidCoordinate(-122.4194, 37.7749)).toBe(true); // San Francisco
      expect(isValidCoordinate(-180, -90)).toBe(true);
      expect(isValidCoordinate(180, 90)).toBe(true);
    });

    it('rejects out-of-range coordinates', () => {
      expect(isValidCoordinate(-180.001, 0)).toBe(false);
      expect(isValidCoordinate(180.001, 0)).toBe(false);
      expect(isValidCoordinate(0, -90.001)).toBe(false);
      expect(isValidCoordinate(0, 90.001)).toBe(false);
      expect(isValidCoordinate(200, 100)).toBe(false);
    });

    it('rejects non-numeric and non-finite values', () => {
      expect(isValidCoordinate(NaN, 45)).toBe(false);
      expect(isValidCoordinate(10, NaN)).toBe(false);
      expect(isValidCoordinate(Infinity, 45)).toBe(false);
      expect(isValidCoordinate(10, -Infinity)).toBe(false);
      expect(isValidCoordinate('8.54' as any, 47.37 as any)).toBe(false);
      expect(isValidCoordinate(null as any, undefined as any)).toBe(false);
    });
  });

  describe('Display Name Formatting (formatPhotonDisplayName)', () => {
    it('formats a complete hierarchical location correctly', () => {
      const props = {
        name: 'Matterhorn',
        district: 'Visp',
        city: 'Zermatt',
        state: 'Valais',
        country: 'Switzerland',
      };
      const formatted = formatPhotonDisplayName(props);
      expect(formatted).toBe('Matterhorn, Visp, Zermatt, Valais, Switzerland');
    });

    it('deduplicates identical primary and secondary names', () => {
      const props = {
        name: 'Zurich',
        city: 'Zurich',
        state: 'Zurich',
        country: 'Switzerland',
      };
      const formatted = formatPhotonDisplayName(props);
      expect(formatted).toBe('Zurich, Switzerland');
    });

    it('falls back to street if name is missing', () => {
      const props = {
        street: 'Bahnhofstrasse',
        city: 'Zurich',
        country: 'Switzerland',
      };
      const formatted = formatPhotonDisplayName(props);
      expect(formatted).toBe('Bahnhofstrasse, Zurich, Switzerland');
    });

    it('returns "Unknown location" when all properties are empty', () => {
      expect(formatPhotonDisplayName({})).toBe('Unknown location');
    });
  });

  describe('MockGeocodingAdapter', () => {
    let mockAdapter: MockGeocodingAdapter;

    beforeEach(() => {
      mockAdapter = new MockGeocodingAdapter();
    });

    it('returns empty results for empty or whitespace query', async () => {
      const res1 = await mockAdapter.search({ query: '' });
      expect(res1.success).toBe(true);
      expect(res1.results).toHaveLength(0);

      const res2 = await mockAdapter.search({ query: '   ' });
      expect(res2.success).toBe(true);
      expect(res2.results).toHaveLength(0);
    });

    it('searches by city name case-insensitively', async () => {
      const res = await mockAdapter.search({ query: 'zermatt' });
      expect(res.success).toBe(true);
      expect(res.results.length).toBeGreaterThanOrEqual(1);
      expect(res.results[0].name).toBe('Zermatt');
      expect(res.results[0].country).toBe('Switzerland');
      expect(res.results[0].lat).toBeCloseTo(45.9765, 3);
      expect(res.results[0].lng).toBeCloseTo(7.7491, 3);
    });

    it('searches by natural feature', async () => {
      const res = await mockAdapter.search({ query: 'Matterhorn' });
      expect(res.success).toBe(true);
      expect(res.results.length).toBe(1);
      expect(res.results[0].name).toBe('Matterhorn');
      expect(res.results[0].type).toBe('peak');
    });

    it('honors the result limit parameter', async () => {
      const res = await mockAdapter.search({ query: 'a', limit: 2 });
      expect(res.success).toBe(true);
      expect(res.results.length).toBeLessThanOrEqual(2);
    });

    it('handles simulated abort signal', async () => {
      const delayAdapter = new MockGeocodingAdapter({ simulatedDelayMs: 50 });
      const controller = new AbortController();

      const searchPromise = delayAdapter.search({
        query: 'Tokyo',
        signal: controller.signal,
      });

      controller.abort();
      const res = await searchPromise.catch((err) => {
        return { success: false, results: [], error: { code: 'ABORTED', message: err.message } };
      });

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('ABORTED');
    });

    it('returns forced errors for negative-path testing', async () => {
      mockAdapter.setForcedError({
        code: 'RATE_LIMITED',
        message: 'Rate limit exceeded in test',
        statusCode: 429,
      });

      const res = await mockAdapter.search({ query: 'Zurich' });
      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('RATE_LIMITED');
      expect(res.error?.statusCode).toBe(429);
    });
  });

  describe('PhotonGeocodingAdapter', () => {
    it('returns empty results on empty query without fetching', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const adapter = new PhotonGeocodingAdapter();
      const res = await adapter.search({ query: '' });

      expect(res.success).toBe(true);
      expect(res.results).toHaveLength(0);
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it('parses valid GeoJSON response features correctly', async () => {
      const mockPayload = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: [8.5417, 47.3769],
            },
            properties: {
              osm_id: 1685633,
              osm_type: 'R',
              osm_key: 'place',
              osm_value: 'city',
              name: 'Zurich',
              state: 'Zurich',
              country: 'Switzerland',
              countrycode: 'CH',
            },
          },
        ],
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockPayload,
      } as Response);

      const adapter = new PhotonGeocodingAdapter();
      const res = await adapter.search({ query: 'Zurich', limit: 5 });

      expect(res.success).toBe(true);
      expect(res.results).toHaveLength(1);
      expect(res.results[0].name).toBe('Zurich');
      expect(res.results[0].lat).toBe(47.3769);
      expect(res.results[0].lng).toBe(8.5417);
      expect(res.results[0].countryCode).toBe('CH');
      expect(res.attribution).toContain('OpenStreetMap');

      fetchSpy.mockRestore();
    });

    it('handles 429 Rate Limiting with appropriate error code', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 429,
      } as Response);

      const adapter = new PhotonGeocodingAdapter();
      const res = await adapter.search({ query: 'Zurich' });

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('RATE_LIMITED');
      expect(res.error?.statusCode).toBe(429);

      fetchSpy.mockRestore();
    });

    it('handles malformed JSON payloads gracefully', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ invalid: 'not a feature collection' }),
      } as Response);

      const adapter = new PhotonGeocodingAdapter();
      const res = await adapter.search({ query: 'Paris' });

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('MALFORMED_RESPONSE');

      fetchSpy.mockRestore();
    });

    it('handles network failure gracefully', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('DNS lookup failed'));

      const adapter = new PhotonGeocodingAdapter();
      const res = await adapter.search({ query: 'Tokyo' });

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('NETWORK_ERROR');
      expect(res.error?.message).toContain('DNS lookup failed');

      fetchSpy.mockRestore();
    });

    it('supports configurable custom endpoints and timeout parameters', () => {
      const adapter = new PhotonGeocodingAdapter({
        endpoint: 'https://internal-photon.wayvora.studio/api',
        timeoutMs: 5000,
      });

      expect(adapter.getEndpoint()).toBe('https://internal-photon.wayvora.studio/api');
    });

    it('handles request timeout with TIMEOUT error code', async () => {
      // Mock fetch to simulate a delayed response longer than timeoutMs
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(resolve, 500))
      );

      const adapter = new PhotonGeocodingAdapter({ timeoutMs: 30 });
      const res = await adapter.search({ query: 'Chamonix' });

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('TIMEOUT');
      expect(res.error?.message).toContain('timed out');

      fetchSpy.mockRestore();
    });
  });

  describe('Route Waypoint Integration (appendPlaceToJourney)', () => {
    it('appends a place to an empty journey as start stop', () => {
      const emptyJourney = createJourney('Test Journey');
      const place = { name: 'Zurich HB', lng: 8.5417, lat: 47.3769 };

      const { journey, newStopId } = appendPlaceToJourney(emptyJourney, place);

      expect(journey.stops).toHaveLength(1);
      expect(journey.stops[0].id).toBe(newStopId);
      expect(journey.stops[0].name).toBe('Zurich HB');
      expect(journey.stops[0].type).toBe('start');
      expect(journey.stops[0].position.lng).toBe(8.5417);
      expect(journey.stops[0].position.lat).toBe(47.3769);
      expect(journey.segments).toHaveLength(0);
    });

    it('connects a new place to an existing journey with valid segment geometry', () => {
      const initial: Journey = {
        ...createJourney('Swiss Alps'),
        segments: [
          {
            id: 'seg-1',
            type: 'road',
            transportMode: 'car',
            points: [
              { lng: 8.5417, lat: 47.3769 },
              { lng: 7.7491, lat: 45.9765 },
            ],
            sourceFormat: 'manual',
          },
        ],
        stops: [
          {
            id: 'stop-start',
            name: 'Zurich',
            position: { lng: 8.5417, lat: 47.3769 },
            type: 'start',
            segmentIndex: 0,
          },
          {
            id: 'stop-end',
            name: 'Zermatt',
            position: { lng: 7.7491, lat: 45.9765 },
            type: 'end',
            segmentIndex: 0,
          },
        ],
      };

      const place = { name: 'Matterhorn Peak', lng: 7.6586, lat: 45.9763, ele: 4478 };
      const { journey: updated, newStopId, newSegmentId } = appendPlaceToJourney(initial, place, {
        transportMode: 'hike',
      });

      // Preserves existing segment and stop IDs
      expect(updated.segments[0].id).toBe('seg-1');
      expect(updated.stops[0].id).toBe('stop-start');

      // Previous terminal stop is converted to waypoint
      expect(updated.stops[1].id).toBe('stop-end');
      expect(updated.stops[1].type).toBe('waypoint');

      // Appends new segment and stop
      expect(updated.segments).toHaveLength(2);
      expect(updated.stops).toHaveLength(3);
      expect(newSegmentId).toBeDefined();

      const newSeg = updated.segments[1];
      expect(newSeg.transportMode).toBe('hike');
      expect(newSeg.points).toHaveLength(2);
      expect(newSeg.points[0].lng).toBe(7.7491); // connects from previous end
      expect(newSeg.points[1].lng).toBe(7.6586); // to new destination
      expect(newSeg.points[1].ele).toBe(4478);
      expect(newSeg.sourceFormat).toBe('manual');
      expect(newSeg.metadata?.provenance).toEqual({
        source: 'manual-connection',
        category: 'manual_direct',
        connectionType: 'direct-line',
        geocodingProvider: 'photon',
      });

      const newStop = updated.stops[2];
      expect(newStop.id).toBe(newStopId);
      expect(newStop.name).toBe('Matterhorn Peak');
      expect(newStop.type).toBe('end');
    });

    it('rejects invalid coordinates with validation error', () => {
      const journey = createJourney('Test');
      const badPlace = { name: 'Invalid Island', lng: 999, lat: -200 };

      expect(() => appendPlaceToJourney(journey, badPlace)).toThrow();
    });

    it('maintains full undo/redo compatibility', () => {
      const initial: Journey = {
        ...createJourney('History Test'),
        segments: [
          {
            id: 'seg-1',
            type: 'road',
            transportMode: 'car',
            points: [{ lng: 8.5, lat: 47.3 }, { lng: 8.6, lat: 47.4 }],
            sourceFormat: 'manual',
          },
        ],
        stops: [
          {
            id: 'stop-1',
            name: 'A',
            position: { lng: 8.5, lat: 47.3 },
            type: 'start',
            segmentIndex: 0,
          },
          {
            id: 'stop-2',
            name: 'B',
            position: { lng: 8.6, lat: 47.4 },
            type: 'end',
            segmentIndex: 0,
          },
        ],
      };

      let history = createEditorHistory(initial);
      expect(canUndo(history)).toBe(false);
      expect(canRedo(history)).toBe(false);

      // Add Place 1
      const step1 = appendPlaceToJourney(history.present, {
        name: 'Location C',
        lng: 8.7,
        lat: 47.5,
      });
      history = pushEditorHistory(history, step1.journey);

      expect(history.present.stops).toHaveLength(3);
      expect(canUndo(history)).toBe(true);
      expect(canRedo(history)).toBe(false);

      // Add Place 2
      const step2 = appendPlaceToJourney(history.present, {
        name: 'Location D',
        lng: 8.8,
        lat: 47.6,
      });
      history = pushEditorHistory(history, step2.journey);

      expect(history.present.stops).toHaveLength(4);

      // Undo Place 2
      history = undoEditorHistory(history);
      expect(history.present.stops).toHaveLength(3);
      expect(canRedo(history)).toBe(true);

      // Undo Place 1
      history = undoEditorHistory(history);
      expect(history.present.stops).toHaveLength(2);
      expect(canUndo(history)).toBe(false);

      // Redo Place 1
      history = redoEditorHistory(history);
      expect(history.present.stops).toHaveLength(3);
      expect(history.present.stops[2].name).toBe('Location C');

      // Redo Place 2
      history = redoEditorHistory(history);
      expect(history.present.stops).toHaveLength(4);
      expect(history.present.stops[3].name).toBe('Location D');
    });
  });

  describe('Composite Attribution for Geocoding and Routing (getFullExportAttribution)', () => {
    it('appends OpenStreetMap via Photon when rendering geocoded places over Satellite tiles', () => {
      const attribution = getFullExportAttribution('satellite', true, {
        includeGeocoding: true,
        includeRouting: false,
      });

      expect(attribution).toContain('Esri');
      expect(attribution).toContain('AWS Open Data');
      expect(attribution).toContain('Geocoding © OpenStreetMap contributors via Photon');
    });

    it('appends OpenStreetMap routing when rendering OSRM routes over Satellite tiles', () => {
      const attribution = getFullExportAttribution('satellite', true, {
        includeGeocoding: false,
        includeRouting: true,
      });

      expect(attribution).toContain('Esri');
      expect(attribution).toContain('Routing data © OpenStreetMap contributors (ODbL)');
    });

    it('avoids duplicating OpenStreetMap on vector styles that already include it', () => {
      const attribution = getFullExportAttribution('cinematic', true, {
        includeGeocoding: true,
        includeRouting: true,
      });

      expect(attribution).toContain('OpenFreeMap');
      expect(attribution).toContain('Map data © OpenStreetMap contributors');
      expect(attribution).toContain('Geocoding via Photon');
      expect(attribution).toContain('Routing via OSRM');
      // Verify that "OpenStreetMap contributors" appears only once as base attribution
      const occurrences = (attribution.match(/OpenStreetMap contributors/g) || []).length;
      expect(occurrences).toBe(1);
    });
  });
});
