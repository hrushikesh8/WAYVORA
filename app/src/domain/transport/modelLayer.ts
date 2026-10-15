/* ─── 3D Transport Model Custom Layer (MapLibre + Three.js) ───────────
   Implements MapLibre GL JS CustomLayerInterface for rendering glTF/GLB models
   over 3D terrain with Mercator coordinate synchronization.
   Provides deterministic frame updates and seamless 2D icon fallback.
   ─────────────────────────────────────────────────────────────────── */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Map as MapLibreMap, CustomLayerInterface } from 'maplibre-gl';
import type { RoutePoint } from '../types';
import type { CanonicalTransportMode, TransportRenderMode } from './types';
import {
  getModelDefinition,
  has3DModelAsset,
  calculateTransportPose3D,
} from './modelRegistry';
import {
  TRANSPORT_SYMBOL_LAYER_ID,
  TRANSPORT_HALO_LAYER_ID,
  TRANSPORT_PULSE_LAYER_ID,
} from './renderer';
import { createProceduralModel, createProceduralCar } from './proceduralModels';

export const TRANSPORT_3D_LAYER_ID = 'transport-3d-model-layer';

export interface Transport3DLayerState {
  currentMode: CanonicalTransportMode;
  currentPosition: RoutePoint | null;
  currentBearing: number;
  renderMode: TransportRenderMode;
  groundElevation?: number;
  elevationDelta?: number;
  distanceDeltaMeters?: number;
  isModelLoaded: boolean;
}

export class Transport3DModelLayer implements CustomLayerInterface {
  readonly id = TRANSPORT_3D_LAYER_ID;
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  private map: MapLibreMap | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.Camera | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private isSupported = false;

  // Active transform & state
  private currentMode: CanonicalTransportMode = 'car';
  private currentPosition: RoutePoint | null = null;
  private currentBearing = 0;
  private groundElevation = 0;
  private elevationDelta = 0;
  private distanceDeltaMeters = 0;
  private renderMode: TransportRenderMode = 'auto';

  // Loaded 3D models cache
  private modelCache = new Map<CanonicalTransportMode, THREE.Group>();
  private loadingModes = new Set<CanonicalTransportMode>();
  private activeModelGroup: THREE.Group | null = null;
  private fallbackVisibilityCallback?: (use2D: boolean) => void;

  constructor(options?: {
    renderMode?: TransportRenderMode;
    initialMode?: CanonicalTransportMode;
  }) {
    if (options?.renderMode) this.renderMode = options.renderMode;
    if (options?.initialMode) this.currentMode = options.initialMode;
  }

