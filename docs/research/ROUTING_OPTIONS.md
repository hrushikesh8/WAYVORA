# Wayvora — Road Routing Services Research & Evaluation

## 1. Executive Context

Wayvora requires real-world road geometry to turn coarse waypoints (e.g., origin city to destination city) into realistic road paths that trace real highways, curves, tunnels, and mountain passes, complementing high-precision GPX trail tracks in unified mixed journeys.

This document evaluates three leading OpenStreetMap-based routing architectures and hosted solutions:
1. **OSRM (Open Source Routing Machine)**
2. **Valhalla**
3. **GraphHopper**

---

## 2. Comprehensive Comparison Matrix

| Evaluation Dimension | OSRM (Open Source Routing Machine) | Valhalla (Mapzen / Stadia Maps) | GraphHopper |
|---|---|---|---|
| **Underlying Engine & Architecture** | C++ Graph routing with Contraction Hierarchies (CH) and Multi-Level Dijkstra (MLD). | Dynamic run-time edge costing with tiled graph hierarchy (`tar` graph tiles). | Java-based graph router with customizable speed-up modes (CH & Landmark A*). |
| **Road Geometry Quality** | High-precision geometry snapped to OSM highway network. Returns polyline or GeoJSON LineString coordinates. | Superior turn maneuver resolution, elevation tile integration, lane guidance, and fine-grained curvature. | High-precision geometry, native 3D coordinate support (`[lng, lat, ele]`), elevation profiles. |
| **Supported Travel Profiles** | `car` (driving), `bike` (bicycle), `foot` (walking). | `auto`, `bicycle`, `pedestrian`, `motorcycle`, `bus`, `truck`. Dynamic costing parameters. | `car`, `bike`, `foot`, `hike`, `motorcycle`, `scooter`. Custom cost profiles via JSON. |
| **Public Demo Endpoints & Rate Limits** | `https://router.project-osrm.org/`<br>**Strict Policy**: Strictly for testing/development. No commercial use, no SLA, aggressive rate limiting (HTTP 429), frequent timeouts under public load. | No public community demo without an account. Hosted by Stadia Maps (free tier: 2,500 requests/day, requires API key) or Mapbox. | `graphhopper.com` API: Free tier (500 requests/day, requires credit card/account for key). |
| **API Keys & Authentication** | Demo endpoint requires no API key. Self-hosted instances require zero auth. | Hosted providers require Bearer tokens or API query keys. Self-hosted instances require zero auth. | Hosted provider requires `key` parameter. Self-hosted requires zero auth. |
| **Attribution & Privacy** | Requires OpenStreetMap attribution (`© OpenStreetMap contributors`). No telemetry sent when self-hosted. | Requires OpenStreetMap attribution. Commercial vendors may log request coordinates. | Requires OpenStreetMap and GraphHopper attribution. |
| **Self-Hosting & Operational Costs** | **Extremely Low Cost**: Pre-built Docker images (`osrm/osrm-backend`). Fast graph preprocessing. Single Docker container can serve global continent routing in ~4–8 GB RAM. | **Moderate**: Requires tile pipeline setup (`valhalla_build_tiles`), higher memory overhead for global coverage (~16–32 GB RAM). | **Moderate**: JVM runtime, moderate memory usage (~8–16 GB RAM for national/continental graphs). |
| **License** | 2-Clause BSD (Permissive, commercial-friendly). | MIT License (Permissive, commercial-friendly). | Apache 2.0 (Core engine). Permissive. |

---

## 3. Provider Viability Analysis

### A. OSRM (Open Source Routing Machine)
- **Strengths**:
  - The universal standard in web-mapping for simple, blazing-fast point-to-point road routing.
  - Zero API key required for local development and smoke testing using the project-osrm demo endpoint.
  - Zero-dependency REST API returning standard GeoJSON coordinates.
  - Easy drop-in transition to a dedicated self-hosted container in production.
- **Risks & Limitations**:
  - The public demo server `router.project-osrm.org` is explicitly **NOT** suitable for high-volume production; it experiences throttling and intermittent 502/503 errors during peak hours.
  - Does not supply elevation coordinates in route points (returns 2D `[lng, lat]`).
- **Mitigation**:
  - Implement strict request timeout (AbortController) and polite headers.
  - Handle all HTTP status codes gracefully (429, 500, network error) with descriptive user feedback.
  - Never fabricate routes on failure.
  - Provide an adapter design with customizable `baseUrl` for self-hosted instances.

### B. Valhalla
- **Strengths**:
  - Industry gold-standard for complex multimodal and dynamic cost routing.
  - Rich maneuver metadata and elevation integration.
- **Risks & Limitations**:
  - Lacks a free, open, keyless public endpoint for out-of-the-box local testing. Requires users to register for API keys (e.g. Stadia Maps).
- **Mitigation**:
  - The provider-independent adapter interface allows adding a `ValhallaRoutingProvider` in subsequent phases without changing domain or UI code.

### C. GraphHopper
- **Strengths**:
  - Built-in elevation support (`elevation=true`).
  - Strong Java community and clean REST API.
- **Risks & Limitations**:
  - Commercial hosted service has restrictive free rate limits (500 req/day) and requires API key setup.
- **Mitigation**:
  - Can be added as a secondary provider plug-in using the `RoutingAdapter` interface.

---

## 4. Architectural Decision & Adapter Strategy

To ensure Wayvora is never locked into a single provider or fragile demo server:

1. **Provider-Independent Routing Contract**:
   Define `RoutingAdapter` interface with `calculateRoute(request: RouteRequest): Promise<RouteResult>`. The journey domain interacts solely with this interface.
2. **Deterministic Mock Adapter (`MockRoutingProvider`)**:
   Provides guaranteed offline fixtures for unit testing, test suites, and offline dev environments.
3. **Pluggable OSRM Adapter (`OsrmRoutingProvider`)**:
   Communicates with standard OSRM v1 endpoints (public demo by default, configurable to private instances).
4. **Non-Destructive Journey Integration**:
   Applying a route to a segment replaces only that explicitly targeted road segment, preserves GPX trails unchanged, retains full provenance (`sourceFormat: 'osrm'`, provider metadata, timestamp), and maintains undo/redo history.
