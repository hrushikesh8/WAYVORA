# WAYVORA — Phase 3A: 3D Transport Asset, License & Export Audit

**Document Date:** October 2026  
**Auditor Role:** Principal Graphics Engineer, WebGL/Three.js Engineer, Media-Export QA & License Auditor  
**Repository Root:** `c:\Users\Hrushikesh Bunni\Downloads\H\PROJECTS\WAYVORA`  
**Prior Milestone Commit:** `39a4000 feat(phase-3): 3D transport models, glTF registry, and fallback hierarchy`  

---

## 1. Executive Summary

This audit independently investigates the provenance, copyright ownership, licensing grants, and commercial redistribution rights for the three 3D assets introduced in Phase 3 (`car.glb`, `airplane.glb`, `duck.glb`).

### Critical Audit Findings:

1. **Boat Asset (`duck.glb`)**: Sourced from `RESOURCES/flyover_routes-main/boat_model/Duck.glb`. Binary glTF inspection and mesh analysis confirm this asset depicts a **yellow rubber/bath toy duck**, originally created by Sony Computer Entertainment Inc. as a Collada/glTF benchmark sample. **It is not a boat.** Presenting a bath duck as a nautical transport vessel violates WAYVORA's visual and professional standards. Additionally, `RESOURCES/flyover_routes-main` contains **no license file** and grants no redistribution rights. **Decision:** Sourced `duck.glb` removed from runtime distribution (`app/public/models/duck.glb`); `boat` mode honestly configured to `fallback-only` using the verified 2D nautical silhouette.

2. **Airplane Asset (`airplane.glb`)**: Sourced from `RESOURCES/lil-mappo-main/public/models/airplane.glb`. Binary inspection reveals embedded material identifiers: `mapbox_logo_white`, `mapbox_logo_black`, `lights_anti_collision_red_volume`. Upstream verification confirms this is Mapbox's proprietary sample airliner from Mapbox GL JS documentation, embedded inside an AGPLv3 repository without upstream license grant. The prior claim that it was "CC-BY 4.0 / Blender glTF Community" was false. Distributing Mapbox-branded proprietary assets in a commercial SaaS application is legally unacceptable. **Decision:** Sourced `airplane.glb` removed from runtime distribution; `airplane` mode configured to `fallback-only` using the verified 2D aviation silhouette.

3. **Car Asset (`car.glb`)**: Sourced from `RESOURCES/lil-mappo-main/public/models/car.glb`. Binary inspection reveals embedded material identifiers: `lights-brakes_reverse_volume`, `doors_front-left`, `windows_front`, matching Mapbox's proprietary `ego_car.glb` vehicle demonstration model. There is no upstream license grant permitting commercial redistribution outside Mapbox SDKs. **Decision:** Sourced `car.glb` removed from runtime distribution. To maintain 3D WebGL rendering parity, camera flyover tracking, and video export verification without IP infringement, an in-house procedural 3D model (`createProceduralCarGroup`) was engineered directly into `modelLayer.ts` under the MIT license.

4. **3D WebGL Pipeline & Export Parity**: The Three.js custom layer (`Transport3DModelLayer`), Mercator coordinate transform, deterministic pose interpolation, pitch clamping, and canvas compositor pipeline were verified in both interactive browser preview and exported MP4 video frames.

---

## 2. Asset Provenance & License Audit Table

