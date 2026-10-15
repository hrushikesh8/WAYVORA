# Wayvora — 3D Terrain & Elevation Pipeline Research

## 1. Executive Context

Wayvora must render cinematic mountain landscapes for both alpine hiking routes (e.g. Mt. Whitney, Swiss Alps, Kokoda Track) and dramatic highway passes. While Phase 0–3 used a tilted 2.5D vector map with an Elevation HUD, Phase 4 introduces true geographically grounded 3D terrain elevation displacement.

This document evaluates three candidate architectures for 3D terrain rendering and elevation sampling.

---

## 2. Comparison Matrix of 3D Terrain Architectures

| Dimension | Option 1: MapLibre Native 3D Terrain (`raster-dem`) | Option 2: Custom WebGL / Three.js Mesh Pipeline | Option 3: Point Elevation API + 2.5D Extrusions |
|---|---|---|---|
| **Rendering Engine** | Native WebGL in MapLibre GL JS v5 (`map.setTerrain`) | External Three.js / WebGL canvas overlay | REST API queries + 2D map styling |
| **DEM Data Sources** | AWS Open Data Terrarium (`s3.amazonaws.com/elevation-tiles-prod/terrarium`), MapTiler Terrain-RGB | Custom GeoTIFF / DEM heightmap files | Open-Meteo Elevation API, Open-Elevation API, SRTM 30m |
| **Tile Resolution & Coverage** | Global coverage, zoom 0–15 (~4m to 30m resolution based on SRTM, ArcticDEM, NED). | High local resolution, but requires custom tile-loading pipeline. | 30m–90m grid resolution per coordinate. |
| **GPU Mesh Performance** | Highly optimized C++/JS GPU vertex displacement with dynamic QuadTree LOD. | High performance but duplicates scene graph and memory. | Negligible GPU load (flat 2D map). |
| **Route Layer Draping** | **Automatic**: MapLibre drapes vector line layers (`LineString`), markers, and glow effects directly onto 3D terrain slope. | **Manual**: Must implement custom depth-tested polyline conformer in Three.js. | Flat lines; no terrain draping. |
| **Offline & Fallback** | Smooth fallback to flat 2D vector map when offline or if tiles fail to load. | Fails completely if mesh fails to generate. | Graceful, but produces no 3D terrain visuals. |
| **Attribution & Licensing** | AWS Open Data / Mapzen (Open Data, MIT / public domain). Tile access free under open data sponsorship. | Dependent on source DEM (USGS / Copernicus / SwissALTI3D). | Open-Meteo / Open-Elevation (ODbL / CC-BY). |
| **Architectural Complexity** | **Low–Medium**: Fully leverages existing MapLibre stack without introducing external renderers. | **Very High**: Major risk of desynchronized camera, projection mismatch, and broken UI interactions. | **Low**: But fails to deliver actual 3D visual landscape. |

---

## 3. Selected Strategy: MapLibre Native `raster-dem` + Elevation Adapter

### Architecture Decision:
1. **MapLibre Native `raster-dem` with Terrarium Encoding**:
   - Utilize MapLibre's built-in terrain engine (`map.addSource('terrain-source', { type: 'raster-dem', encoding: 'terrarium' })` and `map.setTerrain({ source: 'terrain-source', exaggeration: 1.0 })`).
   - Use AWS Open Data Terrarium elevation tiles:
     `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`
   - Decoding formula:
     $$\text{Height (meters)} = (R \times 256 + G + B / 256) - 32768$$
   - Provides global, keyless, open-data terrain tiles with zero proprietary licensing lock-in.
2. **Provider-Independent Elevation Sampling Contract (`ElevationProvider`)**:
   - Interface providing `getElevation(coord: LatLng): Promise<ElevationSample>`.
   - Distinguishes recorded GPS elevation (`RoutePoint.ele`) from terrain sampled elevation (`sample.elevationMetres`) and external API elevation.
   - NEVER invents numbers or overwrites real recorded data.
3. **Deterministic Camera-Ground Clearance Engine**:
   - Computes camera altitude relative to ground elevation at the camera's ground position and target position.
   - Clamps minimum clearance (e.g. +150m to +300m above terrain) to prevent clipping through mountain peaks during chase or ground camera modes.
4. **Resilient Studio UI Controls**:
   - 3D Terrain Toggle button in studio HUD (`3D Terrain: ON / OFF`).
   - Exaggeration slider (1.0x to 2.5x) for dramatic landscape relief.
   - Error detection with automatic graceful fallback to flat cartography.
