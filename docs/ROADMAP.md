# Wayvora — Roadmap

## Phase 0: Foundation & Milestone Verification
**Status**: VERIFIED & COMPLETE (2026-10-15)

- [x] Repository audit and inventory (17 repos audited, licenses verified)
- [x] License safety analysis (AGPL/GPL isolation, zero proprietary code borrowed)
- [x] Feature comparison matrix & capability gap identification
- [x] Architecture Decision Records (ADR-001 through ADR-007)
- [x] Vite + React 19 + TypeScript project scaffold with strict typing
- [x] Pure Domain model implementation (Journey, Segment, Stop, RoutePoint, Scene, Timeline, ExportProfile)
- [x] Automated unit & boundary tests (49 domain tests + 14 road-to-trail acceptance tests = 63 tests passing)
- [x] MapLibre studio canvas with OpenFreeMap dark vector tiles (zero watermark, no API key required)
- [x] Multi-modal journey explorer (road + hiking trail segments, stops, mode badges, elevation tags)
- [x] Deterministic timeline playback with timecode, speed controls (0.5x-4x), and playhead synchronization
- [x] Live Elevation HUD with area curve and synchronized traveler scrubber
- [x] Project save/load with schema validation and versioned `.wayvora.json` roundtripping
- [x] End-to-end browser smoke test & recording verification


## Phase 1: Real Journey Import (GPX) & Route Integration
**Status**: VERIFIED & COMPLETE (2026-10-15)

- [x] Zero-dependency universal GPX parser (`app/src/domain/gpx.ts`) compatible with browser & Node/Vitest
- [x] Preserves latitude, longitude, elevation, timestamps, and point metadata
- [x] Preserves multiple track segments (`<trkseg>`) without silently connecting unrelated tracks
- [x] Validates coordinates and rejects malformed XML / missing root `<gpx>` tags
- [x] Reports missing elevation, timestamp coverage percentage, and gap statistics honestly
- [x] Automatic duplicate point skipping and timestamp gap detection (> 1 hr)
- [x] Full import provenance tracking (`filename`, `importedAt`, `trackName`, `originalSegmentIndex`, `originalPointCount`)
- [x] Seamless domain conversion: `gpxToJourney()` and `appendGpxToJourney()`
- [x] Studio UI Integration:
  - Header "Import GPX" button and file picker
  - Sidebar drag-and-drop GPX dropzone
  - One-click sample loaders for real GPS activity (`kokoda-track-real-activity.gpx`) and synthetic fixture (`synthetic-alpine-ridge-climb.gpx`)
  - GPX Import Inspection Modal showing distance, points, segments, elevation/timestamp coverage, and validation notes
  - User confirmation workflows: "Create as New Journey" or "Append to Current Journey" (non-destructive)
- [x] Automated test suite: 75 tests passing (12 GPX tests, 14 road-to-trail acceptance tests, 49 domain tests)
- [x] Strict TypeScript production build passing (`tsc -b && vite build`)
- [x] End-to-end browser smoke test verified with WebP recording and screenshot artifacts

## Phase 2: Route Editing & Deterministic Stop-Aware Playback
**Status**: VERIFIED & COMPLETE (2026-10-15)

- [x] Pure Domain Route Editor (`app/src/domain/editor.ts`):
  - Segment selection and inspection with provenance and edit audit status (`isOriginal`, `isModified`, `originalFilename`, point count deltas)
  - Safe point insertion (`insertRoutePoint`) at start, end, or arbitrary index
  - Safe point moving (`moveRoutePoint`) with automatic synchronization of attached stops within 10m
  - Safe point deletion (`deleteRoutePoint`) guarded by a strict minimum 2-point constraint (`EditError`)
  - Stop editing (`updateStop`) and deletion (`deleteStop`)
  - Transport mode editing (`updateSegmentMode`) with synchronized segment types
  - Immutable undo/redo history stack (`createEditorHistory`, `pushEditorHistory`, `undoEditorHistory`, `redoEditorHistory`, `canUndo`, `canRedo`)
