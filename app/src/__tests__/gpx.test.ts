/* ─── GPX Import Unit & Acceptance Tests ───────────────────────────── */

import { describe, it, expect } from 'vitest';
import { parseGpx, GpxParseError } from '../domain/gpx';
import {
  serializeProject,
  deserializeProject,
} from '../domain/serialization';
import {
  createJourney,
  createSegment,
  createRoutePoint,
  addSegmentToJourney,
  addStopToJourney,
  validateJourney,
} from '../domain/journey';
import { evaluateTimeline } from '../domain/timeline';
import type { ProvenanceMetadata } from '../domain/types';

// ── Synthetic Fixtures (Clearly labelled) ──

const SYNTHETIC_VALID_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Wayvora Test Suite" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>Alpine Ridge Trail</name>
    <desc>Synthetic mountain hiking track for unit testing</desc>
    <time>2026-08-10T07:00:00Z</time>
  </metadata>
  <wpt lat="46.5700" lon="7.9350">
    <name>Stechelberg Trailhead</name>
    <desc>Hike departure point</desc>
    <ele>915</ele>
    <sym>Trailhead</sym>
  </wpt>
  <wpt lat="46.5450" lon="7.9700">
    <name>Hut Summit</name>
    <ele>2240</ele>
    <sym>Summit</sym>
  </wpt>
  <trk>
    <name>Ascent Track</name>
    <trkseg>
      <trkpt lat="46.5700" lon="7.9350">
        <ele>915.0</ele>
        <time>2026-08-10T07:00:00Z</time>
      </trkpt>
      <trkpt lat="46.5680" lon="7.9380">
        <ele>1040.5</ele>
        <time>2026-08-10T07:15:00Z</time>
      </trkpt>
      <trkpt lat="46.5650" lon="7.9420">
        <ele>1180.2</ele>
        <time>2026-08-10T07:30:00Z</time>
      </trkpt>
      <trkpt lat="46.5620" lon="7.9450">
        <ele>1320.0</ele>
        <time>2026-08-10T07:45:00Z</time>
      </trkpt>
      <trkpt lat="46.5450" lon="7.9700">
        <ele>2240.0</ele>
        <time>2026-08-10T09:30:00Z</time>
      </trkpt>
    </trkseg>
  </trk>
</gpx>`;

const SYNTHETIC_MULTI_SEGMENT_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Wayvora Test">
  <trk>
    <name>Two-Stage Mountain Route</name>
    <trkseg>
      <trkpt lat="46.0000" lon="8.0000"><ele>1000</ele></trkpt>
      <trkpt lat="46.0100" lon="8.0100"><ele>1200</ele></trkpt>
      <trkpt lat="46.0200" lon="8.0200"><ele>1400</ele></trkpt>
    </trkseg>
    <trkseg>
      <trkpt lat="46.0500" lon="8.0500"><ele>1600</ele></trkpt>
      <trkpt lat="46.0600" lon="8.0600"><ele>1800</ele></trkpt>
      <trkpt lat="46.0700" lon="8.0700"><ele>2000</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;

const SYNTHETIC_NO_ELEVATION_NO_TIME_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Basic Plan">
  <trk>
    <name>Flat 2D Track</name>
    <trkseg>
      <trkpt lat="37.7749" lon="-122.4194"/>
      <trkpt lat="37.7755" lon="-122.4180"/>
      <trkpt lat="37.7760" lon="-122.4170"/>
    </trkseg>
  </trk>
</gpx>`;

const SYNTHETIC_DUPLICATES_AND_GAPS_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Gap Test">
  <trk>
    <name>Track with Duplicate and 2hr Gap</name>
    <trkseg>
      <trkpt lat="46.1000" lon="8.1000">
        <ele>500</ele>
        <time>2026-08-10T08:00:00Z</time>
      </trkpt>
      <!-- Duplicate adjacent point -->
      <trkpt lat="46.1000" lon="8.1000">
        <ele>500</ele>
        <time>2026-08-10T08:00:10Z</time>
      </trkpt>
      <trkpt lat="46.1050" lon="8.1050">
        <ele>520</ele>
        <time>2026-08-10T08:15:00Z</time>
      </trkpt>
      <!-- 2 hour timestamp gap (pause or lunch break) -->
      <trkpt lat="46.1100" lon="8.1100">
        <ele>540</ele>
        <time>2026-08-10T10:15:00Z</time>
      </trkpt>
    </trkseg>
  </trk>
