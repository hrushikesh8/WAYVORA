import { describe, it, expect } from 'vitest';
import {
  MockRoutingProvider,
  OsrmRoutingProvider,
  type RouteRequest,
} from '../domain/routing';
import {
  journeyFromWaypoints,
} from '../domain/journey';
import {
  applyRouteToSegment,
  createRoutedSegment,
  EditError,
  createEditorHistory,
  pushEditorHistory,
  undoEditorHistory,
  redoEditorHistory,
} from '../domain/editor';
import { serializeProject, deserializeProject } from '../domain/serialization';
import { MIXED_JOURNEY_WAYPOINTS } from './fixtures';

describe('Provider-Independent Routing Adapter Contract', () => {
  it('MockRoutingProvider calculates valid route geometry with distance, duration, and metadata', async () => {
    const mock = new MockRoutingProvider();
    const request: RouteRequest = {
      origin: { lat: 46.948, lng: 7.447, name: 'Bern' },
      destination: { lat: 47.376, lng: 8.541, name: 'Zurich' },
      profile: 'driving',
    };

    const result = await mock.calculateRoute(request);

    expect(result.success).toBe(true);
    expect(result.points.length).toBeGreaterThanOrEqual(2);
    expect(result.distanceMetres).toBeGreaterThan(50000); // Bern to Zurich is > 50km
    expect(result.durationSeconds).toBeGreaterThan(1000);
    expect(result.origin.name).toBe('Bern');
    expect(result.destination.name).toBe('Zurich');
    expect(result.metadata.providerId).toBe('mock-router');
    expect(result.metadata.attribution).toContain('Wayvora');
    expect(result.metadata.profile).toBe('driving');
  });

  it('MockRoutingProvider handles intermediate waypoints', async () => {
    const mock = new MockRoutingProvider();
    const request: RouteRequest = {
      origin: { lat: 46.948, lng: 7.447, name: 'Bern' },
      destination: { lat: 47.376, lng: 8.541, name: 'Zurich' },
      waypoints: [{ lat: 47.166, lng: 8.515, name: 'Zug' }],
      profile: 'driving',
    };

    const result = await mock.calculateRoute(request);

    expect(result.success).toBe(true);
    expect(result.waypoints).toHaveLength(1);
    expect(result.points.length).toBeGreaterThan(6);
  });

  it('MockRoutingProvider gracefully reports simulated errors without throwing', async () => {
    const mock = new MockRoutingProvider({
      simulateError: {
        code: 'NO_ROUTE',
        message: 'No road connection across water',
      },
    });

    const result = await mock.calculateRoute({
      origin: { lat: 37.77, lng: -122.41 },
      destination: { lat: 21.30, lng: -157.85 }, // SF to Hawaii
    });

    expect(result.success).toBe(false);
    expect(result.points).toHaveLength(0);
    expect(result.error?.code).toBe('NO_ROUTE');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('OsrmRoutingProvider parses valid GeoJSON response using injected fetch', async () => {
    const fakeOsrmResponse = {
      code: 'Ok',
      routes: [
        {
          geometry: {
            coordinates: [
              [7.4474, 46.9480],
              [7.8500, 47.1000],
              [8.5417, 47.3769],
            ],
            type: 'LineString',
          },
          distance: 121500.5,
          duration: 4920.0,
        },
      ],
      waypoints: [
        { location: [7.4474, 46.9480], name: 'Bern' },
        { location: [8.5417, 47.3769], name: 'Zurich' },
      ],
    };

    const mockFetch = async () =>
      new Response(JSON.stringify(fakeOsrmResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const osrm = new OsrmRoutingProvider({ fetchFn: mockFetch as typeof fetch });
    const result = await osrm.calculateRoute({
      origin: { lat: 46.9480, lng: 7.4474, ele: 540 },
      destination: { lat: 47.3769, lng: 8.5417, ele: 408 },
    });

    expect(result.success).toBe(true);
    expect(result.points).toHaveLength(3);
    expect(result.points[0].lat).toBeCloseTo(46.9480);
    expect(result.points[0].lng).toBeCloseTo(7.4474);
    expect(result.points[0].ele).toBe(540); // Preserved from origin
    expect(result.points[2].ele).toBe(408); // Preserved from destination
    expect(result.distanceMetres).toBe(121501);
    expect(result.durationSeconds).toBe(4920);
    expect(result.metadata.attribution).toContain('OpenStreetMap');
  });

  it('OsrmRoutingProvider handles HTTP 429 rate limiting gracefully', async () => {
    const mockFetch = async () =>
      new Response('Too Many Requests', { status: 429, statusText: 'Too Many Requests' });

    const osrm = new OsrmRoutingProvider({ fetchFn: mockFetch as typeof fetch });
    const result = await osrm.calculateRoute({
      origin: { lat: 46.9, lng: 7.4 },
      destination: { lat: 47.3, lng: 8.5 },
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('RATE_LIMITED');
    expect(result.error?.statusCode).toBe(429);
    expect(result.points).toHaveLength(0);
  });

  it('OsrmRoutingProvider handles NoRoute and malformed response cleanly', async () => {
    const mockFetch = async () =>
      new Response(JSON.stringify({ code: 'NoRoute', message: 'Impossible route' }), {
        status: 200,
      });

    const osrm = new OsrmRoutingProvider({ fetchFn: mockFetch as typeof fetch });
    const result = await osrm.calculateRoute({
      origin: { lat: 46.9, lng: 7.4 },
      destination: { lat: 47.3, lng: 8.5 },
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('NO_ROUTE');
  });

  it('OsrmRoutingProvider handles network timeout gracefully', async () => {
    const mockFetch = async () => {
      const err = new Error('The user aborted a request.');
      err.name = 'AbortError';
      throw err;
    };

    const osrm = new OsrmRoutingProvider({ fetchFn: mockFetch as typeof fetch });
    const result = await osrm.calculateRoute({
      origin: { lat: 46.9, lng: 7.4 },
      destination: { lat: 47.3, lng: 8.5 },
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('TIMEOUT');
  });
});

describe('Road Routing Journey Integration & Provenance Preservation', () => {
  it('applies a routing result to a road segment without altering other segments or trail tracks', async () => {
    const journey = journeyFromWaypoints('Alpine Mixed', MIXED_JOURNEY_WAYPOINTS);
    const roadSeg = journey.segments[0];

    const mockRouter = new MockRoutingProvider({
      points: [
        { lat: 46.624, lng: 8.041, ele: 1034 },
        { lat: 46.610, lng: 8.020, ele: 1100 },
        { lat: 46.590, lng: 7.980, ele: 1250 },
        { lat: 46.585, lng: 7.961, ele: 2061 },
      ],
      distanceMetres: 14200,
      durationSeconds: 900,
    });

    const routeResult = await mockRouter.calculateRoute({
      origin: roadSeg.points[0],
      destination: roadSeg.points[roadSeg.points.length - 1],
    });

    const updatedJourney = applyRouteToSegment(journey, roadSeg.id, routeResult);

    // Road segment updated
    const updatedRoadSeg = updatedJourney.segments[0];
    expect(updatedRoadSeg.points).toHaveLength(4);
    expect(updatedRoadSeg.sourceFormat).toBe('osrm');
    expect(updatedRoadSeg.metadata?.routing).toBeDefined();
    expect(updatedRoadSeg.metadata?.isModified).toBe(true);

    // Trail segment remains completely untouched
    const untouchedTrailSeg = updatedJourney.segments.find((s) => s.type === 'trail')!;
    expect(untouchedTrailSeg).toBeDefined();
    expect(untouchedTrailSeg.points.length).toBeGreaterThanOrEqual(2);
    expect(untouchedTrailSeg.type).toBe('trail');
    expect(untouchedTrailSeg.transportMode).toBe('hike');
  });

  it('rejects applying a failed route result with EditError', async () => {
    const journey = journeyFromWaypoints('Alpine Mixed', MIXED_JOURNEY_WAYPOINTS);
    const roadSeg = journey.segments[0];

    const failedResult = {
      success: false,
      points: [],
      distanceMetres: 0,
      origin: { lat: 46.6, lng: 8.0 },
      destination: { lat: 46.5, lng: 7.9 },
      metadata: {
        providerId: 'mock',
        providerName: 'Mock',
        profile: 'driving' as const,
        retrievedAt: new Date().toISOString(),
        attribution: 'test',
      },
      warnings: ['Failed'],
      error: { code: 'NETWORK_ERROR', message: 'Connection refused' },
    };

    expect(() => applyRouteToSegment(journey, roadSeg.id, failedResult)).toThrow(EditError);
  });

  it('creates and appends a new routed segment to a journey', async () => {
    const journey = journeyFromWaypoints('Alpine Mixed', MIXED_JOURNEY_WAYPOINTS);
    const initialSegmentCount = journey.segments.length;

    const mockRouter = new MockRoutingProvider();
    const routeResult = await mockRouter.calculateRoute({
      origin: { lat: 46.624, lng: 8.041 },
      destination: { lat: 46.585, lng: 7.961 },
    });

    const { journey: updated, newSegmentId } = createRoutedSegment(journey, routeResult, 'car');

    expect(updated.segments).toHaveLength(initialSegmentCount + 1);
    const newSeg = updated.segments.find((s) => s.id === newSegmentId);
    expect(newSeg).toBeDefined();
    expect(newSeg?.type).toBe('road');
    expect(newSeg?.sourceFormat).toBe('osrm');
    expect(newSeg?.points.length).toBeGreaterThanOrEqual(2);
  });

  it('preserves routing metadata and provenance across serialization and undo/redo', async () => {
    const journey = journeyFromWaypoints('Alpine Mixed', MIXED_JOURNEY_WAYPOINTS);
    const roadSeg = journey.segments[0];

    const mockRouter = new MockRoutingProvider();
    const routeResult = await mockRouter.calculateRoute({
      origin: roadSeg.points[0],
      destination: roadSeg.points[roadSeg.points.length - 1],
    });

    let history = createEditorHistory(journey);
    const routedJourney = applyRouteToSegment(journey, roadSeg.id, routeResult);
    history = pushEditorHistory(history, routedJourney);

    // Verify present
    expect(history.present.segments[0].sourceFormat).toBe('osrm');

    // Undo reverts to original unrouted segment
    history = undoEditorHistory(history);
    expect(history.present.segments[0].sourceFormat).toBe(roadSeg.sourceFormat);
    expect(history.present.segments[0].points.length).toBe(roadSeg.points.length);

    // Redo restores routed geometry and metadata
    history = redoEditorHistory(history);
    expect(history.present.segments[0].sourceFormat).toBe('osrm');
    expect(history.present.segments[0].points.length).toBe(routeResult.points.length);

    // Lossless serialization roundtrip
    const serialized = serializeProject(history.present);
    const reloaded = deserializeProject(serialized);
    expect(reloaded.segments[0].sourceFormat).toBe('osrm');
    expect(reloaded.segments[0].points.length).toBe(routeResult.points.length);
  });
});
