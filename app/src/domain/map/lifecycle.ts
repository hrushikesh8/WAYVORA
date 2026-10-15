/* ─── Map Lifecycle Coordinator & Layer Preservation ────────────────────
   Ensures custom application layers (route lines, neon glows, editable
   segment vertices) and 3D terrain configurations persist across style
   switches in MapLibre GL JS.

   MapLibre wipes out all user-defined sources and layers on map.setStyle().
   This module provides idempotent attachment and synchronization so that
   switching basemap styles restores all journey graphics seamlessly.
   ─────────────────────────────────────────────────────────────────── */

import type { Map, GeoJSONSource } from 'maplibre-gl';
import type { Journey, RoutePoint, JourneySegment, TransportMode } from '../types';
import { getAllPoints } from '../journey';
import {
  registerTransportIcons,
  attachTransportMapLayers,
  syncTransportSourceData,
} from '../transport';

export interface AttachLayersOptions {
  terrainEnabled?: boolean;
  terrainExaggeration?: number;
  supportsHillshade?: boolean;
  selectedSegmentId?: string | null;
  selectedPointIndex?: number | null;
  currentPosition?: RoutePoint | null;
  currentBearing?: number;
  currentMode?: TransportMode;
}

export const TERRARIUM_DEM_URL =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

/**
 * Idempotently attaches or verifies all application sources, route layers,
 * vertex points, and 3D terrain on the specified MapLibre map instance.
 */
export function attachJourneyMapLayers(
  map: Map,
  journey: Journey,
  options: AttachLayersOptions = {}
): void {
  if (!map) return;

  const allPoints = getAllPoints(journey);

  // 1. Route Geometry Source
  const existingRouteSource = map.getSource('route-source') as GeoJSONSource | undefined;
  if (!existingRouteSource) {
    try {
      map.addSource('route-source', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: allPoints.map((p) => [p.lng, p.lat]),
          },
        },
      });
    } catch {
      // Source might exist in racing condition
    }
  } else {
    syncRouteSourceData(map, allPoints);
  }

  // 2. Route Glow Layer (Cyan wide soft blur)
  if (!map.getLayer('route-glow') && map.getSource('route-source')) {
    try {
      map.addLayer({
        id: 'route-glow',
        type: 'line',
        source: 'route-source',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#00f2fe',
          'line-width': 8,
          'line-opacity': 0.35,
          'line-blur': 4,
        },
      });
    } catch {
      // Layer might already exist
    }
  }

  // 3. Route Main Line (Solid crisp cyan/blue)
  if (!map.getLayer('route-line') && map.getSource('route-source')) {
    try {
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route-source',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#4facfe',
          'line-width': 3.5,
          'line-opacity': 0.95,
        },
      });
    } catch {
      // Layer might already exist
    }
  }

  // 4. Editable Segment Vertices Source
  const existingPointsSource = map.getSource('segment-points-source') as GeoJSONSource | undefined;
  if (!existingPointsSource) {
    try {
      map.addSource('segment-points-source', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      });
    } catch {
      // Source might already exist
    }
  }

  // 5. Editable Segment Vertices Layer
  if (!map.getLayer('segment-points-layer') && map.getSource('segment-points-source')) {
    try {
      map.addLayer({
        id: 'segment-points-layer',
        type: 'circle',
        source: 'segment-points-source',
        paint: {
          'circle-radius': [
            'case',
            ['boolean', ['get', 'selected'], false],
            8,
            5,
          ],
          'circle-color': [
            'case',
            ['boolean', ['get', 'selected'], false],
            '#00f2fe',
            '#fbbf24',
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#0d1117',
        },
      });
    } catch {
      // Layer might already exist
    }
  }

  // Sync segment points if a segment is currently selected
  const activeSegment = options.selectedSegmentId
    ? journey.segments.find((s) => s.id === options.selectedSegmentId) ?? null
    : null;
  syncSegmentPointsData(map, activeSegment, options.selectedPointIndex ?? null);

  // 6. Transport Marker Layers (Pulsing halo disc & rotating SVG silhouette)
  const initialMode = journey.segments[0]?.transportMode ?? 'car';
  attachTransportMapLayers(
    map,
    options.currentPosition ?? allPoints[0] ?? null,
    options.currentBearing ?? 0,
    options.currentMode ?? initialMode
  );
  registerTransportIcons(map);

  // 7. Configure 3D Terrain
  if (options.terrainEnabled !== false) {
    configureMapTerrain(
      map,
      options.terrainEnabled ?? true,
      options.terrainExaggeration ?? 1.2,
      { supportsHillshade: options.supportsHillshade ?? false }
    );
  } else {
    configureMapTerrain(map, false, 1.0);
  }
}

