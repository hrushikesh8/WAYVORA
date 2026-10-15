# WAYVORA — Phase 3: 3D Transport Asset, License & Model Library Audit

**Document Date:** October 2026  
**Auditor Role:** Principal Graphics Engineer, WebGL/Three.js Engineer, Media-Export QA & License Auditor  
**Repository Root:** `c:\Users\Hrushikesh Bunni\Downloads\H\PROJECTS\WAYVORA`  
**Milestone History:**
- `39a4000 feat(phase-3): 3D transport models, glTF registry, and fallback hierarchy` (Initial glTF layer with unverified sample assets)
- `a9a0474 feat(phase-3a): 3D transport asset audit, license verification, and procedural 3D model` (Asset purge, duck analysis, initial procedural car)
- `Phase 3B: License-verified 3D transport model library for all 8 canonical modes` (Full procedural 3D library implementation)

---

## 1. Executive Summary

This audit independently investigates the provenance, copyright ownership, licensing grants, and commercial redistribution rights for third-party assets, and documents WAYVORA's complete, license-verified 3D transport model library across all eight canonical modes.

### Critical Historical Audit Findings:

1. **Boat Asset (`duck.glb`)**: Sourced from `RESOURCES/flyover_routes-main/boat_model/Duck.glb`. Binary glTF inspection and mesh analysis confirm this asset depicts a **yellow rubber/bath toy duck**, originally created by Sony Computer Entertainment Inc. as a Collada/glTF benchmark sample. **It is not a boat.** Presenting a bath duck as a nautical transport vessel violates WAYVORA's visual and professional standards. Additionally, `RESOURCES/flyover_routes-main` contains **no license file** and grants no redistribution rights. **Action:** Sourced `duck.glb` was purged from runtime distribution. Replaced with WAYVORA's in-house procedural 3D luxury cabin cruiser / yacht.

2. **Airplane Asset (`airplane.glb`)**: Sourced from `RESOURCES/lil-mappo-main/public/models/airplane.glb`. Binary inspection revealed embedded material identifiers: `mapbox_logo_white`, `mapbox_logo_black`, `lights_anti_collision_red_volume`. Upstream verification confirmed this was Mapbox's proprietary sample airliner from Mapbox GL JS documentation, embedded inside an AGPLv3 repository without upstream license grant. The prior claim that it was "CC-BY 4.0 / Blender glTF Community" was false. **Action:** Sourced `airplane.glb` was purged from runtime distribution. Replaced with WAYVORA's in-house procedural 3D twin-turbofan passenger jet.

3. **Car Asset (`car.glb`)**: Sourced from `RESOURCES/lil-mappo-main/public/models/car.glb`. Binary inspection revealed embedded material identifiers: `lights-brakes_reverse_volume`, `doors_front-left`, `windows_front`, matching Mapbox's proprietary `ego_car.glb` vehicle demonstration model. There was no upstream license grant permitting commercial redistribution outside Mapbox SDKs. **Action:** Sourced `car.glb` was purged from runtime distribution. Replaced with WAYVORA's in-house procedural 3D touring sedan.

4. **Complete 8-Mode 3D Library (Phase 3B)**: Rather than risking IP contamination, external asset downtime, or licensing disputes, WAYVORA implemented a coherent, high-performance, low-poly procedural 3D model generator (`app/src/domain/transport/proceduralModels.ts`) covering all 8 canonical modes under the MIT license. Every model features zero network latency, zero glTF parse overhead, and high visual contrast from flyover camera altitudes.

---

## 2. Asset Provenance & License Audit Table (All 8 Canonical Modes)

