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


## Phase 6: Story Editor, Media Annotations and Scene Timeline
**Status**: VERIFIED & COMPLETE (2026-10-15)

- [x] Story Domain Model (`app/src/domain/story/types.ts`, `app/src/domain/types.ts`):
  - Typed models: `StoryScene`, `SceneIntent` (`establishing`, `travel`, `stop`, `highlight`, `arrival`), `MediaAsset`, `SceneTransition` (`cut`, `fade`, `dissolve`, `wipe`), and `EvaluatedStoryState`.
  - Narrative copy: scene headline `title`, supporting `subtitle`, and travelogue `caption`.
  - Camera mode overrides and active keyframe associations.
  - Composable domain separation: story overlays are decoupled from raw GPS points and routing-provider data.
- [x] Zero-Dependency Binary EXIF Parser (`app/src/domain/story/media.ts`):
  - Pure `DataView` over `ArrayBuffer` parser (`parseJpegExif`) for JPEG APP1 (`0xFFE1`) marker.
  - Decodes TIFF endianness (both `II` Little Endian and `MM` Big Endian), IFD0 tags, and sub-IFDs.
  - Extracts camera hardware model (0x0110) and original capture timestamp (`DateTimeOriginal` 0x9003).
  - Decodes GPS Info IFD (0x8825) rational coordinate arrays into true decimal degrees with latitude/longitude hemisphere references.
  - **Strict Provenance**: Never fabricates capture coordinates or timestamps; fields remain strictly `undefined` if metadata is missing or corrupted.
- [x] Lightweight Project Serialization & Backward-Compatible Migration (`app/src/domain/serialization.ts`):
  - Media assets stored as lightweight references (`url`, `filename`, `geoPosition`, `timestamp`, `title`, `caption`).
  - Zero binary base64 bloat in project JSON (`.wayvora.json`).
  - Automatic migration in `migrateProject`: normalizes legacy scene percentage ranges to absolute timeline seconds, populates default intents, and initializes media arrays.
- [x] Deterministic Pure Story Evaluation (`app/src/domain/story/evaluator.ts`):
  - `evaluateStoryAtTime(scenes, timeSeconds, options)` pure mathematical function deriving active scene, title cards, captions, active media callouts, and transition state.
  - 100% deterministic: seeking forward, backward, or repeated evaluation at time $t$ yields identical overlay states with zero side effects.
  - Seamlessly composed into `evaluateTimeline(journey, time)` to populate `FrameState.storyState`.
- [x] AutoStory Synthesis Generator (`generateDefaultStoryScenes`):
  - Analyzes journey duration, departure, stop waypoints, and arrival to automatically generate a cohesive narrative story arc.
  - Validates scenes with `validateStoryScenes` (zero timeline gaps or inversions).
- [x] Story Editor Operations & Full Undo/Redo Integration (`app/src/domain/editor.ts`):
  - `addStoryScene`, `updateStoryScene`, `deleteStoryScene`, `reorderStoryScenes`.
  - `attachMediaToScene`, `attachMediaToStop`, `removeMedia`.
  - All operations wrapped in immutable undo/redo history stack (`pushEditorHistory`).
- [x] Studio UI & Cinematic Canvas Overlays (`app/src/App.tsx`, `app/src/index.css`):
  - Story Inspector Tab in sidebar with AutoStory generator ("✨ AutoStory"), Add Scene button ("➕ Add Scene"), scene cards with intent badges, timeline bounds, camera mode selector, and photo attachment.
  - Live viewport canvas overlays:
    - `.cinematic-title-card`: Centered glassmorphic title card with subtle letter-spacing and backdrop blur.
    - `.cinematic-caption-bar`: Bottom travelogue caption bar displaying narrative commentary.
    - `.floating-photo-card`: Floating photograph callout showcasing attached photos with authentic EXIF timestamp and GPS badges.
    - `.transition-overlay`: Full-viewport fade/dissolve overlay preview during scene transitions.
  - Stops Tab photo attachment integration with thumbnail preview and removal.
