# Repository Inventory — Wayvora Research Audit

> Generated: 2026-10-13 · Verified from source inspection (not README claims alone)

## Summary

| # | Repository | License | Language/Stack | Focus |
|---|-----------|---------|---------------|-------|
| 1 | animated-route-main | ISC (pkg) · No LICENSE file | Vanilla JS + Leaflet | GPX route animation with video recording |
| 2 | CreatorMaps-main | MIT | SvelteKit 5 + MapLibre + deck.gl | Cinematic map reels & posters (India-focused) |
| 3 | flight-map-studio-main | MIT | Single HTML · d3-geo · Canvas 2D | Flight/road/rail animated route videos |
| 4 | flyover_routes-main | **NO LICENSE** | Single HTML · Mapbox GL v3 | Cinematic GPX flyover with 3D terrain |
| 5 | georeel-main | **GPL-3.0** | Python 3.14 + Blender + FastAPI | Desktop GPX → 3D fly-through video |
| 6 | GPX_3D-master | MIT | Python Flask + JS | 3D GPX flyover with satellite tiles |
| 7 | journey-atlas-main | Blue Oak 1.0.0 | SvelteKit + Deno 2 + Leaflet | Print-ready road-trip poster maps |
| 8 | lil-mappo-main | **AGPL-3.0** | React 19 + Vite + Mapbox GL + TS | Full map animation studio with timeline |
| 9 | locusify-main | ISC | React 19 + pnpm monorepo | Photo-to-route-map + cinematic replay |
| 10 | route-animator-main | **NO LICENSE** | Single HTML · MapLibre GL 5 | Satellite globe route animation |
| 11 | share-gpx-main | MIT | Go + JS frontend | Self-hosted GPX sharing with 3D terrain |
| 12 | tourgaze-develop | **AGPL-3.0** | Java 25 (Spring Boot) + Vue 3 | Local-first ride viewer & cinematic replay |
| 13 | TrailReplay-main | MIT + Attribution | Vite + MapLibre + TS | GPX storytelling studio with video export |
| 14 | travel-animation-main | MIT | Vanilla JS + MapLibre | Road-trip animation with photo galleries |
| 15 | travelback-main | MIT | Next.js 16 + React 19 + MapLibre 6 + TS | Journey animation with scene editor |
| 16 | TrekReel-gh-pages | **NO LICENSE** (gh-pages only) | Static HTML landing page | Marketing page for desktop app |
| 17 | triptrail-main | MIT | Vanilla JS + MapLibre 5 | Multi-stop cinematic travel animation |

## License Safety Summary

### ✅ Safe for reuse / inspiration (MIT, ISC, Blue Oak)
- **triptrail-main** (MIT) — journey model, routing, deterministic render
- **travelback-main** (MIT) — scene editor, camera system, interpolation, parser
- **travel-animation-main** (MIT) — road animation with photo stops
- **CreatorMaps-main** (MIT) — reel composition, camera studio
- **flight-map-studio-main** (MIT) — deterministic export, d3-geo rendering
- **GPX_3D-master** (MIT) — 3D terrain elevation
- **share-gpx-main** (MIT) — GPX sharing, 3D terrain view
- **TrailReplay-main** (MIT + attribution) — GPX replay, comparison, stats
- **journey-atlas-main** (Blue Oak 1.0.0) — print maps, road-trip data model
- **locusify-main** (ISC) — photo-to-route, replay
- **animated-route-main** (ISC in pkg) — Leaflet GPX animation

### ⚠️ Copyleft — study only, cannot incorporate code
- **lil-mappo-main** (AGPL-3.0) — rich timeline/annotation, but code is off-limits
- **tourgaze-develop** (AGPL-3.0) — ride viewer, off-limits for code
- **georeel-main** (GPL-3.0) — Blender pipeline, off-limits for code

### 🚫 No license — cannot use code
- **flyover_routes-main** — no license file, Mapbox dependency (proprietary API)
- **route-animator-main** — no license file
- **TrekReel-gh-pages** — landing page only, no license

## Detailed Per-Repository Notes

