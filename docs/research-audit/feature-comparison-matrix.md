# Feature Comparison Matrix — Wayvora Research Audit

| Feature | triptrail | travelback | travel-animation | TrailReplay | lil-mappo¹ | flight-map-studio | CreatorMaps | journey-atlas |
|---------|:---------:|:----------:|:----------------:|:-----------:|:----------:|:-----------------:|:-----------:|:------------:|
| **Journey Model** |
| Multi-stop road journey | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Trail/GPX segments | ❌ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Mixed road+trail journey | ❌ | ❌ | ❌ | ✅ partial | ✅ | ❌ | ❌ | ❌ |
| Multiple transport modes | ✅ 10 modes | ❌ single track | ❌ car only | ✅ transport segs | ✅ 3 modes | ✅ 3 modes | ✅ | ❌ |
| Segment type preservation | ✅ per-stop | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Routing** |
| OSRM road routing | ✅ | ❌ | ✅ | ❌ | ✅ Mapbox | ✅ | ❌ | ❌ |
| Sea lane routing | ✅ marnet | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Great-circle air routes | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ |
| GPX/KML import | ❌ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Map & Rendering** |
| MapLibre GL | ✅ v5 | ✅ v6 | ✅ | ✅ | ❌ Mapbox | ❌ d3 | ✅ | ❌ Leaflet |
| 3D terrain | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ |
| Globe projection | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| No API key required | ✅ | ✅ | ✅ | ✅ | ❌ Mapbox | ✅ | ❌ | ✅ partial |
| **Camera** |
| Multiple camera modes | ✅ | ✅ 6 modes | ❌ follow only | ✅ | ✅ 4+ presets | ✅ 3 modes | ✅ | ❌ |
| Camera keyframes | ❌ | ✅ scenes | ❌ | ❌ | ✅ full timeline | ❌ | ❌ | ❌ |
| AutoCam / follow | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Timeline & Editing** |
| Scene editor | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Timeline scrubber | ❌ | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Undo/redo | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| **Export** |
| Deterministic render | ✅ WebCodecs | ✅ WebCodecs | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ Playwright |
| MP4 export | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ PNG |
| Multiple aspect ratios | ✅ 3 | ✅ 5 | ✅ 3 | ✅ | ✅ 3 | ✅ 3 | ✅ 3 | ❌ |
| 4K support | ❌ 1080p | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Data Persistence** |
| Project save/load | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ JSON |
| Local-first | ✅ | ✅ | ✅ | ✅ | ✅ partial | ✅ | ✅ | ✅ |
| **Tests** |
| Unit tests | ❌ | ✅ vitest | ❌ | ✅ vitest | ✅ vitest | ❌ | ❌ | ❌ |
| E2E tests | ❌ | ✅ Playwright | ❌ | ✅ Playwright | ✅ Playwright | ❌ | ❌ | ❌ |

¹ lil-mappo is AGPL — listed for feature comparison only; code cannot be reused.

## Key Insights

1. **No existing repo combines road journeys AND trail journeys** in a single unified model — this is Wayvora's core differentiator.
2. **TripTrail** has the best multi-modal routing (10 modes, OSRM + sea + air) with zero API keys.
3. **Travelback** has the most mature TypeScript domain model, parser, interpolation, and camera system.
4. **lil-mappo** has the richest feature set (timeline, annotations, undo) but is AGPL-copyleft.
5. **MapLibre GL** is the clear choice for the renderer (used by 4 of the MIT-licensed repos, free, open-source).
6. **WebCodecs** is the standard approach for deterministic MP4 export across all modern repos.
7. **No project has full project save/load** with segment types preserved — this is a gap Wayvora must fill.
