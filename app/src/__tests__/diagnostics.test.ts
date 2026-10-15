import { describe, it, expect } from 'vitest';
import {
  auditJourneyDiagnostics,
  calculateElevationGainLoss,
} from '../domain/diagnostics';
import {
  journeyFromWaypoints,
  createRoutePoint,
  createSegment,
  addSegmentToJourney,
} from '../domain/journey';
import {
  createEditorHistory,
  pushEditorHistory,
  undoEditorHistory,
  redoEditorHistory,
  insertRoutePoint,
} from '../domain/editor';
import { evaluateTimeline } from '../domain/timeline';
import { MIXED_JOURNEY_WAYPOINTS } from './fixtures';

describe('Geographic Quality Diagnostics Module', () => {
  it('validates a clean, well-formed multi-modal journey', () => {
    const journey = journeyFromWaypoints('Alpine Mixed', MIXED_JOURNEY_WAYPOINTS);
    const report = auditJourneyDiagnostics(journey);

    expect(report.isValid).toBe(true);
    expect(report.errorCount).toBe(0);
    expect(report.metrics.totalSegments).toBe(journey.segments.length);
    expect(report.metrics.totalPoints).toBeGreaterThan(0);
    expect(report.metrics.totalDistanceMetres).toBeGreaterThan(0);
    expect(report.metrics.elevationGainMetres).toBeGreaterThan(0);
    expect(report.metrics.elevationLossMetres).toBeGreaterThanOrEqual(0);
  });

  it('detects invalid latitude, longitude, and NaN coordinates as errors', () => {
    const journey = journeyFromWaypoints('Bad Coords', [
      { lat: 46.5, lng: 8.0, name: 'A', ele: 1000 },
      { lat: 95.0, lng: 8.5, name: 'B (Bad Lat)', ele: 1100 },
      { lat: 47.0, lng: 200.0, name: 'C (Bad Lng)', ele: 1200 },
      { lat: NaN, lng: 8.8, name: 'D (NaN Lat)', ele: 1300 },
    ]);

    const report = auditJourneyDiagnostics(journey);

    expect(report.isValid).toBe(false);
    expect(report.errorCount).toBeGreaterThanOrEqual(3);

    const invalidIssues = report.issues.filter((i) => i.code === 'INVALID_COORDINATES');
    expect(invalidIssues.length).toBeGreaterThanOrEqual(3);
    expect(invalidIssues[0].severity).toBe('error');
  });

  it('flags segments with fewer than 2 points as invalid single-point segments', () => {
    let journey = journeyFromWaypoints('Valid Base', MIXED_JOURNEY_WAYPOINTS);
    const invalidSegment = createSegment('road', 'car', [createRoutePoint(8.0, 46.0, 500)]);
    journey = addSegmentToJourney(journey, invalidSegment);

    const report = auditJourneyDiagnostics(journey);

    expect(report.isValid).toBe(false);
    const singlePtIssue = report.issues.find((i) => i.code === 'SINGLE_POINT_SEGMENT');
    expect(singlePtIssue).toBeDefined();
    expect(singlePtIssue?.severity).toBe('error');
  });

  it('identifies consecutive duplicate points (< 0.1m) and warns about redundant geometry', () => {
    const journey = journeyFromWaypoints('Duplicate Test', [
      { lat: 46.50000, lng: 8.00000, name: 'Start' },
      { lat: 46.50000, lng: 8.00000, name: 'Duplicate' }, // Exact duplicate
      { lat: 46.55000, lng: 8.05000, name: 'End' },
    ]);

    const report = auditJourneyDiagnostics(journey);

    expect(report.hasWarnings).toBe(true);
    const dupIssue = report.issues.find((i) => i.code === 'DUPLICATE_POINTS');
    expect(dupIssue).toBeDefined();
    expect(dupIssue?.severity).toBe('warning');
  });

  it('detects sparse 2-point routes spanning long distances (> 50km)', () => {
    const journey = journeyFromWaypoints('Sparse Route', [
      { lat: 37.7749, lng: -122.4194, name: 'San Francisco' },
      { lat: 34.0522, lng: -118.2437, name: 'Los Angeles' },
    ]);

    const report = auditJourneyDiagnostics(journey);

    const sparseIssue = report.issues.find((i) => i.code === 'SPARSE_ROUTE');
    expect(sparseIssue).toBeDefined();
    expect(sparseIssue?.severity).toBe('info');
    expect(sparseIssue?.details?.distanceMetres).toBeGreaterThan(500000); // SF to LA is > 500km
  });

  it('detects discontinuous segment boundaries where end of seg i does not connect to start of seg i+1', () => {
    let journey = journeyFromWaypoints('Seg 1', [
      { lat: 46.60, lng: 8.00, name: 'A' },
      { lat: 46.65, lng: 8.05, name: 'B' },
    ]);

    // Segment 2 starts 15km away
    const seg2 = createSegment('trail', 'hike', [
      createRoutePoint(8.25, 46.75, 1200),
      createRoutePoint(8.30, 46.80, 1500),
    ]);
    journey = addSegmentToJourney(journey, seg2);

    const report = auditJourneyDiagnostics(journey);

    expect(report.hasWarnings).toBe(true);
    const gapIssue = report.issues.find((i) => i.code === 'DISCONTINUOUS_SEGMENT_BOUNDARY');
    expect(gapIssue).toBeDefined();
    expect(gapIssue?.severity).toBe('warning');
    expect(gapIssue?.details?.gapMetres).toBeGreaterThan(1000);
    expect(report.metrics.boundaryGapsCount).toBe(1);
  });

  it('detects missing and partial elevation coverage honestly without inventing fake numbers', () => {
    // 100% missing elevation
    const noElevationJourney = journeyFromWaypoints('No Ele', [
      { lat: 46.5, lng: 8.0, name: 'A' },
      { lat: 46.6, lng: 8.1, name: 'B' },
    ]);
    const report1 = auditJourneyDiagnostics(noElevationJourney);
    expect(report1.metrics.elevationCoveragePct).toBe(0);
    expect(report1.issues.some((i) => i.code === 'MISSING_ELEVATIONS' && i.severity === 'info')).toBe(true);

    // Partial elevation coverage (e.g. 50%)
    const partialJourney = journeyFromWaypoints('Partial Ele', [
      { lat: 46.5, lng: 8.0, ele: 1000, name: 'A' },
      { lat: 46.6, lng: 8.1, name: 'B' }, // Missing elevation
    ]);
    const report2 = auditJourneyDiagnostics(partialJourney);
    expect(report2.metrics.elevationCoveragePct).toBe(50);
    expect(report2.issues.some((i) => i.code === 'MISSING_ELEVATIONS' && i.severity === 'warning')).toBe(true);
  });

  it('detects implausible vertical elevation changes and steep glitches', () => {
    const glitchJourney = journeyFromWaypoints('Elevation Glitch', [
      { lat: 46.5000, lng: 8.0000, ele: 1000, name: 'Base' },
      { lat: 46.5001, lng: 8.0001, ele: 2600, name: 'Glitch Peak' }, // 1600m jump in ~15 meters horizontal!
      { lat: 46.5002, lng: 8.0002, ele: 1020, name: 'Return' },
    ]);

    const report = auditJourneyDiagnostics(glitchJourney);

    expect(report.hasWarnings).toBe(true);
    const jumpIssue = report.issues.find((i) => i.code === 'IMPLAUSIBLE_ELEVATION_DELTA');
    expect(jumpIssue).toBeDefined();
    expect(jumpIssue?.severity).toBe('warning');
  });

  it('detects suspicious negative elevation below lowest dry land on Earth', () => {
    const trenchJourney = journeyFromWaypoints('Submarine Trench', [
      { lat: 46.5, lng: 8.0, ele: -1000, name: 'Abyss' }, // -1000m on land!
      { lat: 46.6, lng: 8.1, ele: 500, name: 'Coast' },
    ]);

    const report = auditJourneyDiagnostics(trenchJourney);

    const negIssue = report.issues.find((i) => i.code === 'SUSPICIOUS_NEGATIVE_ELEVATION');
    expect(negIssue).toBeDefined();
    expect(negIssue?.severity).toBe('warning');
  });

  it('accurately calculates elevation gain and loss without synthesizing missing data', () => {
    const points = [
      { lat: 46.0, lng: 8.0, ele: 1000 },
      { lat: 46.1, lng: 8.1, ele: 1250 }, // +250m
      { lat: 46.2, lng: 8.2, ele: 1100 }, // -150m
      { lat: 46.3, lng: 8.3 },             // undefined (should not contribute to gain/loss)
      { lat: 46.4, lng: 8.4, ele: 1400 }, // undefined to 1400: cannot compute delta, ignored
      { lat: 46.5, lng: 8.5, ele: 1350 }, // -50m
    ];

    const { gain, loss } = calculateElevationGainLoss(points);

    // Only transitions with both ends defined: (1000->1250: +250), (1250->1100: -150), (1400->1350: -50)
    expect(gain).toBe(250);
    expect(loss).toBe(200);
  });

  it('tracks diagnostics changes across route edits and undo/redo operations', () => {
    const baseJourney = journeyFromWaypoints('Editor Track', [
      { lat: 46.5, lng: 8.0, ele: 800, name: 'P1' },
      { lat: 46.6, lng: 8.1, ele: 900, name: 'P2' },
    ]);

    let history = createEditorHistory(baseJourney);
    expect(auditJourneyDiagnostics(history.present).warningCount).toBe(0);

    // Insert an exact duplicate point right next to P1
    const dupPoint = createRoutePoint(8.0, 46.5, 800);
    const modifiedJourney = insertRoutePoint(baseJourney, baseJourney.segments[0].id, 1, dupPoint);
    history = pushEditorHistory(history, modifiedJourney);

    // Diagnostics should report duplicate point warning
    const warnedReport = auditJourneyDiagnostics(history.present);
    expect(warnedReport.hasWarnings).toBe(true);
    expect(warnedReport.warningCount).toBeGreaterThan(0);
    expect(warnedReport.issues.some((i) => i.code === 'DUPLICATE_POINTS')).toBe(true);

    // Undo should restore clean state without duplicate warning
    history = undoEditorHistory(history);
    const revertedReport = auditJourneyDiagnostics(history.present);
    expect(revertedReport.warningCount).toBe(0);
    expect(revertedReport.issues.some((i) => i.code === 'DUPLICATE_POINTS')).toBe(false);

    // Redo brings back the duplicate point and warning
    history = redoEditorHistory(history);
    expect(auditJourneyDiagnostics(history.present).warningCount).toBeGreaterThan(0);
  });

  it('confirms deterministic timeline evaluation before and after route editing', () => {
    const journey = journeyFromWaypoints('Timeline Route', MIXED_JOURNEY_WAYPOINTS);
    const segId = journey.segments[0].id;

    // Evaluate frame at t=5.0s
    const frame1 = evaluateTimeline(journey, 5.0);
    const frame2 = evaluateTimeline(journey, 5.0);
    expect(frame1.position).toEqual(frame2.position);
    expect(frame1.bearing).toBe(frame2.bearing);

    // Insert intermediate point
    const midPoint = createRoutePoint(8.03, 46.615, 1050);
    const editedJourney = insertRoutePoint(journey, segId, 1, midPoint);

    // Edited journey evaluates deterministically
    const editedFrame1 = evaluateTimeline(editedJourney, 5.0);
    const editedFrame2 = evaluateTimeline(editedJourney, 5.0);
    expect(editedFrame1.position).toEqual(editedFrame2.position);
    expect(editedFrame1.bearing).toBe(editedFrame2.bearing);
    expect(Number.isFinite(editedFrame1.position.lat)).toBe(true);
    expect(Number.isFinite(editedFrame1.position.lng)).toBe(true);
  });
});