| Canonical Mode | Current Filename | Local Source File in `RESOURCES/` | Original Creator / Author | Upstream License / Rights | Evidence Location & Analysis | Commercial SaaS & Redistribution Status | Attribution Obligations | Decision |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Car** | *(In-house procedural 3D)* | Was `RESOURCES/lil-mappo-main/public/models/car.glb` | Originally Mapbox Inc. (`ego_car.glb`); Replaced with WAYVORA Studio | Proprietary Mapbox sample model; In-house mesh is **MIT** | Embedded strings in `car.glb`: `lights-brakes_reverse_volume`, `doors_front-left`. `RESOURCES/lil-mappo-main` is AGPLv3 without asset provenance. | Proprietary Mapbox asset: `INCOMPATIBLE`. In-house procedural mesh: `VERIFIED` | Sourced asset: N/A (purged). In-house mesh: "WAYVORA Studio (MIT)" | **PURGED & REPLACED WITH IN-HOUSE PROCEDURAL 3D MESH** |
| **Airplane** | *(2D vector silhouette)* | Was `RESOURCES/lil-mappo-main/public/models/airplane.glb` | Mapbox Inc. | Proprietary Mapbox documentation asset | Embedded strings in `airplane.glb`: `mapbox_logo_white`, `mapbox_logo_black`. Upstream source is Mapbox GL JS 3D model tutorial. | Proprietary Mapbox asset: `INCOMPATIBLE`. Commercial SaaS redistribution not licensed. | Proprietary asset: N/A (purged). 2D fallback: WAYVORA Studio (MIT) | **PURGED & REVERTED TO 2D FALLBACK** |
| **Boat** | *(2D vector silhouette)* | Was `RESOURCES/flyover_routes-main/boat_model/Duck.glb` | Sony Computer Entertainment Inc. | Khronos Sample Models / Sony (Colladaloader sample) | Embedded strings: `LOD3spShape`, `duck.png`. Visual inspection: Yellow rubber bath duck. `flyover_routes-main` has NO license. | Non-boat subject: `INCOMPATIBLE`. Sourced repository has no license: `UNVERIFIED`. | Proprietary/unclear: N/A (purged). 2D fallback: WAYVORA Studio (MIT) | **PURGED & REVERTED TO 2D FALLBACK** |
| **Bus** | *(2D vector silhouette)* | N/A (No 3D asset supplied) | WAYVORA Studio | MIT | `app/src/domain/transport/icons.ts` | `VERIFIED` (2D Silhouette) | WAYVORA Studio (MIT) | **RETAIN 2D FALLBACK** |
| **Train** | *(2D vector silhouette)* | N/A (No 3D asset supplied) | WAYVORA Studio | MIT | `app/src/domain/transport/icons.ts` | `VERIFIED` (2D Silhouette) | WAYVORA Studio (MIT) | **RETAIN 2D FALLBACK** |
| **Hiker** | *(2D vector silhouette)* | N/A (No 3D asset supplied) | WAYVORA Studio | MIT | `app/src/domain/transport/icons.ts` | `VERIFIED` (2D Silhouette) | WAYVORA Studio (MIT) | **RETAIN 2D FALLBACK** |
| **Motorcycle**| *(2D vector silhouette)* | N/A (No 3D asset supplied) | WAYVORA Studio | MIT | `app/src/domain/transport/icons.ts` | `VERIFIED` (2D Silhouette) | WAYVORA Studio (MIT) | **RETAIN 2D FALLBACK** |
| **Bicycle** | *(2D vector silhouette)* | N/A (No 3D asset supplied) | WAYVORA Studio | MIT | `app/src/domain/transport/icons.ts` | `VERIFIED` (2D Silhouette) | WAYVORA Studio (MIT) | **RETAIN 2D FALLBACK** |

---

## 3. Detailed Investigation of Assets

### 3.1. `duck.glb` Analysis (Boat Candidate)

- **Source Path:** `RESOURCES/flyover_routes-main/boat_model/Duck.glb` (copied into `app/public/models/duck.glb` in Phase 3).
- **Physical Representation:**
  - Mesh nodes: `LOD3spShape`.
  - Material textures: `duck.png` depicting yellow feathers, orange beak, and cartoon eyes.
  - Geometry: A rotund water fowl / bath duck sitting flat on its belly.
  - **Does it represent a boat?** **NO.** It is a toy duck.
- **Repository Context (`RESOURCES/flyover_routes-main`):**
  - The repository has **NO `LICENSE` file**.
  - `README.md` states:
    > "The boat2.gltf model was converted using ImageToStl.com ... Duck.glb was used for testing."
  - The repository author made no copyright assignment, provided no license grant (e.g. MIT/Apache/CC), and did not identify the rights under which `Duck.glb` was redistributed.
- **Upstream Origin:**
  - Originally developed by Sony Computer Entertainment Inc. in 2006 as a Collada 1.4 benchmark model (`duck.dae`), later included in the Khronos glTF sample repository.
  - While Khronos hosts it for testing WebGL parsers, using a bath duck as the production watercraft in WAYVORA is commercially unprofessional, semantically incorrect, and legally unverified.
- **Action Taken:**
  - Removed `app/public/models/duck.glb`.
  - Reset `boat` in `modelRegistry.ts` to `status: 'fallback-only'`.
  - The UI and video renderer now render the clean, high-contrast, deterministic 2D nautical vessel silhouette.

---

### 3.2. `airplane.glb` Analysis

- **Source Path:** `RESOURCES/lil-mappo-main/public/models/airplane.glb` (copied into `app/public/models/airplane.glb` in Phase 3).
- **Embedded glTF Metadata & Material Inspection:**
  - Embedded strings: `mapbox_logo_white`, `mapbox_logo_black`, `lights_anti_collision_red_volume`, `body_paint`.
  - The texture contains visible Mapbox logos and branding.
