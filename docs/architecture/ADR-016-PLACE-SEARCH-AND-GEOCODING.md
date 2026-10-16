# ADR-016: Place Search, Geocoding Provider Selection & Architecture

**Status**: ACCEPTED  
**Date**: 2026-10-15  
**Domain**: Geocoding, Place Search, Map Integration & Waypoint Addition  

---

## 1. Context & Operational Requirements

WAYVORA requires a place-search and geocoding experience enabling creators to search for real-world locations, inspect candidates directly on the 3D map, and seamlessly integrate selected places as journey waypoints and story stops.

Evaluating a geocoding integration for a commercial-grade travel creation studio introduces several strict operational and legal requirements:

1. **Search-as-you-Type Autocomplete**: Creators expect instant debounced suggestions as they type city names, alpine peaks, natural landmarks, and addresses.
2. **Provider Licensing & Fair Use**:
   - The public OpenStreetMap Nominatim endpoint (`nominatim.openstreetmap.org`) strictly **forbids** search-as-you-type autocomplete queries under its published Usage Policy (Section 2: "Search as you type queries are forbidden on the public server"). Violating this policy results in IP bans.
   - Mapbox Geocoding requires a paid token, forbids displaying results on non-Mapbox maps (e.g. OpenFreeMap or Esri World Imagery), and prohibits permanent storage under standard temporary geocoding pricing.
   - Google Places API has severe display-on-Google-Maps-only restrictions and prohibits storing Place IDs and coordinates.
3. **API-Key Security in Client Applications**: Bundling private server-side API keys in a web application bundle creates leakage and quota theft vulnerabilities.
4. **Offline & Test Determinism**: The test suite and offline evaluation require deterministic, instant search mock adapters without network roundtrips.
5. **Video Export & Attribution**: Coordinates and place names saved in journey projects may appear in exported MP4 travel videos. Data sources must allow permanent caching and attribution in derived works.

---

## 2. Evaluation of Geocoding Providers

| Provider | Data Source | Autocomplete Support | Public Terms & Fair Use | Commercial SaaS Eligibility | API Key Required? | Storage / Caching Allowed? | Usable in Exported Videos? | Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Photon (by Komoot)** | OpenStreetMap (via Nominatim + Elasticsearch) | **Native & Optimized** (`/api/?q=...&limit=6`) | Public demo server for low-volume; no uptime SLA; dynamic rate limits (HTTP 429). Fully self-hostable via Docker. | Open-source (Apache 2.0); data ODbL 1.0. Production SaaS must self-host or configure custom endpoint. | **No** (Zero client key exposure) | **Yes** (ODbL allows caching coordinates & names with attribution) | **Yes** with OpenStreetMap & Photon attribution | **SELECTED AS DEFAULT (Configurable Endpoint)** |
| **OSM Nominatim Public** | OpenStreetMap | **FORBIDDEN** by usage policy | Max 1 req/sec; strict User-Agent. Autocomplete banned. | Non-commercial / evaluation only. | No | Yes (ODbL) | Yes with attribution | **REJECTED** (Autocomplete banned) |
| **OpenCage Geocoding** | Multi-source (OSM, Geonames, etc.) | Supported via `/geocode/v1/json` | 2,500 free queries/day; paid tiers for SaaS. | Commercial tiers available. | **Yes** (Requires key) | Yes on paid tiers | Yes with attribution | **COMPATIBLE SECONDARY ADAPTER** |
| **Mapbox Geocoding** | Proprietary + Open | Supported | Strict rate limits; requires Mapbox map display. | Restricted to Mapbox maps. | **Yes** (Public token) | **No** (Permanent caching costs extra) | Restricted | **REJECTED** (Violates multi-style architecture) |
| **Stadia Maps / Pelias** | OSM, Who's On First, OpenAddresses | Supported via `/v1/autocomplete` | 200k free credits/mo on sign-up. | Commercial tiers available. | **Yes** (Requires key) | Yes | Yes with attribution | **COMPATIBLE SECONDARY ADAPTER** |

---

## 3. Decision

1. **Adopt a Provider-Agnostic Interface (`GeocodingAdapter`)**:
   - `search(query: GeocodeQuery): Promise<GeocodeResponse>`
   - Completely decouples the search UI and journey editor from any third-party API format.

2. **Default Active Provider: `PhotonGeocodingAdapter`**:
   - Connects to `https://photon.komoot.io/api` by default, configurable via `options.endpoint` or `import.meta.env.VITE_PHOTON_ENDPOINT` for self-hosted production instances.
   - Zero API keys needed in the client application.
   - Built specifically for high-speed autocomplete across global OpenStreetMap entities (cities, peaks, villages, landmarks, roads).
   - Enforces defensive client timeout (8000ms default via `AbortController`) returning typed `code: 'TIMEOUT'`.
   - Enforces defensive coordinate validation ($-90 \le \text{lat} \le 90$, $-180 \le \text{lng} \le 180$).
   - Returns structured metadata: name, city, state, country, postcode, OSM category, type, and bounding extent.

3. **Offline & Test Provider: `MockGeocodingAdapter`**:
   - Deterministic in-memory database of European, American, and Asian landmark destinations.
   - Supports simulated latency, abort signals, and forced error conditions for automated testing.

4. **Attribution & Transparency**:
   - Base attribution: `Geocoding © OpenStreetMap contributors via Photon`.
   - Displayed transparently in the search interface and integrated into project metadata.
   - **Composite Video Export Attribution (`getFullExportAttribution`)**: Dynamically audits journey waypoints and segments; when geocoded waypoints or OSRM segments are present on Esri Satellite tiles or any style, `Geocoding © OpenStreetMap contributors via Photon` is appended to the video watermark and map overlay to satisfy ODbL 4.3 requirements.

5. **Honest Waypoint & Route Semantics**:
   - Selecting a search candidate flies the camera to the location and places a temporary highlight marker.
   - An explicit, conscious user action ("+ Add Waypoint (Direct Connection)") commits the point to the route using `editor.ts` immutable history (supporting 100% undo/redo).
   - Attaches explicit provenance metadata: `{ source: 'manual-connection', connectionType: 'direct-line', geocodingProvider: 'photon' }`.
   - Does NOT fabricate road, trail, or transit paths. Connecting segments are clearly presented as straight-line direct connections until the user explicitly requests OSRM routing in the Segments tab.
   - Preserves existing route order, GPS timestamps, and waypoint IDs.

---

## 4. Phase 4.1 Audit Verification & Compliance Findings

- **Photon Public Server Status**: The Komoot public endpoint is officially a demonstration service without SLA. Maintainer guidance stipulates: *"if you have to ask about usage limits, you are likely better off running your own instance."* Caching is compliant under ODbL 1.0. For commercial production deployments, set `VITE_PHOTON_ENDPOINT` to an internal Docker container (`komoot/photon`).
- **Client Resilience**: Configurable 8000ms timeout prevents hanging requests on mobile or slow connections. HTTP 429 status is detected and rendered as a specific warning in the UI.
- **Route Semantics**: Added stop connection is strictly marked as a direct line. Waypoint insertion does not reorder or mutate previous waypoints.
- **Satellite Attribution Gap Fixed**: Resolved attribution gap where Esri World Imagery video exports omitted OSM geocoding/routing credit. `getFullExportAttribution` now audits active journey contents and includes OSM/Photon/OSRM attribution whenever applicable.
