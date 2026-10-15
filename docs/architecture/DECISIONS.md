# Architectural Decision Records — Wayvora

## ADR-001: React + Vite + TypeScript as application framework

**Status**: ACCEPTED  
**Date**: 2026-10-13

**Context**: We need a framework that supports complex editor UIs (timeline, panels, map),
has strong typing, excellent tooling, and a large ecosystem. The reference repositories
use various stacks: Vanilla JS (triptrail, travel-animation, flight-map-studio),
SvelteKit (CreatorMaps, journey-atlas), React (lil-mappo, locusify, travelback), Vue (tourgaze).

**Decision**: React 19 + Vite 6 + TypeScript.

**Rationale**:
- React dominates the two most feature-rich references (travelback: MIT, lil-mappo: AGPL study).
- TypeScript provides the type safety needed for a complex domain model.
- Vite provides fast HMR and is the standard build tool across modern repos.
- The team has the deepest experience with React.

**Alternatives rejected**:
- SvelteKit: Excellent DX but smaller ecosystem for complex editors. journey-atlas and CreatorMaps use it.
- Vanilla JS: triptrail proves it works at small scale, but a 77K single-file app.js shows the limits.
- Vue: Only used by tourgaze (AGPL, Java backend — wrong architecture).

---

## ADR-002: MapLibre GL JS as map renderer

**Status**: ACCEPTED  
**Date**: 2026-10-13

**Context**: The map renderer is the most critical dependency. Options include MapLibre GL (free, BSD-3),
Mapbox GL JS (proprietary, requires API key), Leaflet (2D only), d3-geo (2D canvas).

**Decision**: MapLibre GL JS v5.

**Rationale**:
- Free and open-source (BSD-3-Clause), no API key for the library itself.
- 3D terrain support, globe projection, vector tiles.
- Used by 4 MIT-licensed references (triptrail, travelback, travel-animation, TrailReplay).
- Mapbox GL JS requires a paid API key and has a proprietary license since v2.
- Leaflet is 2D-only, inadequate for cinematic 3D terrain.
- d3-geo (flight-map-studio) is powerful but requires building the entire rendering pipeline from scratch.

**Tile sources**: OpenFreeMap, VersaTiles, CARTO (all free, no API key). Satellite tiles from ESRI
World Imagery (free for non-commercial display) or Maptiler (free tier).

---

## ADR-003: Unified Journey model with typed segments

**Status**: ACCEPTED  
**Date**: 2026-10-13

**Context**: No reference repository combines road and trail segments in a single journey model.
TripTrail has multi-modal stops but no GPX trail support. Travelback has GPX tracks but no
multi-modal routing. TrailReplay has multi-track journeys but limited road support.

**Decision**: A single `Journey` contains an ordered list of `JourneySegment` objects, each with
a discriminating `type` field (`road | trail | air | sea`). Segments share a common `RoutePoint[]`
geometry but differ in metadata and provenance.

**Rationale**:
- This is Wayvora's core differentiator — the unified model.
- Segments must preserve type through serialization for correct rendering and re-routing.
- A `sourceFormat` field tracks provenance (manual, gpx, osrm, geojson).
- The domain model is provider-independent: no MapLibre or OSRM types in the core.

---

## ADR-004: Zustand for state management

**Status**: ACCEPTED  
**Date**: 2026-10-13

**Context**: Options include Redux, Zustand, Jotai, MobX, React Context.

**Decision**: Zustand.

**Rationale**:
- Minimal boilerplate, TypeScript-native.
- Proven at scale by lil-mappo (complex timeline editor with undo/redo via Zundo).
- Supports middleware for persistence, undo/redo, devtools.
- Lighter than Redux, more structured than bare Context.

---

## ADR-005: Deterministic timeline evaluation

**Status**: ACCEPTED  
**Date**: 2026-10-13

**Context**: Preview and export must produce identical results. Many reference repos use
requestAnimationFrame for preview but a deterministic clock for export — this means
the preview doesn't exactly match the export.

**Decision**: A single `evaluateTimeline(journey, timeSeconds)` function returns the
complete visual state (position, bearing, camera). Preview calls it with wall-clock time;
export calls it with frame-clock time (frameIndex / fps).

**Rationale**:
- Guarantees WYSIWYG between preview and export.
- Simplifies testing — timeline evaluation is a pure function.
- Follows the pattern used successfully by triptrail and flight-map-studio.

---

## ADR-006: Project persistence as .wayvora.json