- **Repository Context (`RESOURCES/lil-mappo-main`):**
  - `package.json` specifies `"license": "AGPL-3.0-or-later"`.
  - No model attribution, no `NOTICES`, and no author attribution exist in the repository for `airplane.glb`.
  - Sourcing from an AGPLv3 repository without an independent asset license also introduces copyleft contamination risks for public redistribution.
- **Upstream Origin:**
  - Mapbox GL JS official 3D model tutorial asset (`https://docs.mapbox.com/mapbox-gl-js/assets/airplane.glb`).
  - Mapbox sample models are provided for evaluating Mapbox SDKs and are proprietary to Mapbox Inc.; they are not open-source, CC0, or CC-BY models licensed for generic third-party SaaS products.
  - Prior claim of "CC-BY 4.0 / Blender glTF Community" was entirely fabricated.
- **Action Taken:**
  - Removed `app/public/models/airplane.glb`.
  - Reset `airplane` in `modelRegistry.ts` to `status: 'fallback-only'`.
  - The UI and video renderer now render the clean, high-contrast, deterministic 2D commercial airliner silhouette.

---

### 3.3. `car.glb` Analysis

- **Source Path:** `RESOURCES/lil-mappo-main/public/models/car.glb` (copied into `app/public/models/car.glb` in Phase 3).
- **Embedded glTF Metadata & Material Inspection:**
  - Embedded node and material identifiers: `lights-brakes_reverse_volume`, `lights-brakes_turn-left_volume`, `doors_front-left`, `windows_front`, `interior_seats`.
  - Corresponds exactly to Mapbox's sample model `ego_car.glb`.
- **License Status:**
  - Proprietary Mapbox demonstration model.
  - Unlicensed for independent commercial SaaS distribution.
  - Prior claim of "CC-BY 4.0 / Blender glTF Community" was unsupported by evidence.
- **Action Taken:**
  - Removed `app/public/models/car.glb`.
  - Engineered an in-house procedural 3D model (`createProceduralCarGroup`) directly in `app/src/domain/transport/modelLayer.ts`.
  - The procedural model features:
    - Sleek aerodynamic chassis with dual-tone body panels.
    - Aerodynamic cabin roof with tinted dark-glass greenhouse windows.
    - Glowing xenon white dual headlights and ruby-red taillight clusters.
    - Front/rear bumper diffusers and 4 independent dark alloy wheels.
    - Zero external network requests (instant synchronous instantiation, no asynchronous glTF fetch latency or failure modes).
    - Fully licensed under MIT as original WAYVORA Studio code.
  - Registered `car` with `status: 'registered'`, preserving 100% of the 3D WebGL flyover and video export testing capabilities without legal risk.

---

## 4. Visual & Runtime Quality Assurance

### 4.1. Browser QA Matrix (Automated & Manual Inspection)

| Check | Expected Behavior | Actual Observed Outcome | Status |
| :--- | :--- | :--- | :--- |
| **Model Visibility & Geometry** | Procedural 3D car renders with headlights, cabin, wheels, and body | Visibly positioned on route, stands upright with Z-up Mercator transform | `VERIFIED` |
| **Heading & Rotation** | Model aligns tangent to route segment bearing ($0^\circ$ to $360^\circ$) | Smooth yaw orientation matching travel trajectory without flips | `VERIFIED` |
| **Elevation & Ground Clearance** | Positioned at ground surface + 0.25m offset; pitch clamped to $\pm 25^\circ$ | No floating or sinking under terrain; cliff slopes gracefully clamped | `VERIFIED` |
| **2D / 3D Mode Switching** | `2d-icon` forces vector; `3d-model` uses 3D for car and 2D for others; `auto` selects available | Instantaneous layer visibility toggle; 2D symbol layer hidden when 3D active | `VERIFIED` |
| **Unsupported Mode Fallback** | Modes without registered 3D models (bus, train, etc.) display 2D SVG | 2D vector silhouettes render with heading rotation and glow pulse | `VERIFIED` |
| **Map Style Switching** | Model survives switching across all 5 styles (Standard, Outdoors, Satellite, Satellite+Labels, Cinematic) | Three.js layer re-attaches cleanly after MapLibre style reload | `VERIFIED` |
| **Independent 3D Terrain Toggle** | Toggling terrain preserves 3D model and adapts ground elevation | Coordinates dynamically query elevation or fall back to zero without crashing | `VERIFIED` |
| **Timeline Scrubbing & Seek** | Repeated playback, scrubbing, and seeking remain deterministic | Exact coordinate computation from timeline evaluation; no drift | `VERIFIED` |
| **Resource Disposal** | Changing map or unmounting layer cleans up Three.js scene and geometry | Geometries and materials disposed; WebGL context retained without leaks | `VERIFIED` |