### 1. triptrail-main ⭐ PRIMARY REFERENCE
- **URL**: github.com/Fangyuan025/triptrail
- **Stack**: Vanilla JS, MapLibre GL v5, OSRM routing, Nominatim geocoding
- **Key files**: `app.js` (1751 lines), `demo-journey.geojson`, `marnet.json` (shipping lanes)
- **Verified features**: 10 transport modes (plane/car/train/bus/boat/bike/walk/camper/motorcycle/tuktuk), real routing via OSRM, sea routing via MarineTraffic data, great-circle air routes, deterministic WebCodecs export, multi-stop journey with per-segment modes
- **Data model**: GeoJSON FeatureCollection with Point features; each stop has `name`, `mode` properties
- **No build step**: serves directly as static files
- **Reuse value**: HIGH — journey model, routing logic, mode definitions, canvas rendering

### 2. travelback-main ⭐ PRIMARY REFERENCE
- **URL**: github.com/Open330/travelback
- **Stack**: Next.js 16, React 19, MapLibre GL v6, TypeScript, Tailwind CSS 4
- **Key files**: `src/types.ts` (domain model), `src/lib/parser.ts` (GPX/KML/Google parser), `src/lib/interpolate.ts` (haversine, cumulative distances), `src/lib/camera.ts`, `src/components/SceneEditor.tsx`
- **Verified domain model**: TrackPoint, Track, Scene, CameraMode (6 modes), ExportConfig, ResolutionPresets
- **Test suite**: Extensive — vitest unit tests + Playwright E2E
- **Reuse value**: HIGH — parser, interpolation, camera, scene editor patterns, type definitions

### 3. travel-animation-main
- **URL**: github.com/topmonroe9/travel-animation
- **Stack**: Vanilla JS, MapLibre, python serve.py
- **Key files**: `src/app.js`, `src/route.js`, `src/scene.js`, `src/timeline.js`, `src/car3d.js`, `src/gallery.js`
- **Verified features**: Stop types (fuel/rest/food/overnight/sight/nature/sea), photo galleries at stops, 3D car model, terrain with hillshade, odometer, 4K export
- **Reuse value**: MEDIUM — stop type system, photo-at-stop gallery, road-following camera

### 4. lil-mappo-main (AGPL — study only)
- **URL**: github.com (unknown org)/lil-mappo
- **Stack**: React 19, Vite, Mapbox GL JS, TypeScript, Zustand, dnd-kit
- **Verified domain model**: RouteItem, BoundaryItem, CalloutItem, CameraKeyframe, Project. Timeline-based system with `kind` discriminated union. AutoCam with presets (chase/drone/reveal/topdown).
- **Key insight**: Most feature-complete timeline/scene editor in the set. Annotation system, undo/redo, cloud sync.
- **Reuse value**: STUDY ONLY (AGPL) — architectural patterns are informative

### 5. TrailReplay-main
- **URL**: github.com/bresca-ai/TrailReplay
- **Stack**: Vite + MapLibre, TypeScript, Cloudflare Functions
- **Verified features**: Multi-GPX journey builder, transport segments, comparison mode, live stats, elevation profile, photo placement, video export
- **Reuse value**: MEDIUM — GPX storytelling workflow, multi-track journey concept

### 6. flight-map-studio-main
- **URL**: github.com/Dayamaya-K/flight-map-studio
- **Stack**: Single ~5.7MB HTML file (self-contained), d3-geo projections, Canvas 2D
- **Verified features**: Globe projection, deterministic export (WebCodecs → MP4), real road routing (OSRM), rail routing (Transitous), 3 travel modes, 5 map styles, vehicle artwork
- **Reuse value**: MEDIUM — deterministic rendering approach, d3 globe rendering

### 7–17: Remaining Repositories (Lower Priority)

| Repo | Key Takeaway |
|------|-------------|
| CreatorMaps | SvelteKit; India-focused cinematic reels; useful reel composition patterns |
| flyover_routes | Mapbox-dependent (proprietary); no license; good for studying chase camera with terrain |
| georeel | GPL; Python + Blender; 3D terrain from SRTM; too heavy and wrong license |
| GPX_3D | MIT; Flask + JS; simple 3D flyover; useful elevation approach |
| journey-atlas | Blue Oak; Deno + SvelteKit; print poster maps; road-class coloring is useful reference |
| locusify | ISC; React monorepo; photo EXIF → route; privacy-focused |
| route-animator | No license; MapLibre globe; nice satellite globe rendering |
| share-gpx | MIT; Go backend; first-person terrain playback; good 3D terrain reference |
| tourgaze | AGPL; Java Spring Boot + Vue; most complete ride analytics platform |
| TrekReel | No license; marketing landing page only; no usable code |
