/* ─── Map Style Registry & Provider Configuration ───────────────────────
   Centralized registry for WAYVORA's five core map styles:
   Standard, Outdoors, Satellite, Satellite + Labels, and Cinematic.

   LEGAL & LICENSING NOTICES:
   - OpenFreeMap: Map data © OpenStreetMap contributors (ODbL 1.0). Cartographic
     styles are licensed under BSD-3-Clause / CC-BY 4.0. Permitted for commercial
     interactive display and video outputs with proper attribution.
   - Esri World Imagery & Reference: Governed by the Esri Master License Agreement
     (EMA) and ArcGIS Online Terms of Use. Permitted for display and video presentations
     (YouTube, broadcast, films) provided on-screen attribution is maintained.
     NOTE ON COMMERCIAL LIMITATIONS: Using Esri tiles directly in a monetized commercial
     hosted product as a core service asset requires an ArcGIS Developer or Enterprise
     subscription. In WAYVORA, tile endpoints are configurable and replaceable to allow
     commercial users to supply their own licensed proxy or custom endpoints.
   - AWS Open Data Terrarium: Public domain / Open Data (USGS 3DEP, SRTM, ArcticDEM).
     Zero API keys; unrestricted for display, offline calculation, and video export.
   ─────────────────────────────────────────────────────────────────── */

import type { StyleSpecification } from 'maplibre-gl';

export type MapStyleId = 'standard' | 'outdoors' | 'satellite' | 'satellite-labels' | 'cinematic';

export interface MapStyleDefinition {
  id: MapStyleId;
  name: string;
  category: 'vector' | 'raster' | 'hybrid';
  description: string;
  /** Style URL pointing to a remote JSON, or an inline MapLibre StyleSpecification */
  styleUrlOrSpec: string | StyleSpecification;
  attribution: string;
  supportsHillshade: boolean;
  unresolvedLicensingNotes?: string;
}

export const ESRI_WORLD_IMAGERY_ATTRIBUTION =
  'Sources: Esri, Maxar, Earthstar Geographics, USDA, USGS, AeroGRID, IGN, and the GIS User Community';

export const OPENFREEMAP_ATTRIBUTION =
  'Map data © OpenStreetMap contributors, Style © OpenFreeMap';

export const AWS_TERRARIUM_ATTRIBUTION =
  'Terrain data © USGS, NASA SRTM, ArcticDEM via AWS Open Data / Tilezen';

export const SATELLITE_RASTER_SPEC: StyleSpecification = {
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    'esri-satellite': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: ESRI_WORLD_IMAGERY_ATTRIBUTION,
    },
  },
  layers: [
    {
      id: 'satellite-background',
      type: 'background',
      paint: {
        'background-color': '#060c18',
      },
    },
    {
      id: 'satellite-imagery',
      type: 'raster',
      source: 'esri-satellite',
      paint: {
        'raster-fade-duration': 100,
      },
    },
  ],
};

export const SATELLITE_LABELS_HYBRID_SPEC: StyleSpecification = {
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    'esri-satellite': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: ESRI_WORLD_IMAGERY_ATTRIBUTION,
    },
    'esri-reference-labels': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: 'satellite-background',
      type: 'background',
      paint: {
        'background-color': '#060c18',
      },
    },
    {
      id: 'satellite-imagery',
      type: 'raster',
      source: 'esri-satellite',
      paint: {
        'raster-fade-duration': 100,
      },
    },
    {
      id: 'satellite-reference-labels',
      type: 'raster',
      source: 'esri-reference-labels',
      paint: {
        'raster-fade-duration': 100,
        'raster-opacity': 0.92,
      },
    },
  ],
};

export const MAP_STYLES: Record<MapStyleId, MapStyleDefinition> = {
  standard: {
    id: 'standard',
    name: 'Standard (Clean)',
    category: 'vector',
    description: 'Crisp, high-legibility street and highway cartography.',
    styleUrlOrSpec: 'https://tiles.openfreemap.org/styles/liberty',
    attribution: OPENFREEMAP_ATTRIBUTION,
    supportsHillshade: true,
  },
  outdoors: {
    id: 'outdoors',
    name: 'Outdoors (Topo)',
    category: 'vector',
    description: 'High-contrast trails, green spaces, and alpine contour relief.',
    styleUrlOrSpec: 'https://tiles.openfreemap.org/styles/bright',
    attribution: OPENFREEMAP_ATTRIBUTION,
    supportsHillshade: true,
  },
  satellite: {
    id: 'satellite',
    name: 'Satellite (Pure)',
    category: 'raster',
    description: 'Global photographic satellite and aerial orthophoto imagery.',
    styleUrlOrSpec: SATELLITE_RASTER_SPEC,
    attribution: ESRI_WORLD_IMAGERY_ATTRIBUTION,
    supportsHillshade: false, // In satellite imagery, natural slope shading is already present in the photographic texture
    unresolvedLicensingNotes:
      'Esri terms permit video/film inclusion with mandatory on-screen attribution. Standalone commercial app distribution requires an enterprise ArcGIS subscription.',
  },
  'satellite-labels': {
    id: 'satellite-labels',
    name: 'Satellite + Labels',
    category: 'hybrid',
    description: 'Photographic satellite imagery with place names and borders.',
    styleUrlOrSpec: SATELLITE_LABELS_HYBRID_SPEC,
    attribution: ESRI_WORLD_IMAGERY_ATTRIBUTION,
    supportsHillshade: false,
    unresolvedLicensingNotes:
      'Esri terms permit video/film inclusion with mandatory on-screen attribution. Standalone commercial app distribution requires an enterprise ArcGIS subscription.',
  },
  cinematic: {
    id: 'cinematic',
    name: 'Cinematic (Dark)',
    category: 'vector',
    description: 'Deep midnight palette tailored for neon route illumination.',
    styleUrlOrSpec: 'https://tiles.openfreemap.org/styles/dark',
    attribution: OPENFREEMAP_ATTRIBUTION,
    supportsHillshade: true,
  },
};

export const DEFAULT_MAP_STYLE_ID: MapStyleId = 'cinematic';

export const MAP_STYLE_IDS: MapStyleId[] = [
  'cinematic',
  'standard',
  'outdoors',
  'satellite',
  'satellite-labels',
];

/**
 * Returns formatted attribution string combining active basemap and 3D terrain providers.
 */
export function getStyleAttribution(styleId: MapStyleId, terrainEnabled: boolean = true): string {
  const styleDef = MAP_STYLES[styleId] || MAP_STYLES[DEFAULT_MAP_STYLE_ID];
  if (terrainEnabled) {
    return `${styleDef.attribution} | ${AWS_TERRARIUM_ATTRIBUTION}`;
  }
  return styleDef.attribution;
}
