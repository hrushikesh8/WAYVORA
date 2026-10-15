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

## Phase 2: Route Editing & Routing Services
**Status**: PROPOSED

- Interactive map route vertex editing (drag/add/delete waypoints)
- OSRM road routing integration for road segments
- Great-circle air route computation for flights
- Stop management (reorder, rename, transition duration adjuster)
- Multiple transport modes per segment


## Phase 2: Camera & Scene System
**Status**: PROPOSED

- Camera modes: overview, flyover, chase, ground, orbit
- Scene editor with camera mode per scene
- Timeline scrubber with scene boundaries
- Camera keyframe interpolation
- AutoCam: follow route with smoothing
- Terrain-aware camera (clear mountains)

## Phase 3: Trail Support
**Status**: PROPOSED

- GPX track import for hiking/trail segments
- Elevation-aware rendering (color by gradient)
- Trail-specific camera modes (first-person, drone chase)
- Waypoint markers along trails
- Pace/speed visualization
- Trail comparison (side-by-side replays)

## Phase 4: Media & Annotations
**Status**: PROPOSED

- Photo attachment to stops
- Photo gallery display during playback
- Text captions and annotations
- Music / narration audio tracks
- Overlay graphics (title, odometer, progress bar)

## Phase 5: Export & Sharing
**Status**: PROPOSED

- WebCodecs deterministic MP4 export
- Multiple aspect ratios (16:9, 9:16, 1:1)
- Resolution up to 4K
- Codec selection (H.264, H.265, AV1)
- Progress bar during export
- Export preview

## Phase 6: Advanced Features
**Status**: PROPOSED

- 3D terrain with satellite imagery
- Globe projection for intercontinental journeys
- Sea lane routing
- 3D vehicle models
- Custom map styles
- Cloud project storage (optional)
- Collaborative editing

## Non-Goals (Explicit)

- Native mobile app (browser-first)
- Real-time GPS tracking
- Navigation / turn-by-turn directions
- Social network features
- AI-generated content
