/* ─── DEM Raster Tile Decoding & Coordinate Math ─────────────────────
   Pure functions for decoding DEM color channels (Terrarium and Mapbox)
   and mapping lat/lng coordinates to Web Mercator tile indices.
   ─────────────────────────────────────────────────────────────────── */

/**
 * Decodes Mapzen / AWS Terrarium RGB color into elevation in meters.
 * Formula: (R * 256 + G + B / 256) - 32768
 * Precision: Sub-meter (~1/256 meter).
 */
export function decodeTerrariumRGB(r: number, g: number, b: number): number {
  const raw = (r * 256) + g + (b / 256) - 32768;
  return Math.round(raw * 10) / 10;
}

/**
 * Encodes an elevation in meters into Terrarium RGB channels (useful for fixtures and mock tests).
 */
export function encodeTerrariumRGB(elevationMeters: number): [number, number, number] {
  const value = elevationMeters + 32768;
  const r = Math.floor(value / 256);
  const g = Math.floor(value % 256);
  const b = Math.floor((value - Math.floor(value)) * 256);
  return [Math.max(0, Math.min(255, r)), Math.max(0, Math.min(255, g)), Math.max(0, Math.min(255, b))];
}

/**
 * Decodes Mapbox Terrain-RGB color into elevation in meters.
 * Formula: -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1)
 * Precision: 0.1 meter.
 */
export function decodeMapboxRGB(r: number, g: number, b: number): number {
  const raw = -10000 + ((r * 256 * 256 + g * 256 + b) * 0.1);
  return Math.round(raw * 10) / 10;
}

/**
 * Converts a geographic WGS84 coordinate [lng, lat] to Web Mercator tile indices at a given zoom level.
 */
export function lngLatToTile(
  lng: number,
  lat: number,
  zoom: number
): { x: number; y: number; pixelX: number; pixelY: number } {
  const clampedLat = Math.max(-85.0511, Math.min(85.0511, lat));
  const n = Math.pow(2, zoom);

  const xFloat = ((lng + 180) / 360) * n;
  const latRad = (clampedLat * Math.PI) / 180;
  const yFloat = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;

  const x = Math.floor(xFloat);
  const y = Math.floor(yFloat);

  const pixelX = Math.floor((xFloat - x) * 256);
  const pixelY = Math.floor((yFloat - y) * 256);

  return { x, y, pixelX, pixelY };
}