- [x] Automated Unit Test Suite: 158 tests passing across 13 test suites (including 10 comprehensive tests in `app/src/__tests__/story.test.ts`).
- [x] Strict TypeScript build passing (`tsc -b && vite build` in ~473ms).
- [x] End-to-end browser smoke test verified: AutoStory synthesis, story scene editing, canvas title card and caption bar overlays, playhead synchronization, and recording (`phase6_story_media_smoke_1792049294905.webp`).

## Phase 7: Media Playback and Deterministic Rendering Foundation
**Status**: VERIFIED & COMPLETE (2026-10-15)

- [x] Unified RenderFrame Contract (`app/src/domain/render/types.ts`, `contract.ts`):
  - Typed `RenderFrame` composing spatial traveler state (position, bearing, progress, segment), cinematic camera pose (center, bearing, pitch, zoom, eye position, altitude, mode), story overlays (scene, title, subtitle, caption, active media, transitions), and resource readiness.
  - Formal determinism classification (`classifyDeterminism`): defines mathematical determinism (coordinates, angles, dwell progress, copy) vs environmental factors (WebGL GPU rasterization, network tile caches, font metrics, hardware encoders).
  - Pure mathematical evaluator `evaluateRenderFrame(journey, timeSeconds, options)` guaranteeing bitwise identical output on repeated seeks.
  - Generator `generateRenderFrames(journey, options)` producing sequential frames on a fixed-step grid ($\Delta t = 1 / \text{fps}$) with zero frame drops or timing drift.
- [x] Media Playback & Resource Lifecycle Management (`app/src/domain/render/mediaManager.ts`):
  - Multi-format asset detection: supports image formats (`.jpg`, `.png`, `.webp`) and video formats (`.mp4`, `.webm`).
  - Active playback resolution (`resolveMediaPlayback`): computes media time offset within active scene and visibility bounds.
  - Synchronized HTML5 video element control (`synchronizeVideoElement`): muted seeking and play/pause handling with zero unhandled autoplay rejections.
  - Session ObjectURL lifecycle management (`mediaRegistry`): tracks and revokes temporary blob URLs to avoid browser memory leaks.
  - Graceful missing asset diagnostics: marks `isMissing: true` with error messages rather than silently substituting unrelated files.
- [x] Offscreen Canvas Compositor (`app/src/domain/render/canvasCompositor.ts`):
  - 2D canvas drawing pipeline:
    - Base map rendering from MapLibre canvas (enabled via `preserveDrawingBuffer: true`) or cinematic fallback gradient.
    - Scene transitions (mathematical alpha fade/dissolve).
    - Floating media cards with authentic EXIF metadata badges (elevation, timestamp, camera model) or missing file notice.
    - Glassmorphic cinematic title cards with uppercase title and subtitle.
    - Lower-third travelogue caption bars with gold accent icons.
    - Technical HUD overlay (timecode, spatial progress %, resolution watermark).
- [x] Deterministic Video Export Pipeline (`app/src/domain/render/exporter.ts`):
  - Frame-by-frame rendering decoupled from real-time playback speed.
  - Primary hardware encoder: WebCodecs `VideoEncoder` + `mp4-muxer` (MIT) producing standard seekable H.264 MP4 video blobs with microsecond presentation timestamps.
  - Fallback encoder: `MediaRecorder` canvas capture stream producing WebM video.
  - Full `AbortSignal` cancellation support and frame backpressure handling.
  - Asynchronous progress callback: percent, current frame, elapsed time, and estimated remaining time.
  - In-browser blob download helper (`downloadExportBlob`).
