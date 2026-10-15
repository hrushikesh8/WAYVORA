import { describe, it, expect, vi } from 'vitest';
import {
  MAP_STYLES,
  MAP_STYLE_IDS,
  DEFAULT_MAP_STYLE_ID,
  getStyleAttribution,
  attachJourneyMapLayers,
  configureMapTerrain,
  syncRouteSourceData,
  syncSegmentPointsData,
} from '../domain/map';
import { journeyFromWaypoints } from '../domain/journey';
import { SF_TO_LA_WAYPOINTS } from './fixtures';

describe('Milestone 1 — Centralized Map Styles & 3D Terrain Engine', () => {
  it('registers all 5 canonical map styles with valid metadata', () => {
    expect(MAP_STYLE_IDS).toEqual([
      'cinematic',
      'standard',
      'outdoors',
      'satellite',
      'satellite-labels',
    ]);
    expect(DEFAULT_MAP_STYLE_ID).toBe('cinematic');

    for (const id of MAP_STYLE_IDS) {
      const style = MAP_STYLES[id];
      expect(style).toBeDefined();
      expect(style.id).toBe(id);
      expect(style.name.length).toBeGreaterThan(0);
      expect(style.description.length).toBeGreaterThan(0);
      expect(style.attribution.length).toBeGreaterThan(0);
      expect(['vector', 'raster', 'hybrid']).toContain(style.category);
    }
  });

  it('configures vector basemap styles with OpenFreeMap endpoints', () => {
    expect(MAP_STYLES.standard.category).toBe('vector');
    expect(MAP_STYLES.standard.styleUrlOrSpec).toBe('https://tiles.openfreemap.org/styles/liberty');

    expect(MAP_STYLES.outdoors.category).toBe('vector');
    expect(MAP_STYLES.outdoors.styleUrlOrSpec).toBe('https://tiles.openfreemap.org/styles/bright');

    expect(MAP_STYLES.cinematic.category).toBe('vector');
    expect(MAP_STYLES.cinematic.styleUrlOrSpec).toBe('https://tiles.openfreemap.org/styles/dark');
  });

  it('configures satellite and satellite-labels with standalone raster specifications without API keys', () => {
    const sat = MAP_STYLES.satellite;
    expect(sat.category).toBe('raster');
    expect(typeof sat.styleUrlOrSpec).toBe('object');
    const satSpec = sat.styleUrlOrSpec as any;
    expect(satSpec.version).toBe(8);
    expect(satSpec.sources['esri-satellite']).toBeDefined();
    expect(satSpec.sources['esri-satellite'].type).toBe('raster');
    expect(satSpec.sources['esri-satellite'].tileSize).toBe(256);
    expect(satSpec.sources['esri-satellite'].tiles[0]).toContain('arcgisonline.com');
    expect(satSpec.layers.some((l: any) => l.id === 'satellite-imagery')).toBe(true);

    const satLabels = MAP_STYLES['satellite-labels'];
    expect(satLabels.category).toBe('hybrid');
    const satLabelsSpec = satLabels.styleUrlOrSpec as any;
    expect(satLabelsSpec.sources['esri-satellite']).toBeDefined();
    expect(satLabelsSpec.sources['esri-reference-labels']).toBeDefined();
    expect(satLabelsSpec.layers.some((l: any) => l.id === 'satellite-reference-labels')).toBe(true);
  });

  it('computes composite legal attribution for viewport and video exports', () => {
    const vectorAttr = getStyleAttribution('standard', false);
    expect(vectorAttr).toContain('OpenFreeMap');
    expect(vectorAttr).toContain('OpenStreetMap');
    expect(vectorAttr).not.toContain('AWS Open Data');

    const vectorAttrWithTerrain = getStyleAttribution('standard', true);
    expect(vectorAttrWithTerrain).toContain('OpenFreeMap');
    expect(vectorAttrWithTerrain).toContain('AWS Open Data');

    const satAttr = getStyleAttribution('satellite', false);
    expect(satAttr).toContain('Esri');
    expect(satAttr).toContain('Maxar');
    expect(satAttr).not.toContain('AWS Open Data');

    const satAttrWithTerrain = getStyleAttribution('satellite-labels', true);
    expect(satAttrWithTerrain).toContain('Esri');
    expect(satAttrWithTerrain).toContain('AWS Open Data');
  });

  describe('Map Lifecycle & Layer Persistence across Style Switches', () => {
    function createMockMap() {
      const sources: Record<string, any> = {};
      const layers: Record<string, any> = {};
      let terrain: any = null;

      const map = {
        getSource: vi.fn((id: string) => sources[id]),
        addSource: vi.fn((id: string, def: any) => {
          if (sources[id]) throw new Error(`Source ${id} already exists`);
          const sourceObj = {
            ...def,
            setData: vi.fn((data: any) => {
              sourceObj.data = data;
            }),
          };
          sources[id] = sourceObj;
          return sourceObj;
        }),
        getLayer: vi.fn((id: string) => layers[id]),
        addLayer: vi.fn((def: any, beforeId?: string) => {
          if (layers[def.id]) throw new Error(`Layer ${def.id} already exists`);
          layers[def.id] = { ...def, beforeId };
        }),
        setTerrain: vi.fn((t: any) => {
          terrain = t;
        }),
        getTerrain: vi.fn(() => terrain),
        _sources: sources,
        _layers: layers,
      };

      return map;
    }

    it('attaches route-source, route-glow, route-line, and segment-points idempotently', () => {
      const mockMap = createMockMap();
      const journey = journeyFromWaypoints('California Coastal Tour', SF_TO_LA_WAYPOINTS);

      attachJourneyMapLayers(mockMap as any, journey, {
        terrainEnabled: true,
        terrainExaggeration: 1.2,
        supportsHillshade: true,
        selectedSegmentId: journey.segments[0].id,
        selectedPointIndex: 1,
      });

      expect(mockMap.addSource).toHaveBeenCalledWith('route-source', expect.any(Object));
      expect(mockMap.addSource).toHaveBeenCalledWith('segment-points-source', expect.any(Object));
      expect(mockMap.addSource).toHaveBeenCalledWith('terrain-source', expect.any(Object));

      expect(mockMap.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'route-glow' }));
      expect(mockMap.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'route-line' }));
      expect(mockMap.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'segment-points-layer' }));
      expect(mockMap.addLayer).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'terrain-hillshade' }),
        'route-glow'
      );

      expect(mockMap.setTerrain).toHaveBeenCalledWith({
        source: 'terrain-source',
        exaggeration: 1.2,
      });

      // Second call (simulating re-attachment after partial load or duplicate event) must not throw
      expect(() => {
        attachJourneyMapLayers(mockMap as any, journey, {
          terrainEnabled: true,
          terrainExaggeration: 1.2,
          supportsHillshade: true,
        });
      }).not.toThrow();
    });

    it('enables and disables 3D terrain independently without affecting other sources', () => {
      const mockMap = createMockMap();

      // Configure terrain ON
      configureMapTerrain(mockMap as any, true, 1.5, { supportsHillshade: false });
      expect(mockMap.getSource('terrain-source')).toBeDefined();
      expect(mockMap.setTerrain).toHaveBeenCalledWith({
        source: 'terrain-source',
        exaggeration: 1.5,
      });

      // Configure terrain OFF
      configureMapTerrain(mockMap as any, false, 1.5, { supportsHillshade: false });
      expect(mockMap.setTerrain).toHaveBeenCalledWith(null);
    });

    it('syncs route polyline and segment vertex data through setData', () => {
      const mockMap = createMockMap();
      const journey = journeyFromWaypoints('California Coastal Tour', SF_TO_LA_WAYPOINTS);

      attachJourneyMapLayers(mockMap as any, journey);

      const routeSource = mockMap.getSource('route-source');
      expect(routeSource).toBeDefined();

      syncRouteSourceData(mockMap as any, SF_TO_LA_WAYPOINTS);
      expect(routeSource.setData).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'Feature',
          geometry: expect.objectContaining({ type: 'LineString' }),
        })
      );

      const segmentSource = mockMap.getSource('segment-points-source');
      expect(segmentSource).toBeDefined();
      syncSegmentPointsData(mockMap as any, journey.segments[0], 1);
      expect(segmentSource.setData).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'FeatureCollection',
          features: expect.arrayContaining([
            expect.objectContaining({
              properties: expect.objectContaining({ pointIndex: 1, selected: true }),
            }),
          ]),
        })
      );
    });

    it('gracefully handles mock errors when map.setTerrain is unavailable or fails', () => {
      const mockMap = createMockMap();
      mockMap.setTerrain.mockImplementation(() => {
        throw new Error('WebGL 3D terrain unsupported on this device');
      });

      expect(() => {
        configureMapTerrain(mockMap as any, true, 1.0, { supportsHillshade: true });
      }).not.toThrow();
    });
  });
});
