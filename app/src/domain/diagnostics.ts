/* ─── Geographic Quality Diagnostics Module ──────────────────────────────
   Inspects, audits, and reports on the geographic health of a Journey:
   - Coordinate boundary validation (-90..90, -180..180, NaN checks)
   - Sparse routes and single-point segment validation
   - Consecutive duplicate point detection (< 0.1m)
   - Segment boundary continuity (spatial gaps between consecutive segments)
   - Elevation coverage, gain/loss audit, and implausible vertical jumps (> 500m / 100m)
   - Pure analysis: NEVER invents or synthesizes fake elevation numbers.
   ─────────────────────────────────────────────────────────────────── */

import type { Journey, RoutePoint } from './types';
import { getSegmentGeometryCategory } from './types';
import { haversineDistance } from './geo';

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export type DiagnosticCode =
  | 'INVALID_COORDINATES'
  | 'SINGLE_POINT_SEGMENT'
  | 'SPARSE_ROUTE'
  | 'DUPLICATE_POINTS'
  | 'DISCONTINUOUS_SEGMENT_BOUNDARY'
  | 'MISSING_ELEVATIONS'
  | 'IMPLAUSIBLE_ELEVATION_DELTA'
  | 'SUSPICIOUS_NEGATIVE_ELEVATION';

export interface DiagnosticIssue {
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  segmentId?: string;
  segmentIndex?: number;
  pointIndex?: number;
  details?: Record<string, unknown>;
}

export interface DiagnosticMetrics {
  totalSegments: number;
  totalPoints: number;
  totalDistanceMetres: number;
  elevationCoveragePct: number;
  elevationGainMetres: number;
  elevationLossMetres: number;
  boundaryGapsCount: number;
  maxBoundaryGapMetres: number;
  geometryCategories: {
    verifiedNetworkCount: number;
    recordedTrackCount: number;
    manualDirectCount: number;
    estimatedFallbackCount: number;
  };
}

export interface JourneyDiagnosticsReport {
  isValid: boolean; // false if any error exists
  hasWarnings: boolean;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  issues: DiagnosticIssue[];
  metrics: DiagnosticMetrics;
}

export interface DiagnosticOptions {
  boundaryGapThresholdMetres?: number; // default: 100m
  sparseRouteDistanceThresholdMetres?: number; // default: 50,000m (50km)
  maxPlausibleSlope?: number; // default: 5.0 (500m rise per 100m run = 500% slope)
  maxSingleStepElevationJumpMetres?: number; // default: 1000m
}

/**
 * Validates coordinate numbers.
 */
export function isCoordinateValid(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * Calculates accurate elevation gain and loss across a sequence of points.
 * Explicitly ignores missing elevation and NEVER invents values.
 */
export function calculateElevationGainLoss(points: RoutePoint[]): { gain: number; loss: number } {
  let gain = 0;
  let loss = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];

    if (p1.ele != null && p2.ele != null && Number.isFinite(p1.ele) && Number.isFinite(p2.ele)) {
      const delta = p2.ele - p1.ele;
      if (delta > 0) {
        gain += delta;
      } else if (delta < 0) {
        loss += Math.abs(delta);
      }
    }
  }

  return {
    gain: Math.round(gain),
    loss: Math.round(loss),
  };
}

/**
 * Audits a complete Journey and returns a comprehensive diagnostic report.
 */