- [x] Deterministic Stop-Aware Playback Engine (`app/src/domain/timeline.ts`):
  - Pure deterministic phase scheduler (`computeTimelineSchedule`) decomposing journey into alternating Motion and Dwell phases
  - Configured stop dwell durations (`Stop.durationAtStop`) modeled as cinematic dwell time
  - Deterministic seeking before, during, and after stops (`isDwelling`, `activeStop`, `dwellProgress`)
  - Precise boundary phase selection (at arrival $t = t_{\text{dwellStart}}$, traveler immediately dwells)
  - Zero NaN protection for missing elevation or timestamps
  - Backward compatibility: toggled via `stopDwell` property/option, smoothly falling back to continuous linear motion
- [x] Studio UI Integration (`app/src/App.tsx`, `app/src/index.css`):
  - Segments sidebar tab with segment cards, mode selector, and edit audit badges
  - Point inspector with latitude, longitude, and elevation inputs
  - Interactive MapLibre segment vertices layer (`segment-points-layer`) with clickable circles
  - Navbar Undo (↺) and Redo (↻) buttons with keyboard shortcuts (`Ctrl+Z`, `Ctrl+Y`) and unsaved change indicator
  - Stop dwell input (in seconds) in Stops/Waypoints tab
  - Map Top HUD dwell chip displaying `⏸ Dwelling: [Stop Name] (x.xs / y.ys)`
  - Timeline footer dwell toggle button (`⏸ Dwell: ON / OFF`) and effective duration synchronization
- [x] Automated Testing Suite: 94 tests passing across 8 test suites (including 13 editor tests and 6 stop-playback tests)
- [x] Strict TypeScript build passing (`tsc -b && vite build`)
- [x] End-to-end browser smoke test verified with WebP recording and screenshot artifacts

## Phase 3: Geographic Intelligence and Road Routing
**Status**: VERIFIED & COMPLETE (2026-10-15)

- [x] Provider Research & Comparative Analysis (`docs/research/ROUTING_OPTIONS.md`):
  - Rigorous evaluation of OSRM, Valhalla, and GraphHopper across geometry quality, rate limits, licensing, costs, and operational trade-offs.
  - Recorded ADR-008 for provider-independent adapter architecture.
- [x] Provider-Independent Routing Adapter Contract (`app/src/domain/routing/`):
  - `RoutingAdapter` interface with typed `RouteRequest`, `RouteResult`, `RoutingProviderMetadata`, and `RouteErrorDetails`.
  - `MockRoutingProvider`: Deterministic offline fixture generator supporting custom geometries, curvature synthesis, and simulated error codes (`NO_ROUTE`, `TIMEOUT`, `NETWORK_ERROR`).
  - `OsrmRoutingProvider`: Standard OSRM v1 REST integration supporting GeoJSON LineString coordinate extraction, configurable base URLs, custom fetch injection, polite timeouts, and HTTP status code handling (429 rate limiting, 500 server errors, malformed payloads).
- [x] Non-Destructive Road Segment Integration (`app/src/domain/editor.ts`):
  - `applyRouteToSegment`: Replaces road segment geometry with high-resolution route points without touching other segments or GPX trail tracks.
  - `createRoutedSegment`: Appends new road segments derived from routing results.
  - Provenance tracking (`sourceFormat: 'osrm'`, provider ID, retrieval timestamp, routed distance/duration).
  - Synchronizes attached stop positions at segment boundaries.
  - Full undo/redo and project serialization preservation.
- [x] Geographic Quality Diagnostics Module (`app/src/domain/diagnostics.ts`):
  - Coordinate validation (lat [-90, 90], lng [-180, 180], NaN checks).
  - Single-point segment detection (< 2 points error).
  - Consecutive duplicate point detection (< 0.1m warning).
  - Sparse 2-point route detection (> 50km info).
  - Segment boundary continuity audit (distance gaps > 100m warning).
  - Elevation coverage percentage and honest gain/loss calculation (never invents missing elevation).
  - Implausible vertical elevation jump and extreme slope warnings (> 500m / 100m).
  - Suspicious negative elevation warnings (< -430m).
- [x] Studio UI Integration (`app/src/App.tsx`, `app/src/index.css`):
  - Segment editor "Road Routing Engine" box with travel profile selector (`driving`, `cycling`, `walking`) and "Route via OSRM" button.
  - Non-destructive route confirmation card ("Apply to Segment" / "Cancel") showing distance, road points, and duration.
  - Error banner with one-click "Try Offline Mock Route" fallback.
  - Geographic Diagnostics panel in Metadata tab with Health Status Badge, metrics breakdown, and audit findings list.
