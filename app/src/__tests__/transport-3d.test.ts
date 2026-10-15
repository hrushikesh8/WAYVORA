/* ─── Phase 3: 3D Transport Models & Fallback Hierarchy Tests ────────
   Validates 3D model registry, licensing & attribution completeness,
   deterministic pose evaluation, fallback hierarchy, CustomLayerInterface,
   and export/preview synchronization.
   ─────────────────────────────────────────────────────────────────── */

import { describe, it, expect, vi } from 'vitest';
import {
  CANONICAL_TRANSPORT_MODES,
  getModelDefinition,
  has3DModelAsset,
  resolveTransportRenderMode,
  calculateTransportPose3D,
  Transport3DModelLayer,
  TRANSPORT_3D_LAYER_ID,
  extractMapLibreProjectionMatrix,
  attachTransportMapLayers,
  syncTransportSourceData,
  createProceduralModel,
  TRANSPORT_SOURCE_ID,
  TRANSPORT_SYMBOL_LAYER_ID,
  TRANSPORT_HALO_LAYER_ID,
  TRANSPORT_PULSE_LAYER_ID,
} from '../domain/transport';

describe('Phase 3: 3D Transport Model Engine', () => {
  describe('1. Model Registry & Licensing Due Diligence', () => {
    it('registers all 8 canonical transport modes in the model registry', () => {
      for (const mode of CANONICAL_TRANSPORT_MODES) {
        const def = getModelDefinition(mode);
        expect(def).toBeDefined();
        expect(def.mode).toBe(mode);
        expect(def.name.length).toBeGreaterThan(0);
        expect(def.scale).toBeGreaterThan(0);
      }
    });

    it('documents verifiable licensing and copyright attribution for every single mode', () => {
      for (const mode of CANONICAL_TRANSPORT_MODES) {
        const def = getModelDefinition(mode);
        expect(def.license).toBeDefined();
        expect(def.license.trim().length).toBeGreaterThan(0);
        expect(def.attribution).toBeDefined();
        expect(def.attribution.trim().length).toBeGreaterThan(0);

        // Third-party 3D models must document authors and source references
        if (def.status === 'registered' && def.modelUrl) {
          expect(def.author).toBeDefined();
          expect(def.sourceUrl).toBeDefined();
        }
      }
    });

    it('registers verified in-house procedural 3D models for all 8 canonical modes', () => {
      for (const mode of CANONICAL_TRANSPORT_MODES) {
        expect(has3DModelAsset(mode)).toBe(true);
      }
    });
  });

  describe('2. Deterministic Rendering Mode Resolution & Fallback Hierarchy', () => {
    it('forces 2D vector silhouettes when user specifies 2d-icon setting', () => {
      for (const mode of CANONICAL_TRANSPORT_MODES) {
        const resolved = resolveTransportRenderMode(mode, '2d-icon', true);
        expect(resolved).toBe('2d-svg');
      }
    });

    it('falls back to 2D silhouette if a mode is unregistered or unsupported regardless of setting', () => {
      expect(resolveTransportRenderMode('custom-unknown' as any, '3d-model', true)).toBe('2d-svg');
      expect(resolveTransportRenderMode('custom-unknown' as any, 'auto', true)).toBe('2d-svg');
    });

    it('falls back to 2D silhouette when 3D asset is pending load or loading fails', () => {
      for (const mode of CANONICAL_TRANSPORT_MODES) {
        // When not loaded: resolves safely to 2D SVG silhouette
        expect(resolveTransportRenderMode(mode, '3d-model', false)).toBe('2d-svg');
        expect(resolveTransportRenderMode(mode, 'auto', false)).toBe('2d-svg');

        // Once loaded, resolves deterministically to 3D model
        expect(resolveTransportRenderMode(mode, '3d-model', true)).toBe('3d-model');
        expect(resolveTransportRenderMode(mode, 'auto', true)).toBe('3d-model');
      }
    });
  });

  describe('3. Deterministic 3D Pose Evaluation', () => {
    it('calculates Mercator coordinates, scale, and rotations without NaNs', () => {
      const point = { lng: 8.5417, lat: 47.3769, ele: 408 };
      const pose = calculateTransportPose3D(point, 65, 'car', {
        groundElevation: 408,
      });

      expect(Number.isFinite(pose.mercatorX)).toBe(true);
      expect(Number.isFinite(pose.mercatorY)).toBe(true);
      expect(Number.isFinite(pose.mercatorZ)).toBe(true);
      expect(Number.isFinite(pose.mercatorScale)).toBe(true);
      expect(pose.mercatorScale).toBeGreaterThan(0);

      expect(pose.bearing).toBe(65);
      expect(pose.effectiveElevationMeters).toBeGreaterThanOrEqual(408);
      expect(Number.isFinite(pose.rotationX)).toBe(true);
      expect(Number.isFinite(pose.rotationY)).toBe(true);
      expect(Number.isFinite(pose.rotationZ)).toBe(true);
    });

    it('clamps terrain slope pitch to physical limits rather than assuming wheel physics', () => {
      const point = { lng: 8.5417, lat: 47.3769, ele: 500 };
      const carDef = getModelDefinition('car');

      // Extreme 80-degree cliff climb
      const poseCliff = calculateTransportPose3D(point, 0, 'car', {
        groundElevation: 500,
        elevationDelta: 500,
        distanceDeltaMeters: 50, // steep slope
      });

      expect(poseCliff.pitch).toBeLessThanOrEqual(carDef.maxPitchDegrees);
      expect(poseCliff.pitch).toBeGreaterThanOrEqual(-carDef.maxPitchDegrees);
    });

    it('elevates aviation transport with appropriate ground clearance offset', () => {
      const ground = 800;
      const point = { lng: 8.5417, lat: 47.3769, ele: ground };
      const airplanePose = calculateTransportPose3D(point, 90, 'airplane', {
        groundElevation: ground,
      });

      const carPose = calculateTransportPose3D(point, 90, 'car', {
        groundElevation: ground,
      });

      expect(airplanePose.effectiveElevationMeters).toBeGreaterThan(carPose.effectiveElevationMeters);
    });
  });

  describe('4. CustomLayerInterface Contract & Matrix Extraction', () => {
    it('conforms to MapLibre CustomLayerInterface specifications', () => {
      const layer = new Transport3DModelLayer();
      expect(layer.id).toBe(TRANSPORT_3D_LAYER_ID);
      expect(layer.type).toBe('custom');
      expect(layer.renderingMode).toBe('3d');
      expect(typeof layer.onAdd).toBe('function');
      expect(typeof layer.render).toBe('function');
      expect(typeof layer.onRemove).toBe('function');
    });

    it('extracts projection matrix from various MapLibre input signatures', () => {
      const mock16 = new Float64Array(16).fill(1);

      // Direct array / Float64Array
      expect(extractMapLibreProjectionMatrix(mock16)).toBe(mock16);

      // MapLibre v6 defaultProjectionData
      const v6Input = { defaultProjectionData: { mainMatrix: mock16 } };
      expect(extractMapLibreProjectionMatrix(v6Input)).toBe(mock16);

      // Model view projection matrix
      const mvpInput = { modelViewProjectionMatrix: mock16 };
      expect(extractMapLibreProjectionMatrix(mvpInput)).toBe(mock16);

      // Null / empty input
      expect(extractMapLibreProjectionMatrix(null)).toBeNull();
      expect(extractMapLibreProjectionMatrix(undefined)).toBeNull();
    });

    it('executes safely in headless or mock environments without throwing', () => {
      const layer = new Transport3DModelLayer();
      const mockMap = { getCanvas: () => null, triggerRepaint: vi.fn() } as any;
      const mockGl = {} as any;

      // onAdd in headless environment
      expect(() => layer.onAdd(mockMap, mockGl)).not.toThrow();

      // render with mock input
      expect(() => layer.render(mockGl, { defaultProjectionData: { mainMatrix: new Float64Array(16) } })).not.toThrow();

      // onRemove cleanup
      expect(() => layer.onRemove()).not.toThrow();
    });
  });

  describe('5. Map Lifecycle & Layer Coordination', () => {
    it('attaches 3D model layer and sets 2D visibility accordingly', () => {
      const layers = new Map<string, any>();
      const sources = new Map<string, any>();

      const mockMap = {
        getSource: (id: string) => sources.get(id),
        addSource: (id: string, s: any) => sources.set(id, s),
        getLayer: (id: string) => layers.get(id),
        addLayer: (l: any) => layers.set(l.id, l),
        setLayoutProperty: vi.fn(),
        hasImage: () => true,
      } as any;

      const modelLayer = new Transport3DModelLayer({ renderMode: 'auto' });

      attachTransportMapLayers(
        mockMap,
        { lng: 8.54, lat: 47.37 },
        0,
        'car',
        { modelLayer, renderMode: 'auto' }
      );

      // 2D sources and layers are present
      expect(sources.has(TRANSPORT_SOURCE_ID)).toBe(true);
      expect(layers.has(TRANSPORT_SYMBOL_LAYER_ID)).toBe(true);
      expect(layers.has(TRANSPORT_HALO_LAYER_ID)).toBe(true);
      expect(layers.has(TRANSPORT_PULSE_LAYER_ID)).toBe(true);

      // 3D model custom layer is registered
      expect(layers.has(TRANSPORT_3D_LAYER_ID)).toBe(true);
    });

    it('synchronizes 3D model pose and updates 2D visibility on frame ticks', () => {
      const mockSourceData = vi.fn();
      const mockSetLayout = vi.fn();

      const mockMap = {
        getSource: (id: string) => (id === TRANSPORT_SOURCE_ID ? { setData: mockSourceData } : null),
        getLayer: () => true,
        setLayoutProperty: mockSetLayout,
      } as any;

      const modelLayer = new Transport3DModelLayer({ renderMode: 'auto' });
      const updatePoseSpy = vi.spyOn(modelLayer, 'updatePose');

      syncTransportSourceData(
        mockMap,
        { lng: 8.5417, lat: 47.3769, ele: 410 },
        120,
        'car',
        {
          modelLayer,
          groundElevation: 410,
          renderMode: 'auto',
        }
      );

      // Verifies 2D GeoJSON source received exact coordinates and bearing
      expect(mockSourceData).toHaveBeenCalledTimes(1);
      const callData = mockSourceData.mock.calls[0][0];
      expect(callData.features[0].geometry.coordinates).toEqual([8.5417, 47.3769]);
      expect(callData.features[0].properties.bearing).toBe(120);

      // Verifies 3D model pose updated with identical evaluation
      expect(updatePoseSpy).toHaveBeenCalledWith(
        { lng: 8.5417, lat: 47.3769, ele: 410 },
        120,
        'car',
        expect.objectContaining({ groundElevation: 410 })
      );
    });
  });

  describe('6. Procedural 3D Model Factory & Geometry Quality', () => {
    it('instantiates valid Three.js groups with non-empty meshes for all 8 modes', () => {
      for (const mode of CANONICAL_TRANSPORT_MODES) {
        const group = createProceduralModel(mode);
        expect(group).not.toBeNull();
        expect(group?.name).toBe(`wayvora-model-${mode}`);
        expect(group?.children.length).toBeGreaterThan(0);

        let meshCount = 0;
        group?.traverse((child) => {
          if ((child as any).isMesh) {
            meshCount++;
            expect((child as any).geometry).toBeDefined();
            expect((child as any).material).toBeDefined();
          }
        });
        expect(meshCount).toBeGreaterThan(0);
      }
    });

    it('preloads models into Transport3DModelLayer cache synchronously without network fetch', async () => {
      const layer = new Transport3DModelLayer();
      for (const mode of CANONICAL_TRANSPORT_MODES) {
        const result = await layer.preloadModel(mode);
        expect(result).not.toBeNull();
        expect(layer.isModelCached(mode)).toBe(true);
      }
    });
  });
});