</gpx>`;

const SYNTHETIC_ROUTE_RTE_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Route Planner">
  <rte>
    <name>Navigated Scenic Byway</name>
    <rtept lat="47.100" lon="9.100"><ele>450</ele></rtept>
    <rtept lat="47.120" lon="9.120"><ele>480</ele></rtept>
    <rtept lat="47.140" lon="9.140"><ele>510</ele></rtept>
  </rte>
</gpx>`;

// Real-world sample excerpt from Kokoda Walk (provenance: Relive GPS activity recording)
const REAL_ACTIVITY_GPX_EXCERPT = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Relive GPS" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>Kokoda Walk - 1000 Steps</name>
    <time>2024-05-03T03:46:42.000Z</time>
  </metadata>
  <trk>
    <name>Kokoda Walk Track</name>
    <trkseg>
      <trkpt lat="-37.888092" lon="145.317571">
        <time>2024-05-03T03:46:42.000Z</time>
        <ele>202.84</ele>
      </trkpt>
      <trkpt lat="-37.888089" lon="145.317577">
        <time>2024-05-03T03:46:43.000Z</time>
        <ele>202.82</ele>
      </trkpt>
      <trkpt lat="-37.888089" lon="145.317582">
        <time>2024-05-03T03:46:44.000Z</time>
        <ele>202.80</ele>
      </trkpt>
      <trkpt lat="-37.887905" lon="145.317588">
        <time>2024-05-03T03:47:06.000Z</time>
        <ele>202.03</ele>
      </trkpt>
      <trkpt lat="-37.887886" lon="145.317584">
        <time>2024-05-03T03:47:07.000Z</time>
        <ele>202.03</ele>
      </trkpt>
    </trkseg>
  </trk>
