/* ─── GPX Import Module ────────────────────────────────────────────────
   Focused, zero-dependency GPX (GPS Exchange Format) parser and domain converter.
   Compatible with both browser (DOMParser) and Node/testing environments.
   ─────────────────────────────────────────────────────────────────── */

import type {
  Journey,
  JourneySegment,
  Stop,
  RoutePoint,
  TransportMode,
  StopType,
} from './types';
import {
  createJourney,
  createSegment,
  createStop,
  addSegmentToJourney,
  addStopToJourney,
} from './journey';
import { haversineDistance } from './geo';

export class GpxParseError extends Error {
  constructor(message: string) {
    super(`GPX Parse Error: ${message}`);
    this.name = 'GpxParseError';
  }
}

export interface GpxMetadata {
  name?: string;
  desc?: string;
  author?: string;
  time?: string;
  creator?: string;
}

export interface GpxWaypoint {
  lat: number;
  lng: number;
  ele?: number;
  time?: string;
  name?: string;
  desc?: string;
  sym?: string;
  type?: string;
}

export interface GpxTrackSegment {
  points: RoutePoint[];
  pointCount: number;
  distanceMetres: number;
  elevationGainMetres: number;
  elevationLossMetres: number;
  pointsWithElevation: number;
  pointsWithTime: number;
}

export interface GpxTrack {
  name?: string;
  desc?: string;
  type?: string;
  segments: GpxTrackSegment[];
}

export interface GpxSummary {
  filename: string;
  importedAt: string;
  creator?: string;
  name?: string;
  description?: string;
  totalTracks: number;
  totalSegments: number;
  totalPoints: number;
  totalWaypoints: number;
  totalDistanceMetres: number;
  elevationCoveragePct: number;
  timestampCoveragePct: number;
  minElevation?: number;
  maxElevation?: number;
  elevationGainMetres: number;
  elevationLossMetres: number;
  startTime?: string;
  endTime?: string;
  durationSeconds?: number;
  duplicatePointsSkipped: number;
  timestampGapsCount: number;
  warnings: string[];
}

export interface GpxParseResult {
  metadata: GpxMetadata;
  tracks: GpxTrack[];
  waypoints: GpxWaypoint[];
  summary: GpxSummary;
  toJourney(options?: { name?: string; mode?: TransportMode }): Journey;
  toJourneySegments(options?: { mode?: TransportMode }): JourneySegment[];
  toStops(existingSegmentCount?: number): Stop[];
}

// ── XML Parsing Helpers ──

interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  content: string;
  children: XmlNode[];
}

