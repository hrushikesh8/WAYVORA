# WAYVORA — Cinematic Journey Creation Studio

> Unifying road and trail journeys into high-definition, cinematic 3D visual stories.

Wayvora is a browser-based, GPU-accelerated journey creation studio designed to transform multi-modal travel routes (road trips, hiking trails, flights, rail journeys) into smooth, cinematic video animations.

---

## 🌟 Vision & Key Capabilities

- **Unified Multi-Modal Model**: First-class support for both high-speed road journeys (cars, motorbikes, buses) and rugged trail journeys (hiking paths, GPX mountain tracks, elevation gain/loss, steep climbs).
- **Zero API Key Dependency**: Runs completely locally in the browser with free, permissive vector and raster cartography (OpenStreetMap / CartoDB Dark Matter) and local client-side evaluation.
- **Deterministic Timeline Engine**: Shared pure-function timeline evaluation between real-time 60 FPS viewport preview and frame-accurate 4K export pipelines.
- **Interactive Visual Director**: Dynamic camera control (Overview, Chase Cam, Flyover, Ground View), real-time 3D tilt/pitch, bearing alignment, and atmosphere presets.
- **Elevation HUD**: Live elevation curve profiling for hiking and mountainous routes with synced playhead tracking.
- **Open Standards & Portability**: Projects serialize to readable, versioned `.wayvora.json` files with schema migrations.

---

## 📂 Repository Structure

```
WAYVORA/
├── app/                       # Application Workspace (React 19 + TypeScript + Vite)
│   ├── src/
│   │   ├── domain/            # Pure, zero-dependency Domain Core
│   │   │   ├── types.ts       # Unified Journey, Segment, Stop, Timeline, Scene types
│   │   │   ├── geo.ts         # Haversine distance, bearing, route interpolation, bounds
│   │   │   ├── journey.ts     # Factories, validation, and multi-modal route builder
│   │   │   ├── timeline.ts    # Deterministic frame evaluation & generator
│   │   │   ├── serialization.ts # Versioned .wayvora.json export / import
│   │   │   └── index.ts       # Domain API barrel export
│   │   ├── __tests__/         # Comprehensive Vitest Test Suite (49 tests)
│   │   │   ├── fixtures.ts    # Test datasets (SF to LA, Swiss Alps, Mt. Whitney)
│   │   │   ├── geo.test.ts    # Geodesic, antimeridian, interpolation tests
│   │   │   ├── journey.test.ts # Journey creation, mutation, validation tests
│   │   │   ├── timeline.test.ts # Timeline evaluation & frame generation tests
│   │   │   └── serialization.test.ts # Project file roundtrip tests
│   │   ├── App.tsx            # Cinematic Studio UI (MapLibre GL + HUD + Timeline)
│   │   ├── index.css          # Design system & dark cinematic glassmorphism
│   │   └── main.tsx           # React entry point
│   ├── package.json
│   └── vite.config.ts
├── docs/                      # Research, Architecture & Roadmaps
│   ├── architecture/
│   │   ├── ARCHITECTURE.md    # Core system architecture & module definitions
│   │   └── DECISIONS.md       # ADRs for React, MapLibre, Zustand, Domain separation
│   ├── research-audit/
│   │   ├── repository-inventory.md  # Comprehensive inventory of 17 reference repos
│   │   ├── feature-comparison-matrix.md # Feature matrix & capability gaps
│   │   └── license-register.md      # Dependency license compliance & safety
│   ├── ROADMAP.md             # Multi-phase project delivery roadmap
│   └── SESSION_HANDOFF.md     # Engineering session summary & next steps
└── RESOURCES/                 # Reference repositories and research scripts
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js**: v18+ (tested on Node v24)
- **npm**: v9+ (tested on npm v11)

### Installation & Development

```bash
# Navigate to the app directory
cd app

# Install dependencies
npm install

# Start the interactive development studio
npm run dev

# Run the test suite
npm test

# Build for production
npm run build
```

---

## 🧪 Testing

The domain core is verified by 49 comprehensive unit tests covering:
- **Geodesic calculations**: Haversine distances, antimeridian date-line crossings, coordinate normalization, route bearing.
- **Deterministic timeline**: Sub-second interpolation, scene keyframes, frame generator accuracy.
- **Multi-modal journey builder**: Seamless transitions between road (car/train) and trail (hike/elevation).
- **Serialization safety**: Corrupted JSON rejection, version mismatch checks, and lossless `.wayvora.json` roundtrips.

```bash
cd app
npm test
```

---

## 🗺️ License & Compliance

All Wayvora project code is licensed under the MIT License. Third-party reference repositories and libraries have been audited in [license-register.md](file:///c:/Users/Hrushikesh%20Bunni/Downloads/H/PROJECTS/WAYVORA/docs/research-audit/license-register.md). Only permissively licensed components (MIT / ISC / Apache 2.0) are utilized.
