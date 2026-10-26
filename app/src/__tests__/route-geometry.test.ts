/* ─── WAYVORA Phase 2: Route Geometry Correctness Test Suite ─────────
   Validates geographic provenance, road/trail/cycling profile geometry,
   recorded GPX track preservation, switchback retention, and explicit fallback handling.
   ─────────────────────────────────────────────────────────────────── */

import { describe, it, expect } from 'vitest';
import {
  MockRoutingProvider,
  OsrmRoutingProvider,
  routingProfileForMode,
  isNetworkRoutableMode,
  type RouteRequest,
} from '../domain/routing';
import {
  journeyFromWaypoints,
  createJourney,
} from '../domain/journey';
import {
  applyRouteToSegment,
  EditError,
  createEditorHistory,
  pushEditorHistory,
  undoEditorHistory,
} from '../domain/editor';
import { parseGpx } from '../domain/gpx';
import {
  getSegmentGeometryCategory,
  type JourneySegment,
  type RoutePoint,
} from '../domain/types';
import { auditJourneyDiagnostics } from '../domain/diagnostics';
import { serializeProject, deserializeProject } from '../domain/serialization';
import { haversineDistance, bearing } from '../domain/geo';

describe('Phase 2 — Route Geometry Correctness & Provenance', () => {
  // ── 1. Driving Road Routing ──
  describe('Driving Road Geometry', () => {
    it('follows provider-returned road geometry rather than endpoint-to-endpoint straight line', async () => {
      // Valley drive from Grindelwald to Interlaken
      const origin: RoutePoint = { lat: 46.624, lng: 8.041, ele: 1034 };
      const destination: RoutePoint = { lat: 46.686, lng: 7.863, ele: 568 };

      const straightLineDist = haversineDistance(origin, destination); // direct line ~15.2 km

      const mockRouter = new MockRoutingProvider({ intermediateSteps: 8 });
      const result = await mockRouter.calculateRoute({
        origin,
        destination,
        profile: 'driving',
      });

      expect(result.success).toBe(true);
      expect(result.points.length).toBeGreaterThan(2); // Multi-point curved road geometry
      expect(result.metadata.profile).toBe('driving');

      // Road distance along winding valley road is greater than direct straight line
      expect(result.distanceMetres).toBeGreaterThan(straightLineDist);

      // Verify points deviate from the direct chord (proving realistic road curvature)
      const midPoint = result.points[Math.floor(result.points.length / 2)];
      const chordMidLat = (origin.lat + destination.lat) / 2;
      const chordMidLng = (origin.lng + destination.lng) / 2;
      const deviation = Math.hypot(midPoint.lat - chordMidLat, midPoint.lng - chordMidLng);
      expect(deviation).toBeGreaterThan(0.001); // Deviates along curvature

      // Apply to a driving segment
      let journey = journeyFromWaypoints('Driving Test', [
        { name: 'Start', lat: origin.lat, lng: origin.lng, ele: origin.ele, mode: 'car' },
        { name: 'End', lat: destination.lat, lng: destination.lng, ele: destination.ele, mode: 'car' },
      ]);

      const initialCategory = getSegmentGeometryCategory(journey.segments[0]);
      expect(initialCategory).toBe('manual_direct');

      journey = applyRouteToSegment(journey, journey.segments[0].id, result);
      const routedSeg = journey.segments[0];

      expect(routedSeg.type).toBe('road');
      expect(routedSeg.transportMode).toBe('car');
      expect(getSegmentGeometryCategory(routedSeg)).toBe('verified_network');
      expect(routedSeg.points).toHaveLength(result.points.length);
    });

    it('preserves elevation progression across driving road points', async () => {
      const mockRouter = new MockRoutingProvider({ intermediateSteps: 6 });
      const result = await mockRouter.calculateRoute({
        origin: { lat: 46.624, lng: 8.041, ele: 1034 },
        destination: { lat: 46.686, lng: 7.863, ele: 568 },
        profile: 'driving',
      });

      expect(result.points[0].ele).toBe(1034);
      expect(result.points[result.points.length - 1].ele).toBe(568);
      // Intermediate points contain interpolated elevations
      result.points.forEach((pt) => {
        expect(pt.ele).toBeDefined();
        expect(pt.ele).toBeGreaterThanOrEqual(560);
        expect(pt.ele).toBeLessThanOrEqual(1040);
      });
    });
  });

  // ── 2. Hiking Trail Geometry & Switchbacks ──
  describe('Hiking Trail Geometry', () => {
    it('preserves trail switchbacks and bends when routing walking/hiking profiles', async () => {
      // Steep ascent from Valley (915m) to Alpine Summit (2240m)
      const origin: RoutePoint = { lat: 46.570, lng: 7.935, ele: 915 };
      const destination: RoutePoint = { lat: 46.545, lng: 7.970, ele: 2240 };

      const mockRouter = new MockRoutingProvider({ intermediateSteps: 12 });
      const result = await mockRouter.calculateRoute({
        origin,
        destination,
        profile: 'walking',
      });

      expect(result.success).toBe(true);
      expect(result.points.length).toBeGreaterThan(6);

      // Verify trail switchbacks: calculate consecutive bearings along the path
      const bearings: number[] = [];
      for (let i = 0; i < result.points.length - 1; i++) {
        bearings.push(bearing(result.points[i], result.points[i + 1]));
      }

      // Along alpine switchbacks, bearing changes direction repeatedly as the trail zig-zags
      let directionChanges = 0;
      for (let i = 1; i < bearings.length; i++) {
        const delta = Math.abs(bearings[i] - bearings[i - 1]);
        if (delta > 20 && delta < 340) {
          directionChanges++;
        }
      }
      expect(directionChanges).toBeGreaterThanOrEqual(2); // Verified switchback zig-zags

      // Applying walking route to a hiking segment preserves type 'trail'
      let journey = journeyFromWaypoints('Hiking Test', [
        { name: 'Trailhead', lat: origin.lat, lng: origin.lng, ele: origin.ele, mode: 'hike' },
        { name: 'Summit', lat: destination.lat, lng: destination.lng, ele: destination.ele, mode: 'hike' },
      ]);

      journey = applyRouteToSegment(journey, journey.segments[0].id, result);
      const trailSeg = journey.segments[0];

      // CRITICAL: Type MUST be 'trail', NOT 'road'
      expect(trailSeg.type).toBe('trail');
      expect(trailSeg.transportMode).toBe('hike');
      expect(getSegmentGeometryCategory(trailSeg)).toBe('verified_network');
      expect(trailSeg.metadata?.provenance).toMatchObject({
        category: 'verified_network',
        routedProfile: 'walking',
      });
    });

    it('reports explicit limitation when trail route cannot be obtained without inventing a path', async () => {
      const mockRouter = new MockRoutingProvider({
        simulateError: {
          code: 'NO_ROUTE',
          message: 'No mapped trail or walkable route found between the specified coordinates.',
        },
      });

      const result = await mockRouter.calculateRoute({
        origin: { lat: 46.57, lng: 7.93 },
        destination: { lat: 46.50, lng: 7.90 }, // Glaciated peak without trails
        profile: 'walking',
      });

      expect(result.success).toBe(false);
      expect(result.points).toHaveLength(0); // NEVER invents fake trail coordinates
      expect(result.error?.code).toBe('NO_ROUTE');
      expect(result.error?.message).toContain('No mapped trail');
    });
  });

  // ── 3. Cycling Profile & Mode Mapping ──
  describe('Cycling Profile & Transport Mode Mapping', () => {
    it('uses supported cycling profile and preserves it without substituting driving', async () => {
      const origin: RoutePoint = { lat: 46.948, lng: 7.447 };
      const destination: RoutePoint = { lat: 47.166, lng: 8.515 };

      const mockRouter = new MockRoutingProvider({ intermediateSteps: 6 });
      const result = await mockRouter.calculateRoute({
        origin,
        destination,
        profile: 'cycling',
      });

      expect(result.success).toBe(true);
      expect(result.metadata.profile).toBe('cycling');
      expect(result.durationSeconds).toBeGreaterThan(0);

      // Verify routingProfileForMode
      expect(routingProfileForMode('bike')).toBe('cycling');
      expect(routingProfileForMode('car')).toBe('driving');
      expect(routingProfileForMode('hike')).toBe('hiking');
      expect(routingProfileForMode('walk')).toBe('walking');

      // Verify network routable modes
      expect(isNetworkRoutableMode('bike')).toBe(true);
      expect(isNetworkRoutableMode('car')).toBe(true);
      expect(isNetworkRoutableMode('hike')).toBe(true);
      expect(isNetworkRoutableMode('plane')).toBe(false);
      expect(isNetworkRoutableMode('boat')).toBe(false);
    });

    it('fails honestly if cycling profile is unsupported by a provider', async () => {
      const mockRouter = new MockRoutingProvider({
        unsupportedProfiles: ['cycling'],
      });

      const result = await mockRouter.calculateRoute({
        origin: { lat: 46.948, lng: 7.447 },
        destination: { lat: 47.166, lng: 8.515 },
        profile: 'cycling',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PROFILE_UNSUPPORTED');
      expect(result.points).toHaveLength(0); // Does NOT silently substitute driving geometry
    });
  });

  // ── 4. Recorded GPX Journeys ──
  describe('Recorded GPX Track Preservation', () => {
    const SAMPLE_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Garmin Fenix" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Recorded Alpine Ridge Run</name>
    <trkseg>
      <trkpt lat="46.570123" lon="7.935456">
        <ele>915.2</ele>
        <time>2026-08-10T08:00:00Z</time>
      </trkpt>
      <trkpt lat="46.568456" lon="7.938123">
        <ele>1042.8</ele>
        <time>2026-08-10T08:14:30Z</time>
      </trkpt>
      <trkpt lat="46.565789" lon="7.942789">
        <ele>1185.0</ele>
        <time>2026-08-10T08:29:15Z</time>
      </trkpt>
      <trkpt lat="46.545123" lon="7.970456">
        <ele>2240.6</ele>
        <time>2026-08-10T11:45:00Z</time>
      </trkpt>
    </trkseg>
  </trk>
</gpx>`;

    it('preserves supplied track coordinates, point order, elevation, and timestamps exactly', () => {
      const parsed = parseGpx(SAMPLE_GPX, 'ridge_run.gpx');
      const journey = parsed.toJourney({ mode: 'run' });

      expect(journey.segments).toHaveLength(1);
      const seg = journey.segments[0];

      expect(seg.sourceFormat).toBe('gpx');
      expect(seg.transportMode).toBe('run');
      expect(seg.type).toBe('trail');
      expect(getSegmentGeometryCategory(seg)).toBe('recorded_track');

      // Verify coordinate precision and point order
      expect(seg.points).toHaveLength(4);
      expect(seg.points[0].lat).toBe(46.570123);
      expect(seg.points[0].lng).toBe(7.935456);
      expect(seg.points[0].ele).toBe(915.2);
      expect(seg.points[0].time).toBe('2026-08-10T08:00:00Z');

      expect(seg.points[3].lat).toBe(46.545123);
      expect(seg.points[3].lng).toBe(7.970456);
      expect(seg.points[3].ele).toBe(2240.6);
      expect(seg.points[3].time).toBe('2026-08-10T11:45:00Z');
    });

    it('strictly guards recorded GPX tracks against accidental silent replacement by calculated routes', async () => {
      const parsed = parseGpx(SAMPLE_GPX, 'ridge_run.gpx');
      const journey = parsed.toJourney({ mode: 'run' });
      const gpxSeg = journey.segments[0];

      const mockRouter = new MockRoutingProvider();
      const calculatedRoute = await mockRouter.calculateRoute({
        origin: gpxSeg.points[0],
        destination: gpxSeg.points[gpxSeg.points.length - 1],
      });

      // Calling applyRouteToSegment without explicit replacement authorization MUST throw EditError
      expect(() => {
        applyRouteToSegment(journey, gpxSeg.id, calculatedRoute);
      }).toThrow(EditError);

      expect(() => {
        applyRouteToSegment(journey, gpxSeg.id, calculatedRoute);
      }).toThrow(/Cannot silently replace recorded GPX track/);

      // Verify the journey segments remain untouched
      expect(journey.segments[0].sourceFormat).toBe('gpx');
      expect(journey.segments[0].points[0].time).toBe('2026-08-10T08:00:00Z');

      // Explicit authorized replacement succeeds when requested
      const authorizedJourney = applyRouteToSegment(journey, gpxSeg.id, calculatedRoute, {
        allowRecordedTrackReplacement: true,
      });
      expect(authorizedJourney.segments[0].sourceFormat).toBe('osrm');
      expect(getSegmentGeometryCategory(authorizedJourney.segments[0])).toBe('verified_network');
    });

    it('preserves recorded GPX geometry and metadata losslessly across serialization and undo/redo', () => {
      const parsed = parseGpx(SAMPLE_GPX, 'ridge_run.gpx');
      const journey = parsed.toJourney({ mode: 'run' });

      // Roundtrip through serialization
      const json = serializeProject(journey);
      const reloaded = deserializeProject(json);

      expect(reloaded.segments[0].sourceFormat).toBe('gpx');
      expect(getSegmentGeometryCategory(reloaded.segments[0])).toBe('recorded_track');
      expect(reloaded.segments[0].points[0].ele).toBe(915.2);
      expect(reloaded.segments[0].points[0].time).toBe('2026-08-10T08:00:00Z');
      expect(reloaded.segments[0].points[3].ele).toBe(2240.6);
      expect(reloaded.segments[0].points[3].time).toBe('2026-08-10T11:45:00Z');

      // Undo/redo integrity
      let history = createEditorHistory(journey);
      const modifiedJourney = {
        ...journey,
        name: 'Renamed Run',
      };
      history = pushEditorHistory(history, modifiedJourney);
      expect(history.present.name).toBe('Renamed Run');

      history = undoEditorHistory(history);
      expect(history.present.segments[0].points).toHaveLength(4);
      expect(history.present.segments[0].points[0].time).toBe('2026-08-10T08:00:00Z');
    });
  });

  // ── 5. Provenance Categorization & Fallback Distinction ──
  describe('Geometry Category Distinction & Diagnostics', () => {
    it('correctly categorizes verified network, recorded tracks, manual direct, and estimated fallbacks without mislabeling', () => {
      // 1. Manual direct segment
      const manualSeg: JourneySegment = {
        id: 'seg-manual',
        type: 'road',
        transportMode: 'car',
        sourceFormat: 'manual',
        points: [
          { lat: 46.0, lng: 7.0 },
          { lat: 46.1, lng: 7.1 },
        ],
      };
      expect(getSegmentGeometryCategory(manualSeg)).toBe('manual_direct');

      // 2. Recorded track
      const gpxSeg: JourneySegment = {
        id: 'seg-gpx',
        type: 'trail',
        transportMode: 'hike',
        sourceFormat: 'gpx',
        points: [
          { lat: 46.0, lng: 7.0 },
          { lat: 46.1, lng: 7.1 },
        ],
        metadata: { isOriginalImport: true },
      };
      expect(getSegmentGeometryCategory(gpxSeg)).toBe('recorded_track');

      // 3. Verified network
      const networkSeg: JourneySegment = {
        id: 'seg-network',
        type: 'road',
        transportMode: 'car',
        sourceFormat: 'osrm',
        points: [
          { lat: 46.0, lng: 7.0 },
          { lat: 46.05, lng: 7.05 },
          { lat: 46.1, lng: 7.1 },
        ],
        metadata: {
          routing: { providerId: 'osrm', profile: 'driving' },
          provenance: { category: 'verified_network' },
        },
      };
      expect(getSegmentGeometryCategory(networkSeg)).toBe('verified_network');

      // 4. Estimated fallback
      const fallbackSeg: JourneySegment = {
        id: 'seg-fallback',
        type: 'road',
        transportMode: 'car',
        sourceFormat: 'manual',
        points: [
          { lat: 46.0, lng: 7.0 },
          { lat: 46.1, lng: 7.1 },
        ],
        metadata: {
          isEstimatedFallback: true,
          provenance: { category: 'estimated_fallback', isEstimatedFallback: true },
        },
      };
      expect(getSegmentGeometryCategory(fallbackSeg)).toBe('estimated_fallback');
    });

    it('diagnostics report accurately counts all geometry categories', () => {
      const journey = createJourney('Provenance Audit Journey');
      journey.segments = [
        {
          id: 's1',
          type: 'road',
          transportMode: 'car',
          sourceFormat: 'manual',
          points: [{ lat: 46.0, lng: 7.0 }, { lat: 46.1, lng: 7.1 }],
          metadata: { provenance: { category: 'manual_direct' } },
        },
        {
          id: 's2',
          type: 'road',
          transportMode: 'car',
          sourceFormat: 'osrm',
          points: [{ lat: 46.1, lng: 7.1 }, { lat: 46.15, lng: 7.15 }, { lat: 46.2, lng: 7.2 }],
          metadata: { provenance: { category: 'verified_network' } },
        },
        {
          id: 's3',
          type: 'trail',
          transportMode: 'hike',
          sourceFormat: 'gpx',
          points: [{ lat: 46.2, lng: 7.2 }, { lat: 46.25, lng: 7.25 }],
          metadata: { isOriginalImport: true },
        },
      ];

      const report = auditJourneyDiagnostics(journey);
      expect(report.metrics.geometryCategories).toBeDefined();
      expect(report.metrics.geometryCategories.manualDirectCount).toBe(1);
      expect(report.metrics.geometryCategories.verifiedNetworkCount).toBe(1);
      expect(report.metrics.geometryCategories.recordedTrackCount).toBe(1);
      expect(report.metrics.geometryCategories.estimatedFallbackCount).toBe(0);
    });
  });

  // ── 6. Live OSRM Provider Integration Check ──
  describe('Live OSRM Provider Integration Check', () => {
    it('queries live OSRM endpoint for real road network geometry if available, with graceful offline fallback', async () => {
      const osrm = new OsrmRoutingProvider({ timeoutMs: 4000 });
      const request: RouteRequest = {
        origin: { lat: 46.9480, lng: 7.4474, name: 'Bern' },
        destination: { lat: 47.3769, lng: 8.5417, name: 'Zurich' },
        profile: 'driving',
      };

      try {
        const result = await osrm.calculateRoute(request);
        if (result.success) {
          // Live provider succeeded
          expect(result.points.length).toBeGreaterThan(10);
          expect(result.distanceMetres).toBeGreaterThan(100000); // Bern to Zurich is > 100km
          expect(result.metadata.providerId).toBe('osrm');
          expect(result.metadata.attribution).toContain('OpenStreetMap');
        } else {
          // If rate-limited, timed out, or offline, verify it reported an honest error code without throwing
          expect(['RATE_LIMITED', 'TIMEOUT', 'NETWORK_ERROR', 'NO_ROUTE']).toContain(result.error?.code);
        }
      } catch (err) {
        // Any unhandled throw is a failure
        expect(err).toBeUndefined();
      }
    }, 12000);
  });
});