- [x] Studio UI Integration (`app/src/App.tsx`, `app/src/index.css`):
  - Added dedicated **🎬 Export** tab to studio sidebar tabs.
  - Export profile selector: YouTube 1080p, TikTok / Reels 9:16, Instagram Square 1:1, Fast Draft 720p.
  - Framerate selector (30 FPS / 60 FPS) and hardware encoder status badge.
  - Action buttons: "🎬 Render & Export Video" and "🖼 Capture 1080p Frame PNG".
  - Live export progress card with animated progress bar and Cancel button.
  - Export Ready result card with in-app playable `<video controls>` preview and direct MP4 download button.
  - Viewport floating media card upgraded with HTML5 `<video>` synchronization and missing media placeholder.
- [x] Automated Unit Test Suite: 172 tests passing across 14 test suites (including 14 comprehensive tests in `app/src/__tests__/render.test.ts`).
- [x] Strict TypeScript build passing (`tsc -b && vite build` in ~470ms).
- [x] End-to-end browser smoke test verified: Export panel, Fast Draft 720p profile, 1080p PNG snapshot, deterministic 900-frame video export (0.18 MB MP4), playable video preview, and recording (`phase7_render_export_smoke_1792050897331.webp`).

## Phase 8: Deterministic Audio Timeline, Mixing, and MP4 Synchronization
**Status**: VERIFIED & COMPLETE (2026-10-15)

- [x] Typed Audio Domain Model (`app/src/domain/audio/types.ts`):
  - Typed domain models: `AudioClip`, `AudioTrack`, `AudioTimeline`, `ActiveAudioClipState`, `EvaluatedAudioState`.
  - Properties: `id`, `name`, `assetRef`, `trackId`, `timelineStart`, `duration`, `sourceOffset` (trim-in), `volume` (gain), `fadeIn`, `fadeOut`.
  - Clip validation (`validateAudioClip`): checks ID, name, finite positive duration, non-negative start/offset, and non-negative fade durations.
  - Integration with `Journey.audio` and backward-compatible project migration in `migrateProject`.
  - Serialization integrity: guarantees `.wayvora.json` contains only clip timing and URI references, with zero raw binary PCM or base64 audio data stored.
  - Editor integration (`app/src/domain/editor.ts`): immutable undo/redo history for `addAudioClip`, `updateAudioClip`, `deleteAudioClip`, `setAudioTrackVolume`, and `setMasterAudioVolume`.
- [x] Deterministic Offline PCM Mixer & Synthesis (`app/src/domain/audio/mixer.ts`):
  - Pure mathematical gain calculation with smooth sinusoidal S-curve fade-in and fade-out (`calculateClipGain`).
  - Active clip evaluation at arbitrary timeline time (`evaluateAudioTimelineAtTime`).
  - Offline Float32Array PCM stereo mixing at 44.1 kHz (`mixAudioPcm`): sample-accurate accumulation across all tracks.
  - Clipping prevention: hyperbolic tangent soft-knee limiter compression ($\tanh(x)$ above $\pm 0.95$) preventing harsh digital distortion.
  - Zero-dependency procedural synthesis: `synthesizeAudioTone` generates harmonic A-major ambient triad pads (220 Hz + 277.18 Hz + 329.63 Hz).
  - Pure binary WAV generator: `pcmToWavBlob` writes 16-bit stereo RIFF/WAVE files for zero-dependency browser preview.
- [x] Audio Decoding & Asset Management (`app/src/domain/audio/audioLoader.ts`):
  - `decodeAudioSource`: decodes procedural synthetic URIs, ObjectURLs, and standard audio files via browser `AudioContext.decodeAudioData`.
  - LRU/Map buffer caching with explicit cleanup (`clearDecodedAudioCache`).
  - Missing/corrupted audio handling: logs diagnostic warnings and returns silent buffers rather than aborting exports.