| Canonical Mode | Representation & Mesh Generator | Original Source in `RESOURCES/` | Original Creator / Author | Upstream License / Rights | Evidence Location & Analysis | Commercial SaaS & Redistribution Status | Attribution Obligations | Implementation & Verification Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Car** | Procedural 3D Touring Sedan (`createProceduralCar`) | Was `RESOURCES/lil-mappo-main/public/models/car.glb` | Originally Mapbox (`ego_car.glb`); Replaced with WAYVORA Studio | Proprietary Mapbox asset; In-house procedural mesh is **MIT** | `app/src/domain/transport/proceduralModels.ts`. Dual-tone chassis, tinted glass, xenon headlights, taillights, 4 alloy wheels. | `VERIFIED` (MIT) | WAYVORA Studio (MIT) | `VERIFIED` |
| **Airplane** | Procedural 3D Twin-Turbofan Jet (`createProceduralAirplane`) | Was `RESOURCES/lil-mappo-main/public/models/airplane.glb` | Originally Mapbox Inc.; Replaced with WAYVORA Studio | Proprietary Mapbox asset; In-house procedural mesh is **MIT** | `app/src/domain/transport/proceduralModels.ts`. Fuselage, nose cone, swept wings, dual turbofans, vertical/horizontal tail, nav lights. | `VERIFIED` (MIT) | WAYVORA Studio (MIT) | `VERIFIED` |
| **Boat** | Procedural 3D Sport Yacht (`createProceduralBoat`) | Was `RESOURCES/flyover_routes-main/boat_model/Duck.glb` | Originally Sony (Toy Duck); Replaced with WAYVORA Studio | Toy duck / Unlicensed repo; In-house procedural mesh is **MIT** | `app/src/domain/transport/proceduralModels.ts`. V-hull, teak deck, cabin superstructure, bridge glass, chrome mast, nav lights. | `VERIFIED` (MIT) | WAYVORA Studio (MIT) | `VERIFIED` |
| **Bus** | Procedural 3D Touring Coach (`createProceduralBus`) | N/A (Original implementation) | WAYVORA Studio | **MIT** | `app/src/domain/transport/proceduralModels.ts`. Aerodynamic coach body, panoramic windows, roof AC, 6 wheels (dual rear axle). | `VERIFIED` (MIT) | WAYVORA Studio (MIT) | `VERIFIED` |
| **Train** | Procedural 3D Bullet Train (`createProceduralTrain`) | N/A (Original implementation) | WAYVORA Studio | **MIT** | `app/src/domain/transport/proceduralModels.ts`. Bullet nose, power car body, cockpit glass, crimson livery stripe, roof pantograph. | `VERIFIED` (MIT) | WAYVORA Studio (MIT) | `VERIFIED` |
| **Hiker** | Procedural 3D Trail Trekker (`createProceduralHiker`) | N/A (Original implementation) | WAYVORA Studio | **MIT** | `app/src/domain/transport/proceduralModels.ts`. Trail boots, outdoor rose jacket, expedition rucksack with bedroll, hat, dual trekking poles. | `VERIFIED` (MIT) | WAYVORA Studio (MIT) | `VERIFIED` |
| **Motorcycle**| Procedural 3D Adventure Moto (`createProceduralMotorcycle`) | N/A (Original implementation) | WAYVORA Studio | **MIT** | `app/src/domain/transport/proceduralModels.ts`. Trellis frame, fuel tank, windscreen, xenon headlight, dual aluminum panniers, rider with helmet. | `VERIFIED` (MIT) | WAYVORA Studio (MIT) | `VERIFIED` |
| **Bicycle** | Procedural 3D Touring Cyclist (`createProceduralBicycle`) | N/A (Original implementation) | WAYVORA Studio | **MIT** | `app/src/domain/transport/proceduralModels.ts`. Diamond frame geometry, 700c wheels, drop handlebars, cyclist with aero helmet and jersey. | `VERIFIED` (MIT) | WAYVORA Studio (MIT) | `VERIFIED` |

---

## 3. Procedural 3D Model Architecture & Coordinate Standards

### 3.1. Unified Three.js Coordinate Conventions
All 8 procedural models in `proceduralModels.ts` strictly conform to identical spatial axes:
- **Local +Y Axis:** Up (skywards / normal to ground plane)
- **Local -Z Axis:** Forward (direction of vehicle travel / tangent to journey bearing)
- **Local +X Axis:** Right (starboard side)
- **Origin (0, 0, 0):** Ground or water surface contact point

### 3.2. Mercator Space Alignment
In `modelRegistry.ts`, every registered mode uses:
```ts
rotationOffset: [90, 0, 0] // glTF / Three.js Y-up to MapLibre Z-up
```
When evaluated by `calculateTransportPose3D`:
1. `basePitch = 90°` rotates Three.js `+Y` (up) to MapLibre `+Z` (altitude), and Three.js `-Z` (forward) to MapLibre `-Y` (North in Mercator projection).
2. Segment bearing (`0°` to `360°`) applies a positive yaw rotation around MapLibre's Z axis (`rotationZ = baseYaw + normalizedBearing`).
3. Terrain slope gradient applies pitch around the local X axis (`rotationX = basePitch + pitch`), clamped strictly to `maxPitchDegrees` (e.g. 14° for trains, 18° for planes, 25° for cars/motorcycles, 35° for hikers) to avoid cliff penetration or unrealistic vertical flips.

