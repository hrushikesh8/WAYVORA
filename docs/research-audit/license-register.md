# License Register — Wayvora

> This register tracks every third-party dependency and reference repository
> used or studied during Wayvora development. Code may only be incorporated
> from repositories with permissive licenses (MIT, ISC, Blue Oak, Apache-2.0, BSD).

## Reference Repositories — Reuse Status

| Repository | License | Reuse Status | Notes |
|-----------|---------|-------------|-------|
| triptrail-main | MIT | ✅ PERMITTED | Architecture patterns, routing logic, mode definitions |
| travelback-main | MIT | ✅ PERMITTED | Type patterns, interpolation math, parser patterns |
| travel-animation-main | MIT | ✅ PERMITTED | Stop-type system, gallery patterns |
| TrailReplay-main | MIT + Attribution | ✅ PERMITTED (with attribution) | GPX journey builder patterns |
| flight-map-studio-main | MIT | ✅ PERMITTED | Deterministic export approach |
| CreatorMaps-main | MIT | ✅ PERMITTED | Reel composition patterns |
| GPX_3D-master | MIT | ✅ PERMITTED | Elevation data approach |
| share-gpx-main | MIT | ✅ PERMITTED | 3D terrain view patterns |
| journey-atlas-main | Blue Oak 1.0.0 | ✅ PERMITTED | Data model patterns |
| locusify-main | ISC | ✅ PERMITTED | Photo-to-route patterns |
| animated-route-main | ISC (package.json) | ⚠️ CAUTION (no LICENSE file) | Use patterns only |
| lil-mappo-main | AGPL-3.0 | 🚫 STUDY ONLY | Architecture study; no code reuse |
| tourgaze-develop | AGPL-3.0 | 🚫 STUDY ONLY | Architecture study; no code reuse |
| georeel-main | GPL-3.0 | 🚫 STUDY ONLY | Architecture study; no code reuse |
| flyover_routes-main | NO LICENSE | 🚫 FORBIDDEN | No license = all rights reserved |
| route-animator-main | NO LICENSE | 🚫 FORBIDDEN | No license = all rights reserved |
| TrekReel-gh-pages | NO LICENSE | 🚫 FORBIDDEN | Marketing page only |

## Runtime Dependencies (Verified in `app/package.json`)

| Package | Version | License | Status | Purpose |
|---------|---------|---------|--------|---------|
| maplibre-gl | ^6.14.0 | BSD-3-Clause | ✅ Installed & Verified | Map rendering engine |
| react | ^19.2.8 | MIT | ✅ Installed & Verified | UI component framework |
| react-dom | ^19.2.8 | MIT | ✅ Installed & Verified | DOM renderer |
| zustand | ^5.0.15 | MIT | ✅ Installed & Verified | State management |
| vite | ^8.3.0 | MIT | ✅ Installed & Verified (dev) | Build tooling & dev server |
| typescript | ~6.0.2 | Apache-2.0 | ✅ Installed & Verified (dev) | Type checking |
| vitest | ^5.0.4 | MIT | ✅ Installed & Verified (dev) | Unit & acceptance test suite |
| @tmcw/togeojson | — | BSD-2-Clause | ⏳ Planned (Phase 1) | GPX/KML file parser (not yet installed) |
| mp4-muxer | ^5.2.2 | MIT | ✅ Installed & Verified | Video container muxing |

## Map Cartography & Tile Sources

| Provider | Style / URL | License / Terms | API Key | Status |
|----------|-------------|-----------------|---------|--------|
| OpenFreeMap | `https://tiles.openfreemap.org/styles/dark` | Open & Free (OpenMapTiles / ODbL) | None required | ✅ Active vector style in Studio |
| OpenStreetMap | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | Open Database License (ODbL) | None required | ✅ Verified fallback |
| CartoDB Dark Matter | `basemaps.cartocdn.com` | Requires API Key (Watermarked if absent) | Required | ⚠️ Deprecated / Replaced |

## Obligations

1. **MIT**: Include original copyright notice and license text in distributions.
2. **ISC**: Include copyright notice and permission notice.
3. **Blue Oak 1.0.0**: Permissive; include license text.
4. **BSD-3-Clause** (MapLibre): Include copyright notice; do not use contributor names for endorsement.
5. **TrailReplay attribution**: Include visible attribution per license terms.

## Policy

- All Wayvora original code is authored fresh; no wholesale copy of any repository.
- Design patterns and mathematical formulas (haversine, interpolation, great-circle) are not copyrightable.
- When a specific implementation is adapted, the source repository and its license are noted here.