- [x] Audiovisual WebCodecs Exporter Integration (`app/src/domain/render/exporter.ts`):
  - WebCodecs `AudioEncoder` configured for `mp4a.40.2` (AAC-LC, 44.1 kHz, 128 kbps stereo).
  - `mp4-muxer` configured with `{ codec: 'aac', numberOfChannels: 2, sampleRate: 44100 }` and `firstTimestampBehavior: 'cross-track-offset'`.
  - Chunked 1024-frame `AudioData` planar buffers with microsecond presentation timestamps aligned with video frame bounds.
  - Defined behavior for empty audio timelines (graceful fallback to video-only MP4) and duration mismatches.
- [x] Studio UI Integration (`app/src/App.tsx`, `app/src/index.css`):
  - Dedicated **🎵 Audio** tab in studio sidebar with live clip count badge.
  - Master volume slider and Track cards (Background Music, Voiceover/Narration).
  - Procedural "✨ Ambient Score" generator button and "📁 Add File" picker.
  - Clip cards with start time, trim, duration, volume, and fade in/out sliders.
  - In-studio clip preview (play/pause) via hidden HTML5 audio element.
  - Export panel status badge: live indication of `Audiovisual Mode: 🎵 Synchronized AAC Audio` vs `Video Only`.
- [x] Automated Unit Test Suite: 182 tests passing across 15 test suites (including 10 comprehensive tests in `app/src/__tests__/audio.test.ts`).
- [x] Strict TypeScript build passing (`tsc -b && vite build` in ~470ms).

## Phase 9: Export Validation, Cinematic Polish, and Social Formats
**Status**: VERIFIED & COMPLETE (2026-10-15)

- [x] Empirical Export Validation Acceptance Gate:
  - Real browser export of 4.0-second 720p 30 FPS audiovisual MP4 (`scratch/test_export_phase9.mp4`, 247.5 kB) evaluated via `ffprobe` and `ffmpeg`.
  - Video stream: `h264 (High) (avc1)`, 1280x720, 30.0 fps, progressive, 120 frames.
  - Audio stream: `aac (LC) (mp4a)`, 44.1 kHz, stereo, 128 kbps, 173 frames.
  - Video/Audio synchronization: cross-track alignment via `mp4-muxer` microsecond PTS.
  - Frame decodes: visually verified start (0.5s), middle (2.0s), and end (3.5s) rendered frames without artifacting or distortion.
  - Audio analysis (`ffmpeg volumedetect`): -10.4 dB peak / -19.1 dB RMS loudness, non-clipping.
- [x] Social-Format Safe Area Framing (`app/src/domain/render/canvasCompositor.ts`):
  - Dynamic platform insets (`getSafeAreaInsets`) across 16:9, 9:16 (TikTok/Reels/Shorts), 1:1, and 4:5.
  - 9:16 vertical safe areas prevent occlusion from profile headers (11% top), sound/caption zones (18% bottom), and interaction ribbons (13% right).
  - Optional visual safe-area dashed overlay guides (`drawSafeAreaGuides`) in studio export configuration.
- [x] Smart Non-Overlapping Compositor Layout:
  - Dual-card collision avoidance: in 16:9 widescreen, automatically splits simultaneous title cards and photo media callouts into an elegant two-column layout (title left 48%, photo right 42%).
  - In 9:16 vertical and 1:1 square, automatically stacks title cards at top and media callouts centered lower.
  - Caption readability: automatic multi-line text wrapping and deep text drop shadows (`rgba(0,0,0,0.85)` with 8px blur) guaranteeing legibility over bright vector tiles and snow-covered terrain.
- [x] Cinematic Post-Processing Treatments:
  - Radial vignette (`drawVignette`) focusing viewer attention on the route path and 3D terrain features.
  - Curated filmic color grade presets (`drawColorGrade`):
    - `golden-hour`: warm amber tone (`#d97706`) with soft-light blending.
    - `alpine-cool`: crisp glacial blue tone (`#0284c7`) for high-altitude mountain expeditions.
    - `sunset-glow`: vivid twilight magenta/orange (`#e11d48`).
    - `noir-contrast`: dramatic desaturated high-contrast documentary styling.