### 3.3. Zero-Network Performance & Reliability
- Models load synchronously and instantaneously via `createProceduralModel(mode)`.
- Eliminates network fetch failures, 404 errors, HTTP CORS issues, and slow glTF parser initialization.
- Reuses shared `MeshStandardMaterial` instances across sub-geometries to optimize WebGL draw calls and GPU memory bandwidth.

---

## 4. Visual & Runtime Quality Assurance

### 4.1. Browser Runtime Verification (Automated QA via Browser Subagent)

Interactive browser validation was conducted on `http://localhost:5173/` using automated browser tooling:
- **Studio Load & Navigation:** WAYVORA Studio loaded cleanly without console errors or worker failures.
- **Segment Mode Selector:** Cycled through all 8 transport modes (Car, Airplane, Boat, Bus, Train, Hiker, Motorcycle, Bicycle) in the inspector panel.
- **3D Model Layer:** Confirmed `3D glTF Model Active` badge and 3D terrain rendering active (`3D Terrain: ON`).
- **Timeline Scrub & Playback:** Initiated timeline playback along the default Swiss Alps journey. Vehicle smoothly translated and rotated along the 3D route trajectory, maintaining ground clearance across steep terrain elevations.
- **2D / 3D Mode Switching:** Switching between `auto`, `3d-model`, and `2d-icon` toggled layer visibility instantly without flashing or state loss.
- **Map Styles & Terrain Switching:** 3D model rendering remained stable and re-attached across all 5 styles (Standard, Outdoors, Satellite, Satellite+Labels, Cinematic) and independent terrain toggling.

---

## 5. Media Export & MP4 Validation

### 5.1. Deterministic Frame Pipeline
- Offline video exporter (`app/src/domain/render/exporter.ts`) steps the timeline by `1 / fps` intervals.
- `Transport3DModelLayer.updatePose()` evaluates the exact Mercator coordinate and yaw/pitch for each frame index.
- Three.js renders directly into MapLibre's WebGL canvas context with `autoClear: false`.
- `canvasCompositor.ts` composites the WebGL canvas with HUD telemetry, speed gauges, and attribution badges.
- `mp4-muxer` and WebCodecs `VideoEncoder` assemble standard H.264 MP4 containers.

### 5.2. Export Validation Results
- **Container Format:** ISO/IEC 14496-14 (MP4)
- **Video Codec:** H.264 Baseline Profile (`avc1.42E01E`)
- **Resolution:** 1280x720 (720p HD)
- **Frame Rate:** 30.0 FPS
- **Frame Inspection:**
  - Car, Bus, Motorcycle, and Bicycle render with clear wheels, headlights, and body silhouettes.
  - Train renders with elongated power locomotive body and crimson livery stripe.
  - Airplane cruises with high elevation offset (+45m) and red/green wingtip navigation lights.
  - Boat renders with navy V-hull, teak deck, and cabin superstructure.
  - Hiker renders with high-contrast trail jacket, rucksack, and forward trekking poles.
  - Timing parity between interactive preview and exported MP4 frames is 100% mathematically deterministic.

---

## 6. Automated Test Suite & Build Verification

- **Vitest Suites:** **20 passed (20)**
- **Total Tests:** **244 passed (244)**
  - Model registry: All 8 modes registered with verified licenses and attribution.
  - Fallback hierarchy: Unknown/unregistered modes fall back to 2D silhouettes; unloaded states fall back safely.
  - Deterministic 3D pose evaluation: Mercator projections, pitch limits, and aviation elevation offsets.
  - Procedural 3D model factory: All 8 modes generate valid `THREE.Group` objects with non-empty meshes and geometries.
  - MapLibre custom layer contract: Matrix extraction and layer lifecycle.
- **Production Build (`tsc -b && vite build`):**
  - TypeScript compilation: 0 errors
  - Vite client bundle: Built in 849ms

---

## 7. Status Summary & Next Milestone

| Milestone Phase | Scope | Status |
| :--- | :--- | :--- |
| **Phase 1** | Centralized 5 Map Styles & Independent 3D Terrain | `VERIFIED` |
| **Phase 2** | Deterministic 2D Transport Animation (8 Modes) | `VERIFIED` |
| **Phase 3A** | 3D Transport Asset & License Audit (Purge Unlicensed Assets) | `VERIFIED` |
| **Phase 3B** | License-Verified 3D Transport Model Library (All 8 Modes) | `VERIFIED` |
| **Phase 4** | Place Search & Geocoding Autocomplete | `NOT YET IMPLEMENTED` |
