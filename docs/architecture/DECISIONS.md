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
- Explicitly captures routing metadata, attribution, distance, duration, and error details without silent failures or fabricated paths.
- Preserves trail segments and imported GPX tracks completely intact when re-routing road segments.

