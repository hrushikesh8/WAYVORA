# Wayvora — Architecture

## Overview

Wayvora is a cinematic journey creation studio that unifies road and trail journeys
into a single timeline and rendering pipeline. It runs entirely in the browser,
requires no API keys for core functionality, and exports deterministic video.

## Technology Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| **UI Framework** | React 19 + TypeScript | Mature ecosystem, strongest typing, best fit for complex editor UIs. Travelback and lil-mappo both validate this stack at scale. |
| **Build** | Vite 6 | Fast HMR, native ESM, used by 5+ reference repos. |
| **Map Renderer** | MapLibre GL JS v5 | Free, open-source (BSD-3), 3D terrain, globe projection. Used by triptrail, travelback, travel-animation, TrailReplay. No proprietary API key required. |
| **State** | Zustand | Lightweight, TypeScript-native, proven by lil-mappo at scale. |
| **Testing** | Vitest | Fast, Vite-native, used by travelback and TrailReplay. |
| **CSS** | Vanilla CSS with design tokens | Maximum control, no framework lock-in. |
| **Export** | WebCodecs API + mp4-muxer | Deterministic frame-by-frame rendering, proven across 6+ repos. |
| **GPX/KML Parsing** | @tmcw/togeojson | BSD-2 license, proven by travelback. |
| **Routing** | OSRM (free), great-circle math | No API key needed. Proven by triptrail. |

## Domain Model

```
┌─────────────────────────────────────────────────┐
│                   Journey                        │
│  id, name, description, createdAt, updatedAt     │
│  segments: JourneySegment[]                      │
│  stops: Stop[]                                   │
│  timeline: Timeline                              │
│  exportProfiles: ExportProfile[]                 │
└────────────────┬────────────────────────────────┘
                 │
    ┌────────────┴────────────────┐
    ▼                             ▼
┌────────────────┐    ┌────────────────────┐
│ JourneySegment │    │       Stop         │
│ id             │    │ id                 │
│ type: road |   │    │ name               │
│   trail | air  │    │ position: RoutePoint│
│   | sea        │    │ segmentIndex       │
│ transportMode  │    │ type: start | end  │
│ points:        │    │   | waypoint | ... │
│  RoutePoint[]  │    │ description?       │
│ sourceFormat?  │    │ media: MediaAsset[]│
│ metadata       │    │ durationAtStop?    │
└────────────────┘    └────────────────────┘

┌────────────────┐    ┌────────────────────┐
│  RoutePoint    │    │     Scene          │
│ lng: number    │    │ id                 │
│ lat: number    │    │ name               │
│ ele?: number   │    │ cameraMode         │
│ time?: Date    │    │ startPercent: 0-1  │
│ speed?: number │    │ endPercent: 0-1    │
└────────────────┘    │ cameraParams       │
                      └────────────────────┘

┌────────────────┐    ┌────────────────────┐
│   Timeline     │    │   ExportProfile    │
│ duration: s    │    │ name               │
│ fps: number    │    │ resolution         │
│ scenes: Scene[]│    │ aspectRatio        │
│ currentTime    │    │ codec              │
└────────────────┘    │ fps, bitrate       │
                      └────────────────────┘

┌────────────────┐
│  MediaAsset    │
│ id             │
│ type: photo |  │
│  video | audio │
│ url / blob     │
│ geoPosition?   │
│ timestamp?     │
└────────────────┘
```

## Key Architectural Principles

### 1. Unified Journey Model
A journey contains an ordered list of **segments**, each typed as `road`, `trail`, `air`,
or `sea`. This is the core differentiator: no reference repository supports mixed road+trail
journeys in a single timeline.

### 2. Provider Independence
Routing, elevation, geocoding, and tile sources are behind interfaces. The core domain model
has no dependency on MapLibre, OSRM, or any specific provider.

### 3. Deterministic Timeline
Preview and export share the same evaluation pipeline. Given a `(journey, time)` pair,
the system computes the exact position, camera state, and visual state. No randomness,
no frame-rate dependency.

### 4. Segment Provenance
Each segment preserves its source: was it manually drawn? Imported from GPX? Auto-routed
via OSRM? This enables re-routing without losing user edits.

### 5. Local-First
All data stays in the browser. Project files are serializable JSON. No cloud dependency
for core features.

## Module Structure

```
src/
├── domain/           # Pure domain model (no UI, no map deps)
│   ├── types.ts      # Journey, Segment, Stop, Scene, etc.
│   ├── journey.ts    # Journey creation, validation, mutation
│   ├── timeline.ts   # Timeline evaluation, position interpolation
│   ├── geo.ts        # Haversine, cumulative distance, bearing
│   └── serialization.ts  # Save/load project files
├── services/         # External integrations (behind interfaces)
│   ├── routing.ts    # OSRM routing service
│   ├── elevation.ts  # Elevation data fetching
│   └── geocoding.ts  # Nominatim geocoding
├── engine/           # Rendering and camera
│   ├── camera.ts     # Camera modes and interpolation
│   ├── renderer.ts   # Map rendering coordination
│   └── exporter.ts   # WebCodecs video export
├── components/       # React UI components
│   ├── App.tsx
│   ├── MapView.tsx
│   ├── JourneyPanel.tsx
│   ├── TimelineBar.tsx
│   └── ...
├── store/            # Zustand state management
│   └── useJourneyStore.ts
├── __tests__/        # Test files co-located or in __tests__
└── main.tsx          # Entry point
```

## Data Flow

```
User Input → Store (Zustand) → Domain Logic → Map Renderer (MapLibre)
                                    ↓
                              Timeline Engine → Camera Evaluation → Frame State
                                    ↓
                              Export Pipeline → WebCodecs → MP4
```

## Persistence Format

Projects are saved as `.wayvora.json` files:

```json
{
  "version": 1,
  "journey": {
    "id": "...",
    "name": "My Journey",
    "segments": [...],
    "stops": [...],
    "timeline": {...}
  }
}
```

The format is versioned for forward compatibility. Segments preserve their `type`
and `sourceFormat` through serialization.