function parseAttributes(attrStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z0-9_:.-]+)\s*=\s*(['"])(.*?)\2/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(attrStr)) !== null) {
    attrs[match[1].toLowerCase()] = match[3];
  }
  return attrs;
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Universal XML tokenizer for GPX elements.
 * Handles namespaces (<gpx:trkpt>), nested tags, and CDATA.
 */
function parseGpxXml(xmlText: string): XmlNode {
  if (!xmlText || typeof xmlText !== 'string' || !xmlText.trim()) {
    throw new GpxParseError('GPX file is empty');
  }

  // Remove XML comments and CDATA
  const sanitized = xmlText
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');

  // Validate root <gpx>
  const gpxMatch = /<([a-zA-Z0-9_:-]*gpx)\b([^>]*)>/i.exec(sanitized);
  if (!gpxMatch) {
    throw new GpxParseError('Not a valid GPX document: missing <gpx> root element');
  }

  // Validate closing </gpx> tag
  const isSelfClosing = /\/>$/.test(gpxMatch[0]);
  const hasClosingRoot = /<\/[a-zA-Z0-9_:-]*gpx\s*>/i.test(sanitized);
  if (!isSelfClosing && !hasClosingRoot) {
    throw new GpxParseError('Malformed GPX XML: unclosed <gpx> element');
  }

  // Check for malformed unclosed tags
  const openTags = (sanitized.match(/<[a-zA-Z0-9_:-]+(?:\s[^>]*)?[^\/]>/g) || []).length;
  const closeTags = (sanitized.match(/<\/[a-zA-Z0-9_:-]+>/g) || []).length;
  if (Math.abs(openTags - closeTags) > 2) {
    throw new GpxParseError('Malformed GPX XML: unbalanced tags detected');
  }

  const rootTag = gpxMatch[1];
  const rootAttrs = parseAttributes(gpxMatch[2]);

  return {
    tag: rootTag.toLowerCase(),
    attrs: rootAttrs,
    content: sanitized,
    children: [],
  };
}

function extractChildText(xml: string, tag: string): string | undefined {
  // Matches <tag>...</tag> or <ns:tag>...</ns:tag>
  const re = new RegExp(`<(?:[a-zA-Z0-9_:-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_:-]+:)?${tag}>`, 'i');
  const m = re.exec(xml);
  return m ? decodeXmlEntities(m[1].trim()) : undefined;
}

// ── Main Parser ──

export function parseGpx(
  gpxContent: string,
  filename = 'imported.gpx'
): GpxParseResult {
  const root = parseGpxXml(gpxContent);
  const xml = root.content;
  const warnings: string[] = [];

  // 1. Metadata
  const metadata: GpxMetadata = {
    creator: root.attrs['creator'],
  };

  const metadataBlock = /<metadata\b[^>]*>([\s\S]*?)<\/metadata>/i.exec(xml);
  if (metadataBlock) {
    const metaContent = metadataBlock[1];
    metadata.name = extractChildText(metaContent, 'name');
    metadata.desc = extractChildText(metaContent, 'desc');
    metadata.author = extractChildText(metaContent, 'author');
    metadata.time = extractChildText(metaContent, 'time');
  }

  // 2. Waypoints (<wpt>)
  const waypoints: GpxWaypoint[] = [];
  const wptRegex = /<wpt\b([^>]*)>([\s\S]*?)<\/wpt>|<wpt\b([^>]*)\/>/gi;
  let wptMatch: RegExpExecArray | null;

  while ((wptMatch = wptRegex.exec(xml)) !== null) {
    const attrStr = wptMatch[1] || wptMatch[3] || '';
    const innerContent = wptMatch[2] || '';
    const attrs = parseAttributes(attrStr);

    const lat = parseFloat(attrs['lat']);
    const lon = parseFloat(attrs['lon']);

    if (!Number.isFinite(lat) || Math.abs(lat) > 90) {
      warnings.push(`Ignored waypoint with invalid latitude: ${attrs['lat']}`);
      continue;
    }
    if (!Number.isFinite(lon) || Math.abs(lon) > 180) {
      warnings.push(`Ignored waypoint with invalid longitude: ${attrs['lon']}`);
      continue;
    }

    const eleStr = extractChildText(innerContent, 'ele');
    const ele = eleStr != null && !Number.isNaN(parseFloat(eleStr)) ? parseFloat(eleStr) : undefined;
    const time = extractChildText(innerContent, 'time');
    const name = extractChildText(innerContent, 'name');
    const desc = extractChildText(innerContent, 'desc');
    const sym = extractChildText(innerContent, 'sym');
    const type = extractChildText(innerContent, 'type');

    waypoints.push({
      lat,
      lng: lon,
      ele,
      time,
      name,
      desc,
      sym,
      type,
    });
  }

  // 3. Tracks (<trk>) and Routes (<rte>)
  const tracks: GpxTrack[] = [];
  let duplicatePointsSkipped = 0;
  let timestampGapsCount = 0;

  // Process <trk> elements
  const trkRegex = /<trk\b[^>]*>([\s\S]*?)<\/trk>/gi;
  let trkMatch: RegExpExecArray | null;

  while ((trkMatch = trkRegex.exec(xml)) !== null) {
    const trkXml = trkMatch[1];
    const trkName = extractChildText(trkXml, 'name');
    const trkDesc = extractChildText(trkXml, 'desc');
    const trkType = extractChildText(trkXml, 'type');

    const segments: GpxTrackSegment[] = [];

    // Parse each <trkseg> individually (critical: do not merge them!)
    const trksegRegex = /<trkseg\b[^>]*>([\s\S]*?)<\/trkseg>/gi;
    let segMatch: RegExpExecArray | null;

    while ((segMatch = trksegRegex.exec(trkXml)) !== null) {
      const segXml = segMatch[1];
      const parsedSeg = parsePointsBlock(segXml, 'trkpt', warnings);
      duplicatePointsSkipped += parsedSeg.duplicates;
      timestampGapsCount += parsedSeg.gaps;

      if (parsedSeg.points.length >= 2) {
        segments.push(parsedSeg.segment);
      } else if (parsedSeg.points.length === 1) {
        warnings.push(`Track segment had only 1 point and was omitted (minimum 2 points required)`);
      }
    }

    if (segments.length > 0) {
      tracks.push({
        name: trkName,
        desc: trkDesc,
        type: trkType,
        segments,
      });
    }
  }

  // Fallback: If no <trk> found, check for <rte> (route elements)
  if (tracks.length === 0) {
    const rteRegex = /<rte\b[^>]*>([\s\S]*?)<\/rte>/gi;
    let rteMatch: RegExpExecArray | null;

    while ((rteMatch = rteRegex.exec(xml)) !== null) {
      const rteXml = rteMatch[1];
      const rteName = extractChildText(rteXml, 'name');
      const rteDesc = extractChildText(rteXml, 'desc');
      const parsedRte = parsePointsBlock(rteXml, 'rtept', warnings);
      duplicatePointsSkipped += parsedRte.duplicates;
      timestampGapsCount += parsedRte.gaps;

      if (parsedRte.points.length >= 2) {
        tracks.push({
          name: rteName,
          desc: rteDesc,
          type: 'route',
          segments: [parsedRte.segment],
        });
      }
    }
  }

  // 4. Compute Statistical Summary & Coverage
  let totalPoints = 0;
  let totalSegments = 0;
  let totalDistanceMetres = 0;
  let totalElevationGain = 0;
  let totalElevationLoss = 0;
  let pointsWithElevation = 0;
  let pointsWithTime = 0;

  let minEle = Infinity;
  let maxEle = -Infinity;
  let firstTime: string | undefined;
  let lastTime: string | undefined;

  for (const trk of tracks) {
    for (const seg of trk.segments) {
      totalSegments++;
      totalPoints += seg.pointCount;
      totalDistanceMetres += seg.distanceMetres;
      totalElevationGain += seg.elevationGainMetres;
      totalElevationLoss += seg.elevationLossMetres;
      pointsWithElevation += seg.pointsWithElevation;
      pointsWithTime += seg.pointsWithTime;

      for (const p of seg.points) {
        if (p.ele != null) {
          if (p.ele < minEle) minEle = p.ele;
          if (p.ele > maxEle) maxEle = p.ele;
        }
        if (p.time) {
          if (!firstTime) firstTime = p.time;
          lastTime = p.time;
        }
      }
    }
  }

  let durationSeconds: number | undefined;
  if (firstTime && lastTime) {
    const t0 = new Date(firstTime).getTime();
    const t1 = new Date(lastTime).getTime();
    if (!Number.isNaN(t0) && !Number.isNaN(t1) && t1 >= t0) {
      durationSeconds = Math.round((t1 - t0) / 1000);
    }
  }

  const elevationCoveragePct = totalPoints > 0
    ? Math.round((pointsWithElevation / totalPoints) * 1000) / 10
    : 0;

  const timestampCoveragePct = totalPoints > 0
    ? Math.round((pointsWithTime / totalPoints) * 1000) / 10
    : 0;

  // Add honest data coverage warnings
  if (totalPoints === 0) {
    warnings.push('No valid track or route points found in GPX file');
  }
  if (totalPoints > 0 && pointsWithElevation === 0) {
    warnings.push('No elevation samples found in this GPX track');
  } else if (elevationCoveragePct < 100) {
    warnings.push(`Partial elevation data: ${elevationCoveragePct}% of points have elevation`);
  }
  if (totalPoints > 0 && pointsWithTime === 0) {
    warnings.push('No timestamps found in track points (timing will be calculated from distance)');
  } else if (timestampCoveragePct < 100) {
    warnings.push(`Partial timestamp data: ${timestampCoveragePct}% of points have timestamps`);
  }
  if (timestampGapsCount > 0) {
    warnings.push(`Detected ${timestampGapsCount} timestamp gap(s) exceeding 1 hour (multi-day or paused recording)`);
  }

  const summary: GpxSummary = {
    filename,
    importedAt: new Date().toISOString(),
    creator: metadata.creator,
    name: metadata.name || tracks[0]?.name,
    description: metadata.desc || tracks[0]?.desc,
    totalTracks: tracks.length,
    totalSegments,
    totalPoints,
    totalWaypoints: waypoints.length,
    totalDistanceMetres: Math.round(totalDistanceMetres),
    elevationCoveragePct,
    timestampCoveragePct,
    minElevation: Number.isFinite(minEle) ? Math.round(minEle) : undefined,
    maxElevation: Number.isFinite(maxEle) ? Math.round(maxEle) : undefined,
    elevationGainMetres: Math.round(totalElevationGain),
    elevationLossMetres: Math.round(totalElevationLoss),
    startTime: firstTime,
    endTime: lastTime,
    durationSeconds,
    duplicatePointsSkipped,
    timestampGapsCount,
    warnings,
  };

  return {
    metadata,
    tracks,
    waypoints,
    summary,
    toJourneySegments: (opts) => convertToJourneySegments(tracks, summary, opts?.mode ?? 'hike'),
    toStops: (existingSegmentCount = 0) => convertWaypointsToStops(waypoints, existingSegmentCount),
    toJourney: (opts) => {
      const journeyName = opts?.name || summary.name || filename.replace(/\.gpx$/i, '');
      let journey = createJourney(journeyName, summary.description || `Imported from ${filename}`);
      
      const segments = convertToJourneySegments(tracks, summary, opts?.mode ?? 'hike');
      for (const seg of segments) {
        journey = addSegmentToJourney(journey, seg);
      }

      const stops = convertWaypointsToStops(waypoints, 0);
      for (const st of stops) {
        journey = addStopToJourney(journey, st);
      }

      // If duration is present in GPX, adjust timeline duration (capped to sensible preview)
      if (summary.durationSeconds && summary.durationSeconds > 0) {
        // Timeline preview default scaled to 30-60s or actual duration if short
        journey.timeline.duration = Math.max(15, Math.min(120, Math.round(summary.durationSeconds / 60)));
      }

      return journey;
    },
  };
}

// ── Point Block Parser Helper ──

function parsePointsBlock(
  xmlBlock: string,
  pointTag: 'trkpt' | 'rtept',
  warnings: string[]
): {
  points: RoutePoint[];
  segment: GpxTrackSegment;
  duplicates: number;
  gaps: number;
} {
  const points: RoutePoint[] = [];
  const ptRegex = new RegExp(
    `<(?:[a-zA-Z0-9_:-]+:)?${pointTag}\\b([^>]*)>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_:-]+:)?${pointTag}>|<(?:[a-zA-Z0-9_:-]+:)?${pointTag}\\b([^>]*)\\/>`,
    'gi'
  );

  let match: RegExpExecArray | null;
  let duplicates = 0;
  let gaps = 0;
  let prevTime: number | null = null;

  while ((match = ptRegex.exec(xmlBlock)) !== null) {
    const attrStr = match[1] || match[3] || '';
    const innerContent = match[2] || '';
    const attrs = parseAttributes(attrStr);

    const lat = parseFloat(attrs['lat']);
    const lon = parseFloat(attrs['lon']);

    if (!Number.isFinite(lat) || Math.abs(lat) > 90) {
      warnings.push(`Ignored track point with invalid latitude: ${attrs['lat']}`);
      continue;
    }
    if (!Number.isFinite(lon) || Math.abs(lon) > 180) {
      warnings.push(`Ignored track point with invalid longitude: ${attrs['lon']}`);
      continue;
    }

    // Skip adjacent identical coordinate duplicates
    if (points.length > 0) {
      const prev = points[points.length - 1];
      if (prev.lat === lat && prev.lng === lon) {
        duplicates++;
        continue;
      }
    }

    const eleStr = extractChildText(innerContent, 'ele');
    const ele = eleStr != null && !Number.isNaN(parseFloat(eleStr)) ? parseFloat(eleStr) : undefined;
    const time = extractChildText(innerContent, 'time');
    const speedStr = extractChildText(innerContent, 'speed');
    const speed = speedStr != null && !Number.isNaN(parseFloat(speedStr)) ? parseFloat(speedStr) : undefined;

    // Detect timestamp gaps (> 3600s = 1 hour)
    if (time) {
      const currTime = new Date(time).getTime();
      if (!Number.isNaN(currTime)) {
        if (prevTime !== null && currTime - prevTime > 3600 * 1000) {
          gaps++;
        }
        prevTime = currTime;
      }
    }

    const pt: RoutePoint = {
      lng: lon,
      lat,
      ...(ele != null ? { ele } : {}),
      ...(time ? { time } : {}),
      ...(speed != null ? { speed } : {}),
    };

    points.push(pt);
  }

  // Calculate segment metrics
  let segDist = 0;
  let segGain = 0;
  let segLoss = 0;
  let ptsWithEle = 0;
  let ptsWithTime = 0;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.ele != null) ptsWithEle++;
    if (p.time) ptsWithTime++;

    if (i > 0) {
      const prev = points[i - 1];
      segDist += haversineDistance(prev, p);

      if (prev.ele != null && p.ele != null) {
        const deltaEle = p.ele - prev.ele;
        if (deltaEle > 0) segGain += deltaEle;
        else segLoss += Math.abs(deltaEle);
      }
    }
  }

  const segment: GpxTrackSegment = {
    points,
    pointCount: points.length,
    distanceMetres: Math.round(segDist),
    elevationGainMetres: Math.round(segGain),
    elevationLossMetres: Math.round(segLoss),
    pointsWithElevation: ptsWithEle,
    pointsWithTime: ptsWithTime,
  };

  return { points, segment, duplicates, gaps };
}

