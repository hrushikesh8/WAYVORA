import { describe, it, expect } from 'vitest';
import {
  decodeTerrariumRGB,
  encodeTerrariumRGB,
  decodeMapboxRGB,
  lngLatToTile,
} from '../domain/elevation/decoder';
import { MockElevationProvider } from '../domain/elevation/mock';
import { evaluateCameraClearance, getMetersPerPixel } from '../domain/camera';
import type { RoutePoint } from '../domain/types';

describe('3D Terrain DEM Decoding & Web Mercator Projection', () => {
  it('decodes Terrarium RGB channels to accurate elevation in meters', () => {
    // 0 meters elevation in Terrarium: (R * 256 + G + B/256) = 32768 => R=128, G=0, B=0
    expect(decodeTerrariumRGB(128, 0, 0)).toBe(0);

    // Sea level / Dead Sea (-430m)
    // 32768 - 430 = 32338 => 32338 / 256 = 126 rem 82
    const deadSeaRGB = encodeTerrariumRGB(-430);
    const decodedDeadSea = decodeTerrariumRGB(deadSeaRGB[0], deadSeaRGB[1], deadSeaRGB[2]);
    expect(decodedDeadSea).toBeCloseTo(-430, 0);

    // Mount Whitney summit (4421m)
    const whitneyRGB = encodeTerrariumRGB(4421);
    const decodedWhitney = decodeTerrariumRGB(whitneyRGB[0], whitneyRGB[1], whitneyRGB[2]);
    expect(decodedWhitney).toBeCloseTo(4421, 0);

    // Mount Everest summit (8848m)
    const everestRGB = encodeTerrariumRGB(8848.5);
    const decodedEverest = decodeTerrariumRGB(everestRGB[0], everestRGB[1], everestRGB[2]);
    expect(decodedEverest).toBeCloseTo(8848.5, 0);
  });

  it('decodes Mapbox Terrain-RGB channels accurately', () => {
    // 0 meters in Mapbox RGB: -10000 + (val * 0.1) = 0 => val = 100000
    // 100000 / 65536 = 1 rem 34464; 34464 / 256 = 134 rem 160
    const ele0 = decodeMapboxRGB(1, 134, 160);
    expect(ele0).toBe(0);

    // 1000 meters in Mapbox RGB
    // -10000 + (110000 * 0.1) = 1000 => val = 110000
    // 110000 / 65536 = 1 rem 44464; 44464 / 256 = 173 rem 176
    const ele1000 = decodeMapboxRGB(1, 173, 176);
    expect(ele1000).toBe(1000);
  });

  it('maps geographic coordinates [lng, lat] to Web Mercator tile indices', () => {
    // Prime Meridian & Equator (0, 0) at zoom 0 -> tile (0, 0)
    const tileZ0 = lngLatToTile(0, 0, 0);
    expect(tileZ0.x).toBe(0);
    expect(tileZ0.y).toBe(0);

    // Zurich (lng: 8.5417, lat: 47.3769) at zoom 10
    const zurichTileZ10 = lngLatToTile(8.5417, 47.3769, 10);
    expect(zurichTileZ10.x).toBeGreaterThan(0);
    expect(zurichTileZ10.y).toBeGreaterThan(0);
    expect(zurichTileZ10.pixelX).toBeGreaterThanOrEqual(0);
    expect(zurichTileZ10.pixelX).toBeLessThan(256);
    expect(zurichTileZ10.pixelY).toBeGreaterThanOrEqual(0);
    expect(zurichTileZ10.pixelY).toBeLessThan(256);

    // Extreme latitude clamping (-85.0511 to +85.0511)
    const northPoleTile = lngLatToTile(0, 89.9, 5);
    const southPoleTile = lngLatToTile(0, -89.9, 5);
    expect(Number.isFinite(northPoleTile.y)).toBe(true);
    expect(Number.isFinite(southPoleTile.y)).toBe(true);
  });
});