- [x] Automated Testing Suite: 117 tests passing across 10 test suites (including 11 routing tests and 12 diagnostics tests).
- [x] Strict TypeScript build passing (`tsc -b && vite build` in ~427ms).
- [x] End-to-end browser smoke test verified: OSRM live routing query returned 3,678 road points across 118.3 km, applied to Segment #1, verified undo, and captured WebP recording.


## Phase 4: Real 3D Terrain and Elevation Pipeline
**Status**: VERIFIED & COMPLETE (2026-10-15)

- [x] Research & Comparative Architecture Evaluation (`docs/research/TERRAIN_OPTIONS.md`):
  - In-depth evaluation of MapLibre Native 3D Raster-DEM, Custom Three.js/WebGL DEM mesh, and Point Elevation Web APIs (Open-Elevation, Open-Meteo).
  - Assessed DEM resolution (SRTM 30m vs Copernicus 30m vs ArcticDEM), coverage, licensing (Public Domain / ODbL), caching, GPU performance, and operational costs.
  - Recorded ADR-009 for Native MapLibre 3D Raster-DEM with AWS Open Data Terrarium tiles.
- [x] Provider-Independent Elevation Sampling Contract (`app/src/domain/elevation/`):
  - Pure domain types: `ElevationCoord`, `ElevationSample`, `ElevationProvider`, `ElevationProviderMetadata`, `ElevationResolution`, `ElevationUnits`.
  - Terrarium RGB decoder: pure mathematical decoding $(R \cdot 256 + G + B/256) - 32768$ with sub-meter vertical precision.
  - Mapbox RGB decoder: $(R \cdot 256^2 + G \cdot 256 + B) \cdot 0.1 - 10000$.
  - WGS84 to Web Mercator tile index calculation (`lngLatToTile`).
  - `MockElevationProvider`: In-memory LRU caching, missing tile/coordinate simulation, batch queries, and deterministic offline fixtures.
  - Honest data policy: never invents missing elevation measurements; cleanly separates recorded GPS elevation from externally sampled terrain elevation and interpolated values.
- [x] Real 3D Terrain Rendering in MapLibre Studio (`app/src/App.tsx`):
  - AWS Open Data Terrarium raster-DEM source configured (`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`).
  - Dynamic `map.setTerrain({ source: 'terrain-source', exaggeration: terrainExaggeration })` integration.
  - Exaggeration control (0.5x to 2.5x) with live slider in Right Inspector.
  - Graceful fallback: one-click toggle to 2D flat mode or automatic fallback when offline or tiles fail to load.
  - Automatic GeoJSON vector draping: route glow, route line, segment vertices, and markers seamlessly drape over the 3D mountain mesh.
  - Studio UI controls: Quick Map Action 🏔 button with active state & toast, Right Inspector "3D Terrain & Relief" control box with attribution.
- [x] Deterministic Camera Ground Clearance Engine (`app/src/domain/camera.ts`):
  - Mercator ground resolution scaling (`getMetersPerPixel`).
  - Pure mathematical clearance evaluation: `evaluateCameraClearance(...)` calculates camera eye altitude, evaluates ground elevation at camera coordinates, detects mountain collision/subsurface clipping, and clamps pitch to maintain visual line of sight.
  - Integrated into studio frame evaluation loop.
- [x] Automated Testing Suite: 129 tests passing across 11 test suites (including 12 new terrain/elevation tests in `app/src/__tests__/terrain.test.ts`).
- [x] Strict TypeScript build passing (`tsc -b && vite build` in ~539ms).
- [x] End-to-end browser smoke test verified: tested 3D terrain toggling, exaggeration adjustments, 2D fallback, Mt. Whitney Alpine Ascent (4421m summit), and camera clearance with WebP recording (`phase4_terrain_elevation_smoke_1792046284962.webp`).


## Phase 5: Cinematic Camera Engine & Scene Director
**Status**: VERIFIED & COMPLETE (2026-10-15)