- [x] Deterministic Preset Travel Templates (`app/src/domain/templates/`):
  - 4 production-ready templates:
    - `cinematic-road-trip`: 45s sweeping cruise pacing, gentle chase camera, golden-hour grade, and ambient synth score.
    - `hiking-summit-reveal`: 35s trail pacing, automated high-point summit orbit reveal, alpine-cool grade, and high-altitude ambient score.
    - `city-exploration`: 25s punchy urban pacing, top-down and 45° inspection camera keyframes, and crisp neutral styling.
    - `social-reel-highlights`: 15s rapid-cut 3-scene vertical reel (Departure, High Point, Arrival) formatted with 9:16 safe-area framing.
  - Zero GPS/elevation hallucination: strictly configures timeline scenes, camera keyframes, color grading, and audio tracks while preserving 100% of source route geometry, elevation, and provenance.
  - Full editor integration with immutable undo/redo history (`applyTemplateToJourney`).
- [x] Studio UI Integration (`app/src/App.tsx`, `app/src/index.css`):
  - Added Cinematic Color Grade selector (`Raw`, `🌅 Amber`, `❄️ Alpine`, `🌆 Sunset`, `🎬 Noir`).
  - Added Vignette toggle and Safe-Area overlay toggle.
  - Added Quick-Apply Template cards with duration, color badge, and one-click application directly in Export Tab.
- [x] Automated Unit Test Suite: 194 tests passing across 16 test suites (including 12 comprehensive tests in `app/src/__tests__/polish-and-templates.test.ts`).
- [x] Strict TypeScript build passing (`tsc -b && vite build` in ~580ms).

## Phase 10: Performance, Reliability, and Distribution Readiness
**Status**: VERIFIED & COMPLETE (2026-10-15)

- [x] High-Performance Spatial Distance Caching (`app/src/domain/timeline.ts`):
  - Memoized spatial calculation pipeline (`getCachedJourneySpatialData`) caching `allPoints`, `cumulativeDistances`, `totalDistance`, and `segmentLengths` keyed to immutable `journey.segments`.
  - Replaced per-frame $O(N)$ Haversine distance calculations and array allocations with $O(1)$ cached lookups across `evaluateTimeline`, `computeTimelineSchedule`, `findStopSpatialProgress`, and `findActiveSegmentIndex`.
  - **Empirical Measurement**: 500-frame timeline evaluation on 5,000 points accelerated from 178.14 ms to 0.46 ms (**391.4x speedup**), with zero memory leaks.
- [x] Reliability & Schema Hardening (`journey.ts`, `serialization.ts`):
  - Hardened `validateJourney` and `deserializeProject` against truncated JSON, invalid/negative version numbers, missing journey objects, corrupted latitudes/longitudes, and degenerate segments.
  - Legacy project auto-migration handles missing audio timelines and converts legacy percentage scenes into deterministic seconds.
  - Encoder cleanup: guaranteed `VideoEncoder` and `AudioEncoder` closure in `renderWithWebCodecs` `catch` block prevents hardware encoder channel exhaustion on canceled or failed exports.
- [x] Atomic Project Auto-Save & Crash Recovery (`app/src/domain/storage.ts`):
  - Staged atomic two-step persistence to browser storage (`saveProjectToStorage`, `loadProjectFromStorage`).
  - Automatically recovers project state from temporary staging key if primary storage was interrupted mid-write.
  - Seamless `MemoryStorage` fallback for non-browser/test environments and non-throwing `QuotaExceededError` handling.
  - Debounced auto-save hook in `App.tsx` saves changes continuously without frame stutter.
