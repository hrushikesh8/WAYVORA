/* ─── Transport Rendering Engine (MapLibre & 2D Canvas) ───────────────
   Handles MapLibre symbol layer registration, WebGL layer synchronization,
   and Canvas2D drawing for deterministic preview and video export.
   ─────────────────────────────────────────────────────────────────── */

import type { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl';
import type { RoutePoint, TransportMode } from '../types';
import type { RenderFrame } from '../render/types';
import {
  CANONICAL_TRANSPORT_MODES,
  resolveCanonicalTransportMode,
  TRANSPORT_MODE_METADATA,
  type CanonicalTransportMode,
} from './types';
import { loadTransportSvgImage } from './icons';

export const TRANSPORT_SOURCE_ID = 'transport-source';
export const TRANSPORT_PULSE_LAYER_ID = 'transport-pulse-layer';
export const TRANSPORT_HALO_LAYER_ID = 'transport-halo-layer';
export const TRANSPORT_SYMBOL_LAYER_ID = 'transport-symbol-layer';

/**
 * Registers all 8 canonical transport SVG silhouettes into MapLibre's sprite registry.
 * Idempotent: checks `map.hasImage()` to prevent duplicate registrations.
 */
export async function registerTransportIcons(map: MapLibreMap): Promise<void> {
  if (!map || typeof window === 'undefined' || typeof Image === 'undefined') return;

  for (const mode of CANONICAL_TRANSPORT_MODES) {
    const iconKey = `transport-${mode}`;
    if (map.hasImage && map.hasImage(iconKey)) continue;

    try {
      const img = await loadTransportSvgImage(mode, { size: 64 });
      if (!map.hasImage(iconKey)) {
        map.addImage(iconKey, img, { pixelRatio: 2 });
      }
    } catch (err) {
      console.warn(`Failed to register transport icon for ${mode}:`, err);
    }
  }
}

/**
 * Idempotently attaches the transport source and rendering layers to a MapLibre instance.
 * Re-executed upon every `style.load` event to survive style switching.
 */
export function attachTransportMapLayers(
  map: MapLibreMap,
  initialPosition?: RoutePoint | null,
  initialBearing: number = 0,
  initialMode: TransportMode = 'car'
): void {
  if (!map) return;

  const canonicalMode = resolveCanonicalTransportMode(initialMode);
  const lng = initialPosition?.lng ?? 0;
  const lat = initialPosition?.lat ?? 0;

  // 1. Transport GeoJSON Source
  if (!map.getSource(TRANSPORT_SOURCE_ID)) {
    try {
      map.addSource(TRANSPORT_SOURCE_ID, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: {
                bearing: initialBearing,
                mode: canonicalMode,
                iconName: `transport-${canonicalMode}`,
              },
              geometry: {
                type: 'Point',
                coordinates: [lng, lat],
              },
            },
          ],
        },
      });
    } catch {
      // Ignore if already attached
    }
  }

  // 2. Transport Ambient Glow / Pulse Layer (underneath symbol)
  if (!map.getLayer(TRANSPORT_PULSE_LAYER_ID) && map.getSource(TRANSPORT_SOURCE_ID)) {
    try {
      map.addLayer({
        id: TRANSPORT_PULSE_LAYER_ID,
        type: 'circle',
        source: TRANSPORT_SOURCE_ID,
        paint: {
          'circle-radius': 24,
          'circle-color': [
            'match',
            ['get', 'mode'],
            'car', TRANSPORT_MODE_METADATA.car.accentColor,
            'bus', TRANSPORT_MODE_METADATA.bus.accentColor,
            'train', TRANSPORT_MODE_METADATA.train.accentColor,
            'hiker', TRANSPORT_MODE_METADATA.hiker.accentColor,
            'motorcycle', TRANSPORT_MODE_METADATA.motorcycle.accentColor,
            'bicycle', TRANSPORT_MODE_METADATA.bicycle.accentColor,
            'boat', TRANSPORT_MODE_METADATA.boat.accentColor,
            'airplane', TRANSPORT_MODE_METADATA.airplane.accentColor,
            '#00f2fe',
          ],
          'circle-opacity': 0.3,
          'circle-blur': 0.8,
        },
      });
    } catch {
      // Ignore
    }
  }

  // 3. Transport High-Contrast Halo Disc
  if (!map.getLayer(TRANSPORT_HALO_LAYER_ID) && map.getSource(TRANSPORT_SOURCE_ID)) {
    try {
      map.addLayer({
        id: TRANSPORT_HALO_LAYER_ID,
        type: 'circle',
        source: TRANSPORT_SOURCE_ID,
        paint: {
          'circle-radius': 16,
          'circle-color': '#050b14',
          'circle-opacity': 0.9,
          'circle-stroke-width': 2,
          'circle-stroke-color': [
            'match',
            ['get', 'mode'],
            'car', TRANSPORT_MODE_METADATA.car.accentColor,
            'bus', TRANSPORT_MODE_METADATA.bus.accentColor,
            'train', TRANSPORT_MODE_METADATA.train.accentColor,
            'hiker', TRANSPORT_MODE_METADATA.hiker.accentColor,
            'motorcycle', TRANSPORT_MODE_METADATA.motorcycle.accentColor,
            'bicycle', TRANSPORT_MODE_METADATA.bicycle.accentColor,
            'boat', TRANSPORT_MODE_METADATA.boat.accentColor,
            'airplane', TRANSPORT_MODE_METADATA.airplane.accentColor,
            '#00f2fe',
          ],
        },
      });
    } catch {
      // Ignore
    }
  }

  // 4. Transport Vector Symbol Layer
  if (!map.getLayer(TRANSPORT_SYMBOL_LAYER_ID) && map.getSource(TRANSPORT_SOURCE_ID)) {
    try {
      map.addLayer({
        id: TRANSPORT_SYMBOL_LAYER_ID,
        type: 'symbol',
        source: TRANSPORT_SOURCE_ID,
        layout: {
          'icon-image': ['get', 'iconName'],
          'icon-size': 0.65,
          'icon-rotate': ['get', 'bearing'],
          'icon-rotation-alignment': 'map',
          'icon-pitch-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      });
    } catch {
      // Ignore
    }
  }
}

/**
 * Synchronizes position, bearing, and active transport mode into the MapLibre transport source.
 */
export function syncTransportSourceData(
  map: MapLibreMap,
  position?: RoutePoint | null,
  bearing: number = 0,
  mode: TransportMode | string = 'car'
): void {
  if (!map || !position) return;

  const source = map.getSource(TRANSPORT_SOURCE_ID) as GeoJSONSource | undefined;
  if (!source || typeof source.setData !== 'function') return;

  const canonicalMode = resolveCanonicalTransportMode(mode);

  source.setData({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          bearing: ((bearing % 360) + 360) % 360,
          mode: canonicalMode,
          iconName: `transport-${canonicalMode}`,
        },
        geometry: {
          type: 'Point',
          coordinates: [position.lng, position.lat],
        },
      },
    ],
  });
}