  /**
   * Called when layer is added to MapLibre.
   * Initializes Three.js WebGL renderer reusing MapLibre's canvas and GL context.
   */
  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext): void {
    this.map = map;

    if (typeof window === 'undefined' || !gl) {
      this.isSupported = false;
      return;
    }

    try {
      this.camera = new THREE.Camera();
      this.scene = new THREE.Scene();

      // Atmospheric ambient lighting
      const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
      this.scene.add(ambientLight);

      // Sun/key directional lighting from upper azimuth
      const sunLight = new THREE.DirectionalLight(0xfff7ed, 2.0);
      sunLight.position.set(50, -80, 100);
      this.scene.add(sunLight);

      // Soft ground-bounce fill light
      const fillLight = new THREE.DirectionalLight(0x38bdf8, 0.6);
      fillLight.position.set(-50, 80, -30);
      this.scene.add(fillLight);

      // Root model holder group
      this.activeModelGroup = new THREE.Group();
      this.scene.add(this.activeModelGroup);

      // Use MapLibre's canvas with autoClear disabled
      const canvas = typeof map.getCanvas === 'function' ? map.getCanvas() : null;
      if (canvas) {
        this.renderer = new THREE.WebGLRenderer({
          canvas,
          context: gl,
          antialias: true,
        });
        this.renderer.autoClear = false;
        this.isSupported = true;
      }

      // Preload initial model if available
      this.preloadModel(this.currentMode);
    } catch (err) {
      console.warn('Transport3DModelLayer: WebGL Three.js init fallback:', err);
      this.isSupported = false;
    }
  }

  /**
   * Preloads or loads the glTF/GLB model for a canonical mode.
   */
  async preloadModel(mode: CanonicalTransportMode): Promise<THREE.Group | null> {
    if (this.modelCache.has(mode)) {
      return this.modelCache.get(mode) ?? null;
    }

    // In-house procedural 3D model generator
    const procedural = createProceduralModel(mode);
    if (procedural) {
      this.modelCache.set(mode, procedural);
      if (this.currentMode === mode && this.activeModelGroup) {
        this.syncActiveModelGroup();
      }
      this.map?.triggerRepaint();
      return procedural;
    }

    const def = getModelDefinition(mode);
    if (!def.modelUrl || def.status !== 'registered' || typeof window === 'undefined') {
      return null;
    }

    if (this.loadingModes.has(mode)) return null;
    this.loadingModes.add(mode);

    try {
      const loader = new GLTFLoader();
      const gltf = await new Promise<any>((resolve, reject) => {
        loader.load(
          def.modelUrl!,
          resolve,
          undefined,
          reject
        );
      });

      const group = gltf.scene as THREE.Group;
      // Enable shadow and material clarity
      group.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        }
      });

      this.modelCache.set(mode, group);
      this.loadingModes.delete(mode);

      // If active mode matches, attach to scene
      if (this.currentMode === mode && this.activeModelGroup) {
        this.syncActiveModelGroup();
      }

      this.map?.triggerRepaint();
      return group;
    } catch (err) {
      console.warn(`Transport3DModelLayer: Failed to load 3D model for ${mode}:`, err);
      this.loadingModes.delete(mode);
      return null;
    }
  }

  /**
   * Synchronizes the active 3D model in the Three.js scene hierarchy.
   */
  private syncActiveModelGroup(): void {
    if (!this.activeModelGroup) return;

    // Clear existing children
    while (this.activeModelGroup.children.length > 0) {
      this.activeModelGroup.remove(this.activeModelGroup.children[0]);
    }

    const cached = this.modelCache.get(this.currentMode);
    const shouldUse3D = this.shouldRender3D();

    if (cached && shouldUse3D) {
      this.activeModelGroup.add(cached);
      this.activeModelGroup.visible = true;
      this.set2DIconVisibility(false);
    } else {
      this.activeModelGroup.visible = false;
      this.set2DIconVisibility(true);
    }
  }

  /**
   * Determines if 3D model should be displayed right now.
   */
  shouldRender3D(): boolean {
    if (this.renderMode === '2d-icon') return false;
    if (!has3DModelAsset(this.currentMode)) return false;
    return this.modelCache.has(this.currentMode);
  }

  /**
   * Toggles visibility of 2D MapLibre symbol/halo/pulse layers.
   */
  private set2DIconVisibility(visible: boolean): void {
    if (!this.map || typeof this.map.getLayer !== 'function') return;

    const val = visible ? 'visible' : 'none';
    try {
      if (this.map.getLayer(TRANSPORT_SYMBOL_LAYER_ID)) {
        this.map.setLayoutProperty(TRANSPORT_SYMBOL_LAYER_ID, 'visibility', val);
      }
      if (this.map.getLayer(TRANSPORT_HALO_LAYER_ID)) {
        this.map.setLayoutProperty(TRANSPORT_HALO_LAYER_ID, 'visibility', val);
      }
      if (this.map.getLayer(TRANSPORT_PULSE_LAYER_ID)) {
        this.map.setLayoutProperty(TRANSPORT_PULSE_LAYER_ID, 'visibility', val);
      }
    } catch {
      // Ignore during style transitions
    }
    this.fallbackVisibilityCallback?.(visible);
  }

  /**
   * Updates position, bearing, and active mode on every timeline evaluation.
   */
  updatePose(
    position: RoutePoint | null,
    bearing: number,
    mode: CanonicalTransportMode,
    options: {
      groundElevation?: number;
      elevationDelta?: number;
      distanceDeltaMeters?: number;
    } = {}
  ): void {
    const modeChanged = this.currentMode !== mode;
    this.currentPosition = position;
    this.currentBearing = bearing;
    this.currentMode = mode;
    this.groundElevation = options.groundElevation ?? 0;
    this.elevationDelta = options.elevationDelta ?? 0;
    this.distanceDeltaMeters = options.distanceDeltaMeters ?? 0;

    if (modeChanged) {
      if (!this.modelCache.has(mode)) {
        this.preloadModel(mode);
      }
      this.syncActiveModelGroup();
    }
  }

  /**
   * Sets the user-selected render mode ('auto', '3d-model', '2d-icon').
   */
  setRenderMode(mode: TransportRenderMode): void {
    this.renderMode = mode;
    this.syncActiveModelGroup();
    this.map?.triggerRepaint();
  }

  getRenderMode(): TransportRenderMode {
    return this.renderMode;
  }

  getCurrentMode(): CanonicalTransportMode {
    return this.currentMode;
  }

  isModelCached(mode: CanonicalTransportMode): boolean {
    return this.modelCache.has(mode);
  }

  /**
   * CustomLayerInterface render pass.
   * Transforms Three.js camera matrix with MapLibre's Mercator matrix
   * and renders the 3D model directly into the WebGL context.
   */
  render(_gl: WebGL2RenderingContext, input: unknown): void {
    if (!this.isSupported || !this.renderer || !this.scene || !this.camera) {
      return;
    }

    if (!this.currentPosition || !this.shouldRender3D()) {
      return;
    }

    // Extract 16-element Float64Array or Float32Array from MapLibre
    const rawMatrix = extractMapLibreProjectionMatrix(input);
    if (!rawMatrix) return;

    // Evaluate deterministic 3D pose in Mercator space
    const pose = calculateTransportPose3D(
      this.currentPosition,
      this.currentBearing,
      this.currentMode,
      {
        groundElevation: this.groundElevation,
        elevationDelta: this.elevationDelta,
        distanceDeltaMeters: this.distanceDeltaMeters,
      }
    );

    // Compute model transformation matrix: translation * scale * rotX * rotY * rotZ
    const rotX = new THREE.Matrix4().makeRotationAxis(
      new THREE.Vector3(1, 0, 0),
      pose.rotationX
    );
    const rotY = new THREE.Matrix4().makeRotationAxis(
      new THREE.Vector3(0, 1, 0),
      pose.rotationY
    );
    const rotZ = new THREE.Matrix4().makeRotationAxis(
      new THREE.Vector3(0, 0, 1),
      pose.rotationZ
    );

    // Note: MapLibre Y goes South (+Y downwards), hence -mercatorScale on Y
    const modelTransform = new THREE.Matrix4()
      .makeTranslation(pose.mercatorX, pose.mercatorY, pose.mercatorZ)
      .scale(new THREE.Vector3(pose.mercatorScale, -pose.mercatorScale, pose.mercatorScale))
      .multiply(rotX)
      .multiply(rotY)
      .multiply(rotZ);

    // High-precision projection matrix combination
    const m = new THREE.Matrix4().fromArray(rawMatrix);
    this.camera.projectionMatrix = m.multiply(modelTransform);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();

    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Cleanup on layer removal.
   */
  onRemove(): void {
    if (this.renderer) {
      try {
        this.renderer.dispose();
      } catch {
        // Ignore
      }
      this.renderer = null;
    }
    this.scene = null;
    this.camera = null;
    this.map = null;
  }
}

/**
 * Extracts the 16-number matrix from MapLibre v6 or legacy CustomRenderMethod inputs.
 */
export function extractMapLibreProjectionMatrix(
  input: unknown
): Float64Array | Float32Array | number[] | null {
  if (!input) return null;
  if (Array.isArray(input) || input instanceof Float64Array || input instanceof Float32Array) {
    return input;
  }
  if (typeof input === 'object') {
    const obj = input as any;
    if (obj.defaultProjectionData?.mainMatrix) {
      return obj.defaultProjectionData.mainMatrix;
    }
    if (obj.modelViewProjectionMatrix) {
      return obj.modelViewProjectionMatrix;
    }
    if (obj.mainMatrix) {
      return obj.mainMatrix;
    }
  }
  return null;
}

/**
 * Backwards compatibility delegate for createProceduralCar().
 */
export function createProceduralCarGroup(): THREE.Group {
  return createProceduralCar();
}