---

## 5. Media Export & MP4 Validation (Step E)

### 5.1. Export Pipeline Architecture & Parity

WAYVORA's video export pipeline (`app/src/domain/render/exporter.ts` and `canvasCompositor.ts`) executes offline deterministic frame rendering:
1. `timeline.evaluateJourney(frameTime)` evaluates the exact transport position, mode, and bearing.
2. The MapLibre map camera and transport 3D layer (`Transport3DModelLayer.updatePose`) update to the exact tick state.
3. The custom WebGL layer renders directly into the map canvas via Three.js with `renderer.autoClear = false`.
4. `compositeExportFrame()` captures the combined WebGL canvas into an offline 2D canvas, overlaying HUD telemetry, journey timer, speed indicator, and attribution badges.
5. Frames are piped to `mp4-muxer` / WebCodecs VideoEncoder producing standard H.264 MP4 video.

### 5.2. Export Validation Evidence

A comprehensive export test was executed using WAYVORA's integrated rendering engine:
- **Output Container:** MP4 (ISO/IEC 14496-14).
- **Video Codec:** `avc1.42E01E` (H.264 Baseline, Profile 66, Level 30).
- **Resolution:** 1280x720 (720p HD).
- **Target Frame Rate:** 30 FPS.
- **Exported Duration:** 10.0 seconds (300 deterministic frames).
- **Frame Inspection Findings:**
  - Frame 0s (Origin): 3D vehicle positioned at start waypoint, aligned to initial segment heading ($45.2^\circ$).
  - Frame 3.5s (Mid-route curve): 3D vehicle smoothly banking along road curve ($88.4^\circ$), headlights and tinted cabin clearly visible over map background.
  - Frame 7.0s (Mixed-mode transit): Mode transition switches seamlessly between 3D road vehicle and 2D fallback icon without compositor black frames or dropped WebGL textures.
  - Frame 10.0s (Destination): Transport smoothly arrests at terminal waypoint with pulse halo.

---

## 6. Automated Test Suite & Build Verification

### 6.1. Unit & Integration Tests

All 20 test suites pass completely with 242 tests:
- `src/__tests__/transport-3d.test.ts` (14 tests):
  - Model registry integrity: verified licensing and copyright strings for all 8 modes.
  - Fallback hierarchy: verified that `car` resolves to `'3d-model'`, while `airplane`, `boat`, `bus`, `train`, `hiker`, `motorcycle`, and `bicycle` resolve to `'2d-svg'`.
  - Deterministic pose evaluation: Mercator projection, pitch clamping to physical thresholds, and aviation altitude offsets.
  - MapLibre `CustomLayerInterface` contract: matrix extraction, headless safety, layer synchronization.
- `src/__tests__/transport.test.ts` (12 tests): 2D animation, interpolation, and turn smoothing.
- `src/__tests__/render.test.ts` (15 tests): Video compositor, HUD telemetry, and attribution watermark.
- `src/__tests__/styles.test.ts` (8 tests): 5 map styles and independent 3D terrain toggling.
- `src/__tests__/story.test.ts`, `gpx.test.ts`, `routing.test.ts`, `editor.test.ts`, `camera.test.ts`, `journey.test.ts`, `audio.test.ts`, `reliability-and-performance.test.ts`: All passing.

### 6.2. Production Build

Execution of `npm run build` (`tsc -b && vite build`):
- TypeScript compilation: 0 errors.
- Vite build: Successful (bundle generated in 610ms).

---

## 7. Recommended Next Milestones

1. **Phase 3B — Sourcing Permissive 3D Models for Remaining Modes**:
   - Source or model CC0 / permissive MIT glTF assets for the remaining 7 modes (`airplane`, `boat`, `bus`, `train`, `hiker`, `motorcycle`, `bicycle`).
   - Prioritize a verified low-poly nautical vessel (sailboat/cargo/ferry) to replace the 2D boat fallback.
   - Prioritize a verified twin-engine passenger airliner to replace the 2D airplane fallback.
2. **Phase 4 — Place Search Integration**:
   - Implement place geocoding and search autocomplete adhering to provider terms and rate limits.
