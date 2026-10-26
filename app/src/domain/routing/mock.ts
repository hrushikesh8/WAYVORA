import type { RouteRequest, RouteResult, RoutingAdapter, RouteWaypoint, RoutingProfile } from './types';
import type { RoutePoint } from '../types';
import { haversineDistance } from '../geo';

export interface MockRoutingOptions {
  points?: RoutePoint[];
  distanceMetres?: number;
  durationSeconds?: number;
  unsupportedProfiles?: RoutingProfile[];
  simulateError?: {
    code: string;
    message: string;
    statusCode?: number;
  };
  delayMs?: number;
  intermediateSteps?: number;
}

/**
 * Deterministic Mock Routing Provider for offline unit testing, CI, and fallback.
 */
export class MockRoutingProvider implements RoutingAdapter {
  readonly id = 'mock-router';
  readonly name = 'Mock Deterministic Routing Provider';
  readonly attribution = 'Wayvora Deterministic Routing Fixture';

  private options: MockRoutingOptions;

  constructor(options: MockRoutingOptions = {}) {
    this.options = options;
  }

  setOptions(options: MockRoutingOptions): void {
    this.options = options;
  }

  async calculateRoute(request: RouteRequest): Promise<RouteResult> {
    const { origin, destination, waypoints = [], profile = 'driving' } = request;

    if (this.options.delayMs && this.options.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.options.delayMs));
    }

    if (this.options.simulateError) {
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
          retrievedAt: new Date().toISOString(),
          attribution: this.attribution,
        },
        warnings: ['Simulated error response from MockRoutingProvider'],
        error: this.options.simulateError,
      };
    }

    if (this.options.unsupportedProfiles?.includes(profile)) {
      const errorMsg = `Mock routing provider does not support the '${profile}' profile.`;
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
          retrievedAt: new Date().toISOString(),
          attribution: this.attribution,
        },
        warnings: [errorMsg],
        error: {
          code: 'PROFILE_UNSUPPORTED',
          message: errorMsg,
        },
      };
    }

    // If explicit points fixture was provided, use it
    let routePoints: RoutePoint[];
    if (this.options.points && this.options.points.length >= 2) {
      routePoints = [...this.options.points];
    } else if (profile === 'walking' || profile === 'hiking') {
      // Synthesize realistic alpine trail switchbacks with bends and elevation progression
      routePoints = this.synthesizeTrailPoints(origin, destination, waypoints, this.options.intermediateSteps ?? 8);
    } else {
      // Synthesize curved road or bike points
      routePoints = this.synthesizeRoadPoints(origin, destination, waypoints, this.options.intermediateSteps ?? 5, profile);
    }

    // Calculate total distance along points
    let calcDistance = 0;
    for (let i = 0; i < routePoints.length - 1; i++) {
      calcDistance += haversineDistance(routePoints[i], routePoints[i + 1]);
    }
    const finalDistance = this.options.distanceMetres ?? Math.round(calcDistance);

    // Approximate travel duration (walking 1.4 m/s, cycling 5.5 m/s, driving 22.0 m/s)
    const speed = (profile === 'walking' || profile === 'hiking') ? 1.4 : profile === 'cycling' ? 5.5 : 22.0;
    const finalDuration = this.options.durationSeconds ?? Math.round(finalDistance / speed);

    return {
      success: true,
      points: routePoints,
      distanceMetres: finalDistance,
      durationSeconds: finalDuration,
      origin,
      destination,
      waypoints,
      metadata: {
        providerId: this.id,
        providerName: this.name,
        profile,
        retrievedAt: new Date().toISOString(),
        attribution: this.attribution,
        version: '1.0.0-mock',
      },
      warnings: [],
    };
  }

  private synthesizeRoadPoints(
    origin: RouteWaypoint,
    destination: RouteWaypoint,
    waypoints: RouteWaypoint[],
    stepsBetweenNodes: number,
    profile: RoutingProfile = 'driving'
  ): RoutePoint[] {
    const nodes: RouteWaypoint[] = [origin, ...waypoints, destination];
    const points: RoutePoint[] = [];

    const curveFactor = profile === 'cycling' ? 0.0015 : 0.003;

    for (let i = 0; i < nodes.length - 1; i++) {
      const from = nodes[i];
      const to = nodes[i + 1];

      for (let s = 0; s < stepsBetweenNodes; s++) {
        const t = s / stepsBetweenNodes;
        // Introduce a slight sinusoidal arc to emulate road/path curvature
        const arcOffset = Math.sin(t * Math.PI) * curveFactor;
        const lat = from.lat + (to.lat - from.lat) * t + arcOffset;
        const lng = from.lng + (to.lng - from.lng) * t - arcOffset;

        const ele = from.ele != null && to.ele != null
          ? Math.round(from.ele + (to.ele - from.ele) * t)
          : from.ele ?? to.ele;

        points.push({ lat, lng, ele });
      }
    }

    // Add final destination point
    points.push({
      lat: destination.lat,
      lng: destination.lng,
      ele: destination.ele,
    });

    return points;
  }

  private synthesizeTrailPoints(
    origin: RouteWaypoint,
    destination: RouteWaypoint,
    waypoints: RouteWaypoint[],
    stepsBetweenNodes: number
  ): RoutePoint[] {
    const nodes: RouteWaypoint[] = [origin, ...waypoints, destination];
    const points: RoutePoint[] = [];

    for (let i = 0; i < nodes.length - 1; i++) {
      const from = nodes[i];
      const to = nodes[i + 1];

      // Switchback frequency: 4 switchback zig-zags per leg
      for (let s = 0; s < stepsBetweenNodes; s++) {
        const t = s / stepsBetweenNodes;
        // Higher-frequency sinusoidal switchbacks (alternating lateral zig-zag offsets)
        const switchbackOffset = Math.sin(t * Math.PI * 4) * 0.0008;
        const lat = from.lat + (to.lat - from.lat) * t + switchbackOffset;
        const lng = from.lng + (to.lng - from.lng) * t - (s % 2 === 0 ? switchbackOffset : -switchbackOffset);

        const ele = from.ele != null && to.ele != null
          ? Math.round(from.ele + (to.ele - from.ele) * t)
          : from.ele ?? to.ele;

        points.push({ lat, lng, ele });
      }
    }

    // Add final destination point
    points.push({
      lat: destination.lat,
      lng: destination.lng,
      ele: destination.ele,
    });

    return points;
  }
}