- [x] Distribution Strategy & PWA Standalone Packaging:
  - Documented desktop distribution tradeoffs (ADR-015): PWA + Local Production Runner selected over Electron (avoids >150 MB binary bloat) and Tauri v2 (ensures reliable native hardware WebCodecs across platforms).
  - Web App Manifest (`app/public/manifest.webmanifest`) configured with standalone display mode, theme colors, and icons.
  - Service Worker (`app/public/sw.js`) provides offline caching for application shell, styles, and vector assets.
  - Strict exclusion of the 1.78 GB `RESOURCES/` research repository collection from all production bundles.
- [x] Comprehensive Acceptance Test Suite:
## Phase 4: Place Search & Geocoding Autocomplete
**Status**: VERIFIED & COMPLETE (2026-10-15)

- [x] Provider Evaluation & Architecture Decision (ADR-016):
  - Evaluated Photon (Komoot/OSM), Nominatim, OpenCage, Mapbox, and Pelias.
  - Selected Photon as default active provider: specifically engineered for fast search-as-you-type autocomplete, zero API keys required in client code, ODbL attribution, and self-hostable.
  - MockGeocodingAdapter implemented for offline development and deterministic unit testing.
- [x] Provider-Agnostic Geocoding Interface (`app/src/domain/geocoding/`):
  - `GeocodingAdapter`, `GeocodeQuery`, `GeocodeResponse`, `GeocodeResult`, and error types.
  - Coordinate validation (`isValidCoordinate`) rejecting out-of-bounds lat/lng, NaNs, and infinities.
  - Clean display name formatting (`formatPhotonDisplayName`) deduplicating location hierarchies.
- [x] Studio Place Search UI (`app/src/components/PlaceSearch.tsx`):
  - 280ms debounced input with loading indicator.
  - Request cancellation using `AbortController` preventing stale-response race conditions.
  - Accessible keyboard navigation (ArrowUp, ArrowDown, Enter, Escape).
  - Explicit states for loading, no results found, network errors, and 429 rate limits.
  - Clear button and click-outside dismissal.
  - Selected place inspection card with place name, coordinates, address hierarchy, and "+ Add Waypoint to Journey" button.
- [x] Map Canvas & Lifecycle Integration (`app/src/App.tsx`):
  - Smooth camera `flyTo` animation to selected coordinates.
  - Temporary pulsing cyan location marker.
  - Persistent marker lifecycle across all 5 map styles (Standard, Outdoors, Satellite, Satellite+Labels, Cinematic) via `style.load` hooks.
  - Prominent OpenStreetMap and Photon attribution display.
- [x] Route & Undo/Redo Integration (`app/src/domain/editor.ts`):
  - Pure functional `appendPlaceToJourney(journey, place, options)`.
  - Appends to empty journey as start stop or connects from previous end stop with a manual segment.
  - Seamlessly pushes changes to `EditorHistory`, supporting full undo/redo without mutating existing waypoint IDs, timestamps, or route provenance.
- [x] Comprehensive Acceptance & Unit Tests:
  - Added `app/src/__tests__/geocoding.test.ts` (22 tests) verifying coordinate validation, result parsing, provider adapters, abort signals, route waypoint integration, and undo/redo stacks.
  - Total test suite: **266 passed / 266 tests** across 21 test suites in 1.45s.
  - Strict TypeScript build passing (`tsc -b && vite build` in 599ms).
- [x] Browser QA Verification:
  - Verified in browser with automated recording: successful autocomplete search for "Zurich", keyboard selection, map fly-to, place inspection card, "+ Add Waypoint to Journey" (stop count 11 -> 12), Undo (12 -> 11), Redo (11 -> 12), no-results message for random queries, clear search dismiss, and map style switching across all 5 styles.

## Non-Goals (Explicit)

- Native mobile app (browser-first)
- Full Digital Audio Workstation (DAW) with complex VSTs/plugins
- AI voice cloning / cloud TTS upload
- Real-time GPS navigation / turn-by-turn routing
- Silently fabricating missing elevation or route coordinates



