/* ─── Transport Mode Types & Domain Contracts ──────────────────────────
   Canonical transport modes, metadata, speed profiles, and 2D/3D state.
   ─────────────────────────────────────────────────────────────────── */

import type { RoutePoint, TransportMode as BaseTransportMode } from '../types';

export type CanonicalTransportMode =
  | 'car'
  | 'bus'
  | 'train'
  | 'hiker'
  | 'motorcycle'
  | 'bicycle'
  | 'boat'
  | 'airplane';

export const CANONICAL_TRANSPORT_MODES: CanonicalTransportMode[] = [
  'car',
  'bus',
  'train',
  'hiker',
  'motorcycle',
  'bicycle',
  'boat',
  'airplane',
];

export interface TransportModeMetadata {
  id: CanonicalTransportMode;
  label: string;
  category: 'road' | 'trail' | 'rail' | 'water' | 'air';
  accentColor: string;
  defaultSpeedKmh: number;
  description: string;
}

export const TRANSPORT_MODE_METADATA: Record<CanonicalTransportMode, TransportModeMetadata> = {
  car: {
    id: 'car',
    label: 'Car',
    category: 'road',
    accentColor: '#38bdf8', // Cyan
    defaultSpeedKmh: 90,
    description: 'Road passenger automobile or touring car.',
  },
  bus: {
    id: 'bus',
    label: 'Bus',
    category: 'road',
    accentColor: '#fbbf24', // Amber
    defaultSpeedKmh: 65,
    description: 'Long-distance passenger motorcoach or shuttle.',
  },
  train: {
    id: 'train',
    label: 'Train',
    category: 'rail',
    accentColor: '#f43f5e', // Rose
    defaultSpeedKmh: 120,
    description: 'Passenger rail or high-speed locomotive.',
  },
  hiker: {
    id: 'hiker',
    label: 'Hiker',
    category: 'trail',
    accentColor: '#34d399', // Emerald
    defaultSpeedKmh: 4.5,
    description: 'Backpacking hiker or trail trekker on foot.',
  },
  motorcycle: {
    id: 'motorcycle',
    label: 'Motorcycle',
    category: 'road',
    accentColor: '#a855f7', // Purple
    defaultSpeedKmh: 85,
    description: 'Two-wheeled touring or adventure motorcycle.',
  },
  bicycle: {
    id: 'bicycle',
    label: 'Bicycle',
    category: 'trail',
    accentColor: '#10b981', // Mint
    defaultSpeedKmh: 22,
    description: 'Bicycle or touring cyclist.',
  },
  boat: {
    id: 'boat',
    label: 'Boat',
    category: 'water',
    accentColor: '#06b6d4', // Ocean Cyan
    defaultSpeedKmh: 30,
    description: 'Watercraft, ferry, or nautical vessel.',
  },
  airplane: {
    id: 'airplane',
    label: 'Airplane',
    category: 'air',
    accentColor: '#e0f2fe', // Ice Sky
    defaultSpeedKmh: 650,
    description: 'Aviation airliner or charter flight.',
  },
};

/**
 * Normalizes any arbitrary transport mode string or legacy WAYVORA mode
 * into one of the eight canonical transport modes.
 */
export function resolveCanonicalTransportMode(
  mode?: BaseTransportMode | string | null
): CanonicalTransportMode {
  if (!mode) return 'car';
  const m = mode.toLowerCase().trim();

  switch (m) {
    case 'bus':
    case 'shuttle':
    case 'coach':
    case 'transit':
      return 'bus';

    case 'train':
    case 'rail':
    case 'railway':
    case 'metro':
    case 'subway':
    case 'tram':
      return 'train';

    case 'hiker':
    case 'hike':
    case 'walk':
    case 'walking':
    case 'run':
    case 'running':
    case 'trek':
    case 'foot':
      return 'hiker';

    case 'motorcycle':
    case 'motorbike':
    case 'moto':
    case 'scooter':
      return 'motorcycle';

    case 'bicycle':
    case 'bike':
    case 'biking':
    case 'cycle':
    case 'cycling':
      return 'bicycle';

    case 'boat':
    case 'ferry':
    case 'ship':
    case 'yacht':
    case 'sail':
    case 'kayak':
    case 'canoe':
      return 'boat';

    case 'airplane':
    case 'plane':
    case 'flight':
    case 'aircraft':
    case 'air':
      return 'airplane';

    case 'car':
    case 'camper':
    case 'tuktuk':
    case 'drive':
    case 'automobile':
    case 'van':
    case 'suv':
    default:
      return 'car';
  }
}

/**
 * User-selectable rendering mode for transport markers.
 * - 'auto': Use 3D model when registered & loaded, 2D vector silhouette otherwise.
 * - '3d-model': Prefer 3D model, fallback to 2D only if asset fails to load.
 * - '2d-icon': Force crisp 2D vector silhouette across all modes.
 */
export type TransportRenderMode = 'auto' | '3d-model' | '2d-icon';

/**
 * Explicit state of an animated transport entity at a specific point in time.
 * Designed with a direct 2D/3D fallback contract.
 */
export interface TransportEntityState {
  mode: CanonicalTransportMode;
  position: RoutePoint;
  bearing: number;
  pitch: number;
  roll?: number;
  isDwelling: boolean;
  renderMode: '2d-svg' | '3d-model' | '3d-model-fallback';
  modelId?: string;
  altitudeMeters?: number;
}