- [x] Provider-Independent Cinematic Camera Domain (`app/src/domain/camera.ts`):
  - Typed models: `CameraKeyframe`, `CameraEasing`, `EvaluatedCameraState`, `CameraClearanceResult`, `CameraMode`.
  - Pure mathematical easing curves: `linear`, `easeInQuad`, `easeOutQuad`, `easeInOutQuad`, `easeInOutCubic`, `smoothstep`.
  - Angle wrapping across the 0°/360° boundary taking the shortest angular delta $((\Delta\theta + 540) \pmod{360}) - 180$.
  - Coordinate interpolation across the antimeridian via `shortestLngDelta` and `normalizeLng`.
  - Look-ahead route lead calculation (`destinationPoint(target, bearing, lookAheadMeters)`).
- [x] Deterministic Camera Keyframe Interpolator:
  - `evaluateCameraAtTime(keyframes, time, fallbackTarget, fallbackBearing, fallbackMode, groundEleAtCam)` evaluates camera center, bearing, pitch, zoom, and eye position purely as a function of time.
  - Boundary behavior: clamps to exact first and last keyframe parameters when out of bounds.
  - Smooth keyframe blending with eased interpolation between adjacent keyframes.
  - Zero stateful dependency: repeated seeking to time $t$ yields identical floating-point values.
- [x] 3D Terrain Clearance & Mountain Collision Prevention:
  - Spherical geodesic camera eye computation (`calculateCameraEyePosition`).
  - True ground elevation sampling directly under camera eye via MapLibre's `map.queryTerrainElevation`.
  - Dynamic pitch clamping and altitude elevation (`evaluateCameraClearance`): detects when camera eye descends below mountain terrain + clearance buffer, clamping pitch to maintain line of sight.
  - Clean fallback when terrain is disabled or tiles are not yet loaded.
- [x] AutoCam Composition Generator (`generateAutoCamKeyframes`):
  - Analyzes journey duration, transport modes, stop dwells, and summits to synthesize an optimal cinematic camera track.
  - Establishing panoramic overview at $t = 0$.
  - Smooth road/trail chase following with look-ahead lead.
  - Stop dwell approach, flyover, and gentle orbit.
  - Final destination panoramic overview.
- [x] Studio User Interface & Real-Time Inspector (`app/src/App.tsx`, `app/src/index.css`):
  - 5 Cinematic Camera Modes: `OVERVIEW`, `FLYOVER`, `CHASE`, `GROUND`, `ORBIT`.
  - Live Terrain Clearance HUD: displays ground elevation at camera eye, camera altitude, ground clearance buffer, and collision aversion badge.
  - Cinematic Keyframe Track: toggle ON/OFF, "✨ AutoCam" one-click sequencer, "➕ Add KF" at playhead, seek to keyframe (▶), and delete keyframe (×).
- [x] Automated Testing Suite: 148 tests passing across 12 test suites (including 19 camera domain tests in `app/src/__tests__/camera.test.ts`).
- [x] Strict TypeScript build passing (`tsc -b && vite build` in ~505ms).
- [x] End-to-end browser smoke test verified: AutoCam generation, keyframe seeking, manual camera modes (orbit/chase), Mt. Whitney Alpine Ascent (4421m), and clearance HUD with WebP recording (`phase5_cinematic_camera_smoke_1792047911221.webp`).


## Phase 6: Media, Annotations & Audio
**Status**: PROPOSED

- Photo attachment to stops with geo-anchoring
- Photo modal / callout display during stop dwell
- Text captions, milestones, and summit annotations
- Ambient audio / narration track synchronization
- Dynamic video overlay graphics (title card, speed, elevation graph, odometer)

## Phase 7: Deterministic Video Export (WebCodecs)
**Status**: PROPOSED

- WebCodecs + `mp4-muxer` frame-by-frame offline rendering pipeline
- Canvas frame capture with zero frame drops
- Multiple aspect ratios (16:9 landscape, 9:16 vertical reels/shorts, 1:1 square)
- Resolution selection (720p, 1080p, 4K)
- Export progress bar and offline video preview

## Non-Goals (Explicit)

- Native mobile app (browser-first)
- Real-time GPS navigation / turn-by-turn routing
- Social network features / cloud lock-in
- Silently fabricating missing elevation or route coordinates