**Status**: ACCEPTED  
**Date**: 2026-10-13

**Context**: Need save/load without a backend. Options: IndexedDB, localStorage, file download.

**Decision**: Download/upload of `.wayvora.json` files, with optional IndexedDB auto-save.

**Rationale**:
- JSON is human-readable, diffable, and debuggable.
- File download works everywhere, no quota limits.
- IndexedDB auto-save provides crash recovery.
- Versioned format (`"version": 1`) enables forward migration.
- georeel uses `.georeel` archives (ZIP); premature for v1.

---

## ADR-007: No Mapbox dependency

**Status**: ACCEPTED  
**Date**: 2026-10-13

**Context**: lil-mappo (the most feature-rich reference) uses Mapbox GL JS, which requires
a proprietary API key. flyover_routes also depends on Mapbox.

**Decision**: Use only MapLibre GL JS. Do not introduce any Mapbox dependency.

**Rationale**:
- Wayvora must be free and self-hostable.
- MapLibre is the community fork of Mapbox GL v1, fully BSD-3-Clause.
- All essential features (3D terrain, globe, vector tiles) are available in MapLibre.
- Mapbox-specific features (Standard style, 3D landmarks) are not needed for v1.

---

## ADR-008: Provider-Independent Road Routing Adapter Contract

**Status**: ACCEPTED  
**Date**: 2026-10-15

**Context**: Coarse road waypoints require high-resolution geometry snapped to real-world highway networks. Available engines include OSRM, Valhalla, and GraphHopper. Public demonstration endpoints have strict rate limits and zero SLAs, while commercial hosted endpoints require API keys and credit cards.

**Decision**:
Define a clean, provider-independent `RoutingAdapter` interface with typed `RouteRequest` and `RouteResult` data structures. Implement a deterministic `MockRoutingProvider` for offline testing and an `OsrmRoutingProvider` for live road routing (using standard OSRM v1 REST protocol with configurable base URLs and strict timeout/error handling). Never couple the pure journey domain directly to an HTTP endpoint.

**Rationale**:
- Decouples the pure domain model and unit tests from external networks.
- Enables seamless switching between public testing endpoints (OSRM demo) and production self-hosted Docker containers or commercial providers (Valhalla / Stadia Maps / GraphHopper).
- Preserves trail segments and imported GPX tracks completely intact when re-routing road segments.

---

## ADR-009: Native MapLibre 3D Raster-DEM Terrain & Elevation Sampling Contract

**Status**: ACCEPTED  
**Date**: 2026-10-15

**Context**: High-fidelity mountain visualization is essential for hiking trails and alpine road passes. Introducing external 3D renderers (e.g. Three.js / Babylon) introduces massive synchronization complexity, projection mismatches, duplicate tile-loading pipelines, and broken vector labeling. Commercial DEM tile providers (e.g. Mapbox / MapTiler) require paid API keys and usage tracking.

**Decision**:
1. Implement 3D terrain natively in MapLibre GL JS v5 using `raster-dem` with open Terrarium encoding from the AWS Open Data terrain tile repository (`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`).
2. Establish a provider-independent `ElevationProvider` domain contract that returns typed `ElevationSample` objects with explicit provenance (source, resolution, attribution, fallback status).
3. Strictly keep recorded GPS elevation (`RoutePoint.ele`) distinct from terrain-sampled elevation (`ElevationSample.elevationMetres`). Never invent elevation or silently overwrite recorded points.
4. Implement a deterministic camera clearance engine that prevents camera-ground clipping through mountain terrain while following routes.
5. Provide automatic, resilient fallback to flat 2D/2.5D cartography if 3D terrain tiles fail to load or are toggled off by the user.

**Rationale**:
- MapLibre natively deforms terrain on the GPU and drapes vector polyline layers, glows, and markers directly onto mountain slopes with zero custom depth-testing shaders.
- AWS Open Data Terrarium tiles provide global coverage (SRTM/NED/ArcticDEM) without proprietary API keys or per-tile billing.
- Decouples domain elevation queries from MapLibre canvas state for headless testing and export pipeline determinism.

---

## ADR-010: Deterministic Cinematic Camera Engine, Keyframe Track, and Terrain Ground Clearance

**Status**: ACCEPTED  
**Date**: 2026-10-15