// ── Domain Conversion Helpers ──

function convertToJourneySegments(
  tracks: GpxTrack[],
  summary: GpxSummary,
  mode: TransportMode = 'hike'
): JourneySegment[] {
  const segments: JourneySegment[] = [];

  let segIdx = 0;
  for (const trk of tracks) {
    for (const seg of trk.segments) {
      const journeySeg: JourneySegment = {
        ...createSegment('trail', mode, seg.points, 'gpx'),
        metadata: {
          provenance: {
            source: 'gpx_import',
            filename: summary.filename,
            importedAt: summary.importedAt,
            trackName: trk.name,
            originalSegmentIndex: segIdx,
            originalPointCount: seg.pointCount,
            distanceMetres: seg.distanceMetres,
            elevationGainMetres: seg.elevationGainMetres,
            elevationLossMetres: seg.elevationLossMetres,
          },
          isOriginalImport: true,
        },
      };
      segments.push(journeySeg);
      segIdx++;
    }
  }

  return segments;
}

function convertWaypointsToStops(
  waypoints: GpxWaypoint[],
  segmentIndex = 0
): Stop[] {
  return waypoints.map((wpt, idx) => {
    let stopType: StopType = 'waypoint';
    const sym = wpt.sym?.toLowerCase() || '';
    if (sym.includes('summit') || sym.includes('peak')) stopType = 'sight';
    else if (sym.includes('camp') || sym.includes('shelter')) stopType = 'rest';
    else if (idx === 0) stopType = 'start';
    else if (idx === waypoints.length - 1) stopType = 'end';

    return {
      ...createStop(
        wpt.name || `Waypoint ${idx + 1}`,
        { lng: wpt.lng, lat: wpt.lat, ...(wpt.ele != null ? { ele: wpt.ele } : {}) },
        segmentIndex,
        stopType
      ),
      description: wpt.desc,
      durationAtStop: stopType === 'rest' ? 600 : 0,
    };
  });
}

/**
 * Appends imported GPX track segments and waypoints into an existing journey
 * without destroying or overwriting previous segments and stops.
 */
export function appendGpxToJourney(
  existingJourney: Journey,
  gpxResult: GpxParseResult,
  mode: TransportMode = 'hike'
): Journey {
  let updated = { ...existingJourney };
  const baseSegmentIndex = updated.segments.length;
  const newSegments = gpxResult.toJourneySegments({ mode });

  for (const seg of newSegments) {
    updated = addSegmentToJourney(updated, seg);
  }

  const newStops = gpxResult.toStops(baseSegmentIndex);
  for (const st of newStops) {
    updated = addStopToJourney(updated, st);
  }

  return updated;
}