export function auditJourneyDiagnostics(
  journey: Journey,
  options: DiagnosticOptions = {}
): JourneyDiagnosticsReport {
  const gapThreshold = options.boundaryGapThresholdMetres ?? 100;
  const sparseDistThreshold = options.sparseRouteDistanceThresholdMetres ?? 50000;
  const maxSingleJump = options.maxSingleStepElevationJumpMetres ?? 1000;

  const issues: DiagnosticIssue[] = [];

  let totalPointsCount = 0;
  let pointsWithElevationCount = 0;
  let totalDistanceMetres = 0;
  let totalGain = 0;
  let totalLoss = 0;
  let boundaryGapsCount = 0;
  let maxBoundaryGapMetres = 0;

  const geometryCategories = {
    verifiedNetworkCount: 0,
    recordedTrackCount: 0,
    manualDirectCount: 0,
    estimatedFallbackCount: 0,
  };

  journey.segments.forEach((seg, sIdx) => {
    const points = seg.points;
    totalPointsCount += points.length;

    // Track geometry category
    const cat = getSegmentGeometryCategory(seg);
    if (cat === 'verified_network') geometryCategories.verifiedNetworkCount++;
    else if (cat === 'recorded_track') geometryCategories.recordedTrackCount++;
    else if (cat === 'estimated_fallback') geometryCategories.estimatedFallbackCount++;
    else geometryCategories.manualDirectCount++;

    // Check minimum segment points
    if (points.length < 2) {
      issues.push({
        code: 'SINGLE_POINT_SEGMENT',
        severity: 'error',
        message: `Segment #${sIdx + 1} (${seg.id}) has only ${points.length} point(s). A valid path requires at least 2 points.`,
        segmentId: seg.id,
        segmentIndex: sIdx,
        details: { pointCount: points.length },
      });
    }

    let segmentDistance = 0;

    for (let pIdx = 0; pIdx < points.length; pIdx++) {
      const pt = points[pIdx];

      // Coordinate validity check
      if (!isCoordinateValid(pt.lat, pt.lng)) {
        issues.push({
          code: 'INVALID_COORDINATES',
          severity: 'error',
          message: `Segment #${sIdx + 1}, Point #${pIdx + 1} has invalid coordinates: (${pt.lat}, ${pt.lng}).`,
          segmentId: seg.id,
          segmentIndex: sIdx,
          pointIndex: pIdx,
          details: { lat: pt.lat, lng: pt.lng },
        });
      }

      // Elevation tracking
      if (pt.ele != null && Number.isFinite(pt.ele)) {
        pointsWithElevationCount++;

        // Lowest natural dry land on Earth is Dead Sea shore (~ -430m)
        if (pt.ele < -430) {
          issues.push({
            code: 'SUSPICIOUS_NEGATIVE_ELEVATION',
            severity: 'warning',
            message: `Segment #${sIdx + 1}, Point #${pIdx + 1} has suspicious negative elevation (${pt.ele}m, below -430m).`,
            segmentId: seg.id,
            segmentIndex: sIdx,
            pointIndex: pIdx,
            details: { elevation: pt.ele },
          });
        }
      }

      // Adjacent point checks (distance, duplicates, elevation slope)
      if (pIdx < points.length - 1) {
        const nextPt = points[pIdx + 1];
        if (isCoordinateValid(pt.lat, pt.lng) && isCoordinateValid(nextPt.lat, nextPt.lng)) {
          const stepDist = haversineDistance(pt, nextPt);
          segmentDistance += stepDist;

          // Duplicate point check
          if (stepDist < 0.1) {
            issues.push({
              code: 'DUPLICATE_POINTS',
              severity: 'warning',
              message: `Segment #${sIdx + 1} has consecutive duplicate points at #${pIdx + 1} and #${pIdx + 2} (distance: ${stepDist.toFixed(2)}m).`,
              segmentId: seg.id,
              segmentIndex: sIdx,
              pointIndex: pIdx,
              details: { stepDistMetres: stepDist },
            });
          }

          // Implausible vertical elevation change check
          if (
            pt.ele != null &&
            nextPt.ele != null &&
            Number.isFinite(pt.ele) &&
            Number.isFinite(nextPt.ele)
          ) {
            const verticalDelta = Math.abs(nextPt.ele - pt.ele);
            const isJumpTooLarge = verticalDelta > maxSingleJump;
            const isSlopeExtreme = stepDist > 0 && verticalDelta / stepDist > (options.maxPlausibleSlope ?? 5.0) && verticalDelta > 300;

            if (isJumpTooLarge || isSlopeExtreme) {
              issues.push({
                code: 'IMPLAUSIBLE_ELEVATION_DELTA',
                severity: 'warning',
                message: `Segment #${sIdx + 1} has implausible vertical elevation change between points #${pIdx + 1} and #${pIdx + 2}: Δ${verticalDelta}m over ${stepDist.toFixed(0)}m distance.`,
                segmentId: seg.id,
                segmentIndex: sIdx,
                pointIndex: pIdx,
                details: {
                  fromElevation: pt.ele,
                  toElevation: nextPt.ele,
                  verticalDelta,
                  stepDist,
                },
              });
            }
          }
        }
      }
    }

    totalDistanceMetres += segmentDistance;

    // Sparse route check: only 2 points but spans a massive distance
    if (points.length === 2 && segmentDistance > sparseDistThreshold) {
      issues.push({
        code: 'SPARSE_ROUTE',
        severity: 'info',
        message: `Segment #${sIdx + 1} is a sparse 2-point line spanning ${(segmentDistance / 1000).toFixed(1)}km. Consider routing or adding intermediate waypoints.`,
        segmentId: seg.id,
        segmentIndex: sIdx,
        details: { distanceMetres: segmentDistance, pointCount: points.length },
      });
    }

    // Elevation gain/loss for segment
    const { gain, loss } = calculateElevationGainLoss(points);
    totalGain += gain;
    totalLoss += loss;

    // Segment boundary continuity check (between seg i and seg i+1)
    if (sIdx < journey.segments.length - 1) {
      const nextSeg = journey.segments[sIdx + 1];
      if (points.length > 0 && nextSeg.points.length > 0) {
        const segEndPt = points[points.length - 1];
        const nextSegStartPt = nextSeg.points[0];

        if (
          isCoordinateValid(segEndPt.lat, segEndPt.lng) &&
          isCoordinateValid(nextSegStartPt.lat, nextSegStartPt.lng)
        ) {
          const boundaryGap = haversineDistance(segEndPt, nextSegStartPt);
          if (boundaryGap > gapThreshold) {
            boundaryGapsCount++;
            if (boundaryGap > maxBoundaryGapMetres) {
              maxBoundaryGapMetres = boundaryGap;
            }

            issues.push({
              code: 'DISCONTINUOUS_SEGMENT_BOUNDARY',
              severity: 'warning',
              message: `Gap between end of Segment #${sIdx + 1} (${seg.type}) and start of Segment #${sIdx + 2} (${nextSeg.type}) is ${(boundaryGap / 1000).toFixed(2)}km (threshold: ${gapThreshold}m).`,
              segmentId: seg.id,
              segmentIndex: sIdx,
              details: {
                gapMetres: boundaryGap,
                fromSegmentId: seg.id,
                toSegmentId: nextSeg.id,
              },
            });
          }
        }
      }
    }
  });

  // Global elevation coverage check
  const elevationCoveragePct = totalPointsCount > 0
    ? Math.round((pointsWithElevationCount / totalPointsCount) * 100)
    : 0;

  if (pointsWithElevationCount === 0 && totalPointsCount > 0) {
    issues.push({
      code: 'MISSING_ELEVATIONS',
      severity: 'info',
      message: 'Journey contains no elevation data (0% elevation coverage). Profile rendering is unavailable.',
      details: { coveragePct: 0 },
    });
  } else if (elevationCoveragePct > 0 && elevationCoveragePct < 100) {
    issues.push({
      code: 'MISSING_ELEVATIONS',
      severity: 'warning',
      message: `Journey has partial elevation coverage (${elevationCoveragePct}% of points have elevation). Some points lack elevation values.`,
      details: { coveragePct: elevationCoveragePct, missingPoints: totalPointsCount - pointsWithElevationCount },
    });
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const infoCount = issues.filter((i) => i.severity === 'info').length;

  return {
    isValid: errorCount === 0,
    hasWarnings: warningCount > 0,
    errorCount,
    warningCount,
    infoCount,
    issues,
    metrics: {
      totalSegments: journey.segments.length,
      totalPoints: totalPointsCount,
      totalDistanceMetres: Math.round(totalDistanceMetres),
      elevationCoveragePct,
      elevationGainMetres: totalGain,
      elevationLossMetres: totalLoss,
      boundaryGapsCount,
      maxBoundaryGapMetres: Math.round(maxBoundaryGapMetres),
      geometryCategories,
    },
  };
}