**Context**: Simple static camera pitch and zoom values produce robotic, jarring playback and frequently clip into mountain ridges on steep alpine trails. Users require cinematic motion (overview establishing shots, smooth road chasing, gentle stop dwell orbits, and summit flyovers) with deterministic keyframe interpolation, angle wrapping, and reliable terrain clearance.

**Decision**:
1. Implement a pure domain camera engine (`app/src/domain/camera.ts`) with typed `CameraKeyframe`, `CameraEasing`, and `EvaluatedCameraState`.
2. Ensure mathematical determinism: given timeline time $t$ and keyframes, `evaluateCameraAtTime` computes the exact camera state with zero stateful memory.
3. Handle angle wrapping across the 0°/360° boundary via shortest angular delta $((\Delta\theta + 540) \pmod{360}) - 180$.
4. Calculate 3D camera eye coordinates geographically using pure spherical geodesics (`destinationPoint`) and query terrain elevation directly under the eye using MapLibre's `queryTerrainElevation`.
5. Implement dynamic pitch clamping and altitude elevation (`evaluateCameraClearance`): if ground elevation under the camera eye exceeds camera altitude minus safe clearance, pitch is automatically clamped to maintain visual line of sight above mountain ridges.
6. Provide an intelligent `generateAutoCamKeyframes` generator that analyzes journey duration, transport mode transitions, stop dwell periods, and summits to synthesize an optimal camera choreography.
7. Seamlessly integrate into both the timeline evaluator (`evaluateTimeline`) and the interactive studio inspector with real-time Ground Clearance HUD and Keyframe Sequencer.

**Rationale**:
- Complete determinism guarantees identical camera framing between interactive browser preview and offline video export.
- Spherical geodesics and angle wrapping eliminate sudden 360° camera spins or antimeridian distortions.
- Mountain collision aversion prevents the camera from clipping into rock faces during steep mountain ascents.

---

## ADR-011: Story Domain, Zero-Dependency EXIF Extraction, and Composable Overlay Timeline

**Status**: ACCEPTED  
**Date**: 2026-10-15

**Context**: Moving beyond geographic route rendering and camera choreography, WAYVORA must function as a journey-story editor. Users need to combine their journey with narrative scenes (establishing, travel, stop dwell, highlight, arrival), titles, subtitles, captions, photographs, and visual transitions into a unified deterministic timeline. Crucially, project serialization must remain lightweight without embedding multi-megabyte binary payloads into JSON, and EXIF metadata (GPS, capture timestamps) must be accurately extracted from user photos without third-party bloat and without ever fabricating unverified coordinates.

**Decision**:
1. **Story Domain Model**:
   - Introduce `StoryScene` with typed `SceneIntent` (`establishing`, `travel`, `stop`, `highlight`, `arrival`), timeline time intervals (`startTime`, `endTime`), narrative copy (`title`, `subtitle`, `caption`), visual `transition` (`cut`, `fade`, `dissolve`, `wipe`), and associated `media` assets.
   - Separate story narrative layer from raw GPS track points and routing-provider data while maintaining composability.
2. **Zero-Dependency Binary EXIF Parser**:
   - Implement `parseJpegExif` using native `DataView` over `ArrayBuffer` to parse JPEG APP1 (`0xFFE1`), read TIFF headers (both `II` Little Endian and `MM` Big Endian), decode IFD0 tags, extract `DateTimeOriginal` (0x9003) and camera model (0x0110), and resolve GPS Info IFD (0x8825) rational coordinate arrays into verified decimal degrees with hemisphere reference.
   - **Strict Provenance**: Never fabricate capture coordinates or timestamps; if EXIF is absent or corrupt, properties remain strictly `undefined`.
3. **Clean Project Serialization & Migration**:
   - Store media assets as metadata references (`url`, `filename`, `geoPosition`, `timestamp`, `title`, `caption`). Never embed binary base64 payloads into `.wayvora.json`.
   - Update `migrateProject` to auto-normalize legacy scenes (convert percentage boundaries to absolute timeline seconds, set default intents, and initialize empty media collections).
4. **Deterministic Timeline Evaluation**:
   - Implement `evaluateStoryAtTime` as a pure mathematical function $(scenes, t, options) \to EvaluatedStoryState$.
   - Repeated evaluation at the same timeline time $t$ yields identical state regardless of playback history, seeking direction, or frame rate.
   - Integrate into `evaluateTimeline` to supply `FrameState.storyState` alongside spatial travel coordinates and camera keyframe interpolation.