</gpx>`;

describe('GPX Parser Core Functionality', () => {
  it('parses valid GPX track with elevations, timestamps, metadata, and waypoints', () => {
    const result = parseGpx(SYNTHETIC_VALID_GPX, 'alpine_ridge.gpx');

    expect(result.metadata.name).toBe('Alpine Ridge Trail');
    expect(result.metadata.creator).toBe('Wayvora Test Suite');
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0].name).toBe('Ascent Track');

    const seg = result.tracks[0].segments[0];
    expect(seg.points).toHaveLength(5);
    expect(seg.points[0].ele).toBe(915.0);
    expect(seg.points[0].time).toBe('2026-08-10T07:00:00Z');
    expect(seg.points[4].ele).toBe(2240.0);

    // Summary metrics
    expect(result.summary.totalPoints).toBe(5);
    expect(result.summary.elevationCoveragePct).toBe(100);
    expect(result.summary.timestampCoveragePct).toBe(100);
    expect(result.summary.minElevation).toBe(915);
    expect(result.summary.maxElevation).toBe(2240);
    expect(result.summary.elevationGainMetres).toBe(1325); // 2240 - 915
    expect(result.summary.durationSeconds).toBe(9000); // 2.5 hours = 9000s
    expect(result.summary.duplicatePointsSkipped).toBe(0);

    // Waypoints
    expect(result.waypoints).toHaveLength(2);
    expect(result.waypoints[0].name).toBe('Stechelberg Trailhead');
    expect(result.waypoints[1].name).toBe('Hut Summit');
  });

  it('parses real GPS activity excerpt with sub-second precision and micro-elevations', () => {
    const result = parseGpx(REAL_ACTIVITY_GPX_EXCERPT, 'kokoda.gpx');

    expect(result.summary.name).toBe('Kokoda Walk - 1000 Steps');
    expect(result.summary.totalPoints).toBe(5);
    expect(result.summary.elevationCoveragePct).toBe(100);
    expect(result.summary.timestampCoveragePct).toBe(100);
    expect(result.tracks[0].segments[0].points[0].lat).toBeCloseTo(-37.888092, 5);
    expect(result.tracks[0].segments[0].points[0].lng).toBeCloseTo(145.317571, 5);
  });

  it('handles routes with missing elevation and missing timestamps without inventing data', () => {
    const result = parseGpx(SYNTHETIC_NO_ELEVATION_NO_TIME_GPX, 'flat_route.gpx');

    expect(result.summary.totalPoints).toBe(3);
    expect(result.summary.elevationCoveragePct).toBe(0);
    expect(result.summary.timestampCoveragePct).toBe(0);
    expect(result.summary.minElevation).toBeUndefined();
    expect(result.summary.maxElevation).toBeUndefined();
    expect(result.summary.durationSeconds).toBeUndefined();

    // Verify points have undefined ele and time
    for (const p of result.tracks[0].segments[0].points) {
      expect(p.ele).toBeUndefined();
      expect(p.time).toBeUndefined();
    }

    // Honest warnings reported
    expect(result.summary.warnings.some(w => w.includes('No elevation samples'))).toBe(true);
    expect(result.summary.warnings.some(w => w.includes('No timestamps'))).toBe(true);
  });

  it('handles multiple track segments without silently merging them', () => {
    const result = parseGpx(SYNTHETIC_MULTI_SEGMENT_GPX, 'two_stages.gpx');

    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0].segments).toHaveLength(2);
    expect(result.tracks[0].segments[0].points).toHaveLength(3);
    expect(result.tracks[0].segments[1].points).toHaveLength(3);

    // Converting to domain segments must yield 2 separate segments
    const journeySegs = result.toJourneySegments();
    expect(journeySegs).toHaveLength(2);
    expect(journeySegs[0].type).toBe('trail');
    expect(journeySegs[1].type).toBe('trail');
    expect((journeySegs[0].metadata?.provenance as ProvenanceMetadata)?.originalSegmentIndex).toBe(0);
    expect((journeySegs[1].metadata?.provenance as ProvenanceMetadata)?.originalSegmentIndex).toBe(1);
  });

  it('handles GPX routes (<rte>) as fallback when no <trk> elements exist', () => {
    const result = parseGpx(SYNTHETIC_ROUTE_RTE_GPX, 'byway.gpx');

    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0].name).toBe('Navigated Scenic Byway');
    expect(result.tracks[0].segments[0].points).toHaveLength(3);
    expect(result.tracks[0].segments[0].points[0].ele).toBe(450);
  });

  it('detects and skips duplicate adjacent points and flags timestamp gaps', () => {
    const result = parseGpx(SYNTHETIC_DUPLICATES_AND_GAPS_GPX, 'gaps_test.gpx');

    expect(result.summary.duplicatePointsSkipped).toBe(1);
    expect(result.summary.timestampGapsCount).toBe(1);
    expect(result.summary.totalPoints).toBe(3); // 4 points - 1 duplicate = 3
    expect(result.summary.warnings.some(w => w.includes('exceeding 1 hour'))).toBe(true);
  });

  it('maps GPX waypoints to domain Stop objects accurately', () => {
    const result = parseGpx(SYNTHETIC_VALID_GPX, 'waypoints_test.gpx');
    const stops = result.toStops();

    expect(stops).toHaveLength(2);
    expect(stops[0].name).toBe('Stechelberg Trailhead');
    expect(stops[0].type).toBe('start');
    expect(stops[0].position.ele).toBe(915);
    expect(stops[0].description).toBe('Hike departure point');

    expect(stops[1].name).toBe('Hut Summit');
    expect(stops[1].type).toBe('sight'); // 'Summit' symbol maps to sight
    expect(stops[1].position.ele).toBe(2240);
  });
});

describe('GPX Error Handling & Malformed Input', () => {
  it('throws GpxParseError for empty or whitespace-only files', () => {
    expect(() => parseGpx('')).toThrow(GpxParseError);
    expect(() => parseGpx('   \n  \t')).toThrow(GpxParseError);
  });

  it('throws GpxParseError when missing <gpx> root element', () => {
    expect(() => parseGpx('<html><body>Not a GPX</body></html>')).toThrow(GpxParseError);
    expect(() => parseGpx('{"type": "FeatureCollection"}')).toThrow(GpxParseError);
  });

  it('throws GpxParseError for severely malformed XML with unbalanced tags', () => {
    const malformed = '<gpx><trk><trkseg><trkpt lat="10" lon="20"><ele>100';
    expect(() => parseGpx(malformed)).toThrow(GpxParseError);
  });

  it('skips trackpoints with out-of-bounds coordinates and logs warnings', () => {
    const invalidCoordsGpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1">
  <trk>
    <trkseg>
      <trkpt lat="46.0" lon="8.0"><ele>500</ele></trkpt>
      <trkpt lat="95.0" lon="8.0"><ele>510</ele></trkpt> <!-- Invalid lat > 90 -->
      <trkpt lat="46.2" lon="195.0"><ele>520</ele></trkpt> <!-- Invalid lon > 180 -->
      <trkpt lat="46.3" lon="8.3"><ele>530</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;

    const result = parseGpx(invalidCoordsGpx);
    expect(result.summary.totalPoints).toBe(2); // Only the 2 valid points kept
    expect(result.summary.warnings.some(w => w.includes('invalid latitude'))).toBe(true);
    expect(result.summary.warnings.some(w => w.includes('invalid longitude'))).toBe(true);
  });
});

describe('Domain Integration & Mixed Journey Roundtrip', () => {
  it('appends an imported GPX hiking trail to an existing road journey without data loss', () => {
    // 1. Existing road journey
    let journey = createJourney('Interlaken to Summit Mixed Tour');
    const roadPoints = [
      createRoutePoint(7.8632, 46.6863, 568),
      createRoutePoint(7.9350, 46.5700, 915),
    ];
    const roadSeg = createSegment('road', 'car', roadPoints, 'manual');
    journey = addSegmentToJourney(journey, roadSeg);

    // 2. Parse GPX trail
    const gpxResult = parseGpx(SYNTHETIC_VALID_GPX, 'alpine_ascent.gpx');
    const trailSegments = gpxResult.toJourneySegments({ mode: 'hike' });
    const trailStops = gpxResult.toStops(journey.segments.length);

    // Append to journey
    for (const seg of trailSegments) {
      journey = addSegmentToJourney(journey, seg);
    }
    for (const st of trailStops) {
      journey = addStopToJourney(journey, st);
    }

    // 3. Validation
    const errors = validateJourney(journey);
    expect(errors).toEqual([]);

    // 4. Verify mixed structure
    expect(journey.segments).toHaveLength(2);
    expect(journey.segments[0].type).toBe('road');
    expect(journey.segments[0].transportMode).toBe('car');
    expect(journey.segments[1].type).toBe('trail');
    expect(journey.segments[1].transportMode).toBe('hike');
    expect(journey.segments[1].sourceFormat).toBe('gpx');
    expect((journey.segments[1].metadata?.provenance as ProvenanceMetadata)?.filename).toBe('alpine_ascent.gpx');

    // 5. Timeline evaluation
    const frameStart = evaluateTimeline(journey, 0);
    expect(frameStart.position.lng).toBeCloseTo(7.8632);

    const frameEnd = evaluateTimeline(journey, journey.timeline.duration);
    expect(frameEnd.position.ele).toBe(2240);

    // 6. Roundtrip serialization to .wayvora.json
    const serializedJson = serializeProject(journey);
    const restored = deserializeProject(serializedJson);

    expect(restored.segments).toHaveLength(2);
    expect(restored.segments[1].sourceFormat).toBe('gpx');
    expect((restored.segments[1].metadata?.provenance as ProvenanceMetadata)?.filename).toBe('alpine_ascent.gpx');
    expect(restored.stops).toHaveLength(2);
    expect(restored.stops[1].name).toBe('Hut Summit');

    // Frame evaluation matches before and after reload
    const frameReloadedEnd = evaluateTimeline(restored, restored.timeline.duration);
    expect(frameReloadedEnd.position.ele).toBe(2240);
    expect(frameReloadedEnd.position.lng).toBeCloseTo(frameEnd.position.lng);
  });
});
