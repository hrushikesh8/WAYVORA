/* ─── Mock Geocoding Adapter ───────────────────────────────────────────
   Deterministic, offline geocoding adapter for automated testing and
   local development without external network dependencies.
   ─────────────────────────────────────────────────────────────────── */

import type {
  GeocodingAdapter,
  GeocodeQuery,
  GeocodeResponse,
  GeocodeResult,
  GeocodeErrorDetails,
} from './types';

export const MOCK_GEOCODE_DATABASE: GeocodeResult[] = [
  {
    id: 'mock-zurich',
    name: 'Zurich',
    displayName: 'Zurich, Canton of Zurich, Switzerland',
    lat: 47.3769,
    lng: 8.5417,
    category: 'place',
    type: 'city',
    country: 'Switzerland',
    countryCode: 'CH',
    state: 'Zurich',
    city: 'Zurich',
    postcode: '8001',
    osmId: 1685633,
    osmType: 'R',
  },
  {
    id: 'mock-zermatt',
    name: 'Zermatt',
    displayName: 'Zermatt, Valais, Switzerland',
    lat: 45.9765,
    lng: 7.7491,
    category: 'place',
    type: 'town',
    country: 'Switzerland',
    countryCode: 'CH',
    state: 'Valais',
    city: 'Zermatt',
    postcode: '3920',
    osmId: 1685640,
    osmType: 'R',
  },
  {
    id: 'mock-matterhorn',
    name: 'Matterhorn',
    displayName: 'Matterhorn, Valais, Switzerland',
    lat: 45.9763,
    lng: 7.6586,
    category: 'natural',
    type: 'peak',
    country: 'Switzerland',
    countryCode: 'CH',
    state: 'Valais',
    osmId: 26863133,
    osmType: 'N',
  },
  {
    id: 'mock-chamonix',
    name: 'Chamonix-Mont-Blanc',
    displayName: 'Chamonix-Mont-Blanc, Haute-Savoie, France',
    lat: 45.9237,
    lng: 6.8694,
    category: 'place',
    type: 'town',
    country: 'France',
    countryCode: 'FR',
    state: 'Auvergne-Rhône-Alpes',
    city: 'Chamonix-Mont-Blanc',
    postcode: '74400',
    osmId: 104273,
    osmType: 'R',
  },
  {
    id: 'mock-san-francisco',
    name: 'San Francisco',
    displayName: 'San Francisco, California, United States',
    lat: 37.7749,
    lng: -122.4194,
    category: 'place',
    type: 'city',
    country: 'United States',
    countryCode: 'US',
    state: 'California',
    city: 'San Francisco',
    postcode: '94102',
    osmId: 111968,
    osmType: 'R',
  },
  {
    id: 'mock-los-angeles',
    name: 'Los Angeles',
    displayName: 'Los Angeles, California, United States',
    lat: 34.0522,
    lng: -118.2437,
    category: 'place',
    type: 'city',
    country: 'United States',
    countryCode: 'US',
    state: 'California',
    city: 'Los Angeles',
    postcode: '90012',
    osmId: 207359,
    osmType: 'R',
  },
  {
    id: 'mock-tokyo',
    name: 'Tokyo',
    displayName: 'Tokyo, Japan',
    lat: 35.6762,
    lng: 139.6503,
    category: 'place',
    type: 'city',
    country: 'Japan',
    countryCode: 'JP',
    state: 'Tokyo',
    city: 'Tokyo',
    osmId: 1543114,
    osmType: 'R',
  },
  {
    id: 'mock-paris',
    name: 'Paris',
    displayName: 'Paris, Île-de-France, France',
    lat: 48.8566,
    lng: 2.3522,
    category: 'place',
    type: 'city',
    country: 'France',
    countryCode: 'FR',
    state: 'Île-de-France',
    city: 'Paris',
    postcode: '75001',
    osmId: 71525,
    osmType: 'R',
  },
];

export class MockGeocodingAdapter implements GeocodingAdapter {
  readonly id = 'mock';
  readonly name = 'Mock Geocoding Provider';
  readonly attribution = 'Mock Geocoding Dataset (Offline Testing)';

  private database: GeocodeResult[];
  private simulatedDelayMs: number;
  private forcedError: GeocodeErrorDetails | null = null;

  constructor(options?: {
    database?: GeocodeResult[];
    simulatedDelayMs?: number;
    forcedError?: GeocodeErrorDetails | null;
  }) {
    this.database = options?.database ?? [...MOCK_GEOCODE_DATABASE];
    this.simulatedDelayMs = options?.simulatedDelayMs ?? 0;
    this.forcedError = options?.forcedError ?? null;
  }

  setForcedError(error: GeocodeErrorDetails | null): void {
    this.forcedError = error;
  }

  async search(query: GeocodeQuery): Promise<GeocodeResponse> {
    const trimmed = query.query.trim().toLowerCase();
    const retrievedAt = new Date().toISOString();

    if (this.simulatedDelayMs > 0) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, this.simulatedDelayMs);
        if (query.signal) {
          query.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }
      });
    }

    if (query.signal?.aborted) {
      return {
        success: false,
        results: [],
        query: query.query,
        attribution: this.attribution,
        retrievedAt,
        error: {
          code: 'ABORTED',
          message: 'Geocoding request was cancelled.',
        },
      };
    }

    if (this.forcedError) {
      return {
        success: false,
        results: [],
        query: query.query,
        attribution: this.attribution,
        retrievedAt,
        error: this.forcedError,
      };
    }

    if (!trimmed) {
      return {
        success: true,
        results: [],
        query: query.query,
        attribution: this.attribution,
        retrievedAt,
      };
    }

    const limit = query.limit ?? 6;
    const matches = this.database
      .filter((item) => {
        return (
          item.name.toLowerCase().includes(trimmed) ||
          item.displayName.toLowerCase().includes(trimmed) ||
          (item.city && item.city.toLowerCase().includes(trimmed)) ||
          (item.country && item.country.toLowerCase().includes(trimmed))
        );
      })
      .slice(0, limit);

    return {
      success: true,
      results: matches,
      query: query.query,
      attribution: this.attribution,
      retrievedAt,
    };
  }
}
