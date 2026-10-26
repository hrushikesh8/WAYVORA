import type { RoutePoint, TransportMode } from '../types';

export interface RouteWaypoint {
  lat: number;
  lng: number;
  name?: string;
  ele?: number;
}

export type RoutingProfile = 'driving' | 'cycling' | 'walking' | 'hiking';

/**
 * Maps a journey transport mode to its geographically appropriate routing profile.
 * - 'car', 'bus', 'motorcycle', 'camper', 'tuktuk' -> 'driving'
 * - 'bike' -> 'cycling'
 * - 'walk', 'run' -> 'walking'
 * - 'hike' -> 'hiking' (or walking for road/trail network)
 */
export function routingProfileForMode(mode: TransportMode): RoutingProfile {
  switch (mode) {
    case 'bike':
      return 'cycling';
    case 'hike':
      return 'hiking';
    case 'walk':
    case 'run':
      return 'walking';
    case 'car':
    case 'bus':
    case 'motorcycle':
    case 'camper':
    case 'tuktuk':
    default:
      return 'driving';
  }
}

/**
 * Returns true if the transport mode is supported by ground road/trail network routing.
 * Modes like 'plane' (air) or 'boat'/'ferry' (sea) use direct or maritime paths.
 */
export function isNetworkRoutableMode(mode: TransportMode): boolean {
  return [
    'car', 'bus', 'motorcycle', 'camper', 'tuktuk',
    'bike',
    'walk', 'hike', 'run'
  ].includes(mode);
}

export interface RouteRequest {
  origin: RouteWaypoint;
  destination: RouteWaypoint;
  waypoints?: RouteWaypoint[];
  profile?: RoutingProfile;
  timeoutMs?: number;
}

export interface RoutingProviderMetadata {
  providerId: string;
  providerName: string;
  profile: RoutingProfile;
  retrievedAt: string; // ISO 8601
  endpoint?: string;
  attribution: string;
  version?: string;
}

export interface RouteErrorDetails {
  code: string; // e.g. 'NO_ROUTE', 'TIMEOUT', 'NETWORK_ERROR', 'RATE_LIMITED', 'MALFORMED_RESPONSE', 'INVALID_REQUEST'
  message: string;
  statusCode?: number;
}

export interface RouteResult {
  success: boolean;
  points: RoutePoint[];
  distanceMetres: number;
  durationSeconds?: number;
  origin: RouteWaypoint;
  destination: RouteWaypoint;
  waypoints?: RouteWaypoint[];
  metadata: RoutingProviderMetadata;
  warnings: string[];
  error?: RouteErrorDetails;
}

export interface RoutingAdapter {
  readonly id: string;
  readonly name: string;
  readonly attribution: string;
  calculateRoute(request: RouteRequest): Promise<RouteResult>;
}
