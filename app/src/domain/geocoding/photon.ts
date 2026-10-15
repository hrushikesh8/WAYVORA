/* ─── Photon Geocoding Adapter ─────────────────────────────────────────
   Open-source, search-as-you-type geocoding adapter backed by Photon (Komoot)
   and OpenStreetMap. Supports proximity biasing, language localization,
   defensive coordinate validation, and abort signals.
   ─────────────────────────────────────────────────────────────────── */

import type {
  GeocodingAdapter,
  GeocodeQuery,
  GeocodeResponse,
  GeocodeResult,
} from './types';

export const PHOTON_DEFAULT_ENDPOINT = 'https://photon.komoot.io/api';
export const PHOTON_ATTRIBUTION = 'Geocoding © OpenStreetMap contributors via Photon';

export interface PhotonFeature {
  type: string;
  geometry: {
    type: string;
    coordinates: [number, number]; // [lng, lat]
  };
  properties: {
    osm_id?: number | string;
    osm_type?: string;
    osm_key?: string;
    osm_value?: string;
    name?: string;
    housenumber?: string;
    street?: string;
    postcode?: string;
    city?: string;
    district?: string;
    state?: string;
    country?: string;
    countrycode?: string;
    extent?: [number, number, number, number];
  };
}

export interface PhotonFeatureCollection {
  type: string;
  features: PhotonFeature[];
}

/**
 * Validates whether latitude and longitude are valid finite numbers within bounds.
 */
export function isValidCoordinate(lng: unknown, lat: unknown): boolean {
  return (
    typeof lng === 'number' &&
    typeof lat === 'number' &&
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    lng >= -180 &&
    lng <= 180 &&
    lat >= -90 &&
    lat <= 90
  );
}

/**
 * Builds a clean, hierarchical display name from Photon properties.
 */
export function formatPhotonDisplayName(props: PhotonFeature['properties']): string {
  const primary = props.name || props.street || '';
  const secondary = [
    props.district,
    props.city && props.city !== primary ? props.city : undefined,
    props.state && props.state !== primary && props.state !== props.city ? props.state : undefined,
    props.country,
  ].filter(Boolean);

  const parts = [primary, ...secondary].filter((part, idx, arr) => part && arr.indexOf(part) === idx);
  return parts.length > 0 ? parts.join(', ') : 'Unknown location';
}

/**
 * Photon Geocoding Adapter implementing GeocodingAdapter interface.
 */
export class PhotonGeocodingAdapter implements GeocodingAdapter {
  readonly id = 'photon';
  readonly name = 'Photon (OpenStreetMap)';
  readonly attribution = PHOTON_ATTRIBUTION;

  private endpoint: string;

  constructor(options?: { endpoint?: string }) {
    this.endpoint = options?.endpoint || PHOTON_DEFAULT_ENDPOINT;
  }

  async search(query: GeocodeQuery): Promise<GeocodeResponse> {
    const trimmed = query.query.trim();
    const retrievedAt = new Date().toISOString();

    if (!trimmed) {
      return {
        success: true,
        results: [],
        query: query.query,
        attribution: this.attribution,
        retrievedAt,
      };
    }

    const limit = Math.max(1, Math.min(query.limit ?? 6, 15));
    const url = new URL(this.endpoint);
    url.searchParams.set('q', trimmed);
    url.searchParams.set('limit', limit.toString());

    if (query.language) {
      url.searchParams.set('lang', query.language);
    } else {
      url.searchParams.set('lang', 'en');
    }

    if (isValidCoordinate(query.lng, query.lat)) {
      url.searchParams.set('lon', query.lng!.toString());
      url.searchParams.set('lat', query.lat!.toString());
    }

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal: query.signal,
      });

      if (!response.ok) {
        if (response.status === 429) {
          return {
            success: false,
            results: [],
            query: trimmed,
            attribution: this.attribution,
            retrievedAt,
            error: {
              code: 'RATE_LIMITED',
              message: 'Geocoding rate limit exceeded. Please wait a moment before trying again.',
              statusCode: 429,
            },
          };
        }

        return {
          success: false,
          results: [],
          query: trimmed,
          attribution: this.attribution,
          retrievedAt,
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: `Geocoding service returned HTTP ${response.status}`,
            statusCode: response.status,
          },
        };
      }

      const data = (await response.json()) as PhotonFeatureCollection;

      if (!data || !Array.isArray(data.features)) {
        return {
          success: false,
          results: [],
          query: trimmed,
          attribution: this.attribution,
          retrievedAt,
          error: {
            code: 'MALFORMED_RESPONSE',
            message: 'Invalid GeoJSON payload returned by geocoding service.',
          },
        };
      }

      const results: GeocodeResult[] = [];

      for (let i = 0; i < data.features.length; i++) {
        const feat = data.features[i];
        if (!feat || !feat.geometry || !Array.isArray(feat.geometry.coordinates)) {
          continue;
        }

        const [lng, lat] = feat.geometry.coordinates;
        if (!isValidCoordinate(lng, lat)) {
          continue;
        }

        const props = feat.properties || {};
        const name = props.name || props.street || `Location ${i + 1}`;
        const displayName = formatPhotonDisplayName(props);

        results.push({
          id: `photon-${props.osm_type || 'x'}-${props.osm_id || i}-${lat.toFixed(5)}-${lng.toFixed(5)}`,
          name,
          displayName,
          lat,
          lng,
          category: props.osm_key,
          type: props.osm_value,
          country: props.country,
          countryCode: props.countrycode,
          state: props.state,
          city: props.city,
          postcode: props.postcode,
          street: props.street,
          extent: props.extent,
          osmId: props.osm_id,
          osmType: props.osm_type,
        });
      }

      return {
        success: true,
        results,
        query: trimmed,
        attribution: this.attribution,
        retrievedAt,
      };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        return {
          success: false,
          results: [],
          query: trimmed,
          attribution: this.attribution,
          retrievedAt,
          error: {
            code: 'ABORTED',
            message: 'Geocoding request was cancelled.',
          },
        };
      }

      return {
        success: false,
        results: [],
        query: trimmed,
        attribution: this.attribution,
        retrievedAt,
        error: {
          code: 'NETWORK_ERROR',
          message: err instanceof Error ? err.message : 'Network request failed',
        },
      };
    }
  }
}