export {
  registerTransportIcons,
  attachTransportMapLayers,
  syncTransportSourceData,
};

export interface TerrainOptions {
  supportsHillshade?: boolean;
}

/**
 * Manages MapLibre 3D terrain and optional hillshading independently of map styles.
 */
export function configureMapTerrain(
  map: Map,
  terrainEnabled: boolean,
  exaggeration: number = 1.2,
  options: TerrainOptions = {}
): void {
  if (!map) return;

  try {
    // Ensure terrain raster-dem source exists
    if (!map.getSource('terrain-source')) {
      map.addSource('terrain-source', {
        type: 'raster-dem',
        tiles: [TERRARIUM_DEM_URL],
        tileSize: 256,
        encoding: 'terrarium',
        maxzoom: 15,
      });
    }

    if (terrainEnabled && map.getSource('terrain-source')) {
      map.setTerrain({
        source: 'terrain-source',
        exaggeration: Math.max(0.1, Math.min(3.0, exaggeration)),
      });

      // Optional hillshade layer for vector styles that support it
      if (options.supportsHillshade) {
        if (!map.getLayer('terrain-hillshade') && map.getSource('terrain-source')) {
          try {
            // Insert hillshade beneath route lines if route-glow is present
            const beforeLayer = map.getLayer('route-glow') ? 'route-glow' : undefined;
            map.addLayer(
              {
                id: 'terrain-hillshade',
                type: 'hillshade',
                source: 'terrain-source',
                paint: {
                  'hillshade-exaggeration': 0.45,
                  'hillshade-shadow-color': '#050c18',
                  'hillshade-highlight-color': '#ffffff',
                  'hillshade-illumination-anchor': 'viewport',
                },
              },
              beforeLayer
            );
          } catch {
            // Layer insertion non-fatal
          }
        }
      } else {
        removeLayerSafely(map, 'terrain-hillshade');
      }
    } else {
      map.setTerrain(null);
      removeLayerSafely(map, 'terrain-hillshade');
    }
  } catch (err) {
    console.warn('MapLibre terrain configuration warning, falling back to 2D:', err);
    try {
      map.setTerrain(null);
      removeLayerSafely(map, 'terrain-hillshade');
    } catch {
      // Ignore fallback errors
    }
  }
}

/**
 * Safely updates route line GeoJSON coordinates without rebuilding layers.
 */
export function syncRouteSourceData(map: Map, points: RoutePoint[]): void {
  if (!map) return;
  const source = map.getSource('route-source') as GeoJSONSource | undefined;
  if (!source) return;

  try {
    source.setData({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: points.map((p) => [p.lng, p.lat]),
      },
    });
  } catch {
    // Non-fatal if style is mid-transition
  }
}

/**
 * Safely updates editable segment vertex circle features without rebuilding layers.
 */
export function syncSegmentPointsData(
  map: Map,
  segment: JourneySegment | null,
  selectedPointIndex: number | null
): void {
  if (!map) return;
  const source = map.getSource('segment-points-source') as GeoJSONSource | undefined;
  if (!source) return;

  if (!segment) {
    try {
      source.setData({ type: 'FeatureCollection', features: [] });
    } catch {
      // Ignore
    }
    return;
  }

  try {
    const features = segment.points.map((pt, idx) => ({
      type: 'Feature' as const,
      properties: {
        pointIndex: idx,
        selected: selectedPointIndex === idx,
      },
      geometry: {
        type: 'Point' as const,
        coordinates: [pt.lng, pt.lat],
      },
    }));

    source.setData({
      type: 'FeatureCollection',
      features,
    });
  } catch {
    // Non-fatal if style is mid-transition
  }
}

function removeLayerSafely(map: Map, layerId: string): void {
  try {
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }
  } catch {
    // Ignore
  }
}