describe('Elevation Provider Domain Contract & Caching', () => {
  it('retrieves elevation samples with full provenance and metadata', async () => {
    const provider = new MockElevationProvider({ defaultElevation: 1250 });
    const sample = await provider.getElevation({ lat: 46.6, lng: 8.0 });

    expect(sample.elevationMetres).toBe(1250);
    expect(sample.providerId).toBe('mock-elevation-provider');
    expect(sample.attribution).toContain('Wayvora');
    expect(sample.isMissing).toBe(false);
    expect(sample.isFallback).toBe(false);
    expect(sample.cacheHit).toBe(false);
  });

  it('caches sampled coordinates and returns cacheHit = true on subsequent queries', async () => {
    const provider = new MockElevationProvider({ defaultElevation: 2000 });
    const coord = { lat: 46.578, lng: 7.961 };

    const firstSample = await provider.getElevation(coord);
    expect(firstSample.cacheHit).toBe(false);
    expect(provider.getCacheSize()).toBe(1);

    const secondSample = await provider.getElevation(coord);
    expect(secondSample.cacheHit).toBe(true);
    expect(secondSample.elevationMetres).toBe(2000);
  });

  it('handles simulated missing data without throwing or inventing values', async () => {
    const provider = new MockElevationProvider({ simulateMissing: true });
    const sample = await provider.getElevation({ lat: 46.6, lng: 8.0 });

    expect(sample.elevationMetres).toBeNull();
    expect(sample.isMissing).toBe(true);
    expect(sample.isFallback).toBe(false);
  });

  it('handles simulated offline errors with graceful fallback flag', async () => {
    const provider = new MockElevationProvider({ simulateOffline: true });
    const sample = await provider.getElevation({ lat: 46.6, lng: 8.0 });

    expect(sample.elevationMetres).toBeNull();
    expect(sample.isMissing).toBe(true);
    expect(sample.isFallback).toBe(true);
  });

  it('supports batch elevation queries over route coordinates', async () => {
    const provider = new MockElevationProvider({ defaultElevation: 1500 });
    const coords = [
      { lat: 46.60, lng: 8.00 },
      { lat: 46.62, lng: 8.02 },
      { lat: 46.64, lng: 8.04 },
    ];

    const samples = await provider.getElevations(coords);
    expect(samples).toHaveLength(3);
    expect(samples.every((s) => s.elevationMetres === 1500)).toBe(true);
  });
});

describe('Camera Clearance Engine & Mountain Intersection Prevention', () => {
  it('calculates ground resolution in meters per pixel accurately', () => {
    const mppEquator = getMetersPerPixel(0, 10);
    const mppSwissAlps = getMetersPerPixel(46.6, 10);

    expect(mppEquator).toBeGreaterThan(0);
    expect(mppSwissAlps).toBeLessThan(mppEquator); // Cosine latitude scaling
  });

  it('maintains requested pitch when camera has ample safe clearance in overview mode', () => {
    const target: RoutePoint = { lat: 46.6, lng: 8.0, ele: 1000 };
    const clearance = evaluateCameraClearance(target, 'overview', 45, 10, 1000);

    expect(clearance.isClippingAverted).toBe(false);
    expect(clearance.clampedPitch).toBe(45);
    expect(clearance.clearanceMetres).toBeGreaterThan(300);
  });

  it('detects ground clipping and elevates camera when flying low over mountains', () => {
    const valleyTarget: RoutePoint = { lat: 46.60, lng: 8.00, ele: 900 };
    // Mountain ridge right under camera eye is at 2800m elevation!
    const mountainUnderCameraEle = 2800;

    const clearance = evaluateCameraClearance(
      valleyTarget,
      'chase',
      70, // Steep tilt
      14, // Close zoom
      mountainUnderCameraEle,
      { minClearanceMetres: 150 }
    );

    // Camera clipping should be detected and averted
    expect(clearance.isClippingAverted).toBe(true);
    expect(clearance.effectiveCameraAltitude).toBeGreaterThanOrEqual(mountainUnderCameraEle + 150);
    expect(clearance.clearanceMetres).toBeGreaterThanOrEqual(150);
    expect(clearance.clampedPitch).toBeLessThan(70); // Pitch tilted up to clear ridge
  });

  it('evaluates camera clearance deterministically', () => {
    const target: RoutePoint = { lat: 36.5785, lng: -118.2923, ele: 4421 }; // Mt. Whitney Summit
    const res1 = evaluateCameraClearance(target, 'ground', 65, 13, 3800);
    const res2 = evaluateCameraClearance(target, 'ground', 65, 13, 3800);

    expect(res1).toEqual(res2);
    expect(Number.isFinite(res1.effectiveCameraAltitude)).toBe(true);
    expect(Number.isFinite(res1.clearanceMetres)).toBe(true);
  });
});