5. **Interactive Story Studio & Full Undo/Redo**:
   - Add dedicated "Story" inspector tab with scene cards, intent badges, time controls, title/subtitle/caption inputs, camera mode overrides, and media attachment.
   - Provide "✨ AutoStory" synthesis generator (`generateDefaultStoryScenes`) analyzing journey duration, departure, stop waypoints, and arrival.
   - Render live cinematic canvas overlays in the viewport (`cinematic-title-card`, `cinematic-caption-bar`, `floating-photo-card`, `transition-overlay`).
   - Incorporate all story mutations (`addStoryScene`, `updateStoryScene`, `deleteStoryScene`, `reorderStoryScenes`, `attachMediaToScene`, `attachMediaToStop`, `removeMedia`) into the immutable undo/redo history stack.

**Rationale**:
- Zero-dependency parsing keeps bundle size minimal and avoids supply-chain vulnerabilities.
- Preserving authentic EXIF provenance guarantees that photo placement along the route is faithful to real-world capture conditions.
- Separating story overlays from camera keyframes and geographic route segments allows users to freely edit narrative copy and timing without corrupting route points or map geometry.

---

## ADR-012: Deterministic Render-Frame Contract, Media Synchronization, and Hardware WebCodecs Export

**Status**: ACCEPTED  
**Date**: 2026-10-15

**Context**: Transitioning WAYVORA from an interactive geographic/cinematic studio into an actual travel video production engine requires a formal, frame-by-frame rendering foundation. Interactive playback relies on `requestAnimationFrame` and browser wall-clock scheduling, which cannot guarantee zero-drop frame rates or reproducible offline exports. Furthermore, users require multimedia support (both photographs and HTML5 video assets), clear handling of missing or moved assets without silent fabrication, and a reliable MP4 video export path within the browser without cloud dependencies or massive server rendering costs.

**Decision**:
1. **Unified RenderFrame Contract (`app/src/domain/render/types.ts`, `contract.ts`)**:
   - Establish `RenderFrame` composing spatial traveler state (coordinates, heading, progress, segment), cinematic camera pose (center, bearing, pitch, zoom, eye position, altitude, mode), narrative story overlays (active scene, title, subtitle, caption, active media, transitions), and resource readiness.
   - Formally document determinism boundaries: mathematical coordinates, camera angles, stop dwell timing, and story copy are 100% mathematically deterministic, while WebGL tile rasterization, DEM elevation sampling, font glyph rendering, and hardware video encoders depend on local browser/GPU runtime state.
2. **Media Playback & Resource Lifecycle Management (`app/src/domain/render/mediaManager.ts`)**:
   - Support both standard image formats (`.jpg`, `.png`, `.webp`) and HTML5 video formats (`.mp4`, `.webm`).
   - Synchronize HTML5 `<video>` playback timing to $(t - \text{scene.startTime})$ with muted seeking and autoplay policy safeguards.
   - Implement `mediaRegistry` to track and clean up session blob URLs, preventing browser memory leaks.
   - **Missing Asset Diagnostics**: If a referenced media file is missing or unreadable, mark `isMissing: true` and display a clear diagnostic badge (`⚠ Media File Missing: [filename]`) rather than silently substituting unrelated media.
3. **Offscreen Canvas Compositor (`app/src/domain/render/canvasCompositor.ts`)**:
   - Pure 2D canvas drawing pipeline layering the MapLibre WebGL canvas (enabled via `preserveDrawingBuffer: true`), scene transitions, floating photo/video cards with authentic EXIF metadata tags, centered cinematic title cards, lower-third travelogue caption bars, and technical timecode HUDs.
4. **Deterministic Frame-by-Frame Video Exporter (`app/src/domain/render/exporter.ts`)**:
   - Step through the timeline on a fixed-step grid $\Delta t = 1 / \text{fps}$ from $t = 0$ to $t = \text{duration}$, completely detached from wall-clock time.
   - **Primary Engine**: Hardware WebCodecs `VideoEncoder` + `mp4-muxer` (MIT) producing standard seekable H.264 MP4 files directly in the browser with microsecond presentation timestamps.
   - **Fallback Engine**: `MediaRecorder` canvas stream producing WebM files on browsers lacking WebCodecs.
   - Provide full `AbortSignal` cancellation, frame-level backpressure management, and asynchronous progress reporting.
   - Provide in-browser video playback preview and direct file download.