/**
 * Pure 2D Canvas drawing routine for the transport marker.
 * Used by CanvasCompositor during fallback rendering or unit test validation.
 */
export function drawTransportMarker2D(
  ctx: CanvasRenderingContext2D,
  frame: RenderFrame,
  options?: {
    x?: number;
    y?: number;
    size?: number;
    mode?: CanonicalTransportMode;
  }
): void {
  if (!ctx || typeof ctx.translate !== 'function' || typeof ctx.rotate !== 'function') {
    return;
  }

  const width = frame.metadata.width;
  const height = frame.metadata.height;
  const x = options?.x ?? width / 2;
  const y = options?.y ?? height / 2;
  const size = options?.size ?? 44;
  const canonicalMode = options?.mode || resolveCanonicalTransportMode(frame.transportMode);
  const meta = TRANSPORT_MODE_METADATA[canonicalMode];
  const bearing = frame.bearing ?? 0;

  ctx.save();
  ctx.translate(x, y);

  // 1. Ambient Glow
  const glowRadius = size * 0.7;
  const radGrad = ctx.createRadialGradient(0, 0, size * 0.2, 0, 0, glowRadius);
  radGrad.addColorStop(0, meta.accentColor + '88');
  radGrad.addColorStop(1, meta.accentColor + '00');
  ctx.fillStyle = radGrad;
  ctx.beginPath();
  ctx.arc(0, 0, glowRadius, 0, Math.PI * 2);
  ctx.fill();

  // 2. High-contrast background disc
  const discRadius = size * 0.42;
  ctx.fillStyle = '#050b14';
  ctx.strokeStyle = meta.accentColor;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(0, 0, discRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 3. Rotate and draw vehicle silhouette
  ctx.rotate((bearing * Math.PI) / 180);

  // Draw arrow / vehicle direction indicator
  ctx.fillStyle = meta.accentColor;
  ctx.beginPath();
  ctx.moveTo(0, -discRadius * 0.82);
  ctx.lineTo(discRadius * 0.35, discRadius * 0.55);
  ctx.lineTo(0, discRadius * 0.25);
  ctx.lineTo(-discRadius * 0.35, discRadius * 0.55);
  ctx.closePath();
  ctx.fill();

  // Draw center core dot
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(0, -discRadius * 0.15, discRadius * 0.18, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}
