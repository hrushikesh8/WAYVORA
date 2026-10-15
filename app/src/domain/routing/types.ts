import type { RoutePoint } from '../types';

export interface RouteWaypoint {
  lat: number;
  lng: number;
  name?: string;
  ele?: number;
}

export type RoutingProfile = 'driving' | 'cycling' | 'walking';

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
