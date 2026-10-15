/* ─── Elevation Provider Domain Contract ──────────────────────────────
   Defines the provider-independent interface for elevation sampling,
   caching, and provenance retention.
   ─────────────────────────────────────────────────────────────────── */

export interface ElevationCoord {
  lat: number;
  lng: number;
}

export interface ElevationSample {
  coord: ElevationCoord;
  elevationMetres: number | null;
  resolutionMetres?: number;
  providerId: string;
  providerName: string;
  attribution: string;
  retrievedAt: string;
  isMissing: boolean;
  isFallback: boolean;
  cacheHit?: boolean;
}

export interface ElevationProviderMetadata {
  id: string;
  name: string;
  attribution: string;
  encoding?: 'terrarium' | 'mapbox' | 'custom';
  resolution?: string;
  sourceUrl?: string;
}

export interface ElevationProvider {
  readonly id: string;
  readonly name: string;
  readonly attribution: string;

  getElevation(coord: ElevationCoord): Promise<ElevationSample>;
  getElevations(coords: ElevationCoord[]): Promise<ElevationSample[]>;
}
