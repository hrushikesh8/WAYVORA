import type { ElevationCoord, ElevationSample, ElevationProvider } from './types';

export interface MockElevationOptions {
  defaultElevation?: number;
  elevationsByCoord?: Record<string, number>;
  simulateMissing?: boolean;
  simulateOffline?: boolean;
  resolutionMetres?: number;
}

export class MockElevationProvider implements ElevationProvider {
  readonly id = 'mock-elevation-provider';
  readonly name = 'Mock Deterministic Elevation Provider';
  readonly attribution = 'Wayvora Deterministic Terrain Fixture';

  private cache = new Map<string, ElevationSample>();
  private options: MockElevationOptions;

  constructor(options: MockElevationOptions = {}) {
    this.options = options;
  }

  setOptions(options: MockElevationOptions): void {
    this.options = options;
  }

  clearCache(): void {
    this.cache.clear();
  }

  getCacheSize(): number {
    return this.cache.size;
  }

  async getElevation(coord: ElevationCoord): Promise<ElevationSample> {
    const key = `${coord.lat.toFixed(5)},${coord.lng.toFixed(5)}`;
    const cached = this.cache.get(key);
    if (cached) {
      return { ...cached, cacheHit: true };
    }

    if (this.options.simulateOffline) {
      const sample: ElevationSample = {
        coord,
        elevationMetres: null,
        providerId: this.id,
        providerName: this.name,
        attribution: this.attribution,
        retrievedAt: new Date().toISOString(),
        isMissing: true,
        isFallback: true,
        cacheHit: false,
      };
      return sample;
    }

    if (this.options.simulateMissing) {
      const sample: ElevationSample = {
        coord,
        elevationMetres: null,
        providerId: this.id,
        providerName: this.name,
        attribution: this.attribution,
        retrievedAt: new Date().toISOString(),
        isMissing: true,
        isFallback: false,
        cacheHit: false,
      };
      this.cache.set(key, sample);
      return sample;
    }

    let ele: number;
    if (this.options.elevationsByCoord && this.options.elevationsByCoord[key] != null) {
      ele = this.options.elevationsByCoord[key];
    } else if (this.options.defaultElevation != null) {
      ele = this.options.defaultElevation;
    } else {
      // Deterministic synthetic elevation landscape: e.g. Alpine gradient based on coordinates
      const base = 800;
      const variation = Math.sin(coord.lat * 50) * Math.cos(coord.lng * 50) * 1200;
      ele = Math.round(base + Math.abs(variation));
    }

    const sample: ElevationSample = {
      coord,
      elevationMetres: ele,
      resolutionMetres: this.options.resolutionMetres ?? 30,
      providerId: this.id,
      providerName: this.name,
      attribution: this.attribution,
      retrievedAt: new Date().toISOString(),
      isMissing: false,
      isFallback: false,
      cacheHit: false,
    };

    this.cache.set(key, sample);
    return sample;
  }

  async getElevations(coords: ElevationCoord[]): Promise<ElevationSample[]> {
    return Promise.all(coords.map((c) => this.getElevation(c)));
  }
}
