/* ─── Geocoding & Place Search Domain Types ───────────────────────────
   Defines the provider-agnostic place search and geocoding contract for WAYVORA.
   Supports search-as-you-type autocomplete, coordinate verification,
   provenance attribution, and graceful error handling.
   ─────────────────────────────────────────────────────────────────── */

export interface GeocodeResult {
  id: string;
  name: string;
  displayName: string;
  lat: number;
  lng: number;
  category?: string; // e.g. 'place', 'boundary', 'highway', 'natural', 'tourism'
  type?: string;     // e.g. 'city', 'town', 'village', 'peak', 'administrative'
  country?: string;
  countryCode?: string;
  state?: string;
  city?: string;
  postcode?: string;
  street?: string;
  extent?: [number, number, number, number]; // [westLng, southLat, eastLng, northLat]
  osmId?: string | number;
  osmType?: string;
}

export interface GeocodeQuery {
  query: string;
  limit?: number;
  lat?: number; // Proximity bias
  lng?: number;
  language?: string;
  signal?: AbortSignal;
}

export interface GeocodeErrorDetails {
  code: 'INVALID_QUERY' | 'NETWORK_ERROR' | 'TIMEOUT' | 'RATE_LIMITED' | 'MALFORMED_RESPONSE' | 'ABORTED' | 'SERVICE_UNAVAILABLE';
  message: string;
  statusCode?: number;
}

export interface GeocodeResponse {
  success: boolean;
  results: GeocodeResult[];
  query: string;
  attribution: string;
  retrievedAt: string; // ISO 8601
  error?: GeocodeErrorDetails;
}

export interface GeocodingAdapter {
  readonly id: string;
  readonly name: string;
  readonly attribution: string;
  search(query: GeocodeQuery): Promise<GeocodeResponse>;
}
