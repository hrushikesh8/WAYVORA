import type { RouteRequest, RouteResult, RoutingAdapter, RoutingProfile } from './types';
import type { RoutePoint } from '../types';

export interface OsrmProviderOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export class OsrmRoutingProvider implements RoutingAdapter {
  readonly id = 'osrm';
  readonly name = 'Open Source Routing Machine (OSRM)';
  readonly attribution = '© OpenStreetMap contributors (ODbL)';

  private baseUrl: string;
  private defaultTimeoutMs: number;
  private fetchFn: typeof fetch;

  constructor(options: OsrmProviderOptions = {}) {
    // Default to the public OSRM demonstration server, but allow custom base URLs (e.g. self-hosted Docker)
    this.baseUrl = (options.baseUrl ?? 'https://router.project-osrm.org').replace(/\/+$/, '');
    this.defaultTimeoutMs = options.timeoutMs ?? 9000;
    this.fetchFn = options.fetchFn ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : async () => {
      throw new Error('No fetch implementation available in current environment');
    });
  }

  async calculateRoute(request: RouteRequest): Promise<RouteResult> {
    const { origin, destination, waypoints = [], profile = 'driving', timeoutMs } = request;
    const effectiveTimeout = timeoutMs ?? this.defaultTimeoutMs;

    const osrmProfile = this.mapProfile(profile);

    // Coordinate sequence: lon,lat;lon,lat;...
    const allWaypoints = [origin, ...waypoints, destination];
    const coordsString = allWaypoints
      .map((w) => `${w.lng.toFixed(6)},${w.lat.toFixed(6)}`)
      .join(';');

    const url = `${this.baseUrl}/route/v1/${osrmProfile}/${coordsString}?overview=full&geometries=geojson&steps=false`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), effectiveTimeout);

    try {
      const response = await this.fetchFn(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        let errorMsg = `OSRM server responded with HTTP status ${response.status} (${response.statusText})`;
        let errCode = 'SERVER_ERROR';

        if (response.status === 429) {
          errCode = 'RATE_LIMITED';
          errorMsg = 'Public OSRM rate limit exceeded. Please wait a moment or configure a private routing endpoint.';
        } else if (response.status === 400) {
          errCode = 'INVALID_REQUEST';
        }

        return {
          success: false,
          points: [],
          distanceMetres: 0,
          origin,
          destination,
          waypoints,
          metadata: {
            providerId: this.id,
            providerName: this.name,
            profile,
            endpoint: this.baseUrl,
            retrievedAt: new Date().toISOString(),
            attribution: this.attribution,
          },
          warnings: [errorMsg],
          error: {
            code: errCode,
            message: errorMsg,
            statusCode: response.status,
          },
        };
      }

      const json = await response.json();

      if (!json || typeof json !== 'object') {
        return {
          success: false,
          points: [],
          distanceMetres: 0,
          origin,
          destination,
          waypoints,
          metadata: {
            providerId: this.id,
            providerName: this.name,
            profile,
            endpoint: this.baseUrl,
            retrievedAt: new Date().toISOString(),
            attribution: this.attribution,
          },
          warnings: ['Malformed response from OSRM service'],
          error: {
            code: 'MALFORMED_RESPONSE',
            message: 'OSRM service returned an invalid JSON payload.',
          },
        };
      }

      if (json.code !== 'Ok' || !json.routes || json.routes.length === 0) {
        const osrmCode = json.code ?? 'UNKNOWN_ERROR';
        const errorMsg = json.message ?? (osrmCode === 'NoRoute' ? 'No navigable road route found between the specified coordinates.' : `OSRM returned code: ${osrmCode}`);

        return {
          success: false,
          points: [],
          distanceMetres: 0,
          origin,
          destination,
          waypoints,
          metadata: {
            providerId: this.id,
            providerName: this.name,
            profile,
            endpoint: this.baseUrl,
            retrievedAt: new Date().toISOString(),
            attribution: this.attribution,
          },
          warnings: [errorMsg],
          error: {
            code: osrmCode === 'NoRoute' ? 'NO_ROUTE' : 'ROUTING_FAILED',
            message: errorMsg,
          },
        };
      }

      const route = json.routes[0];
      const coordinates = route.geometry?.coordinates;

      if (!Array.isArray(coordinates) || coordinates.length < 2) {
        return {
          success: false,
          points: [],
          distanceMetres: 0,
          origin,
          destination,
          waypoints,
          metadata: {
            providerId: this.id,
            providerName: this.name,
            profile,
            endpoint: this.baseUrl,
            retrievedAt: new Date().toISOString(),
            attribution: this.attribution,
          },
          warnings: ['Route geometry coordinates missing or insufficient in OSRM response.'],
          error: {
            code: 'MALFORMED_GEOMETRY',
            message: 'OSRM returned fewer than 2 coordinates in the route geometry.',
          },
        };
      }

      // GeoJSON LineString coordinates are [longitude, latitude]
      const points: RoutePoint[] = coordinates.map((coord: [number, number]) => ({
        lng: coord[0],
        lat: coord[1],
      }));

      // Preserve origin and destination elevations if available
      if (origin.ele != null && points.length > 0) {
        points[0].ele = origin.ele;
      }
      if (destination.ele != null && points.length > 1) {
        points[points.length - 1].ele = destination.ele;
      }

      return {
        success: true,
        points,
        distanceMetres: Math.round(route.distance ?? 0),
        durationSeconds: Math.round(route.duration ?? 0),
        origin,
        destination,
        waypoints,
        metadata: {
          providerId: this.id,
          providerName: this.name,
          profile,
          endpoint: this.baseUrl,
          retrievedAt: new Date().toISOString(),
          attribution: this.attribution,
          version: 'osrm-v1',
        },
        warnings: [],
      };
    } catch (err: unknown) {
      clearTimeout(timeoutId);

      const isAbort = (err as { name?: string })?.name === 'AbortError';
      const code = isAbort ? 'TIMEOUT' : 'NETWORK_ERROR';
      const message = isAbort
        ? `Routing request timed out after ${effectiveTimeout}ms`
        : (err instanceof Error ? err.message : 'Unknown network failure communicating with OSRM');

      return {
        success: false,
        points: [],
        distanceMetres: 0,
        origin,
        destination,
        waypoints,
        metadata: {
          providerId: this.id,
          providerName: this.name,
          profile,
          endpoint: this.baseUrl,
          retrievedAt: new Date().toISOString(),
          attribution: this.attribution,
        },
        warnings: [message],
        error: {
          code,
          message,
        },
      };
    }
  }

  private mapProfile(profile: RoutingProfile): string {
    switch (profile) {
      case 'cycling':
        return 'bike';
      case 'walking':
        return 'foot';
      case 'driving':
      default:
        return 'driving';
    }
  }
}