**Rationale**:
- WebCodecs delivers GPU-accelerated video encoding with zero server rendering costs and zero cloud lock-in.
- `mp4-muxer` provides a tiny (~15KB) zero-dependency, MIT-licensed muxer that writes valid MP4 containers with correct duration headers.
- Fixed-step frame scheduling eliminates dropped frames and playback lag during video generation.

---

## ADR-013: Deterministic Audio Timeline, Float32Array PCM Mixing, and WebCodecs AAC Muxing

**Status**: ACCEPTED  
**Date**: 2026-10-15

**Context**:
WAYVORA's video export pipeline (Phase 7) produced mute H.264 MP4 videos. Travel films demand synchronized background scores, ambient soundscapes, and narration/voiceover tracks. Browser Web Audio API nodes (`AudioContext`, `GainNode`, etc.) are coupled to wall-clock time and real-time playback, which makes them unsuitable for deterministic, faster-than-realtime, or frame-by-frame offline export. Furthermore, storing raw binary audio inside `.wayvora.json` projects would cause massive serialization bloat and file corruption.

**Decision**:
1. **Typed Audio Domain & Serialization (`app/src/domain/audio/types.ts`, `app/src/domain/types.ts`, `serialization.ts`)**:
   - Introduce `AudioClip` with properties: `id`, `name`, `assetRef` (URI or synth identifier), `trackId` ('music' | 'narration' | 'sfx'), `timelineStart`, `duration`, `sourceOffset` (trim-in), `volume` (gain), `fadeIn`, and `fadeOut`.
   - Organize into `AudioTrack` and `AudioTimeline` with independent track volumes and master volume.
   - **Serialization Integrity**: `.wayvora.json` stores only clip metadata, timing parameters, and asset URI references. Zero binary PCM or base64 audio data is stored in the JSON project file. Existing projects automatically gain a default audio timeline structure upon loading via `migrateProject`.
   - Fully integrated into editor immutable history (`pushEditorHistory`) supporting undo/redo for all audio additions, modifications, and track level adjustments.

2. **Deterministic Offline PCM Mixer & Synthesis (`app/src/domain/audio/mixer.ts`)**:
   - Calculate sample-accurate gain using smooth sinusoidal S-curve fade curves:
     $$\text{fadeIn: } \sin\left(\frac{\pi}{2} \cdot \frac{t - \text{start}}{\text{fadeIn}}\right), \quad \text{fadeOut: } \cos\left(\frac{\pi}{2} \cdot \frac{t - (\text{end} - \text{fadeOut})}{\text{fadeOut}}\right)$$
   - Pure Float32Array stereo PCM buffer evaluation $(L, R)$ at 44.1 kHz, completely decoupled from hardware clocks or browser audio drivers.
   - **Clipping Prevention**: Implement a smooth soft-knee limiter using hyperbolic tangent compression:
     $$\text{sample}' = \tanh(\text{sample}) \quad \text{when } |\text{sample}| > 0.95$$
     preventing digital clipping distortion while preserving dynamic range.
   - **Zero-Dependency Ambient Synthesis & Preview**: Built-in procedural harmonic tone generator (`synthesizeAudioTone`, A-major triad with natural envelope) and in-memory 16-bit stereo WAV encoder (`pcmToWavBlob`), enabling preview and export without external audio files.

3. **WebCodecs Hardware AAC Audio Encoding (`app/src/domain/render/exporter.ts`)**:
   - Instantiate WebCodecs `AudioEncoder` with `mp4a.40.2` (AAC-LC, 44.1 kHz, 128 kbps stereo).
   - Configure `mp4-muxer` with `{ codec: 'aac', sampleRate: 44100, numberOfChannels: 2 }` and `firstTimestampBehavior: 'cross-track-offset'` for synchronized AV track alignment.
   - Chunk mixed Float32Array PCM into 1024-frame planar buffers (`f32-planar`) with microsecond presentation timestamps ($t_{\mu s} = \text{round}(i \cdot 10^6 / 44100)$) matching video PTS bounds.
   - Provide graceful fallback to video-only export when no audio clips are active or WebCodecs audio encoding is not supported.

**Rationale**:
- Pure Float32Array PCM mixing is 100% deterministic, testable in node/vitest without browser mocks, and immune to audio driver latency jitter.
- WebCodecs `AudioEncoder` encodes AAC in hardware/native browser threads in a fraction of real time.
- Standard AAC in MP4 containers ensures universal playback compatibility across Apple QuickTime, Windows Media Player, iOS Safari, Android Chrome, and YouTube.






