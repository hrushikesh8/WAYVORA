import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Map as MapLibreMap, Marker, setWorkerUrl } from 'maplibre-gl';
import maplibreglWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';

// Ensure MapLibre GL worker resolves cleanly in Vite dev server and production builds
setWorkerUrl(maplibreglWorkerUrl);
import {
  journeyFromWaypoints,
  getAllPoints,
  createStop,
  createSegment,
  addStopToJourney,
  addSegmentToJourney,
  createRoutePoint,
} from './domain/journey';
import { evaluateTimeline, getEffectiveDuration } from './domain/timeline';
import { deserializeProject, downloadProject } from './domain/serialization';
import { saveProjectToStorage, loadProjectFromStorage } from './domain/storage';
import { totalDistance, computeBounds } from './domain/geo';
import type { Journey, TransportMode, CameraMode, CameraKeyframe, TransitionType, TitleCardMotion, StoryTitleCards } from './domain/types';
import { parseGpx, appendGpxToJourney, type GpxParseResult } from './domain/gpx';
import {
  insertRoutePoint,
  moveRoutePoint,
  deleteRoutePoint,
  updateStop,
  deleteStop,
  updateSegmentMode,
  applyRouteToSegment,
  createEditorHistory,
  pushEditorHistory,
  undoEditorHistory,
  redoEditorHistory,
  canUndo,
  canRedo,
  getSegmentEditAudit,
  addStoryScene,
  updateStoryScene,
  deleteStoryScene,
  attachMediaToScene,
  attachMediaToStop,
  addAudioClip,
  updateAudioClip,
  deleteAudioClip,
  setAudioTrackVolume,
  setMasterAudioVolume,
  appendPlaceToJourney,
  reorderStoryScenes,
  updateTitleCards,
  updateAudioDucking,
  alignClipToScene,
  addMediaToLibrary,
  removeMediaFromLibrary,
  assignMediaToScene,
  removeMediaFromScene,
  addMediaToAudioTrack,
  type EditorHistory,
} from './domain/editor';
import { PlaceSearch } from './components/PlaceSearch';
import { MediaLibraryPanel } from './components/MediaLibraryPanel';
import { MediaPreviewModal } from './components/MediaPreviewModal';
import {
  type MediaAsset,
  importMediaFile,
  reviveMediaUrls,
  deleteMediaBlob,
} from './domain/media';
import type { GeocodeResult } from './domain/geocoding';
import {
  type AudioClip,
  type AudioDuckingSettings,
  synthesizeAudioTone,
  pcmToWavBlob,
  evaluateAudioTimelineAtTime,
  DEFAULT_DUCKING_SETTINGS,
} from './domain/audio';
import {
  type StoryScene,
  type SceneIntent,
  createMediaAsset,
  parseJpegExif,
  generateDefaultStoryScenes,
  generateDefaultTitleCards,
} from './domain/story';
import {
  OsrmRoutingProvider,
  MockRoutingProvider,
  type RouteResult,
  type RoutingProfile,
} from './domain/routing';
import { auditJourneyDiagnostics } from './domain/diagnostics';
import {
  evaluateCameraClearance,
  evaluateCameraAtTime,
  calculateCameraEyePosition,
  generateAutoCamKeyframes,
  type CameraClearanceResult,
} from './domain/camera';
import {
  exportJourneyVideo,
  downloadExportBlob,
  compositeRenderFrame,
  evaluateRenderFrame,
  isWebCodecsSupported,
  isSupportedVideoFormat,
  synchronizeVideoElement,
  type ExportJobConfig,
  type ExportProgress,
  type ExportResult,
  type ColorGradePreset,
} from './domain/render';
import {
  JOURNEY_TEMPLATES,
  applyJourneyTemplate,
  type JourneyTemplateId,
} from './domain/templates';
import {
  MAP_STYLES,
  MAP_STYLE_IDS,
  DEFAULT_MAP_STYLE_ID,
  type MapStyleId,
  getFullExportAttribution,
  attachJourneyMapLayers,
  syncRouteSourceData,
  syncSegmentPointsData,
  syncTransportSourceData,
  configureMapTerrain,
} from './domain/map';
import {
  getTransportSvg,
  resolveCanonicalTransportMode,
  TRANSPORT_MODE_METADATA,
  CANONICAL_TRANSPORT_MODES,
  Transport3DModelLayer,
  type TransportRenderMode,
  has3DModelAsset,
  getModelDefinition,
} from './domain/transport';
import { MIXED_JOURNEY_WAYPOINTS, SF_TO_LA_WAYPOINTS } from './__tests__/fixtures';

// Additional sample journey: Pacific Crest High Sierra Trail
const SIERRA_TRAIL_WAYPOINTS = [
  { name: 'Lone Pine Base', lng: -118.0629, lat: 36.6062, ele: 1136, mode: 'car' as TransportMode },
  { name: 'Whitney Portal Trailhead', lng: -118.2389, lat: 36.5869, ele: 2550, mode: 'car' as TransportMode },
  { name: 'Lone Pine Lake', lng: -118.2580, lat: 36.5775, ele: 3030, mode: 'hike' as TransportMode },
  { name: 'Outpost Camp', lng: -118.2710, lat: 36.5689, ele: 3158, mode: 'hike' as TransportMode },
  { name: 'Trail Camp', lng: -118.2868, lat: 36.5604, ele: 3669, mode: 'hike' as TransportMode },
  { name: 'Mount Whitney Summit', lng: -118.2923, lat: 36.5785, ele: 4421, mode: 'hike' as TransportMode },
];


// Synthetic Road-to-Trail Acceptance Route (Clearly labelled demonstration fixture)
const SYNTHETIC_ROAD_TO_TRAIL_WAYPOINTS = [
  { name: 'Valley Gateway (Car Start)', lng: 7.9000, lat: 46.6000, ele: 795, mode: 'car' as TransportMode },
  { name: 'Lower Meadow Drive', lng: 7.9150, lat: 46.5920, ele: 840, mode: 'car' as TransportMode },
  { name: 'River Crossing Bridge', lng: 7.9280, lat: 46.5810, ele: 890, mode: 'car' as TransportMode },
  { name: 'Stechelberg Trailhead (Rest/Transition)', lng: 7.9350, lat: 46.5700, ele: 915, mode: 'car' as TransportMode },
  { name: 'Forest Switchback 1', lng: 7.9380, lat: 46.5680, ele: 1040, mode: 'hike' as TransportMode },
  { name: 'Pine Ridge Trail', lng: 7.9420, lat: 46.5650, ele: 1180, mode: 'hike' as TransportMode },
  { name: 'Waterfall Viewpoint', lng: 7.9450, lat: 46.5620, ele: 1320, mode: 'hike' as TransportMode },
  { name: 'Tree Line Clearing', lng: 7.9490, lat: 46.5590, ele: 1475, mode: 'hike' as TransportMode },
  { name: 'Alpine Scree Field', lng: 7.9530, lat: 46.5560, ele: 1650, mode: 'hike' as TransportMode },
  { name: 'High Col Pass', lng: 7.9620, lat: 46.5500, ele: 1980, mode: 'hike' as TransportMode },
  { name: 'Mountain Hut Summit', lng: 7.9700, lat: 46.5450, ele: 2240, mode: 'hike' as TransportMode },
];

const PRESET_JOURNEYS = [
  { id: 'alps', title: 'Swiss Alps: Road to Ridge (Mixed)', data: MIXED_JOURNEY_WAYPOINTS },
  { id: 'acceptance', title: 'Synthetic Road-to-Trail (Acceptance Fixture)', data: SYNTHETIC_ROAD_TO_TRAIL_WAYPOINTS },
  { id: 'california', title: 'California Roadtrip (SF to LA)', data: SF_TO_LA_WAYPOINTS },
  { id: 'sierra', title: 'Mt. Whitney Alpine Ascent (Trail)', data: SIERRA_TRAIL_WAYPOINTS },
];

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function App() {
  const [selectedPreset, setSelectedPreset] = useState('alps');
  const [journey, setJourney] = useState<Journey>(() => {
    const stored = loadProjectFromStorage();
    if (stored) return stored;
    return journeyFromWaypoints('Swiss Alps Epic: Road to Ridge', MIXED_JOURNEY_WAYPOINTS);
  });
  
  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  // Camera & Visual Director State
  const [cameraMode, setCameraMode] = useState<CameraMode>('overview');
  const [mapPitch, setMapPitch] = useState(45);
  const [mapZoom, setMapZoom] = useState(11);
  const [activeTab, setActiveTab] = useState<'stops' | 'segments' | 'story' | 'audio' | 'media' | 'stats' | 'export'>('stops');
  const [notification, setNotification] = useState<string | null>(null);

  // Media Library State
  const [selectedMediaForPreview, setSelectedMediaForPreview] = useState<MediaAsset | null>(null);
  const [isImportingMedia, setIsImportingMedia] = useState(false);
  const [mediaImportMessage, setMediaImportMessage] = useState<string | null>(null);

  // Audio Timeline State & Refs
  const audioFileInputRef = useRef<HTMLInputElement>(null);
  const targetTrackIdForAudio = useRef<string | null>(null);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const [previewingClipId, setPreviewingClipId] = useState<string | null>(null);
  const activeAudioPlayersRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const currentAudioState = useMemo(() => {
    return evaluateAudioTimelineAtTime(journey.audio, currentTime);
  }, [journey.audio, currentTime]);

  // Video Export State
  const [selectedExportProfileIndex, setSelectedExportProfileIndex] = useState(0);
  const [exportFps, setExportFps] = useState(30);
  const [exportColorGrade, setExportColorGrade] = useState<ColorGradePreset>('golden-hour');
  const [exportVignette, setExportVignette] = useState<boolean>(true);
  const [exportSafeGuides, setExportSafeGuides] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const exportAbortControllerRef = useRef<AbortController | null>(null);

  // GPX Import State
  const [gpxResult, setGpxResult] = useState<GpxParseResult | null>(null);
  const [isGpxModalOpen, setIsGpxModalOpen] = useState(false);
  const gpxFileInputRef = useRef<HTMLInputElement>(null);

  // Route Editing & Undo/Redo State
  const [editorHistory, setEditorHistory] = useState<EditorHistory>(() =>
    createEditorHistory(journey)
  );
  const [isSaved, setIsSaved] = useState(true);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const [stopDwellEnabled, setStopDwellEnabled] = useState(true);

  // Road Routing State
  const [routingProfile, setRoutingProfile] = useState<RoutingProfile>('driving');
  const [routingStatus, setRoutingStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [pendingRoute, setPendingRoute] = useState<{ segmentId: string; result: RouteResult } | null>(null);
  const [routingError, setRoutingError] = useState<string | null>(null);

  // Map Style & 3D Terrain State
  const [currentMapStyle, setCurrentMapStyle] = useState<MapStyleId>(DEFAULT_MAP_STYLE_ID);
  const [isTerrain3dEnabled, setIsTerrain3dEnabled] = useState(true);
  const [terrainExaggeration, setTerrainExaggeration] = useState(1.2);
  const [terrainStatus, setTerrainStatus] = useState<'ready' | 'fallback' | 'disabled'>('ready');

  // 3D Transport Model State
  const [transportRenderMode, setTransportRenderMode] = useState<TransportRenderMode>('auto');
  const transportRenderModeRef = useRef<TransportRenderMode>(transportRenderMode);
  transportRenderModeRef.current = transportRenderMode;
  const transport3dLayerRef = useRef<Transport3DModelLayer | null>(null);
  if (!transport3dLayerRef.current && typeof window !== 'undefined') {
    transport3dLayerRef.current = new Transport3DModelLayer({ renderMode: transportRenderMode });
  }

  // Mutable refs keeping map event handlers synchronized with latest React state
  const currentMapStyleRef = useRef<MapStyleId>(DEFAULT_MAP_STYLE_ID);
  const isTerrain3dEnabledRef = useRef<boolean>(isTerrain3dEnabled);
  const terrainExaggerationRef = useRef<number>(terrainExaggeration);
  const journeyRef = useRef<Journey>(journey);
  const selectedSegmentIdRef = useRef<string | null>(selectedSegmentId);
  const selectedPointIndexRef = useRef<number | null>(selectedPointIndex);

  currentMapStyleRef.current = currentMapStyle;
  isTerrain3dEnabledRef.current = isTerrain3dEnabled;
  terrainExaggerationRef.current = terrainExaggeration;
  journeyRef.current = journey;
  selectedSegmentIdRef.current = selectedSegmentId;
  selectedPointIndexRef.current = selectedPointIndex;

  // Cinematic Camera & Keyframe State
  const [isKeyframeTrackActive, setIsKeyframeTrackActive] = useState<boolean>(() => {
    return (journey.timeline.keyframes && journey.timeline.keyframes.length > 0) ? true : false;
  });
  const [cameraKeyframes, setCameraKeyframes] = useState<CameraKeyframe[]>(() => journey.timeline.keyframes ?? []);
  const [liveClearance, setLiveClearance] = useState<CameraClearanceResult | null>(null);

  // Story & Media Upload State
  const sceneMediaInputRef = useRef<HTMLInputElement>(null);
  const targetSceneIdForMedia = useRef<string | null>(null);
  const stopMediaInputRef = useRef<HTMLInputElement>(null);
  const targetStopIdForMedia = useRef<string | null>(null);

  // MapLibre references
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastTimestampRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Place Search & Waypoint Integration State
  const [selectedPlace, setSelectedPlace] = useState<GeocodeResult | null>(null);
  const selectedPlaceRef = useRef<GeocodeResult | null>(null);
  selectedPlaceRef.current = selectedPlace;
  const searchMarkerRef = useRef<Marker | null>(null);

  // Derived metrics
  const allPoints = useMemo(() => getAllPoints(journey), [journey]);
  const journeyTotalDistance = useMemo(() => totalDistance(allPoints), [allPoints]);
  const diagnosticsReport = useMemo(() => auditJourneyDiagnostics(journey), [journey]);

  const activeJourney = useMemo(
    () => ({
      ...journey,
      timeline: { ...journey.timeline, stopDwell: stopDwellEnabled },
    }),
    [journey, stopDwellEnabled]
  );

  const effectiveDuration = useMemo(
    () => (stopDwellEnabled ? getEffectiveDuration(activeJourney) : journey.timeline.duration),
    [activeJourney, stopDwellEnabled, journey.timeline.duration]
  );

  const currentFrame = useMemo(
    () => evaluateTimeline(activeJourney, currentTime, { stopDwell: stopDwellEnabled }),
    [activeJourney, currentTime, stopDwellEnabled]
  );
  const currentFrameRef = useRef(currentFrame);
  currentFrameRef.current = currentFrame;

  const showNotification = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3500);
  };

  // Atomic debounced auto-save to browser storage
  useEffect(() => {
    const timer = setTimeout(() => {
      saveProjectToStorage(journey);
    }, 1200);
    return () => clearTimeout(timer);
  }, [journey]);

  // Hydrate local-first media ObjectURLs on startup
  useEffect(() => {
    reviveMediaUrls(journey).then((revived) => {
      setJourney(revived);
    });
  }, []);

  // Switch presets
  const handleSelectPreset = (presetId: string) => {
    setSelectedPreset(presetId);
    const preset = PRESET_JOURNEYS.find(p => p.id === presetId);
    if (!preset) return;
    const newJourney = journeyFromWaypoints(preset.title, preset.data);
    setJourney(newJourney);
    setEditorHistory(createEditorHistory(newJourney));
    setIsSaved(true);
    setSelectedSegmentId(null);
    setSelectedPointIndex(null);
    setCurrentTime(0);
    setIsPlaying(false);
    showNotification(`Loaded preset: ${preset.title}`);
  };


  // Switch Map Basemap Style
  const handleStyleChange = (newStyleId: MapStyleId) => {
    setCurrentMapStyle(newStyleId);
    currentMapStyleRef.current = newStyleId;
    const map = mapInstanceRef.current;
    if (!map) return;
    const styleDef = MAP_STYLES[newStyleId];
    if (!styleDef) return;

    try {
      map.setStyle(styleDef.styleUrlOrSpec as any, { diff: false });
      showNotification(`Map style: ${styleDef.name}`);
    } catch (err) {
      console.warn('Failed to switch map style, falling back to cinematic:', err);
      showNotification(`Failed to load style: ${styleDef.name}`);
      map.setStyle(MAP_STYLES.cinematic.styleUrlOrSpec as any, { diff: false });
      setCurrentMapStyle('cinematic');
      currentMapStyleRef.current = 'cinematic';
    }
  };

  // Initialize MapLibre
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const initialStyleDef = MAP_STYLES[currentMapStyleRef.current] || MAP_STYLES.cinematic;
    const map = new MapLibreMap({
      container: mapContainerRef.current,
      style: initialStyleDef.styleUrlOrSpec as any,
      center: [allPoints[0]?.lng ?? 8.5417, allPoints[0]?.lat ?? 47.3769],
      zoom: 10,
      pitch: 45,
      bearing: 0,
      preserveDrawingBuffer: true,
    } as any);

    mapInstanceRef.current = map;

    map.on('error', (e) => {
      // Gracefully handle or log map tile issues
      if (e.error && !e.error.message?.includes('abort')) {
        console.warn('MapLibre style/tile warning:', e.error.message);
      }
    });

    // Create custom vehicle/marker element
    const initialMode = journeyRef.current.segments[0]?.transportMode ?? 'car';
    const canonical = resolveCanonicalTransportMode(initialMode);
    const el = document.createElement('div');
    el.className = 'wayvora-marker';
    el.dataset.mode = canonical;
    el.innerHTML = getTransportSvg(canonical, { size: 38 });
    const marker = new Marker({ element: el })
      .setLngLat([allPoints[0]?.lng ?? 0, allPoints[0]?.lat ?? 0])
      .addTo(map);
    markerRef.current = marker;

    // Map-level resilient click listener for segment vertices
    map.on('click', (e) => {
      try {
        if (!map.getLayer('segment-points-layer')) return;
        const features = map.queryRenderedFeatures(e.point, { layers: ['segment-points-layer'] });
        if (features && features.length > 0) {
          const ptIdx = features[0].properties?.pointIndex;
          if (typeof ptIdx === 'number') {
            setSelectedPointIndex(ptIdx);
          }
        }
      } catch {
        // Ignore
      }
    });

    map.on('mousemove', (e) => {
      try {
        if (!map.getLayer('segment-points-layer')) return;
        const features = map.queryRenderedFeatures(e.point, { layers: ['segment-points-layer'] });
        map.getCanvas().style.cursor = features && features.length > 0 ? 'pointer' : '';
      } catch {
        // Ignore
      }
    });

    // Re-attach persistent layers whenever a style loads (both initial and on style switch)
    map.on('style.load', () => {
      const activeStyle = MAP_STYLES[currentMapStyleRef.current] || MAP_STYLES.cinematic;
      attachJourneyMapLayers(map, journeyRef.current, {
        terrainEnabled: isTerrain3dEnabledRef.current,
        terrainExaggeration: terrainExaggerationRef.current,
        supportsHillshade: activeStyle.supportsHillshade,
        selectedSegmentId: selectedSegmentIdRef.current,
        selectedPointIndex: selectedPointIndexRef.current,
        currentPosition: currentFrameRef.current?.position,
        currentBearing: currentFrameRef.current?.bearing ?? 0,
        currentMode: currentFrameRef.current?.activeTransportMode ?? 'car',
        modelLayer: transport3dLayerRef.current,
        transportRenderMode: transportRenderModeRef.current,
      });

      // Re-attach active place search marker across map style switches
      if (selectedPlaceRef.current) {
        const p = selectedPlaceRef.current;
        if (searchMarkerRef.current) searchMarkerRef.current.remove();
        const pinEl = document.createElement('div');
        pinEl.className = 'wayvora-search-pin';
        pinEl.innerHTML = `
          <div style="position: relative; display: flex; align-items: center; justify-content: center; cursor: pointer;">
            <div style="position: absolute; width: 34px; height: 34px; border-radius: 50%; background: rgba(0, 242, 254, 0.35); animation: ping 1.8s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
            <div style="position: relative; width: 20px; height: 20px; border-radius: 50%; background: #00f2fe; border: 2.5px solid #ffffff; box-shadow: 0 0 16px #00f2fe, 0 4px 8px rgba(0,0,0,0.6);"></div>
          </div>
        `;
        searchMarkerRef.current = new Marker({ element: pinEl, anchor: 'center' })
          .setLngLat([p.lng, p.lat])
          .addTo(map);
      }

      fitMapToBounds(map, getAllPoints(journeyRef.current));
    });

    return () => {
      if (searchMarkerRef.current) {
        searchMarkerRef.current.remove();
        searchMarkerRef.current = null;
      }
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Synchronize 3D Terrain and exaggeration
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !map.isStyleLoaded()) return;

    try {
      const style = MAP_STYLES[currentMapStyle] || MAP_STYLES.cinematic;
      configureMapTerrain(map, isTerrain3dEnabled, terrainExaggeration, {
        supportsHillshade: style.supportsHillshade,
      });
      setTerrainStatus(isTerrain3dEnabled ? 'ready' : 'disabled');
    } catch (err: unknown) {
      console.warn('MapLibre terrain update error, falling back to 2D:', err);
      setTerrainStatus('fallback');
    }
  }, [isTerrain3dEnabled, terrainExaggeration, currentMapStyle]);

  // Update Route geometry when journey changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !map.isStyleLoaded()) return;

    syncRouteSourceData(map, allPoints);
    fitMapToBounds(map, allPoints);
  }, [allPoints]);

  const fitMapToBounds = (map: MapLibreMap, points: typeof allPoints) => {
    const bounds = computeBounds(points);
    if (!bounds) return;
    map.fitBounds(
      [
        [bounds.minLng, bounds.minLat],
        [bounds.maxLng, bounds.maxLat],
      ],
      { padding: 80, duration: 1200, pitch: mapPitch }
    );
  };

  // ── Place Search & Waypoint Integration Handlers ──
  const handleSelectPlace = useCallback((place: GeocodeResult) => {
    setSelectedPlace(place);
    const map = mapInstanceRef.current;
    if (!map) return;

    if (searchMarkerRef.current) {
      searchMarkerRef.current.remove();
      searchMarkerRef.current = null;
    }

    const pinEl = document.createElement('div');
    pinEl.className = 'wayvora-search-pin';
    pinEl.innerHTML = `
      <div style="position: relative; display: flex; align-items: center; justify-content: center; cursor: pointer;">
        <div style="position: absolute; width: 34px; height: 34px; border-radius: 50%; background: rgba(0, 242, 254, 0.35); animation: ping 1.8s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
        <div style="position: relative; width: 20px; height: 20px; border-radius: 50%; background: #00f2fe; border: 2.5px solid #ffffff; box-shadow: 0 0 16px #00f2fe, 0 4px 8px rgba(0,0,0,0.6);"></div>
      </div>
    `;

    searchMarkerRef.current = new Marker({ element: pinEl, anchor: 'center' })
      .setLngLat([place.lng, place.lat])
      .addTo(map);

    map.flyTo({
      center: [place.lng, place.lat],
      zoom: Math.max(map.getZoom(), 11),
      speed: 1.2,
      curve: 1.4,
      essential: true,
    });
  }, []);

  const handleAddPlaceToJourney = useCallback((place: GeocodeResult) => {
    const next = appendPlaceToJourney(journeyRef.current, {
      name: place.name,
      lng: place.lng,
      lat: place.lat,
    });

    setEditorHistory((prev) => pushEditorHistory(prev, next.journey));
    setJourney(next.journey);

    const map = mapInstanceRef.current;
    if (map && map.isStyleLoaded()) {
      syncRouteSourceData(map, getAllPoints(next.journey));
      const activeSeg = next.journey.segments.find((s) => s.id === selectedSegmentIdRef.current) ?? null;
      syncSegmentPointsData(map, activeSeg, selectedPointIndexRef.current);
    }
  }, []);

  const handleClearSearchSelection = useCallback(() => {
    setSelectedPlace(null);
    if (searchMarkerRef.current) {
      searchMarkerRef.current.remove();
      searchMarkerRef.current = null;
    }
  }, []);

  // Sync editable segment vertices on map
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const seg = journey.segments.find((s) => s.id === selectedSegmentId) ?? null;
    syncSegmentPointsData(map, seg, selectedPointIndex);
  }, [selectedSegmentId, selectedPointIndex, journey]);

  // Sync Marker & Camera on frame update
  useEffect(() => {
    if (!currentFrame.position) return;
    const { position, bearing } = currentFrame;
    const activeMode = currentFrame.activeTransportMode || 'car';
    const canonical = resolveCanonicalTransportMode(activeMode);
    const is3DActive = transport3dLayerRef.current?.shouldRender3D() ?? false;

    const map = mapInstanceRef.current;
    if (map && map.isStyleLoaded()) {
      syncTransportSourceData(map, position, bearing, activeMode, {
        modelLayer: transport3dLayerRef.current,
        groundElevation: position.ele ?? 0,
        renderMode: transportRenderMode,
      });
    }

    if (markerRef.current) {
      markerRef.current.setLngLat([position.lng, position.lat]);
      const markerEl = markerRef.current.getElement();
      if (markerEl) {
        markerEl.style.transform = `rotate(${bearing}deg)`;
        markerEl.style.opacity = is3DActive ? '0' : '1';
        markerEl.style.pointerEvents = is3DActive ? 'none' : 'auto';
        if (markerEl.dataset.mode !== canonical) {
          markerEl.dataset.mode = canonical;
          markerEl.innerHTML = getTransportSvg(canonical, { size: 38 });
        }
      }
    }

    if (!map) return;
    // Calculate 3D camera eye coordinate
    const eyeCalc = calculateCameraEyePosition(position, bearing, mapPitch, mapZoom);
    let groundEleAtCam = position.ele ?? 0;
    if (map.queryTerrainElevation) {
      try {
        const qEle = map.queryTerrainElevation([eyeCalc.cameraEye.lng, eyeCalc.cameraEye.lat]);
        if (typeof qEle === 'number' && Number.isFinite(qEle)) {
          groundEleAtCam = qEle;
        }
      } catch {
        // Fallback cleanly
      }
    }

    if (isKeyframeTrackActive && cameraKeyframes.length > 0) {
      // Deterministic keyframe track interpolation
      const camState = evaluateCameraAtTime(
        cameraKeyframes,
        currentFrame.time,
        position,
        bearing,
        cameraMode,
        groundEleAtCam
      );

      setLiveClearance({
        targetElevation: position.ele ?? 0,
        groundElevationAtCamera: camState.groundElevationAtCamera,
        calculatedCameraAltitude: camState.calculatedCameraAltitude,
        effectiveCameraAltitude: camState.effectiveCameraAltitude,
        clearanceMetres: camState.clearanceMetres,
        clampedPitch: camState.clampedPitch,
        isClippingAverted: camState.isClippingAverted,
      });

      map.easeTo({
        center: [camState.center.lng, camState.center.lat],
        bearing: camState.bearing,
        pitch: camState.pitch,
        zoom: camState.zoom,
        duration: 80,
      });
    } else {
      // Manual route-following camera with terrain clearance
      const clearance = evaluateCameraClearance(
        position,
        cameraMode,
        mapPitch,
        mapZoom,
        groundEleAtCam
      );
      const effectivePitch = clearance.isClippingAverted ? clearance.clampedPitch : mapPitch;
      setLiveClearance(clearance);

      if (cameraMode === 'chase') {
        map.easeTo({
          center: [position.lng, position.lat],
          bearing: bearing,
          pitch: effectivePitch,
          zoom: mapZoom,
          duration: 80,
        });
      } else if (cameraMode === 'ground') {
        map.easeTo({
          center: [position.lng, position.lat],
          bearing: bearing,
          pitch: Math.max(60, effectivePitch),
          zoom: Math.max(14, mapZoom),
          duration: 80,
        });
      } else if (cameraMode === 'flyover') {
        map.easeTo({
          center: [position.lng, position.lat],
          bearing: bearing,
          pitch: Math.max(50, effectivePitch),
          zoom: mapZoom,
          duration: 80,
        });
      } else if (cameraMode === 'orbit') {
        const orbitBearing = (bearing + (currentFrame.time * 20)) % 360;
        map.easeTo({
          center: [position.lng, position.lat],
          bearing: orbitBearing,
          pitch: effectivePitch,
          zoom: mapZoom,
          duration: 80,
        });
      }
    }
  }, [currentFrame, cameraMode, mapPitch, mapZoom, isKeyframeTrackActive, cameraKeyframes]);

  // Animation Loop
  useEffect(() => {
    if (!isPlaying) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      lastTimestampRef.current = null;
      return;
    }

    const loop = (timestamp: number) => {
      if (lastTimestampRef.current === null) {
        lastTimestampRef.current = timestamp;
      }
      const deltaSeconds = (timestamp - lastTimestampRef.current) / 1000;
      lastTimestampRef.current = timestamp;

      setCurrentTime((prev) => {
        const next = prev + deltaSeconds * playbackSpeed;
        if (next >= effectiveDuration) {
          setIsPlaying(false);
          return effectiveDuration;
        }
        return next;
      });

      animationFrameRef.current = requestAnimationFrame(loop);
    };

    animationFrameRef.current = requestAnimationFrame(loop);

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isPlaying, playbackSpeed, effectiveDuration]);

  // Synchronized multi-track in-browser audio playback with ducking
  useEffect(() => {
    const players = activeAudioPlayersRef.current;

    if (!isPlaying) {
      players.forEach((audio: HTMLAudioElement) => {
        if (!audio.paused) audio.pause();
      });
      return;
    }

    const evalAudio = evaluateAudioTimelineAtTime(journey.audio, currentTime);
    const activeClipIds = new Set(evalAudio.activeClips.map((c) => c.clip.id));

    // Pause audio elements for clips that are no longer active
    players.forEach((audio: HTMLAudioElement, clipId: string) => {
      if (!activeClipIds.has(clipId)) {
        if (!audio.paused) audio.pause();
      }
    });

    // Synchronize and play active clips
    evalAudio.activeClips.forEach(({ clip, currentGain, sourceOffsetSeconds }) => {
      let audio = players.get(clip.id);
      if (!audio) {
        audio = new Audio(clip.assetUrl);
        players.set(clip.id, audio);
      }

      audio.volume = Math.max(0, Math.min(1.0, currentGain));

      // Correct clock drift greater than 0.35s
      if (Math.abs(audio.currentTime - sourceOffsetSeconds) > 0.35) {
        audio.currentTime = Math.max(0, sourceOffsetSeconds);
      }

      if (audio.paused && currentGain > 0.001) {
        audio.play().catch(() => {});
      }
    });
  }, [isPlaying, currentTime, journey.audio]);

  // Clean up audio players on unmount
  useEffect(() => {
    return () => {
      activeAudioPlayersRef.current.forEach((audio: HTMLAudioElement) => {
        audio.pause();
      });
      activeAudioPlayersRef.current.clear();
    };
  }, []);

  // Timeline scrub handler
  const handleTimelineScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    setCurrentTime(ratio * effectiveDuration);
  };


  // Add waypoint modal / prompt
  const handleAddStop = () => {
    const name = prompt('Enter stop name (e.g. Alpine Vista):');
    if (!name) return;
    const lastStop = journey.stops[journey.stops.length - 1];
    const prevPt = lastStop ? lastStop.position : { lng: 8.0, lat: 46.6 };
    // Offset slightly
    const newPt = createRoutePoint(prevPt.lng + 0.02, prevPt.lat + 0.015, (prevPt.ele ?? 500) + 120);
    const newStop = createStop(name, newPt, journey.segments.length, 'waypoint');
    const newSeg = createSegment('trail', 'hike', [prevPt, newPt], 'manual');

    let updated = addSegmentToJourney(journey, newSeg);
    updated = addStopToJourney(updated, newStop);
    applyJourneyEdit(updated, `Added stop: ${name}`);
  };

  // Cinematic Camera Keyframe Actions
  const handleGenerateAutoCam = () => {
    const generated = generateAutoCamKeyframes(journey);
    setCameraKeyframes(generated);
    setIsKeyframeTrackActive(true);
    const updated = {
      ...journey,
      timeline: {
        ...journey.timeline,
        keyframes: generated,
      },
    };
    applyJourneyEdit(updated, `Generated ${generated.length} Cinematic Keyframes (AutoCam)`);
  };

  const handleAddKeyframeAtCurrentTime = () => {
    const newKf: CameraKeyframe = {
      id: `cam-kf-${Date.now()}`,
      time: Math.round(currentTime * 10) / 10,
      mode: cameraMode,
      bearing: Math.round(currentFrame.bearing),
      pitch: mapPitch,
      zoom: mapZoom,
      easing: 'easeInOutCubic',
      label: `${cameraMode.toUpperCase()} at ${formatTime(currentTime)}`,
    };
    const next = [...cameraKeyframes.filter((k) => Math.abs(k.time - newKf.time) > 0.2), newKf].sort(
      (a, b) => a.time - b.time
    );
    setCameraKeyframes(next);
    setIsKeyframeTrackActive(true);
    const updated = {
      ...journey,
      timeline: {
        ...journey.timeline,
        keyframes: next,
      },
    };
    applyJourneyEdit(updated, `Added ${cameraMode.toUpperCase()} Keyframe at ${formatTime(currentTime)}`);
  };

  const handleDeleteKeyframe = (id: string) => {
    const next = cameraKeyframes.filter((k) => k.id !== id);
    setCameraKeyframes(next);
    const updated = {
      ...journey,
      timeline: {
        ...journey.timeline,
        keyframes: next,
      },
    };
    applyJourneyEdit(updated, 'Keyframe removed');
  };

  const handleClearKeyframes = () => {
    setCameraKeyframes([]);
    setIsKeyframeTrackActive(false);
    const updated = {
      ...journey,
      timeline: {
        ...journey.timeline,
        keyframes: [],
      },
    };
    applyJourneyEdit(updated, 'Cleared camera keyframes (Manual Follow active)');
  };

  // Story Scene Handlers
  const handleAutoStory = () => {
    const generated = generateDefaultStoryScenes(journey);
    const updated = {
      ...journey,
      timeline: {
        ...journey.timeline,
        scenes: generated,
      },
    };
    applyJourneyEdit(updated, `Generated ${generated.length} story scenes (AutoStory)`);
  };

  const handleAddStoryScene = () => {
    const dur = effectiveDuration || 60;
    const startTime = Math.round(currentTime * 10) / 10;
    const endTime = Math.min(dur, Math.round((startTime + 6) * 10) / 10);
    const newScene: StoryScene = {
      id: `story-scene-${Date.now()}`,
      name: `Scene at ${formatTime(startTime)}`,
      intent: 'highlight',
      startTime,
      endTime: endTime > startTime ? endTime : startTime + 5,
      cameraMode: 'chase',
      params: { zoom: 14, pitch: 60, bearing: Math.round(currentFrame.bearing), rotationSpeed: 0 },
      title: 'New Scene',
      subtitle: `Captured at ${formatTime(startTime)}`,
      caption: 'Enter story travelogue description...',
      media: [],
    };
    const updated = addStoryScene(journey, newScene);
    applyJourneyEdit(updated, `Added scene: ${newScene.name}`);
  };

  const handleUpdateStoryScene = (sceneId: string, updates: Partial<StoryScene>) => {
    try {
      const updated = updateStoryScene(journey, sceneId, updates);
      applyJourneyEdit(updated);
    } catch (err: unknown) {
      console.warn('Update scene error:', err);
    }
  };

  const handleDeleteStoryScene = (sceneId: string) => {
    try {
      const updated = deleteStoryScene(journey, sceneId);
      applyJourneyEdit(updated, 'Scene removed');
    } catch (err: unknown) {
      console.warn('Delete scene error:', err);
    }
  };

  const handleReorderStoryScene = (fromIndex: number, toIndex: number) => {
    try {
      const updated = reorderStoryScenes(journey, fromIndex, toIndex);
      applyJourneyEdit(updated, 'Reordered story scene');
    } catch (err: unknown) {
      console.warn('Reorder scene error:', err);
    }
  };

  const handleUpdateTitleCards = (updates: Partial<StoryTitleCards>) => {
    try {
      const updated = updateTitleCards(journey, updates);
      applyJourneyEdit(updated, 'Updated title cards');
    } catch (err: unknown) {
      console.warn('Update title cards error:', err);
    }
  };

  const handleInitDefaultTitleCards = () => {
    const defaults = generateDefaultTitleCards(journey);
    handleUpdateTitleCards(defaults);
  };

  const handleSceneMediaSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const sceneId = targetSceneIdForMedia.current;
    if (!file || !sceneId) return;

    const isVideo = isSupportedVideoFormat(file.name, file.type);
    const reader = new FileReader();
    reader.onload = () => {
      const buffer = reader.result as ArrayBuffer;
      const exif = isVideo ? { hasExif: false } : parseJpegExif(buffer);
      const blobUrl = URL.createObjectURL(file);
      const asset = createMediaAsset(file.name, blobUrl, {
        type: isVideo ? 'video' : 'photo',
        mimeType: file.type,
        sizeBytes: file.size,
        title: file.name.replace(/\.[^/.]+$/, ''),
        geoPosition: exif.geoPosition,
        timestamp: exif.capturedAt,
        cameraModel: exif.cameraModel,
        sceneId,
      });

      const updated = attachMediaToScene(journey, sceneId, asset);
      applyJourneyEdit(
        updated,
        `Attached ${isVideo ? 'video' : 'photo'}: ${file.name}${exif.geoPosition?.ele ? ` (${exif.geoPosition.ele}m EXIF)` : ''}`
      );
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const handleStopMediaSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const stopId = targetStopIdForMedia.current;
    if (!file || !stopId) return;

    const isVideo = isSupportedVideoFormat(file.name, file.type);
    const reader = new FileReader();
    reader.onload = () => {
      const buffer = reader.result as ArrayBuffer;
      const exif = isVideo ? { hasExif: false } : parseJpegExif(buffer);
      const blobUrl = URL.createObjectURL(file);
      const asset = createMediaAsset(file.name, blobUrl, {
        type: isVideo ? 'video' : 'photo',
        mimeType: file.type,
        sizeBytes: file.size,
        title: file.name.replace(/\.[^/.]+$/, ''),
        geoPosition: exif.geoPosition,
        timestamp: exif.capturedAt,
        cameraModel: exif.cameraModel,
        stopId,
      });

      const updated = attachMediaToStop(journey, stopId, asset);
      applyJourneyEdit(
        updated,
        `Attached ${isVideo ? 'video' : 'photo'} to stop: ${file.name}${exif.geoPosition?.ele ? ` (${exif.geoPosition.ele}m EXIF)` : ''}`
      );
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };


  // Audio Timeline Handlers
  const handleAddSyntheticScore = (trackId: string) => {
    const dur = Math.min(30, Math.max(10, Math.round(effectiveDuration)));
    const synth = synthesizeAudioTone({
      durationSeconds: dur,
      sampleRate: 44100,
      frequencyHz: 220,
      style: 'ambient-chord',
    });
    const wavBlob = pcmToWavBlob(synth.left, synth.right, 44100);
    const blobUrl = URL.createObjectURL(wavBlob);
    const newClip: AudioClip = {
      id: `audio-clip-${Date.now()}`,
      name: 'Alpine Ambient Score',
      type: 'music',
      assetUrl: blobUrl,
      timelineStartSeconds: 0,
      sourceTrimInSeconds: 0,
      durationSeconds: dur,
      volume: 0.85,
      fadeInSeconds: 2.0,
      fadeOutSeconds: 3.0,
      metadata: {
        artist: 'WAYVORA Sound Engine',
        title: 'Alpine Ambient Triad (A Major)',
        provenance: 'Procedural PCM Synthesis',
      },
    };
    const updated = addAudioClip(journey, trackId, newClip);
    applyJourneyEdit(updated, `Generated Ambient Score (${dur}s)`);
  };

  const handleSelectAudioFile = (trackId: string) => {
    targetTrackIdForAudio.current = trackId;
    audioFileInputRef.current?.click();
  };

  const handleAudioFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const trackId = targetTrackIdForAudio.current;
    if (!file || !trackId) return;
    const blobUrl = URL.createObjectURL(file);
    const track = journey.audio?.tracks.find((t) => t.id === trackId);
    const newClip: AudioClip = {
      id: `audio-clip-${Date.now()}`,
      name: file.name.replace(/\.[^/.]+$/, ''),
      filename: file.name,
      type: track?.type || 'music',
      assetUrl: blobUrl,
      timelineStartSeconds: 0,
      sourceTrimInSeconds: 0,
      durationSeconds: Math.min(60, Math.round(effectiveDuration)),
      volume: 1.0,
      fadeInSeconds: 1.0,
      fadeOutSeconds: 1.0,
      metadata: {
        title: file.name,
        provenance: 'User Audio File',
      },
    };
    const updated = addAudioClip(journey, trackId, newClip);
    applyJourneyEdit(updated, `Added audio track: ${file.name}`);
    e.target.value = '';
  };

  const handleUpdateAudioClip = (clipId: string, updates: Partial<AudioClip>) => {
    try {
      const updated = updateAudioClip(journey, clipId, updates);
      applyJourneyEdit(updated);
    } catch (err: unknown) {
      console.warn('Update audio clip error:', err);
    }
  };

  const handleDeleteAudioClip = (clipId: string) => {
    if (previewingClipId === clipId && audioPreviewRef.current) {
      audioPreviewRef.current.pause();
      setPreviewingClipId(null);
    }
    const updated = deleteAudioClip(journey, clipId);
    applyJourneyEdit(updated, 'Removed audio clip');
  };

  const handleTogglePreviewClip = (clip: AudioClip) => {
    if (previewingClipId === clip.id) {
      if (audioPreviewRef.current) {
        audioPreviewRef.current.pause();
      }
      setPreviewingClipId(null);
      return;
    }
    if (audioPreviewRef.current) {
      audioPreviewRef.current.src = clip.assetUrl;
      audioPreviewRef.current.currentTime = clip.sourceTrimInSeconds;
      audioPreviewRef.current.volume = Math.max(0, Math.min(1, clip.volume));
      audioPreviewRef.current.play().catch(() => {});
      setPreviewingClipId(clip.id);
      audioPreviewRef.current.onended = () => setPreviewingClipId(null);
    }
  };

  const handleSetMasterAudioVolume = (vol: number) => {
    const updated = setMasterAudioVolume(journey, vol);
    applyJourneyEdit(updated);
  };

  const handleSetAudioTrackVolume = (trackId: string, vol: number, muted?: boolean) => {
    const updated = setAudioTrackVolume(journey, trackId, vol, muted);
    applyJourneyEdit(updated);
  };

  const handleUpdateAudioDucking = (updates: Partial<AudioDuckingSettings>) => {
    try {
      const updated = updateAudioDucking(journey, updates);
      applyJourneyEdit(updated, 'Updated audio ducking settings');
    } catch (err: unknown) {
      console.warn('Update audio ducking error:', err);
    }
  };

  const handleAlignClipToScene = (clipId: string, sceneId: string) => {
    try {
      const updated = alignClipToScene(journey, clipId, sceneId);
      const sc = journey.timeline.scenes.find((s) => s.id === sceneId);
      applyJourneyEdit(updated, `Aligned narration clip to ${sc?.name || 'scene'}`);
    } catch (err: unknown) {
      console.warn('Align clip to scene error:', err);
    }
  };

  const handleAddSyntheticNature = (trackId: string) => {
    const dur = Math.min(30, Math.max(10, Math.round(effectiveDuration)));
    const synth = synthesizeAudioTone({
      durationSeconds: dur,
      sampleRate: 44100,
      frequencyHz: 110,
      style: 'ambient-chord',
      gain: 0.4,
    });
    const wavBlob = pcmToWavBlob(synth.left, synth.right, 44100);
    const blobUrl = URL.createObjectURL(wavBlob);
    const newClip: AudioClip = {
      id: `audio-clip-${Date.now()}`,
      name: 'Alpine Wind & Nature',
      type: 'ambient',
      assetUrl: blobUrl,
      timelineStartSeconds: 0,
      sourceTrimInSeconds: 0,
      durationSeconds: dur,
      volume: 0.65,
      fadeInSeconds: 2.0,
      fadeOutSeconds: 2.0,
      metadata: {
        artist: 'WAYVORA Sound Engine',
        title: 'Alpine Wind & Nature Ambience',
        provenance: 'Procedural PCM Synthesis',
      },
    };
    const updated = addAudioClip(journey, trackId, newClip);
    applyJourneyEdit(updated, `Generated Nature Ambience (${dur}s)`);
  };

  // Video Export Profiles and Dispatchers
  const fullActiveAttribution = useMemo(() => {
    const hasGeocodedStops = journey.segments.some((s) => {
      const prov = s.metadata?.provenance;
      return typeof prov === 'object' && prov !== null && prov.source === 'manual-connection';
    });
    const hasRoutedSegments = journey.segments.some((s) => s.sourceFormat === 'osrm');
    return getFullExportAttribution(currentMapStyle, isTerrain3dEnabled, {
      includeGeocoding: hasGeocodedStops,
      includeRouting: hasRoutedSegments,
    });
  }, [journey, currentMapStyle, isTerrain3dEnabled]);

  const exportProfiles: ExportJobConfig[] = useMemo(() => {
    return [
      {
        profileName: 'YouTube 1080p',
        width: 1920,
        height: 1080,
        fps: exportFps,
        bitrateMbps: 8,
        codec: 'h264',
        aspectRatio: '16:9',
        cinematicTreatment: {
          vignette: exportVignette,
          colorGrade: exportColorGrade,
          contrastBoost: 0.15,
        },
        drawSafeAreaGuides: exportSafeGuides,
        attributionText: fullActiveAttribution,
      },
      {
        profileName: 'TikTok / Reels 9:16',
        width: 1080,
        height: 1920,
        fps: exportFps,
        bitrateMbps: 6,
        codec: 'h264',
        aspectRatio: '9:16',
        cinematicTreatment: {
          vignette: exportVignette,
          colorGrade: exportColorGrade,
          contrastBoost: 0.20,
        },
        drawSafeAreaGuides: exportSafeGuides,
        attributionText: fullActiveAttribution,
      },
      {
        profileName: 'Instagram Square 1:1',
        width: 1080,
        height: 1080,
        fps: exportFps,
        bitrateMbps: 6,
        codec: 'h264',
        aspectRatio: '1:1',
        cinematicTreatment: {
          vignette: exportVignette,
          colorGrade: exportColorGrade,
          contrastBoost: 0.15,
        },
        drawSafeAreaGuides: exportSafeGuides,
        attributionText: fullActiveAttribution,
      },
      {
        profileName: 'Fast Draft 720p',
        width: 1280,
        height: 720,
        fps: exportFps,
        bitrateMbps: 4,
        codec: 'h264',
        aspectRatio: '16:9',
        cinematicTreatment: {
          vignette: exportVignette,
          colorGrade: exportColorGrade,
          contrastBoost: 0.10,
        },
        drawSafeAreaGuides: exportSafeGuides,
        attributionText: fullActiveAttribution,
      },
    ];
  }, [exportFps, exportVignette, exportColorGrade, exportSafeGuides, fullActiveAttribution]);

  const handleApplyTemplate = (templateId: JourneyTemplateId) => {
    const template = JOURNEY_TEMPLATES.find((t) => t.id === templateId);
    if (!template) return;
    const updated = applyJourneyTemplate(journey, templateId);
    applyJourneyEdit(updated, `Applied "${template.name}" Preset Template`);
    if (template.recommendedAspectRatio === '9:16') {
      setSelectedExportProfileIndex(1);
    } else if (template.recommendedAspectRatio === '1:1') {
      setSelectedExportProfileIndex(2);
    } else {
      setSelectedExportProfileIndex(0);
    }
    if (template.cinematicTreatment.colorGrade) {
      setExportColorGrade(template.cinematicTreatment.colorGrade);
    }
    if (template.cinematicTreatment.vignette !== undefined) {
      setExportVignette(template.cinematicTreatment.vignette);
    }
  };

  const handleStartExport = async () => {
    const config = exportProfiles[selectedExportProfileIndex];
    if (!config) return;

    setIsExporting(true);
    setExportResult(null);
    setExportProgress({
      currentFrame: 0,
      totalFrames: Math.ceil(effectiveDuration * config.fps),
      percent: 0,
      phase: 'preparing',
      elapsedMs: 0,
      estimatedRemainingMs: 0,
      message: 'Initializing video encoder...',
    });

    const abortController = new AbortController();
    exportAbortControllerRef.current = abortController;

    try {
      const result = await exportJourneyVideo(activeJourney, {
        config,
        abortSignal: abortController.signal,
        onProgress: (prog) => {
          setExportProgress(prog);
        },
        getMapCanvas: async (frame) => {
          const map = mapInstanceRef.current;
          if (!map) return null;
          map.jumpTo({
            center: [frame.camera.center.lng, frame.camera.center.lat],
            bearing: frame.camera.bearing,
            pitch: frame.camera.pitch,
            zoom: frame.camera.zoom,
          });
          syncTransportSourceData(
            map,
            frame.position,
            frame.bearing,
            frame.transportMode || 'car',
            {
              modelLayer: transport3dLayerRef.current,
              groundElevation: frame.position?.ele ?? 0,
              renderMode: transportRenderModeRef.current,
            }
          );
          await new Promise((r) => requestAnimationFrame(r));
          return map.getCanvas();
        },
      });

      setExportResult(result);
      showNotification(`Video exported successfully! (${(result.sizeBytes / 1024 / 1024).toFixed(1)} MB)`);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        showNotification('Video export cancelled');
      } else {
        alert(err instanceof Error ? err.message : 'Export failed');
      }
    } finally {
      setIsExporting(false);
      exportAbortControllerRef.current = null;
    }
  };

  const handleCancelExport = () => {
    if (exportAbortControllerRef.current) {
      exportAbortControllerRef.current.abort();
    }
  };

  const handleCaptureFramePng = () => {
    const map = mapInstanceRef.current;
    if (map) {
      syncTransportSourceData(
        map,
        currentFrame.position,
        currentFrame.bearing,
        currentFrame.activeTransportMode || 'car',
        {
          modelLayer: transport3dLayerRef.current,
          groundElevation: currentFrame.position?.ele ?? 0,
          renderMode: transportRenderModeRef.current,
        }
      );
    }
    const mapCanvas = map ? map.getCanvas() : null;
    const currentConfig = exportProfiles[selectedExportProfileIndex] || exportProfiles[0];
    const renderFrame = evaluateRenderFrame(activeJourney, currentTime, {
      width: currentConfig.width,
      height: currentConfig.height,
      fps: 30,
      aspectRatio: currentConfig.aspectRatio,
    });
    const canvas = document.createElement('canvas');
    canvas.width = currentConfig.width;
    canvas.height = currentConfig.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    compositeRenderFrame(ctx, renderFrame, {
      mapCanvas,
      cinematicTreatment: {
        vignette: exportVignette,
        colorGrade: exportColorGrade,
        contrastBoost: 0.15,
      },
      drawSafeAreaGuides: exportSafeGuides,
    });
    canvas.toBlob((blob) => {
      if (blob) {
        const timeCode = Math.round(currentTime).toString().padStart(3, '0');
        downloadExportBlob(blob, `wayvora_frame_${timeCode}s_${currentConfig.width}x${currentConfig.height}.png`);
        showNotification(`Captured ${currentConfig.width}x${currentConfig.height} snapshot PNG!`);
      }
    }, 'image/png');
  };

  // Route Editing Dispatchers
  const applyJourneyEdit = (newJourney: Journey, notificationMsg?: string) => {
    setJourney(newJourney);
    setEditorHistory((h) => pushEditorHistory(h, newJourney));
    setIsSaved(false);
    if (notificationMsg) showNotification(notificationMsg);
  };

  // Media Library Handlers
  const handleImportMediaFiles = async (files: FileList | File[]) => {
    setIsImportingMedia(true);
    setMediaImportMessage(null);
    let importedCount = 0;
    let duplicateCount = 0;
    const errorMessages: string[] = [];
    let currentJourney = journey;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const result = await importMediaFile(file, { existingLibrary: currentJourney.mediaLibrary });
      if (result.success && result.asset) {
        if (result.isDuplicate) {
          duplicateCount++;
        } else {
          currentJourney = addMediaToLibrary(currentJourney, result.asset);
          importedCount++;
        }
      } else if (result.error) {
        errorMessages.push(result.error);
      }
    }

    if (importedCount > 0) {
      applyJourneyEdit(currentJourney, `Imported ${importedCount} media asset${importedCount > 1 ? 's' : ''}`);
    }

    let msg = '';
    if (importedCount > 0) msg += `Successfully imported ${importedCount} file${importedCount > 1 ? 's' : ''}. `;
    if (duplicateCount > 0) msg += `${duplicateCount} file${duplicateCount > 1 ? 's were' : ' was'} already in library. `;
    if (errorMessages.length > 0) msg += `Note: ${errorMessages.join('; ')}`;
    setMediaImportMessage(msg || 'No new files imported.');
    setIsImportingMedia(false);
  };

  const handleDeleteMediaAsset = async (assetId: string) => {
    const asset = (journey.mediaLibrary ?? []).find((m) => m.id === assetId);
    if (asset?.storageKey) {
      await deleteMediaBlob(asset.storageKey);
    }
    const updated = removeMediaFromLibrary(journey, assetId);
    applyJourneyEdit(updated, `Deleted media asset: ${asset?.filename ?? assetId}`);
  };

  const handleAssignMediaToScene = (sceneId: string, assetId: string) => {
    try {
      const updated = assignMediaToScene(journey, sceneId, assetId);
      const asset = (journey.mediaLibrary ?? []).find((m) => m.id === assetId);
      applyJourneyEdit(updated, `Attached ${asset?.filename ?? 'media'} to scene`);
      showNotification(`Attached ${asset?.filename ?? 'media'} to scene`);
    } catch (err) {
      console.error(err);
    }
  };

  const handleRemoveMediaFromScene = (sceneId: string, assetId: string) => {
    try {
      const updated = removeMediaFromScene(journey, sceneId, assetId);
      applyJourneyEdit(updated, 'Removed media from scene');
      showNotification('Removed media from scene');
    } catch (err) {
      console.error(err);
    }
  };

  const handleAssignMediaToAudioTrack = (trackId: string, asset: MediaAsset) => {
    try {
      const updated = addMediaToAudioTrack(journey, trackId, asset, currentTime);
      applyJourneyEdit(updated, `Added ${asset.filename} to audio timeline`);
      showNotification(`Added ${asset.filename} to audio timeline`);
    } catch (err) {
      console.error(err);
    }
  };

  const handleUndo = () => {
    if (!canUndo(editorHistory)) return;
    const nextH = undoEditorHistory(editorHistory);
    setEditorHistory(nextH);
    setJourney(nextH.present);
    setIsSaved(false);
    showNotification('Undo applied');
  };

  const handleRedo = () => {
    if (!canRedo(editorHistory)) return;
    const nextH = redoEditorHistory(editorHistory);
    setEditorHistory(nextH);
    setJourney(nextH.present);
    setIsSaved(false);
    showNotification('Redo applied');
  };

  const handleInsertPointInSegment = (segmentId: string, atEnd: boolean) => {
    const seg = journey.segments.find((s) => s.id === segmentId);
    if (!seg || seg.points.length === 0) return;
    const refPoint = atEnd ? seg.points[seg.points.length - 1] : seg.points[0];
    const offsetLng = atEnd ? 0.015 : -0.015;
    const offsetLat = atEnd ? 0.01 : -0.01;
    const newPoint = createRoutePoint(
      refPoint.lng + offsetLng,
      refPoint.lat + offsetLat,
      refPoint.ele != null ? refPoint.ele + 50 : undefined
    );
    const insertIdx = atEnd ? seg.points.length : 0;
    try {
      const updated = insertRoutePoint(journey, segmentId, insertIdx, newPoint);
      applyJourneyEdit(updated, `Inserted point ${atEnd ? 'at end' : 'at start'}`);
      setSelectedPointIndex(insertIdx);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const handleMoveSelectedPoint = (lat: number, lng: number, ele?: number) => {
    if (!selectedSegmentId || selectedPointIndex === null) return;
    try {
      const updated = moveRoutePoint(journey, selectedSegmentId, selectedPointIndex, { lat, lng, ele });
      applyJourneyEdit(updated, `Moved point #${selectedPointIndex + 1}`);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteSelectedPoint = () => {
    if (!selectedSegmentId || selectedPointIndex === null) return;
    try {
      const updated = deleteRoutePoint(journey, selectedSegmentId, selectedPointIndex);
      applyJourneyEdit(updated, `Deleted point #${selectedPointIndex + 1}`);
      setSelectedPointIndex(null);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const handleUpdateStopDuration = (stopId: string, durationSeconds: number) => {
    try {
      const updated = updateStop(journey, stopId, { durationAtStop: durationSeconds });
      applyJourneyEdit(updated, `Set dwell duration to ${durationSeconds}s`);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteStopItem = (stopId: string) => {
    try {
      const updated = deleteStop(journey, stopId);
      applyJourneyEdit(updated, 'Removed stop');
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const handleChangeSegmentMode = (segmentId: string, mode: TransportMode) => {
    try {
      const updated = updateSegmentMode(journey, segmentId, mode);
      applyJourneyEdit(updated, `Updated mode to ${mode.toUpperCase()}`);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  // Road Routing Action Handlers
  const handleRequestRoadRoute = async (segmentId: string, useMockFallback = false) => {
    const seg = journey.segments.find((s) => s.id === segmentId);
    if (!seg || seg.points.length < 2) {
      showNotification('Segment must have at least 2 points to calculate a road route.');
      return;
    }

    const origin = seg.points[0];
    const destination = seg.points[seg.points.length - 1];

    setRoutingStatus('loading');
    setRoutingError(null);
    setPendingRoute(null);

    const provider = useMockFallback
      ? new MockRoutingProvider()
      : new OsrmRoutingProvider({ timeoutMs: 8000 });

    try {
      const result = await provider.calculateRoute({
        origin: { lat: origin.lat, lng: origin.lng, ele: origin.ele },
        destination: { lat: destination.lat, lng: destination.lng, ele: destination.ele },
        profile: routingProfile,
      });

      if (result.success && result.points.length >= 2) {
        setRoutingStatus('success');
        setPendingRoute({ segmentId, result });
        showNotification(
          `Road route calculated: ${(result.distanceMetres / 1000).toFixed(1)} km (${result.points.length} points)`
        );
      } else {
        setRoutingStatus('error');
        const errMsg = result.error?.message ?? 'Failed to calculate road route.';
        setRoutingError(errMsg);
        showNotification(`Routing error: ${errMsg}`);
      }
    } catch (err: unknown) {
      setRoutingStatus('error');
      const errMsg = err instanceof Error ? err.message : 'Unknown routing error';
      setRoutingError(errMsg);
      showNotification(`Routing error: ${errMsg}`);
    }
  };

  const handleApplyPendingRoute = () => {
    if (!pendingRoute) return;
    try {
      const updated = applyRouteToSegment(journey, pendingRoute.segmentId, pendingRoute.result);
      applyJourneyEdit(
        updated,
        `Applied road route: ${(pendingRoute.result.distanceMetres / 1000).toFixed(1)} km via ${pendingRoute.result.metadata.providerName}`
      );
      setPendingRoute(null);
      setRoutingStatus('idle');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to apply route';
      showNotification(msg);
    }
  };


  // Keyboard Shortcuts (Ctrl+Z, Ctrl+Y)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) {
          e.preventDefault();
          handleRedo();
        } else {
          e.preventDefault();
          handleUndo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editorHistory]);

  // Project Export & Import
  const handleSaveProject = () => {
    downloadProject(journey);
    setIsSaved(true);
    showNotification('Project downloaded as .wayvora.json');
  };

  const handleLoadProjectFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const restored = deserializeProject(reader.result as string);
        setJourney(restored);
        setEditorHistory(createEditorHistory(restored));
        setIsSaved(true);
        setSelectedSegmentId(null);
        setSelectedPointIndex(null);
        setCurrentTime(0);
        setIsPlaying(false);
        showNotification(`Loaded project: ${restored.name}`);
      } catch (err: unknown) {
        alert(err instanceof Error ? err.message : 'Failed to load project file');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };


  // GPX Import Handlers
  const handleSelectGpxFile = () => {
    gpxFileInputRef.current?.click();
  };

  const handleGpxInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result as string;
        const res = parseGpx(text, file.name);
        setGpxResult(res);
        setIsGpxModalOpen(true);
      } catch (err: unknown) {
        alert(err instanceof Error ? err.message : 'Failed to parse GPX file');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleLoadSampleGpx = async (url: string, filename: string) => {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const text = await resp.text();
      const res = parseGpx(text, filename);
      setGpxResult(res);
      setIsGpxModalOpen(true);
    } catch (err: unknown) {
      showNotification(`Failed to load sample GPX: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleConfirmNewJourneyFromGpx = () => {
    if (!gpxResult) return;
    const newJourney = gpxResult.toJourney();
    setJourney(newJourney);
    setEditorHistory(createEditorHistory(newJourney));
    setIsSaved(true);
    setSelectedSegmentId(null);
    setSelectedPointIndex(null);
    setSelectedPreset('custom');
    setCurrentTime(0);
    setIsPlaying(false);
    setIsGpxModalOpen(false);
    showNotification(`Imported GPX: "${newJourney.name}" (${(gpxResult.summary.totalDistanceMetres / 1000).toFixed(2)} km)`);
    const pts = getAllPoints(newJourney);
    if (mapInstanceRef.current && pts.length > 0) {
      fitMapToBounds(mapInstanceRef.current, pts);
    }
  };

  const handleConfirmAppendGpx = () => {
    if (!gpxResult) return;
    const updated = appendGpxToJourney(journey, gpxResult);
    applyJourneyEdit(updated, `Appended GPX track to current journey (${updated.segments.length} segments)`);
    setIsGpxModalOpen(false);
    const pts = getAllPoints(updated);
    if (mapInstanceRef.current && pts.length > 0) {
      fitMapToBounds(mapInstanceRef.current, pts);
    }
  };


  // Render Elevation Profile Path
  const elevationSvgPath = useMemo(() => {
    const pts = allPoints.filter(p => p.ele != null);
    if (pts.length < 2) return null;
    const elevations = pts.map(p => p.ele ?? 0);
    const minEle = Math.min(...elevations);
    const maxEle = Math.max(...elevations);
    const range = Math.max(1, maxEle - minEle);

    const coords = elevations.map((ele, idx) => {
      const x = (idx / (elevations.length - 1)) * 230;
      const y = 40 - ((ele - minEle) / range) * 32;
      return `${x},${y}`;
    });

    return `M 0,44 L ${coords.join(' L ')} L 230,44 Z`;
  }, [allPoints]);

  return (
    <>
      {/* ─── Top Studio Navbar ─── */}
      <header className="studio-header">
        <div className="brand-section">
          <div className="brand-logo">
            <div className="logo-badge">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#050b14" strokeWidth="2.5">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </div>
            <span className="brand-title">WAYVORA</span>
            <span className="tag-version">STUDIO V1</span>
          </div>

          <select
            className="journey-selector"
            value={selectedPreset}
            onChange={(e) => handleSelectPreset(e.target.value)}
            title="Journey Route Preset"
          >
            {PRESET_JOURNEYS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
            {selectedPreset === 'custom' && (
              <option value="custom">★ Imported GPX Journey</option>
            )}
          </select>

          <select
            className="journey-selector"
            value={currentMapStyle}
            onChange={(e) => handleStyleChange(e.target.value as MapStyleId)}
            title="Map Basemap Style"
          >
            {MAP_STYLE_IDS.map((styleId) => (
              <option key={styleId} value={styleId}>
                🗺 {MAP_STYLES[styleId].name}
              </option>
            ))}
          </select>

          {isSaved ? (
            <span className="save-badge save-badge-saved">✓ Saved</span>
          ) : (
            <span className="save-badge save-badge-unsaved">● Unsaved</span>
          )}

          <div className="undo-redo-group">
            <button
              className="btn-icon-undo"
              onClick={handleUndo}
              disabled={!canUndo(editorHistory)}
              title="Undo edit (Ctrl+Z)"
            >
              ↺
            </button>
            <button
              className="btn-icon-undo"
              onClick={handleRedo}
              disabled={!canRedo(editorHistory)}
              title="Redo edit (Ctrl+Y)"
            >
              ↻
            </button>
          </div>
        </div>

        <div className="header-stats">
          <div className="stat-pill">
            <span className="label">Total Distance</span>
            <span className="val">{(journeyTotalDistance / 1000).toFixed(1)} km</span>
          </div>
          <div className="stat-pill">
            <span className="label">Segments</span>
            <span className="val">{journey.segments.length}</span>
          </div>
          <div className="stat-pill">
            <span className="label">Engine</span>
            <span className="val" style={{ color: '#00f2fe' }}>60 FPS / 4K</span>
          </div>
        </div>

        <div className="header-actions">
          <input
            type="file"
            ref={gpxFileInputRef}
            style={{ display: 'none' }}
            accept=".gpx,application/gpx+xml"
            onChange={handleGpxInputChange}
          />
          <button className="btn-ghost" onClick={handleSelectGpxFile} title="Import GPS hiking tracks or trail segments">
            Import GPX
          </button>
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            accept=".json,.wayvora.json"
            onChange={handleLoadProjectFile}
          />
          <button className="btn-ghost" onClick={() => fileInputRef.current?.click()}>
            Load Project
          </button>
          <button className="btn-ghost" onClick={handleSaveProject}>
            Save .wayvora
          </button>
          <button
            className="btn-primary"
            onClick={() => setActiveTab('export')}
            title="Open video export & rendering studio"
          >
            <span>Render Video</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
          </button>
        </div>
      </header>

      {/* ─── Studio Main Workspace ─── */}
      <main className="studio-body">
        {/* Left Sidebar: Journey Segments & Stops */}
        <aside className="studio-sidebar">
          <div className="sidebar-tabs">
            <button
              className={`tab-btn ${activeTab === 'stops' ? 'active' : ''}`}
              onClick={() => setActiveTab('stops')}
            >
              Stops ({journey.stops.length})
            </button>
            <button
              className={`tab-btn ${activeTab === 'segments' ? 'active' : ''}`}
              onClick={() => setActiveTab('segments')}
            >
              Segments ({journey.segments.length})
            </button>
            <button
              className={`tab-btn ${activeTab === 'story' ? 'active' : ''}`}
              onClick={() => setActiveTab('story')}
            >
              Story ({journey.timeline.scenes?.length ?? 0})
            </button>
            <button
              className={`tab-btn ${activeTab === 'audio' ? 'active' : ''}`}
              onClick={() => setActiveTab('audio')}
            >
              🎵 Audio ({journey.audio?.tracks.reduce((acc, t) => acc + t.clips.length, 0) ?? 0})
            </button>
            <button
              className={`tab-btn ${activeTab === 'media' ? 'active' : ''}`}
              onClick={() => setActiveTab('media')}
            >
              🖼️ Media ({journey.mediaLibrary?.length ?? 0})
            </button>
            <button
              className={`tab-btn ${activeTab === 'stats' ? 'active' : ''}`}
              onClick={() => setActiveTab('stats')}
            >
              Metadata
            </button>
            <button
              className={`tab-btn ${activeTab === 'export' ? 'active' : ''}`}
              onClick={() => setActiveTab('export')}
            >
              🎬 Export
            </button>
          </div>

          <div className="sidebar-scroll">
            {activeTab === 'stops' ? (
              <>
                <div style={{ marginBottom: '14px' }}>
                  <div
                    className="gpx-dropzone"
                    onClick={handleSelectGpxFile}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const file = e.dataTransfer.files[0];
                      if (file && (file.name.endsWith('.gpx') || file.type.includes('gpx') || file.type.includes('xml'))) {
                        const reader = new FileReader();
                        reader.onload = () => {
                          try {
                            const res = parseGpx(reader.result as string, file.name);
                            setGpxResult(res);
                            setIsGpxModalOpen(true);
                          } catch (err: unknown) {
                            alert(err instanceof Error ? err.message : 'Failed to parse GPX file');
                          }
                        };
                        reader.readAsText(file);
                      }
                    }}
                  >
                    <div style={{ fontSize: '12px', fontWeight: 600, color: '#00f2fe', marginBottom: '2px' }}>
                      📁 Drop GPX or Click to Browse
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      Preserves elevations, timestamps & segments
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                    <button
                      className="btn-ghost"
                      style={{ fontSize: '10px', padding: '4px 6px', flex: 1, textAlign: 'center' }}
                      onClick={() => handleLoadSampleGpx('/fixtures/kokoda-track-real-activity.gpx', 'kokoda-track-real-activity.gpx')}
                      title="Load real recorded GPS walking track"
                    >
                      📍 Real GPS Track
                    </button>
                    <button
                      className="btn-ghost"
                      style={{ fontSize: '10px', padding: '4px 6px', flex: 1, textAlign: 'center' }}
                      onClick={() => handleLoadSampleGpx('/fixtures/synthetic-alpine-ridge-climb.gpx', 'synthetic-alpine-ridge-climb.gpx')}
                      title="Load synthetic alpine climb test fixture"
                    >
                      ⛰️ Synthetic Climb
                    </button>
                  </div>
                </div>

                <div className="section-label">
                  <span>Waypoints & Trails</span>
                  <button
                    className="btn-ghost"
                    style={{ padding: '2px 8px', fontSize: '11px' }}
                    onClick={handleAddStop}
                  >
                    + Add Stop
                  </button>
                </div>

                {journey.stops.map((stop, idx) => {
                  const seg = journey.segments[stop.segmentIndex];
                  const mode = seg?.transportMode ?? 'car';
                  return (
                    <React.Fragment key={stop.id}>
                      <div
                        className="stop-card"
                        onClick={() => {
                          if (mapInstanceRef.current) {
                            mapInstanceRef.current.flyTo({
                              center: [stop.position.lng, stop.position.lat],
                              zoom: 13,
                              pitch: 50,
                              duration: 1000,
                            });
                          }
                        }}
                      >
                        <div className="stop-header">
                          <span className="stop-name">{stop.name}</span>
                          <span className={`mode-badge mode-${mode}`}>{mode}</span>
                          <button
                            className="btn-ghost"
                            style={{ padding: '0 4px', fontSize: '11px', color: '#ef4444' }}
                            title="Delete Stop"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteStopItem(stop.id);
                            }}
                          >
                            ✕
                          </button>
                        </div>
                        <div className="stop-details">
                          <span>{stop.position.lat.toFixed(3)}°N, {stop.position.lng.toFixed(3)}°E</span>
                          {stop.position.ele != null && <span>▲ {stop.position.ele}m</span>}
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginTop: '6px',
                            paddingTop: '6px',
                            borderTop: '1px solid rgba(255,255,255,0.06)',
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>⏸ Dwell Pause:</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              min="0"
                              max="60"
                              className="stop-dwell-input"
                              value={stop.durationAtStop ?? 0}
                              onChange={(e) => handleUpdateStopDuration(stop.id, Number(e.target.value))}
                            />
                            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>sec</span>
                          </div>
                        </div>

                        {/* Stop Media Attachments */}
                        <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                            {stop.media?.map((m) => (
                              <img
                                key={m.id}
                                src={m.url}
                                alt={m.filename}
                                className="scene-thumb"
                                style={{ width: '28px', height: '28px' }}
                                title={m.title ?? m.filename}
                              />
                            ))}
                          </div>
                          <button
                            className="btn-ghost"
                            style={{ fontSize: '10px', padding: '2px 6px' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              targetStopIdForMedia.current = stop.id;
                              stopMediaInputRef.current?.click();
                            }}
                            title="Attach photo to this stop"
                          >
                            📷 + Photo
                          </button>
                        </div>
                      </div>

                      {idx < journey.stops.length - 1 && (
                        <div className="segment-connector">
                          <div className="connector-line" />
                          <span>{seg?.type.toUpperCase()} SEGMENT</span>
                        </div>
                      )}
                    </React.Fragment>
                  );
                })}
              </>
            ) : activeTab === 'segments' ? (
              <>
                <div className="section-label">
                  <span>Journey Segments ({journey.segments.length})</span>
                </div>

                {journey.segments.map((seg, sIdx) => {
                  const audit = getSegmentEditAudit(seg);
                  const isSelected = selectedSegmentId === seg.id;
                  return (
                    <div
                      key={seg.id}
                      className={`segment-editor-card ${isSelected ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedSegmentId(isSelected ? null : seg.id);
                        setSelectedPointIndex(null);
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <span style={{ fontWeight: 600, fontSize: '12px' }}>
                          Segment #{sIdx + 1} ({seg.type.toUpperCase()})
                        </span>
                        <span
                          style={{
                            fontSize: '10px',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: audit.isModified ? 'rgba(245, 158, 11, 0.2)' : 'rgba(0, 242, 254, 0.1)',
                            color: audit.isModified ? '#fbbf24' : '#00f2fe',
                          }}
                        >
                          {audit.isModified ? '● Modified' : (audit.isOriginal ? '✓ GPX Track' : 'Manual')}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                        <span>Mode:</span>
                        <select
                          style={{
                            background: 'rgba(0,0,0,0.4)',
                            color: '#fff',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: '4px',
                            fontSize: '11px',
                            padding: '2px 4px',
                          }}
                          value={seg.transportMode}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => handleChangeSegmentMode(seg.id, e.target.value as TransportMode)}
                        >
                          {CANONICAL_TRANSPORT_MODES.map((m) => (
                            <option key={m} value={m}>
                              {TRANSPORT_MODE_METADATA[m].label.toUpperCase()}
                            </option>
                          ))}
                        </select>
                        <span>• {seg.points.length} points</span>
                      </div>

                      {isSelected && (
                        <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.08)' }} onClick={(e) => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                            <button
                              className="btn-ghost"
                              style={{ fontSize: '10px', padding: '4px 6px', flex: 1 }}
                              onClick={() => handleInsertPointInSegment(seg.id, false)}
                              title="Insert point at start of segment"
                            >
                              + Insert Start
                            </button>
                            <button
                              className="btn-ghost"
                              style={{ fontSize: '10px', padding: '4px 6px', flex: 1 }}
                              onClick={() => handleInsertPointInSegment(seg.id, true)}
                              title="Insert point at end of segment"
                            >
                              + Insert End
                            </button>
                          </div>

                          {/* Road Routing Engine Action Box */}
                          <div className="routing-action-box" onClick={(e) => e.stopPropagation()}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                              <span style={{ fontSize: '11px', fontWeight: 600, color: '#00f2fe' }}>
                                🧭 Road Routing Engine
                              </span>
                              <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                                {routingStatus === 'loading' ? 'Routing...' : 'OSRM Provider'}
                              </span>
                            </div>

                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                              <select
                                style={{
                                  background: 'rgba(0,0,0,0.5)',
                                  color: '#fff',
                                  border: '1px solid var(--border-subtle)',
                                  borderRadius: '4px',
                                  fontSize: '11px',
                                  padding: '2px 4px',
                                  flex: 1,
                                }}
                                value={routingProfile}
                                onChange={(e) => setRoutingProfile(e.target.value as RoutingProfile)}
                              >
                                <option value="driving">Driving (Car)</option>
                                <option value="cycling">Cycling (Bike)</option>
                                <option value="walking">Walking (Foot)</option>
                              </select>
                              <button
                                className="btn-primary"
                                style={{ fontSize: '10px', padding: '4px 8px' }}
                                disabled={routingStatus === 'loading' || seg.points.length < 2}
                                onClick={() => handleRequestRoadRoute(seg.id, false)}
                                title="Query OSRM for real highway route between first and last point"
                              >
                                {routingStatus === 'loading' ? 'Routing...' : 'Route via OSRM'}
                              </button>
                            </div>

                            {routingError && (
                              <div style={{ fontSize: '10px', color: '#f87171', marginTop: '4px', lineHeight: '1.4' }}>
                                <span>⚠ {routingError}</span>
                                <div style={{ marginTop: '4px' }}>
                                  <button
                                    className="btn-ghost"
                                    style={{ fontSize: '10px', padding: '2px 6px', color: '#38bdf8' }}
                                    onClick={() => handleRequestRoadRoute(seg.id, true)}
                                    title="Try calculating deterministic mock route without network"
                                  >
                                    Try Offline Mock Route
                                  </button>
                                </div>
                              </div>
                            )}

                            {pendingRoute && pendingRoute.segmentId === seg.id && (
                              <div className="route-confirmation-card">
                                <div style={{ fontSize: '11px', color: '#34d399', fontWeight: 500 }}>
                                  ✓ Route Ready: {(pendingRoute.result.distanceMetres / 1000).toFixed(1)} km ({pendingRoute.result.points.length} road points)
                                </div>
                                <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                                  {pendingRoute.result.durationSeconds ? `Est. ${Math.round(pendingRoute.result.durationSeconds / 60)} min · ` : ''}
                                  {pendingRoute.result.metadata.attribution}
                                </div>
                                <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                                  <button
                                    className="btn-primary"
                                    style={{ fontSize: '10px', padding: '3px 8px', flex: 1 }}
                                    onClick={handleApplyPendingRoute}
                                  >
                                    Apply to Segment
                                  </button>
                                  <button
                                    className="btn-ghost"
                                    style={{ fontSize: '10px', padding: '3px 8px' }}
                                    onClick={() => {
                                      setPendingRoute(null);
                                      setRoutingStatus('idle');
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>

                          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px', marginTop: '8px' }}>
                            Select point to inspect / edit:
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', maxHeight: '100px', overflowY: 'auto', marginBottom: '8px' }}>
                            {seg.points.map((_, pIdx) => (
                              <button
                                key={pIdx}
                                className={`btn-ghost ${selectedPointIndex === pIdx ? 'active' : ''}`}
                                style={{ padding: '2px 6px', fontSize: '10px' }}
                                onClick={() => setSelectedPointIndex(pIdx)}
                              >
                                #{pIdx + 1}
                              </button>
                            ))}
                          </div>

                          {selectedPointIndex !== null && seg.points[selectedPointIndex] && (
                            <div className="point-inspector-box">
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: '11px', fontWeight: 600, color: '#00f2fe' }}>
                                  Point #{selectedPointIndex + 1}
                                </span>
                                <button
                                  className="btn-ghost"
                                  style={{ padding: '2px 6px', fontSize: '10px', color: '#ef4444' }}
                                  onClick={handleDeleteSelectedPoint}
                                  disabled={seg.points.length <= 2}
                                  title={seg.points.length <= 2 ? 'Segment must have at least 2 points' : 'Delete point'}
                                >
                                  Delete
                                </button>
                              </div>

                              <div className="point-inspector-grid">
                                <div className="point-input-group">
                                  <label>Latitude</label>
                                  <input
                                    type="number"
                                    step="0.001"
                                    value={seg.points[selectedPointIndex].lat}
                                    onChange={(e) =>
                                      handleMoveSelectedPoint(
                                        Number(e.target.value),
                                        seg.points[selectedPointIndex!].lng,
                                        seg.points[selectedPointIndex!].ele
                                      )
                                    }
                                  />
                                </div>
                                <div className="point-input-group">
                                  <label>Longitude</label>
                                  <input
                                    type="number"
                                    step="0.001"
                                    value={seg.points[selectedPointIndex].lng}
                                    onChange={(e) =>
                                      handleMoveSelectedPoint(
                                        seg.points[selectedPointIndex!].lat,
                                        Number(e.target.value),
                                        seg.points[selectedPointIndex!].ele
                                      )
                                    }
                                  />
                                </div>
                              </div>

                              <div className="point-input-group">
                                <label>Elevation (m)</label>
                                <input
                                  type="number"
                                  step="1"
                                  value={seg.points[selectedPointIndex].ele ?? 0}
                                  onChange={(e) =>
                                    handleMoveSelectedPoint(
                                      seg.points[selectedPointIndex!].lat,
                                      seg.points[selectedPointIndex!].lng,
                                      Number(e.target.value)
                                    )
                                  }
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            ) : (
              <div className="diagnostics-panel">
                <div className="control-header">Geographic Diagnostics</div>

                {/* Health Status Badge */}
                <div
                  className={`diagnostics-badge ${
                    !diagnosticsReport.isValid
                      ? 'diagnostics-badge-error'
                      : diagnosticsReport.hasWarnings
                      ? 'diagnostics-badge-warning'
                      : 'diagnostics-badge-valid'
                  }`}
                >
                  <span>
                    {!diagnosticsReport.isValid
                      ? `✕ ${diagnosticsReport.errorCount} Error(s) Found`
                      : diagnosticsReport.hasWarnings
                      ? `⚠ ${diagnosticsReport.warningCount} Quality Warning(s)`
                      : '✓ All Geometries Valid & Continuous'}
                  </span>
                </div>

                {/* Metrics Breakdown Grid */}
                <div className="gpx-summary-grid">
                  <div className="gpx-stat-card">
                    <span className="stat-label">Total Distance</span>
                    <span className="stat-value">{(diagnosticsReport.metrics.totalDistanceMetres / 1000).toFixed(2)} km</span>
                  </div>
                  <div className="gpx-stat-card">
                    <span className="stat-label">Total Points</span>
                    <span className="stat-value">{diagnosticsReport.metrics.totalPoints}</span>
                  </div>
                  <div className="gpx-stat-card">
                    <span className="stat-label">Elevation Coverage</span>
                    <span className="stat-value">{diagnosticsReport.metrics.elevationCoveragePct}%</span>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                      +{diagnosticsReport.metrics.elevationGainMetres}m / -{diagnosticsReport.metrics.elevationLossMetres}m
                    </span>
                  </div>
                  <div className="gpx-stat-card">
                    <span className="stat-label">Boundary Continuity</span>
                    <span className="stat-value">
                      {diagnosticsReport.metrics.boundaryGapsCount === 0
                        ? 'Continuous'
                        : `${diagnosticsReport.metrics.boundaryGapsCount} Gap(s)`}
                    </span>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                      Max: {diagnosticsReport.metrics.maxBoundaryGapMetres > 0 ? `${(diagnosticsReport.metrics.maxBoundaryGapMetres / 1000).toFixed(2)}km` : '0m'}
                    </span>
                  </div>
                </div>

                {/* Issues List */}
                {diagnosticsReport.issues.length > 0 && (
                  <div style={{ marginTop: '8px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                      Audit Findings ({diagnosticsReport.issues.length}):
                    </div>
                    <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {diagnosticsReport.issues.map((issue, idx) => (
                        <div
                          key={idx}
                          className={`diagnostic-issue-item ${
                            issue.severity === 'error'
                              ? 'diagnostic-issue-error'
                              : issue.severity === 'warning'
                              ? 'diagnostic-issue-warning'
                              : 'diagnostic-issue-info'
                          }`}
                        >
                          <strong>[{issue.code}]</strong> {issue.message}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '8px', color: 'var(--text-muted)', fontSize: '11px' }}>
                  <div>Duration: <strong>{journey.timeline.duration}s</strong> (Effective: <strong>{effectiveDuration.toFixed(1)}s</strong>)</div>
                  <div>FPS: <strong>{journey.timeline.fps}</strong> · Created: <strong>{new Date(journey.createdAt).toLocaleDateString()}</strong></div>
                </div>
              </div>
            )}

            {activeTab === 'audio' && (
              <div className="audio-panel">
                <div className="section-label">
                  <span>Audio Timeline & Multi-Track Sound Director</span>
                </div>

                {/* Master Volume */}
                <div className="audio-track-card" style={{ background: 'rgba(0, 242, 254, 0.05)', borderColor: 'rgba(0, 242, 254, 0.25)' }}>
                  <div className="audio-track-header">
                    <span className="audio-track-title">🔊 Master Output Volume</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--accent-cyan)' }}>
                      {Math.round((journey.audio?.masterVolume ?? 1.0) * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1.5"
                    step="0.05"
                    value={journey.audio?.masterVolume ?? 1.0}
                    onChange={(e) => handleSetMasterAudioVolume(Number(e.target.value))}
                  />
                </div>

                {/* Automatic Music Ducking Control Card */}
                {(() => {
                  const ducking = journey.audio?.ducking || DEFAULT_DUCKING_SETTINGS;
                  const isDuckingActive = currentAudioState.isDucking;
                  const currentDuckingPct = Math.round((currentAudioState.duckingGain ?? 1.0) * 100);

                  return (
                    <div className="ducking-card">
                      <div className="ducking-header">
                        <span className="ducking-title">
                          🦆 Automatic Music Ducking
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span className={`ducking-status-pill ${isDuckingActive ? 'active' : 'idle'}`}>
                            {isDuckingActive
                              ? `🎙️ DUCKING ACTIVE (${currentDuckingPct}%)`
                              : `🎵 DUCKING IDLE (${currentDuckingPct}%)`}
                          </span>
                          <button
                            className="btn-ghost"
                            style={{
                              padding: '2px 8px',
                              fontSize: '10px',
                              color: ducking.enabled ? '#34d399' : 'var(--text-muted)',
                              fontWeight: 700,
                            }}
                            onClick={() => handleUpdateAudioDucking({ enabled: !ducking.enabled })}
                          >
                            {ducking.enabled ? 'ON' : 'OFF'}
                          </button>
                        </div>
                      </div>

                      {ducking.enabled && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
                          {/* Attenuation Slider */}
                          <div className="audio-slider-row">
                            <div className="audio-slider-labels">
                              <span>Music Level During Narration</span>
                              <span style={{ fontFamily: 'var(--font-mono)' }}>
                                {Math.round(ducking.attenuation * 100)}% ({(20 * Math.log10(Math.max(0.01, ducking.attenuation))).toFixed(1)} dB)
                              </span>
                            </div>
                            <input
                              type="range"
                              min="0.10"
                              max="0.80"
                              step="0.05"
                              value={ducking.attenuation}
                              onChange={(e) => handleUpdateAudioDucking({ attenuation: Number(e.target.value) })}
                            />
                          </div>

                          {/* Attack, Release & Margin Grid */}
                          <div className="audio-clip-grid">
                            <div className="audio-input-group">
                              <label>Attack (Fade Down)</label>
                              <input
                                type="number"
                                min="0.1"
                                max="3.0"
                                step="0.1"
                                value={ducking.attackSeconds}
                                onChange={(e) => handleUpdateAudioDucking({ attackSeconds: Math.max(0.1, Number(e.target.value)) })}
                              />
                            </div>
                            <div className="audio-input-group">
                              <label>Release (Fade Up)</label>
                              <input
                                type="number"
                                min="0.2"
                                max="5.0"
                                step="0.1"
                                value={ducking.releaseSeconds}
                                onChange={(e) => handleUpdateAudioDucking({ releaseSeconds: Math.max(0.2, Number(e.target.value)) })}
                              />
                            </div>
                            <div className="audio-input-group">
                              <label>Safety Margin</label>
                              <input
                                type="number"
                                min="0.0"
                                max="2.0"
                                step="0.1"
                                value={ducking.marginSeconds}
                                onChange={(e) => handleUpdateAudioDucking({ marginSeconds: Math.max(0, Number(e.target.value)) })}
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Multi-Track Visual Timeline Lane Overview */}
                <div className="audio-multitrack-overview">
                  <div className="multitrack-header">
                    <span>Multi-Track Timeline Lanes</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--accent-cyan)' }}>
                      {formatTime(currentTime)} / {formatTime(effectiveDuration)}
                    </span>
                  </div>

                  <div className="multitrack-lane-container">
                    {/* Music Lane */}
                    <div className="multitrack-lane">
                      <span className="multitrack-lane-label">Music</span>
                      {(journey.audio?.tracks || [])
                        .filter((t) => t.type === 'music')
                        .flatMap((t) => t.clips)
                        .map((clip) => {
                          const leftPct = (clip.timelineStartSeconds / Math.max(1, effectiveDuration)) * 100;
                          const widthPct = (clip.durationSeconds / Math.max(1, effectiveDuration)) * 100;
                          return (
                            <div
                              key={clip.id}
                              className="multitrack-clip-block music"
                              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                              title={`${clip.name} (${clip.timelineStartSeconds}s - ${clip.timelineStartSeconds + clip.durationSeconds}s)`}
                              onClick={() => setCurrentTime(clip.timelineStartSeconds)}
                            >
                              {clip.name}
                            </div>
                          );
                        })}
                    </div>

                    {/* Voiceover Lane */}
                    <div className="multitrack-lane">
                      <span className="multitrack-lane-label">Voiceover</span>
                      {(journey.audio?.tracks || [])
                        .filter((t) => t.type === 'voiceover')
                        .flatMap((t) => t.clips)
                        .map((clip) => {
                          const leftPct = (clip.timelineStartSeconds / Math.max(1, effectiveDuration)) * 100;
                          const widthPct = (clip.durationSeconds / Math.max(1, effectiveDuration)) * 100;
                          return (
                            <div
                              key={clip.id}
                              className="multitrack-clip-block voiceover"
                              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                              title={`${clip.name} (${clip.timelineStartSeconds}s - ${clip.timelineStartSeconds + clip.durationSeconds}s)`}
                              onClick={() => setCurrentTime(clip.timelineStartSeconds)}
                            >
                              {clip.name}
                            </div>
                          );
                        })}
                    </div>

                    {/* Ambient Lane */}
                    <div className="multitrack-lane">
                      <span className="multitrack-lane-label">Ambient</span>
                      {(journey.audio?.tracks || [])
                        .filter((t) => t.type === 'ambient')
                        .flatMap((t) => t.clips)
                        .map((clip) => {
                          const leftPct = (clip.timelineStartSeconds / Math.max(1, effectiveDuration)) * 100;
                          const widthPct = (clip.durationSeconds / Math.max(1, effectiveDuration)) * 100;
                          return (
                            <div
                              key={clip.id}
                              className="multitrack-clip-block ambient"
                              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                              title={`${clip.name} (${clip.timelineStartSeconds}s - ${clip.timelineStartSeconds + clip.durationSeconds}s)`}
                              onClick={() => setCurrentTime(clip.timelineStartSeconds)}
                            >
                              {clip.name}
                            </div>
                          );
                        })}
                    </div>

                    {/* Live Playhead Indicator */}
                    <div
                      className="multitrack-playhead"
                      style={{
                        left: `${(currentTime / Math.max(1, effectiveDuration)) * 100}%`,
                      }}
                    />
                  </div>
                </div>

                {/* Audio Tracks & Clips Detail */}
                {(!journey.audio?.tracks || journey.audio.tracks.length === 0) ? (
                  <div className="audio-empty-msg">No audio tracks available.</div>
                ) : (
                  journey.audio.tracks.map((track) => (
                    <div key={track.id} className="audio-track-card">
                      <div className="audio-track-header">
                        <span className="audio-track-title">
                          {track.type === 'music' ? '🎵' : track.type === 'voiceover' ? '🎙️' : '🌲'} {track.name}
                        </span>
                        <div className="audio-track-controls">
                          <button
                            className="btn-ghost"
                            style={{ padding: '2px 6px', fontSize: '10px', color: track.muted ? '#f87171' : 'var(--text-muted)' }}
                            onClick={() => handleSetAudioTrackVolume(track.id, track.volume, !track.muted)}
                            title={track.muted ? 'Unmute Track' : 'Mute Track'}
                          >
                            {track.muted ? '🔇 MUTED' : '🔊'}
                          </button>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)' }}>
                            {Math.round(track.volume * 100)}%
                          </span>
                        </div>
                      </div>

                      {/* Track Volume Slider */}
                      <input
                        type="range"
                        min="0"
                        max="1.5"
                        step="0.05"
                        value={track.volume}
                        disabled={track.muted}
                        onChange={(e) => handleSetAudioTrackVolume(track.id, Number(e.target.value))}
                      />

                      {/* Track Action Buttons */}
                      <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                        {track.type === 'music' && (
                          <button
                            className="btn-ghost"
                            style={{ flex: 1, fontSize: '10px', justifyContent: 'center' }}
                            onClick={() => handleAddSyntheticScore(track.id)}
                            title="Generate a procedural ambient triad chord score"
                          >
                            ✨ Ambient Score
                          </button>
                        )}
                        {track.type === 'ambient' && (
                          <button
                            className="btn-ghost"
                            style={{ flex: 1, fontSize: '10px', justifyContent: 'center' }}
                            onClick={() => handleAddSyntheticNature(track.id)}
                            title="Generate procedural gentle wind and nature ambience"
                          >
                            🌲 Nature Ambience
                          </button>
                        )}
                        <button
                          className="btn-ghost"
                          style={{ flex: 1, fontSize: '10px', justifyContent: 'center' }}
                          onClick={() => handleSelectAudioFile(track.id)}
                          title="Import audio file (.mp3, .wav, .ogg, .m4a)"
                        >
                          📁 Add File
                        </button>
                      </div>

                      {/* Clips List */}
                      {track.clips.length === 0 ? (
                        <div className="audio-empty-msg">No clips in this track.</div>
                      ) : (
                        track.clips.map((clip) => {
                          const isPreviewing = previewingClipId === clip.id;
                          const linkedScene = (journey.timeline.scenes || []).find((s) => s.id === clip.sceneId);

                          return (
                            <div key={clip.id} className={`audio-clip-card ${isPreviewing ? 'previewing' : ''}`}>
                              <div className="audio-clip-header">
                                <span className="audio-clip-name" title={clip.name}>
                                  {clip.name}
                                </span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <span className={`audio-badge ${clip.type}`}>
                                    {clip.type}
                                  </span>
                                  <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                                    {clip.durationSeconds.toFixed(1)}s
                                  </span>
                                </div>
                                <div style={{ display: 'flex', gap: '4px' }}>
                                  <button
                                    className="btn-ghost"
                                    style={{
                                      padding: '2px 6px',
                                      fontSize: '10px',
                                      color: isPreviewing ? 'var(--accent-cyan)' : 'inherit',
                                    }}
                                    onClick={() => handleTogglePreviewClip(clip)}
                                    title="Preview clip audio"
                                  >
                                    {isPreviewing ? '⏸' : '▶'}
                                  </button>
                                  <button
                                    className="btn-ghost"
                                    style={{ padding: '2px 5px', fontSize: '10px', color: '#f87171' }}
                                    onClick={() => handleDeleteAudioClip(clip.id)}
                                    title="Delete clip"
                                  >
                                    ×
                                  </button>
                                </div>
                              </div>

                              {/* Mini Waveform Visualization */}
                              <div className="audio-waveform-mini">
                                {[0.4, 0.7, 0.5, 0.9, 0.6, 0.8, 0.3, 0.75, 0.65, 0.85, 0.5, 0.4].map((h, bIdx) => (
                                  <div
                                    key={bIdx}
                                    className="audio-waveform-bar"
                                    style={{
                                      height: `${Math.round(h * 100)}%`,
                                      background:
                                        clip.type === 'music'
                                          ? '#c084fc'
                                          : clip.type === 'voiceover'
                                          ? '#fbbf24'
                                          : '#2dd4bf',
                                    }}
                                  />
                                ))}
                              </div>

                              {/* Timeline & Trim Inputs */}
                              <div className="audio-clip-grid">
                                <div className="audio-input-group">
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <label>Start (s)</label>
                                    <div style={{ display: 'flex', gap: '2px' }}>
                                      <button
                                        className="btn-ghost"
                                        style={{ padding: '0 2px', fontSize: '8px' }}
                                        onClick={() => handleUpdateAudioClip(clip.id, { timelineStartSeconds: Math.max(0, clip.timelineStartSeconds - 1) })}
                                        title="Nudge back 1 second"
                                      >
                                        -1s
                                      </button>
                                      <button
                                        className="btn-ghost"
                                        style={{ padding: '0 2px', fontSize: '8px' }}
                                        onClick={() => handleUpdateAudioClip(clip.id, { timelineStartSeconds: clip.timelineStartSeconds + 1 })}
                                        title="Nudge forward 1 second"
                                      >
                                        +1s
                                      </button>
                                    </div>
                                  </div>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.5"
                                    value={clip.timelineStartSeconds}
                                    onChange={(e) => handleUpdateAudioClip(clip.id, { timelineStartSeconds: Math.max(0, Number(e.target.value)) })}
                                  />
                                </div>
                                <div className="audio-input-group">
                                  <label>Trim In (s)</label>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.5"
                                    value={clip.sourceTrimInSeconds}
                                    onChange={(e) => handleUpdateAudioClip(clip.id, { sourceTrimInSeconds: Math.max(0, Number(e.target.value)) })}
                                  />
                                </div>
                                <div className="audio-input-group">
                                  <label>Duration (s)</label>
                                  <input
                                    type="number"
                                    min="0.5"
                                    step="0.5"
                                    value={clip.durationSeconds}
                                    onChange={(e) => handleUpdateAudioClip(clip.id, { durationSeconds: Math.max(0.5, Number(e.target.value)) })}
                                  />
                                </div>
                              </div>

                              {/* Scene Alignment Row (Especially for Voiceover Narration & Ambient) */}
                              <div className="audio-clip-align-row">
                                <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>Scene:</span>
                                <select
                                  style={{
                                    flex: 1,
                                    background: 'rgba(0, 0, 0, 0.4)',
                                    border: '1px solid var(--border-subtle)',
                                    borderRadius: '3px',
                                    color: '#fff',
                                    fontSize: '9px',
                                    padding: '2px 4px',
                                  }}
                                  value={clip.sceneId || ''}
                                  onChange={(e) => {
                                    if (e.target.value) {
                                      handleAlignClipToScene(clip.id, e.target.value);
                                    }
                                  }}
                                >
                                  <option value="">Snap to Story Scene...</option>
                                  {(journey.timeline.scenes || []).map((sc, sIdx) => (
                                    <option key={sc.id} value={sc.id}>
                                      Scene {sIdx + 1}: {sc.name} ({sc.startTime ?? 0}s)
                                    </option>
                                  ))}
                                </select>
                                {linkedScene && (
                                  <button
                                    className="btn-ghost"
                                    style={{ padding: '1px 5px', fontSize: '9px', color: '#f87171' }}
                                    onClick={() => handleUpdateAudioClip(clip.id, { sceneId: undefined })}
                                    title="Unlink from scene"
                                  >
                                    Unlink
                                  </button>
                                )}
                              </div>

                              {/* Volume Slider */}
                              <div className="audio-slider-row">
                                <div className="audio-slider-labels">
                                  <span>Gain</span>
                                  <span>{Math.round(clip.volume * 100)}%</span>
                                </div>
                                <input
                                  type="range"
                                  min="0"
                                  max="1.5"
                                  step="0.05"
                                  value={clip.volume}
                                  onChange={(e) => handleUpdateAudioClip(clip.id, { volume: Number(e.target.value) })}
                                />
                              </div>

                              {/* Fades */}
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                                <div className="audio-slider-row">
                                  <div className="audio-slider-labels">
                                    <span>Fade In</span>
                                    <span>{clip.fadeInSeconds}s</span>
                                  </div>
                                  <input
                                    type="range"
                                    min="0"
                                    max="5"
                                    step="0.5"
                                    value={clip.fadeInSeconds}
                                    onChange={(e) => handleUpdateAudioClip(clip.id, { fadeInSeconds: Number(e.target.value) })}
                                  />
                                </div>
                                <div className="audio-slider-row">
                                  <div className="audio-slider-labels">
                                    <span>Fade Out</span>
                                    <span>{clip.fadeOutSeconds}s</span>
                                  </div>
                                  <input
                                    type="range"
                                    min="0"
                                    max="5"
                                    step="0.5"
                                    value={clip.fadeOutSeconds}
                                    onChange={(e) => handleUpdateAudioClip(clip.id, { fadeOutSeconds: Number(e.target.value) })}
                                  />
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === 'media' && (
              <MediaLibraryPanel
                journey={journey}
                onImportFiles={handleImportMediaFiles}
                onDeleteAsset={handleDeleteMediaAsset}
                onAssignToScene={handleAssignMediaToScene}
                onAssignToAudioTrack={handleAssignMediaToAudioTrack}
                onPreviewAsset={(asset) => setSelectedMediaForPreview(asset)}
                isImporting={isImportingMedia}
                importMessage={mediaImportMessage}
              />
            )}

            {activeTab === 'export' && (
              <div className="export-panel">
                <div className="section-label">
                  <span>Video Export & Deterministic Renderer</span>
                </div>

                {/* Profile Selector */}
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                    Resolution & Aspect Ratio:
                  </div>
                  <div className="export-profile-grid">
                    {exportProfiles.map((p, idx) => (
                      <div
                        key={p.profileName}
                        className={`profile-card ${selectedExportProfileIndex === idx ? 'active' : ''}`}
                        onClick={() => setSelectedExportProfileIndex(idx)}
                      >
                        <span className="profile-name">{p.profileName}</span>
                        <span className="profile-dims">{p.width}×{p.height} ({p.aspectRatio})</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Framerate Selector */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Framerate:</span>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                      className={`btn-ghost ${exportFps === 30 ? 'active' : ''}`}
                      style={{ padding: '2px 8px', fontSize: '11px' }}
                      onClick={() => setExportFps(30)}
                    >
                      30 FPS
                    </button>
                    <button
                      className={`btn-ghost ${exportFps === 60 ? 'active' : ''}`}
                      style={{ padding: '2px 8px', fontSize: '11px' }}
                      onClick={() => setExportFps(60)}
                    >
                      60 FPS
                    </button>
                  </div>
                </div>

                {/* Codec Engine Status */}
                <div style={{
                  fontSize: '11px',
                  padding: '8px',
                  background: 'rgba(0,0,0,0.3)',
                  borderRadius: '6px',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <span>Encoder Engine:</span>
                  <span style={{ color: isWebCodecsSupported() ? '#34d399' : '#fbbf24', fontWeight: 600 }}>
                    {isWebCodecsSupported() ? '✓ Hardware WebCodecs (MP4 H.264)' : '⚠ MediaRecorder (WebM Fallback)'}
                  </span>
                </div>

                {/* Audiovisual Synchronization Status */}
                <div style={{
                  fontSize: '11px',
                  padding: '8px',
                  background: 'rgba(0,0,0,0.3)',
                  borderRadius: '6px',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <span>Audiovisual Mode:</span>
                  <span style={{ color: (journey.audio?.tracks.some(t => t.clips.length > 0)) ? '#38bdf8' : 'var(--text-muted)', fontWeight: 600 }}>
                    {(journey.audio?.tracks.some(t => t.clips.length > 0)) ? '🎵 Synchronized AAC Audio' : '🎬 Video-Only (No Audio Clips)'}
                  </span>
                </div>

                {/* Cinematic Treatment & Color Grade */}
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                    Cinematic Color Grade:
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px', marginBottom: '6px' }}>
                    {[
                      { id: 'none', label: 'Raw' },
                      { id: 'golden-hour', label: '🌅 Amber' },
                      { id: 'alpine-cool', label: '❄️ Alpine' },
                      { id: 'sunset-glow', label: '🌆 Sunset' },
                      { id: 'noir-contrast', label: '🎬 Noir' },
                    ].map((g) => (
                      <button
                        key={g.id}
                        className={`btn-ghost ${exportColorGrade === g.id ? 'active' : ''}`}
                        style={{ fontSize: '10px', padding: '4px 2px', justifyContent: 'center' }}
                        onClick={() => setExportColorGrade(g.id as ColorGradePreset)}
                      >
                        {g.label}
                      </button>
                    ))}
                  </div>

                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      className={`btn-ghost ${exportVignette ? 'active' : ''}`}
                      style={{ flex: 1, fontSize: '10px', padding: '4px', justifyContent: 'center' }}
                      onClick={() => setExportVignette(!exportVignette)}
                    >
                      {exportVignette ? '✓ Vignette' : 'Vignette'}
                    </button>
                    <button
                      className={`btn-ghost ${exportSafeGuides ? 'active' : ''}`}
                      style={{ flex: 1, fontSize: '10px', padding: '4px', justifyContent: 'center' }}
                      onClick={() => setExportSafeGuides(!exportSafeGuides)}
                      title="Draw yellow dashed safe area framing guidelines for social formats"
                    >
                      {exportSafeGuides ? '✓ Safe-Area' : 'Safe-Area'}
                    </button>
                  </div>
                </div>

                {/* Quick Apply Cinematic Preset Templates */}
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                    Cinematic Preset Templates:
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                    {JOURNEY_TEMPLATES.map((tmpl) => (
                      <div
                        key={tmpl.id}
                        className="template-preset-card"
                        onClick={() => handleApplyTemplate(tmpl.id)}
                        title={tmpl.description}
                      >
                        <span style={{ fontSize: '15px' }}>{tmpl.icon}</span>
                        <div style={{ overflow: 'hidden' }}>
                          <div style={{ fontSize: '11px', fontWeight: 600, color: '#f1f5f9', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                            {tmpl.name}
                          </div>
                          <div style={{ fontSize: '9px', color: 'var(--accent-cyan)' }}>
                            {tmpl.recommendedAspectRatio} · {tmpl.defaultDurationSeconds}s
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Action Buttons */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                  <button
                    className="btn-primary"
                    style={{ justifyContent: 'center', padding: '8px 12px', fontSize: '12px' }}
                    disabled={isExporting}
                    onClick={handleStartExport}
                  >
                    {isExporting ? '⏳ Rendering Frames...' : '🎬 Render & Export Video'}
                  </button>
                  <button
                    className="btn-ghost"
                    style={{ justifyContent: 'center', padding: '6px 12px', fontSize: '11px' }}
                    onClick={handleCaptureFramePng}
                    title="Export the currently paused frame as 1080p PNG snapshot"
                  >
                    🖼 Capture 1080p Frame PNG
                  </button>
                </div>

                {/* Live Export Progress Card */}
                {isExporting && exportProgress && (
                  <div className="export-progress-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--accent-cyan)' }}>
                        Phase: {exportProgress.phase.toUpperCase()}
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#fff' }}>
                        {exportProgress.percent}%
                      </span>
                    </div>

                    <div className="export-progress-bar-bg">
                      <div
                        className="export-progress-bar-fill"
                        style={{ width: `${exportProgress.percent}%` }}
                      />
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-muted)' }}>
                      <span>Frame {exportProgress.currentFrame} / {exportProgress.totalFrames}</span>
                      <span>
                        {exportProgress.estimatedRemainingMs > 0
                          ? `~${Math.round(exportProgress.estimatedRemainingMs / 1000)}s left`
                          : 'Finalizing...'}
                      </span>
                    </div>

                    <button
                      className="btn-ghost"
                      style={{ fontSize: '10px', padding: '3px 8px', color: '#f87171', alignSelf: 'flex-end' }}
                      onClick={handleCancelExport}
                    >
                      Cancel Export
                    </button>
                  </div>
                )}

                {/* Export Result Card */}
                {exportResult && !isExporting && (
                  <div className="export-result-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', fontWeight: 600, color: '#34d399' }}>
                        ✓ Export Ready ({Math.round(exportResult.totalFrames)} frames)
                      </span>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                        {(exportResult.sizeBytes / (1024 * 1024)).toFixed(2)} MB
                      </span>
                    </div>

                    {exportResult.hasAudioTrack && (
                      <div style={{ fontSize: '10px', color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span>🎵</span>
                        <span>Track: {exportResult.audioCodec?.toUpperCase()} · {exportResult.audioChannels === 2 ? 'Stereo' : 'Mono'} · {exportResult.audioSampleRate} Hz</span>
                      </div>
                    )}

                    <video
                      controls
                      src={URL.createObjectURL(exportResult.blob)}
                      style={{ width: '100%', maxHeight: '140px', borderRadius: '4px', background: '#000' }}
                    />

                    <button
                      className="btn-primary"
                      style={{ justifyContent: 'center', padding: '6px 10px', fontSize: '11px' }}
                      onClick={() => downloadExportBlob(exportResult.blob, exportResult.filename)}
                    >
                      ⬇ Download {exportResult.filename}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>


        {/* Center: Interactive Map & Overlays */}
        <div className="studio-center">
          <div ref={mapContainerRef} className="map-container" />

          {/* Floating Place Search & Autocomplete */}
          <div className="place-search-overlay" style={{ position: 'absolute', top: 14, left: 14, zIndex: 30 }}>
            <PlaceSearch
              onSelectPlace={handleSelectPlace}
              onAddPlaceToJourney={handleAddPlaceToJourney}
              selectedPlace={selectedPlace}
              onClearSelection={handleClearSearchSelection}
              proximityBias={
                mapInstanceRef.current
                  ? {
                      lat: mapInstanceRef.current.getCenter().lat,
                      lng: mapInstanceRef.current.getCenter().lng,
                    }
                  : undefined
              }
            />
          </div>

          {/* Cinematic Opening / Closing Full Title Card */}
          {currentFrame.storyState?.activeTitleCard && currentFrame.storyState.activeTitleCard.opacity > 0.01 && (
            <div
              className={`cinematic-full-title-card ${currentFrame.storyState.activeTitleCard.type}`}
              style={{
                opacity: currentFrame.storyState.activeTitleCard.opacity,
                transform: currentFrame.storyState.activeTitleCard.motion === 'slow-zoom'
                  ? `scale(${1.0 + currentFrame.storyState.activeTitleCard.progress * 0.04})`
                  : undefined,
              }}
            >
              <div className="title-card-box">
                <span className="title-card-badge">
                  {currentFrame.storyState.activeTitleCard.type === 'opening'
                    ? '◆ WAYVORA EXPEDITION'
                    : '◆ EXPEDITION COMPLETE'}
                </span>
                <div className="title-card-headline">{currentFrame.storyState.activeTitleCard.title}</div>
                {currentFrame.storyState.activeTitleCard.subtitle && (
                  <div className="title-card-subline">{currentFrame.storyState.activeTitleCard.subtitle}</div>
                )}
              </div>
            </div>
          )}

          {/* Cinematic Transition Veil */}
          {currentFrame.storyState?.transition && (
            <div
              className="cinematic-transition-veil"
              style={{
                opacity: Math.sin(currentFrame.storyState.transition.progress * Math.PI) * (currentFrame.storyState.transition.type === 'fade-black' ? 0.96 : 0.88),
                background: currentFrame.storyState.transition.type === 'fade-black' ? '#03060c' : '#05080f',
              }}
            />
          )}

          {/* Cinematic Scene Headline Overlay */}
          {!currentFrame.storyState?.activeTitleCard && currentFrame.storyState?.title && (
            <div className="cinematic-title-card">
              <div className="title-text">{currentFrame.storyState.title}</div>
              {currentFrame.storyState.subtitle && (
                <div className="subtitle-text">{currentFrame.storyState.subtitle}</div>
              )}
            </div>
          )}

          {currentFrame.storyState?.caption && (
            <div className="cinematic-caption-bar">
              <span>{currentFrame.storyState.caption}</span>
            </div>
          )}

          {currentFrame.storyState?.activeMedia && currentFrame.storyState.activeMedia.length > 0 && (() => {
            const asset = currentFrame.storyState.activeMedia[0];
            const isVideo = isSupportedVideoFormat(asset.filename, asset.mimeType);
            const sceneStart = currentFrame.storyState.activeScene?.startTime ?? 0;
            const videoTime = Math.max(0, currentTime - sceneStart);

            if (asset.isMissing) {
              return (
                <div className="floating-photo-card missing-card">
                  <div className="missing-media-placeholder">
                    <span>⚠ Media File Missing</span>
                    <small>{asset.filename}</small>
                  </div>
                </div>
              );
            }

            return (
              <div className="floating-photo-card">
                {isVideo ? (
                  <video
                    src={asset.url}
                    className="media-video-content"
                    playsInline
                    muted
                    ref={(el) => {
                      if (el) synchronizeVideoElement(el, videoTime, isPlaying);
                    }}
                  />
                ) : (
                  <img
                    src={asset.url}
                    alt={asset.filename}
                    onError={() => {
                      asset.isMissing = true;
                    }}
                  />
                )}
                <div className="photo-info">
                  <strong>{asset.title ?? asset.filename}</strong>
                  {asset.caption && <div>{asset.caption}</div>}
                  <div style={{ display: 'flex', gap: '4px', marginTop: '2px' }}>
                    {asset.geoPosition?.ele != null && (
                      <span className="exif-badge">⛰️ {Math.round(asset.geoPosition.ele)}m</span>
                    )}
                    {asset.timestamp && (
                      <span className="exif-badge">
                        🕒 {new Date(asset.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                    {isVideo && <span className="exif-badge video-badge">▶ Video</span>}
                  </div>
                </div>
              </div>
            );
          })()}

          {currentFrame.storyState?.transition && (
            <div
              className="transition-overlay"
              style={{
                opacity:
                  currentFrame.storyState.transition.type === 'fade'
                    ? 1 - Math.abs(currentFrame.storyState.transition.progress - 0.5) * 2
                    : 0.3 * (1 - currentFrame.storyState.transition.progress),
              }}
            />
          )}

          {/* Hidden inputs for media upload */}
          <input
            type="file"
            ref={sceneMediaInputRef}
            accept="image/*,video/mp4,video/webm"
            style={{ display: 'none' }}
            onChange={handleSceneMediaSelected}
          />
          <input
            type="file"
            ref={stopMediaInputRef}
            accept="image/*,video/mp4,video/webm"
            style={{ display: 'none' }}
            onChange={handleStopMediaSelected}
          />
          <input
            type="file"
            ref={audioFileInputRef}
            accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac"
            style={{ display: 'none' }}
            onChange={handleAudioFileSelected}
          />
          <audio ref={audioPreviewRef} style={{ display: 'none' }} />

          {/* Map Top HUD */}
          <div className="map-hud-top">
            <div className="hud-chip">
              <span>Mode:</span>
              <strong style={{ color: TRANSPORT_MODE_METADATA[resolveCanonicalTransportMode(currentFrame.activeTransportMode)].accentColor }}>
                {TRANSPORT_MODE_METADATA[resolveCanonicalTransportMode(currentFrame.activeTransportMode)].label}
              </strong>
            </div>
            <div className="hud-chip">
              <span>Position:</span>
              <strong>
                {currentFrame.position.lat.toFixed(4)}°, {currentFrame.position.lng.toFixed(4)}°
              </strong>
            </div>
            <div className="hud-chip">
              <span>Bearing:</span>
              <strong>{currentFrame.bearing.toFixed(0)}°</strong>
            </div>
            {currentFrame.position.ele != null && (
              <div className="hud-chip">
                <span>Elevation:</span>
                <strong>{currentFrame.position.ele.toFixed(0)} m</strong>
              </div>
            )}
            <div className="hud-chip">
              <span>Progress:</span>
              <strong>{(currentFrame.progress * 100).toFixed(1)}%</strong>
            </div>
            {currentFrame.isDwelling && currentFrame.activeStop && (
              <div className="hud-chip dwell-chip" style={{ background: 'rgba(245, 158, 11, 0.25)', border: '1px solid #f59e0b', color: '#fbbf24' }}>
                <span>⏸ Dwelling:</span>
                <strong>{currentFrame.activeStop.name} ({currentFrame.activeStop.durationAtStop ? `${(currentFrame.dwellProgress * currentFrame.activeStop.durationAtStop).toFixed(1)}s / ${currentFrame.activeStop.durationAtStop}s` : 'Paused'})</strong>
              </div>
            )}
          </div>

          {/* Map Right Quick Controls */}
          <div className="map-hud-right">
            <button
              className="hud-btn"
              title="Reset View"
              onClick={() => {
                if (mapInstanceRef.current) fitMapToBounds(mapInstanceRef.current, allPoints);
              }}
            >
              ⛶
            </button>
            <button
              className="hud-btn"
              title="Toggle 3D Pitch"
              onClick={() => {
                const nextPitch = mapPitch > 30 ? 0 : 60;
                setMapPitch(nextPitch);
                mapInstanceRef.current?.easeTo({ pitch: nextPitch, duration: 600 });
              }}
            >
              3D
            </button>
            <button
              className={`hud-btn ${isTerrain3dEnabled ? 'active' : ''}`}
              title={isTerrain3dEnabled ? '3D Terrain Elevation Mesh Active' : '3D Terrain Disabled (Flat 2D)'}
              onClick={() => {
                const next = !isTerrain3dEnabled;
                setIsTerrain3dEnabled(next);
                showNotification(next ? '3D Terrain Mesh Enabled (AWS Terrarium)' : '3D Terrain Disabled');
              }}
            >
              🏔
            </button>
          </div>

          {/* Elevation HUD Mini Profile */}
          {elevationSvgPath && (
            <div className="elevation-hud">
              <h4>
                <span>Elevation HUD</span>
                <span>{currentFrame.position.ele ? `${currentFrame.position.ele.toFixed(0)}m` : 'Profile'}</span>
              </h4>
              <svg className="elevation-svg" viewBox="0 0 230 48">
                <defs>
                  <linearGradient id="eleGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#00f2fe" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#4facfe" stopOpacity="0.05" />
                  </linearGradient>
                </defs>
                <path d={elevationSvgPath} fill="url(#eleGrad)" stroke="#00f2fe" strokeWidth="1.5" />
                {/* Current Playhead on elevation profile */}
                <line
                  x1={currentFrame.progress * 230}
                  y1="0"
                  x2={currentFrame.progress * 230}
                  y2="48"
                  stroke="#ffffff"
                  strokeWidth="2"
                  strokeDasharray="2 2"
                />
              </svg>
            </div>
          )}

          {/* Map Attribution Notice */}
          <div className="map-attribution-overlay" title={fullActiveAttribution}>
            {fullActiveAttribution}
          </div>
        </div>

        {/* Right Inspector: Camera & Visual Director */}
        <aside className="studio-inspector">
          <div className="control-group">
            <div className="control-header">
              <span>Camera Director</span>
              <span style={{ fontSize: '10px', color: isKeyframeTrackActive ? 'var(--accent-cyan)' : 'var(--text-muted)' }}>
                {isKeyframeTrackActive ? 'Keyframe Track' : 'Manual Follow'}
              </span>
            </div>
            <div className="camera-grid">
              {(['overview', 'flyover', 'chase', 'ground', 'orbit'] as CameraMode[]).map((mode) => (
                <button
                  key={mode}
                  className={`camera-card ${cameraMode === mode ? 'active' : ''}`}
                  onClick={() => setCameraMode(mode)}
                >
                  {mode.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Live Terrain Ground Clearance HUD */}
          {liveClearance && (
            <div className="control-group">
              <div className="control-header">
                <span>Terrain Clearance HUD</span>
              </div>
              <div className="camera-clearance-hud">
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Ground Under Camera:</span>
                  <strong>{liveClearance.groundElevationAtCamera} m</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Camera Eye Altitude:</span>
                  <strong>{liveClearance.effectiveCameraAltitude} m</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Ground Clearance:</span>
                  <strong>{liveClearance.clearanceMetres} m</strong>
                </div>
                <div
                  className={`camera-clearance-status ${
                    liveClearance.isClippingAverted ? 'clearance-averted' : 'clearance-safe'
                  }`}
                >
                  {liveClearance.isClippingAverted
                    ? `⚠ Mountain Clipping Averted (Pitch: ${liveClearance.clampedPitch}°)`
                    : '✓ Safe Terrain Clearance'}
                </div>
              </div>
            </div>
          )}

          {/* Cinematic Keyframe Sequencer */}
          <div className="control-group">
            <div className="control-header">
              <span>Cinematic Keyframe Track</span>
              <button
                style={{
                  background: 'none',
                  border: 'none',
                  color: isKeyframeTrackActive ? 'var(--accent-cyan)' : 'var(--text-muted)',
                  fontSize: '10px',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
                onClick={() => {
                  const next = !isKeyframeTrackActive;
                  setIsKeyframeTrackActive(next);
                  showNotification(next ? 'Keyframe Track Active' : 'Manual Route Follow Active');
                }}
              >
                {isKeyframeTrackActive ? 'TRACK: ON' : 'TRACK: OFF'}
              </button>
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                className="btn-ghost"
                style={{ flex: 1, fontSize: '10px', justifyContent: 'center' }}
                onClick={handleGenerateAutoCam}
                title="Synthesize smart camera keyframe sequence honoring roads, trails and stop dwells"
              >
                ✨ AutoCam
              </button>
              <button
                className="btn-ghost"
                style={{ flex: 1, fontSize: '10px', justifyContent: 'center' }}
                onClick={handleAddKeyframeAtCurrentTime}
                title="Add camera keyframe at current playhead time"
              >
                ➕ Add KF
              </button>
              {cameraKeyframes.length > 0 && (
                <button
                  className="btn-ghost"
                  style={{ fontSize: '10px', padding: '0 8px' }}
                  onClick={handleClearKeyframes}
                  title="Clear all keyframes"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Keyframe List */}
            {cameraKeyframes.length > 0 ? (
              <div className="keyframe-list">
                {cameraKeyframes.map((kf) => (
                  <div key={kf.id} className="keyframe-item">
                    <span className="keyframe-time">{formatTime(kf.time)}</span>
                    <span className="keyframe-badge">{kf.mode}</span>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                      {kf.pitch}°/{kf.zoom}x
                    </span>
                    <button
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--accent-cyan)',
                        fontSize: '10px',
                        cursor: 'pointer',
                        padding: '0 4px',
                      }}
                      onClick={() => setCurrentTime(kf.time)}
                      title="Seek to keyframe"
                    >
                      ▶
                    </button>
                    <button
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#f87171',
                        fontSize: '11px',
                        cursor: 'pointer',
                        padding: '0 4px',
                      }}
                      onClick={() => handleDeleteKeyframe(kf.id)}
                      title="Delete keyframe"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : activeTab === 'story' ? (
              <div className="story-editor-panel">
                <div className="section-label">
                  <span>Cinematic Story & Narrative Timeline</span>
                </div>

                {/* Opening & Closing Title Cards Configuration */}
                <div className="title-cards-config-card">
                  <h4>
                    <span>🎬 Cinematic Title Cards</span>
                    <button
                      className="btn-ghost"
                      style={{ padding: '2px 6px', fontSize: '10px' }}
                      onClick={handleInitDefaultTitleCards}
                      title="Reset opening and closing title cards to defaults"
                    >
                      ↺ Defaults
                    </button>
                  </h4>

                  {/* Opening Title Card */}
                  <div className="title-card-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={journey.timeline.titleCards?.opening?.enabled ?? true}
                          onChange={(e) => handleUpdateTitleCards({
                            opening: {
                              enabled: e.target.checked,
                              title: journey.timeline.titleCards?.opening?.title ?? journey.name,
                              subtitle: journey.timeline.titleCards?.opening?.subtitle ?? 'From Roads to Trails, Every Journey Becomes a Story',
                              duration: journey.timeline.titleCards?.opening?.duration ?? 3.5,
                              motion: journey.timeline.titleCards?.opening?.motion ?? 'slow-zoom',
                            }
                          })}
                        />
                        Opening Title Card
                      </label>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                        {(journey.timeline.titleCards?.opening?.duration ?? 3.5).toFixed(1)}s
                      </span>
                    </div>

                    {(journey.timeline.titleCards?.opening?.enabled ?? true) && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <input
                          type="text"
                          value={journey.timeline.titleCards?.opening?.title ?? journey.name}
                          placeholder="Opening Headline Title..."
                          style={{
                            background: 'rgba(0,0,0,0.3)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: '4px',
                            color: '#fff',
                            fontSize: '11px',
                            padding: '3px 6px',
                          }}
                          onChange={(e) => handleUpdateTitleCards({
                            opening: {
                              ...(journey.timeline.titleCards?.opening ?? { enabled: true }),
                              title: e.target.value,
                              duration: journey.timeline.titleCards?.opening?.duration ?? 3.5,
                            }
                          })}
                        />
                        <input
                          type="text"
                          value={journey.timeline.titleCards?.opening?.subtitle ?? ''}
                          placeholder="Opening Subtitle..."
                          style={{
                            background: 'rgba(0,0,0,0.3)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: '4px',
                            color: '#cbd5e1',
                            fontSize: '10px',
                            padding: '2px 6px',
                          }}
                          onChange={(e) => handleUpdateTitleCards({
                            opening: {
                              ...(journey.timeline.titleCards?.opening ?? { enabled: true, title: journey.name }),
                              subtitle: e.target.value,
                              duration: journey.timeline.titleCards?.opening?.duration ?? 3.5,
                            }
                          })}
                        />
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '2px' }}>
                          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Motion:</span>
                          <select
                            style={{
                              background: 'rgba(0,0,0,0.4)',
                              color: '#fff',
                              border: '1px solid var(--border-subtle)',
                              borderRadius: '3px',
                              fontSize: '10px',
                              padding: '2px 4px',
                              flex: 1,
                            }}
                            value={journey.timeline.titleCards?.opening?.motion ?? 'slow-zoom'}
                            onChange={(e) => handleUpdateTitleCards({
                              opening: {
                                ...(journey.timeline.titleCards?.opening ?? { enabled: true, title: journey.name }),
                                motion: e.target.value as TitleCardMotion,
                                duration: journey.timeline.titleCards?.opening?.duration ?? 3.5,
                              }
                            })}
                          >
                            <option value="slow-zoom">Slow Zoom (Cinematic)</option>
                            <option value="fade">Smooth Fade</option>
                            <option value="none">Static Cut</option>
                          </select>
                          <input
                            type="range"
                            min="1.5"
                            max="7.0"
                            step="0.5"
                            value={journey.timeline.titleCards?.opening?.duration ?? 3.5}
                            style={{ width: '75px' }}
                            title="Opening card duration (seconds)"
                            onChange={(e) => handleUpdateTitleCards({
                              opening: {
                                ...(journey.timeline.titleCards?.opening ?? { enabled: true, title: journey.name }),
                                duration: Number(e.target.value),
                              }
                            })}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Closing Title Card */}
                  <div className="title-card-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={journey.timeline.titleCards?.closing?.enabled ?? true}
                          onChange={(e) => handleUpdateTitleCards({
                            closing: {
                              enabled: e.target.checked,
                              title: journey.timeline.titleCards?.closing?.title ?? 'Journey Complete',
                              subtitle: journey.timeline.titleCards?.closing?.subtitle ?? `${journey.stops.length} Stops · Created with Wayvora`,
                              duration: journey.timeline.titleCards?.closing?.duration ?? 3.5,
                              motion: journey.timeline.titleCards?.closing?.motion ?? 'fade',
                            }
                          })}
                        />
                        Closing Title Card
                      </label>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                        {(journey.timeline.titleCards?.closing?.duration ?? 3.5).toFixed(1)}s
                      </span>
                    </div>

                    {(journey.timeline.titleCards?.closing?.enabled ?? true) && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <input
                          type="text"
                          value={journey.timeline.titleCards?.closing?.title ?? 'Journey Complete'}
                          placeholder="Closing Headline..."
                          style={{
                            background: 'rgba(0,0,0,0.3)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: '4px',
                            color: '#fff',
                            fontSize: '11px',
                            padding: '3px 6px',
                          }}
                          onChange={(e) => handleUpdateTitleCards({
                            closing: {
                              ...(journey.timeline.titleCards?.closing ?? { enabled: true }),
                              title: e.target.value,
                              duration: journey.timeline.titleCards?.closing?.duration ?? 3.5,
                            }
                          })}
                        />
                        <input
                          type="text"
                          value={journey.timeline.titleCards?.closing?.subtitle ?? ''}
                          placeholder="Closing Subtitle..."
                          style={{
                            background: 'rgba(0,0,0,0.3)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: '4px',
                            color: '#cbd5e1',
                            fontSize: '10px',
                            padding: '2px 6px',
                          }}
                          onChange={(e) => handleUpdateTitleCards({
                            closing: {
                              ...(journey.timeline.titleCards?.closing ?? { enabled: true, title: 'Journey Complete' }),
                              subtitle: e.target.value,
                              duration: journey.timeline.titleCards?.closing?.duration ?? 3.5,
                            }
                          })}
                        />
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '2px' }}>
                          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Motion:</span>
                          <select
                            style={{
                              background: 'rgba(0,0,0,0.4)',
                              color: '#fff',
                              border: '1px solid var(--border-subtle)',
                              borderRadius: '3px',
                              fontSize: '10px',
                              padding: '2px 4px',
                              flex: 1,
                            }}
                            value={journey.timeline.titleCards?.closing?.motion ?? 'fade'}
                            onChange={(e) => handleUpdateTitleCards({
                              closing: {
                                ...(journey.timeline.titleCards?.closing ?? { enabled: true, title: 'Journey Complete' }),
                                motion: e.target.value as TitleCardMotion,
                                duration: journey.timeline.titleCards?.closing?.duration ?? 3.5,
                              }
                            })}
                          >
                            <option value="fade">Smooth Fade</option>
                            <option value="slow-zoom">Slow Zoom</option>
                            <option value="none">Static Cut</option>
                          </select>
                          <input
                            type="range"
                            min="1.5"
                            max="7.0"
                            step="0.5"
                            value={journey.timeline.titleCards?.closing?.duration ?? 3.5}
                            style={{ width: '75px' }}
                            title="Closing card duration (seconds)"
                            onChange={(e) => handleUpdateTitleCards({
                              closing: {
                                ...(journey.timeline.titleCards?.closing ?? { enabled: true, title: 'Journey Complete' }),
                                duration: Number(e.target.value),
                              }
                            })}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
                  <button
                    className="btn-ghost"
                    style={{ flex: 1, fontSize: '11px', justifyContent: 'center' }}
                    onClick={handleAutoStory}
                    title="Synthesize smart narrative scenes with titles, subtitles and captions"
                  >
                    ✨ AutoStory
                  </button>
                  <button
                    className="btn-ghost"
                    style={{ flex: 1, fontSize: '11px', justifyContent: 'center' }}
                    onClick={handleAddStoryScene}
                    title="Add a custom scene at current playhead time"
                  >
                    ➕ Add Scene
                  </button>
                </div>

                {(!journey.timeline.scenes || journey.timeline.scenes.length === 0) ? (
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic', padding: '12px 4px' }}>
                    No story scenes defined yet. Click &quot;✨ AutoStory&quot; to automatically build scenes from your stops and route.
                  </div>
                ) : (
                  (journey.timeline.scenes as StoryScene[]).map((scene, sceneIdx) => {
                    const isActive = currentFrame.storyState?.activeScene?.id === scene.id;
                    const scenesCount = journey.timeline.scenes?.length ?? 0;
                    return (
                      <div
                        key={scene.id}
                        className={`story-scene-card ${isActive ? 'active-scene' : ''}`}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <button
                              className="scene-reorder-btn"
                              disabled={sceneIdx === 0}
                              onClick={() => handleReorderStoryScene(sceneIdx, sceneIdx - 1)}
                              title="Move scene earlier in narrative"
                            >
                              ▲
                            </button>
                            <button
                              className="scene-reorder-btn"
                              disabled={sceneIdx === scenesCount - 1}
                              onClick={() => handleReorderStoryScene(sceneIdx, sceneIdx + 1)}
                              title="Move scene later in narrative"
                            >
                              ▼
                            </button>
                            <span className={`scene-intent-badge intent-${scene.intent ?? 'travel'}`}>
                              {scene.intent ?? 'travel'}
                            </span>
                          </div>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--accent-cyan)' }}>
                            {formatTime(scene.startTime)} - {formatTime(scene.endTime)}
                          </span>
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <button
                              className="btn-ghost"
                              style={{ padding: '2px 5px', fontSize: '10px' }}
                              onClick={() => setCurrentTime(scene.startTime)}
                              title="Seek to scene start"
                            >
                              ▶
                            </button>
                            <button
                              className="btn-ghost"
                              style={{ padding: '2px 5px', fontSize: '10px', color: '#f87171' }}
                              onClick={() => handleDeleteStoryScene(scene.id)}
                              title="Delete scene"
                            >
                              ×
                            </button>
                          </div>
                        </div>

                        {/* Title Input */}
                        <input
                          type="text"
                          value={scene.title ?? ''}
                          placeholder="Scene Headline Title..."
                          style={{
                            background: 'rgba(0,0,0,0.25)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: '4px',
                            color: '#fff',
                            fontSize: '11px',
                            padding: '4px 6px',
                          }}
                          onChange={(e) => handleUpdateStoryScene(scene.id, { title: e.target.value })}
                        />

                        {/* Subtitle Input */}
                        <input
                          type="text"
                          value={scene.subtitle ?? ''}
                          placeholder="Supporting Subtitle..."
                          style={{
                            background: 'rgba(0,0,0,0.25)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: '4px',
                            color: '#cbd5e1',
                            fontSize: '10px',
                            padding: '3px 6px',
                          }}
                          onChange={(e) => handleUpdateStoryScene(scene.id, { subtitle: e.target.value })}
                        />

                        {/* Caption Textarea */}
                        <textarea
                          rows={2}
                          value={scene.caption ?? ''}
                          placeholder="Story / Travelogue commentary..."
                          style={{
                            background: 'rgba(0,0,0,0.25)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: '4px',
                            color: '#e2e8f0',
                            fontSize: '10px',
                            padding: '4px 6px',
                            resize: 'none',
                          }}
                          onChange={(e) => handleUpdateStoryScene(scene.id, { caption: e.target.value })}
                        />

                        {/* Scene Timing & Duration Row */}
                        <div className="scene-timing-row">
                          <div className="scene-timing-field">
                            <label>Start</label>
                            <input
                              type="number"
                              step="0.5"
                              min="0"
                              value={scene.startTime}
                              onChange={(e) => {
                                const val = Math.max(0, Number(e.target.value));
                                const dur = Math.max(0.5, scene.endTime - scene.startTime);
                                handleUpdateStoryScene(scene.id, { startTime: val, endTime: Math.round((val + dur) * 10) / 10 });
                              }}
                            />
                          </div>
                          <div className="scene-timing-field">
                            <label>Duration</label>
                            <input
                              type="number"
                              step="0.5"
                              min="0.5"
                              value={Math.round((scene.endTime - scene.startTime) * 10) / 10}
                              onChange={(e) => {
                                const dur = Math.max(0.5, Number(e.target.value));
                                handleUpdateStoryScene(scene.id, { endTime: Math.round((scene.startTime + dur) * 10) / 10 });
                              }}
                            />
                          </div>
                          <div className="scene-timing-field">
                            <label>End</label>
                            <input
                              type="number"
                              step="0.5"
                              min={scene.startTime + 0.5}
                              value={scene.endTime}
                              onChange={(e) => {
                                const end = Math.max(scene.startTime + 0.5, Number(e.target.value));
                                handleUpdateStoryScene(scene.id, { endTime: Math.round(end * 10) / 10 });
                              }}
                            />
                          </div>
                        </div>

                        {/* Scene Stop and Segment Link Row */}
                        <div className="scene-link-row">
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <label style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Link Stop</label>
                            <select
                              style={{
                                background: 'rgba(0,0,0,0.4)',
                                color: '#fff',
                                border: '1px solid var(--border-subtle)',
                                borderRadius: '3px',
                                fontSize: '10px',
                                padding: '2px 4px',
                              }}
                              value={scene.stopId ?? ''}
                              onChange={(e) => handleUpdateStoryScene(scene.id, { stopId: e.target.value || undefined })}
                            >
                              <option value="">[None / Open Route]</option>
                              {journey.stops.map((st, sIdx) => (
                                <option key={st.id} value={st.id}>
                                  Stop #{sIdx + 1}: {st.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <label style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Link Segment</label>
                            <select
                              style={{
                                background: 'rgba(0,0,0,0.4)',
                                color: '#fff',
                                border: '1px solid var(--border-subtle)',
                                borderRadius: '3px',
                                fontSize: '10px',
                                padding: '2px 4px',
                              }}
                              value={scene.segmentId ?? ''}
                              onChange={(e) => handleUpdateStoryScene(scene.id, { segmentId: e.target.value || undefined })}
                            >
                              <option value="">[None / General]</option>
                              {journey.segments.map((sg, gIdx) => (
                                <option key={sg.id} value={sg.id}>
                                  Segment #{gIdx + 1} ({sg.transportMode.toUpperCase()})
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        {/* Transition Control */}
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '6px' }}>
                          <span style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Transition:</span>
                          <select
                            style={{
                              background: 'rgba(0,0,0,0.4)',
                              color: '#fff',
                              border: '1px solid var(--border-subtle)',
                              borderRadius: '3px',
                              fontSize: '10px',
                              padding: '2px 4px',
                              flex: 1,
                            }}
                            value={scene.transition?.type ?? 'cut'}
                            onChange={(e) => handleUpdateStoryScene(scene.id, {
                              transition: {
                                type: e.target.value as TransitionType,
                                duration: scene.transition?.duration ?? 0.8,
                              }
                            })}
                          >
                            <option value="cut">Cut (Instant)</option>
                            <option value="crossfade">Crossfade (Atmosphere)</option>
                            <option value="fade-black">Fade Through Black</option>
                          </select>
                          {scene.transition?.type && scene.transition.type !== 'cut' && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <input
                                type="range"
                                min="0.3"
                                max="2.5"
                                step="0.1"
                                value={scene.transition.duration}
                                style={{ width: '55px' }}
                                title={`Transition duration: ${scene.transition.duration}s`}
                                onChange={(e) => handleUpdateStoryScene(scene.id, {
                                  transition: {
                                    type: scene.transition!.type,
                                    duration: Number(e.target.value),
                                  }
                                })}
                              />
                              <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                                {scene.transition.duration}s
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Controls Row: Mode & Intent */}
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '6px' }}>
                          <select
                            value={scene.intent ?? 'travel'}
                            style={{
                              flex: 1,
                              background: 'var(--bg-card)',
                              border: '1px solid var(--border-subtle)',
                              color: '#fff',
                              fontSize: '10px',
                              padding: '2px 4px',
                              borderRadius: '3px',
                            }}
                            onChange={(e) => handleUpdateStoryScene(scene.id, { intent: e.target.value as SceneIntent })}
                          >
                            <option value="establishing">Establishing</option>
                            <option value="travel">Travel</option>
                            <option value="stop">Stop</option>
                            <option value="highlight">Highlight</option>
                            <option value="arrival">Arrival</option>
                          </select>

                          <button
                            className="btn-ghost"
                            style={{ fontSize: '10px', padding: '2px 6px' }}
                            onClick={() => {
                              targetSceneIdForMedia.current = scene.id;
                              sceneMediaInputRef.current?.click();
                            }}
                            title="Attach local photo or video to scene"
                          >
                            📷 + File
                          </button>

                          {journey.mediaLibrary && journey.mediaLibrary.some((m) => m.type !== 'audio') && (
                            <select
                              style={{
                                background: 'var(--bg-card)',
                                border: '1px solid var(--border-subtle)',
                                color: '#38bdf8',
                                fontSize: '10px',
                                padding: '2px 4px',
                                borderRadius: '3px',
                                maxWidth: '90px',
                              }}
                              defaultValue=""
                              onChange={(e) => {
                                if (e.target.value) {
                                  handleAssignMediaToScene(scene.id, e.target.value);
                                  e.target.value = '';
                                }
                              }}
                              title="Attach existing media from your Media Library"
                            >
                              <option value="" disabled>🖼️ Library</option>
                              {journey.mediaLibrary.filter((m) => m.type !== 'audio').map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.title || m.filename} ({m.type.toUpperCase()})
                                </option>
                              ))}
                            </select>
                          )}
                        </div>

                        {/* Attached Media List */}
                        {scene.media && scene.media.length > 0 && (
                          <div className="scene-media-row">
                            {scene.media.map((med) => (
                              <div key={med.id} style={{ position: 'relative' }}>
                                <img
                                  src={med.url}
                                  alt={med.filename}
                                  className="scene-thumb"
                                  title={`${med.title ?? med.filename}${med.geoPosition?.ele ? ` (${med.geoPosition.ele}m)` : ''}`}
                                />
                                <button
                                  style={{
                                    position: 'absolute',
                                    top: '-4px',
                                    right: '-4px',
                                    background: '#ef4444',
                                    border: 'none',
                                    borderRadius: '50%',
                                    color: '#fff',
                                    width: '14px',
                                    height: '14px',
                                    fontSize: '9px',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                  }}
                                  onClick={() => handleRemoveMediaFromScene(scene.id, med.id)}
                                  title="Remove media from scene"
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            ) : (
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                No custom keyframes. Click &quot;✨ AutoCam&quot; to synthesize a cinematic camera sequence.
              </div>
            )}
          </div>

          <div className="control-group">
            <div className="control-header">
              <span>Camera Pitch</span>
            </div>
            <div className="slider-row">
              <div className="slider-labels">
                <span>Angle</span>
                <span>{mapPitch}°</span>
              </div>
              <input
                type="range"
                min="0"
                max="75"
                value={mapPitch}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setMapPitch(val);
                  mapInstanceRef.current?.setPitch(val);
                }}
              />
            </div>
          </div>

          <div className="control-group">
            <div className="control-header">
              <span>Zoom Level</span>
            </div>
            <div className="slider-row">
              <div className="slider-labels">
                <span>Zoom</span>
                <span>{mapZoom}x</span>
              </div>
              <input
                type="range"
                min="5"
                max="17"
                step="0.5"
                value={mapZoom}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setMapZoom(val);
                  mapInstanceRef.current?.setZoom(val);
                }}
              />
            </div>
          </div>

          {/* Basemap & 3D Terrain Director */}
          <div className="control-group">
            <div className="control-header">
              <span>Basemap & 3D Terrain</span>
              <span style={{ fontSize: '10px', color: isTerrain3dEnabled ? '#34d399' : 'var(--text-muted)' }}>
                {isTerrain3dEnabled ? (terrainStatus === 'fallback' ? 'Flat Fallback' : 'Active 3D') : 'Disabled'}
              </span>
            </div>

            {/* Map Style Selector Buttons */}
            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '5px' }}>
                Map Style
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '4px' }}>
                {MAP_STYLE_IDS.map((styleId) => {
                  const s = MAP_STYLES[styleId];
                  const isActive = currentMapStyle === styleId;
                  return (
                    <button
                      key={styleId}
                      className={`btn-ghost ${isActive ? 'active' : ''}`}
                      style={{ fontSize: '11px', padding: '5px 6px', justifyContent: 'center', textAlign: 'center' }}
                      onClick={() => handleStyleChange(styleId)}
                      title={s.description}
                    >
                      {s.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
              <button
                className={`btn-ghost ${isTerrain3dEnabled ? 'active' : ''}`}
                style={{ flex: 1, fontSize: '11px', justifyContent: 'center' }}
                onClick={() => {
                  const next = !isTerrain3dEnabled;
                  setIsTerrain3dEnabled(next);
                  showNotification(next ? '3D Terrain Mesh Enabled (AWS Terrarium)' : '3D Terrain Disabled');
                }}
              >
                {isTerrain3dEnabled ? '🏔 3D Terrain: ON' : '🗺 2D Map: FLAT'}
              </button>
            </div>
            {isTerrain3dEnabled && (
              <div className="slider-row">
                <div className="slider-labels">
                  <span>Terrain Exaggeration</span>
                  <span>{terrainExaggeration.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="2.5"
                  step="0.1"
                  value={terrainExaggeration}
                  onChange={(e) => setTerrainExaggeration(Number(e.target.value))}
                />
              </div>
            )}
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '6px', lineHeight: '1.4' }}>
              <strong style={{ color: 'var(--text-secondary)' }}>Attribution:</strong> {fullActiveAttribution}
            </div>
          </div>

          {/* 3D Transport Model Director */}
          <div className="control-group">
            <div className="control-header">
              <span>Transport Model Director</span>
              <span style={{
                fontSize: '10px',
                fontWeight: 600,
                color: transportRenderMode === '2d-icon'
                  ? 'var(--text-muted)'
                  : (has3DModelAsset(resolveCanonicalTransportMode(currentFrame.activeTransportMode || 'car')) ? '#38bdf8' : '#fbbf24')
              }}>
                {transportRenderMode === '2d-icon'
                  ? '2D Icons Forced'
                  : (has3DModelAsset(resolveCanonicalTransportMode(currentFrame.activeTransportMode || 'car'))
                      ? `3D (${resolveCanonicalTransportMode(currentFrame.activeTransportMode || 'car').toUpperCase()})`
                      : `2D (${resolveCanonicalTransportMode(currentFrame.activeTransportMode || 'car').toUpperCase()} Fallback)`)}
              </span>
            </div>

            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '5px' }}>
              Rendering Mode
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px', marginBottom: '8px' }}>
              {(['auto', '3d-model', '2d-icon'] as TransportRenderMode[]).map((mode) => (
                <button
                  key={mode}
                  className={`btn-ghost ${transportRenderMode === mode ? 'active' : ''}`}
                  style={{ fontSize: '10px', padding: '5px 2px', justifyContent: 'center', textAlign: 'center' }}
                  onClick={() => {
                    setTransportRenderMode(mode);
                    if (transport3dLayerRef.current) {
                      transport3dLayerRef.current.setRenderMode(mode);
                    }
                    showNotification(
                      mode === '3d-model'
                        ? 'Transport: 3D Models (Preferred)'
                        : mode === 'auto'
                        ? 'Transport: Auto (3D + 2D Fallback)'
                        : 'Transport: 2D Icons (Forced)'
                    );
                  }}
                >
                  {mode === '3d-model' ? '🏎 3D Model' : mode === 'auto' ? '✨ Auto' : '🎯 2D Icon'}
                </button>
              ))}
            </div>

            {/* Active Model Status & Legal Attribution */}
            {(() => {
              const activeMode = resolveCanonicalTransportMode(currentFrame.activeTransportMode || 'car');
              const def = getModelDefinition(activeMode);
              const hasAsset = has3DModelAsset(activeMode);
              const meta = TRANSPORT_MODE_METADATA[activeMode];
              return (
                <div style={{
                  fontSize: '10px',
                  background: 'rgba(0,0,0,0.35)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  padding: '8px',
                  lineHeight: '1.4'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Active Mode:</span>
                    <strong style={{ color: meta.accentColor }}>{meta.label}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Asset Status:</span>
                    <span style={{ color: (hasAsset && transportRenderMode !== '2d-icon') ? '#34d399' : '#fbbf24', fontWeight: 600 }}>
                      {transportRenderMode === '2d-icon'
                        ? '🎯 2D Vector Silhouette'
                        : hasAsset
                        ? '✓ 3D glTF Model Active'
                        : 'ℹ Deterministic 2D Fallback'}
                    </span>
                  </div>
                  <div style={{
                    color: 'var(--text-muted)',
                    fontSize: '9px',
                    borderTop: '1px solid rgba(255,255,255,0.08)',
                    paddingTop: '4px',
                    marginTop: '4px'
                  }}>
                    <strong style={{ color: 'var(--text-secondary)' }}>Licensing:</strong> {def.attribution}
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="control-group">
            <div className="control-header">
              <span>Cinematic Atmosphere</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              {['Alpine Dark', 'Sunset Gold', 'Neon Cyber', 'Clean Slate'].map((preset, idx) => (
                <button
                  key={preset}
                  className={`btn-ghost ${idx === 0 ? 'active' : ''}`}
                  style={{ justifyContent: 'center' }}
                  onClick={() => showNotification(`Atmosphere set: ${preset}`)}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>
        </aside>
      </main>

      {/* ─── Bottom Timeline Studio ─── */}
      <footer className="studio-timeline">
        <div className="timeline-controls">
          <div className="playback-buttons">
            <button
              className="btn-play"
              onClick={() => setIsPlaying((p) => !p)}
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? '⏸' : '▶'}
            </button>
            <button
              className="btn-ghost"
              onClick={() => {
                setCurrentTime(0);
                setIsPlaying(false);
              }}
              title="Reset Timeline"
            >
              ⏮
            </button>
            <div className="timecode-display">
              {currentTime.toFixed(1)}s <span>/ {effectiveDuration.toFixed(1)}s</span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Speed:</span>
            {[0.5, 1, 2, 4].map((spd) => (
              <button
                key={spd}
                className={`btn-ghost ${playbackSpeed === spd ? 'active' : ''}`}
                style={{ padding: '2px 8px', fontSize: '11px' }}
                onClick={() => setPlaybackSpeed(spd)}
              >
                {spd}x
              </button>
            ))}
            <button
              className={`btn-ghost ${stopDwellEnabled ? 'active' : ''}`}
              style={{ fontSize: '11px', padding: '2px 8px', marginLeft: '6px' }}
              onClick={() => setStopDwellEnabled((v) => !v)}
              title="Toggle Stop Dwell Pauses in Playback"
            >
              ⏸ Dwell: {stopDwellEnabled ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>

        {/* Timeline Track with Scene Markers and Playhead */}
        <div className="timeline-track-wrapper" onClick={handleTimelineScrub}>
          <div
            className="timeline-progress-bar"
            style={{ width: `${(currentTime / effectiveDuration) * 100}%` }}
          />
          <div className="timeline-scene-markers">
            {journey.timeline.scenes.map((scene) => {
              const startPct = scene.startPercent ?? (scene.startTime != null ? scene.startTime / effectiveDuration : 0);
              const endPct = scene.endPercent ?? (scene.endTime != null ? scene.endTime / effectiveDuration : 1);
              const widthPct = Math.max(0, Math.min(100, (endPct - startPct) * 100));
              return (
                <div
                  key={scene.id}
                  className="scene-block"
                  style={{ width: `${widthPct}%` }}
                >
                  {scene.name} ({scene.cameraMode})
                </div>
              );
            })}
          </div>
          <div
            className="timeline-playhead"
            style={{ left: `${(currentTime / effectiveDuration) * 100}%` }}
          />
        </div>
      </footer>

      {/* Toast Notification */}
      {notification && <div className="notification-toast">{notification}</div>}

      {/* GPX Inspection & Import Modal */}
      {isGpxModalOpen && gpxResult && (
        <div className="modal-backdrop" onClick={() => setIsGpxModalOpen(false)}>
          <div className="gpx-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                <span>GPX Import Inspection</span>
                <span style={{ fontSize: '12px', color: '#00f2fe', fontWeight: 400 }}>
                  {gpxResult.summary.filename}
                </span>
              </h3>
              <button
                className="btn-ghost"
                style={{ padding: '2px 8px' }}
                onClick={() => setIsGpxModalOpen(false)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '14px', lineHeight: '1.5' }}>
                {gpxResult.summary.name ? <strong>{gpxResult.summary.name}</strong> : 'Unnamed Track'}{' '}
                {gpxResult.summary.description && <span>— {gpxResult.summary.description}</span>}
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Creator: {gpxResult.summary.creator || 'Standard GPX'} | Imported: {new Date(gpxResult.summary.importedAt).toLocaleTimeString()}
                </div>
              </div>

              <div className="gpx-summary-grid">
                <div className="gpx-stat-card">
                  <span className="stat-label">Total Distance</span>
                  <span className="stat-value">{(gpxResult.summary.totalDistanceMetres / 1000).toFixed(2)} km</span>
                </div>
                <div className="gpx-stat-card">
                  <span className="stat-label">Track Points</span>
                  <span className="stat-value">{gpxResult.summary.totalPoints}</span>
                </div>
                <div className="gpx-stat-card">
                  <span className="stat-label">Track Segments</span>
                  <span className="stat-value">{gpxResult.summary.totalSegments}</span>
                </div>
                <div className="gpx-stat-card">
                  <span className="stat-label">Waypoints</span>
                  <span className="stat-value">{gpxResult.summary.totalWaypoints}</span>
                </div>
                <div className="gpx-stat-card">
                  <span className="stat-label">Elevation Coverage</span>
                  <span className="stat-value">{gpxResult.summary.elevationCoveragePct}%</span>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                    +{gpxResult.summary.elevationGainMetres}m / -{gpxResult.summary.elevationLossMetres}m
                  </span>
                </div>
                <div className="gpx-stat-card">
                  <span className="stat-label">Timestamp Coverage</span>
                  <span className="stat-value">{gpxResult.summary.timestampCoveragePct}%</span>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                    {gpxResult.summary.durationSeconds ? `${Math.round(gpxResult.summary.durationSeconds / 60)} min` : 'No duration'}
                  </span>
                </div>
              </div>

              {gpxResult.summary.warnings.length > 0 && (
                <div className="gpx-warning-box">
                  <strong style={{ display: 'block', marginBottom: '4px' }}>Validation Notes & Data Coverage:</strong>
                  <ul style={{ margin: 0, paddingLeft: '16px' }}>
                    {gpxResult.summary.warnings.map((w, idx) => (
                      <li key={idx}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setIsGpxModalOpen(false)}>
                Cancel
              </button>
              <button
                className="btn-ghost"
                onClick={handleConfirmAppendGpx}
                title="Append imported route to current journey without replacing existing segments"
              >
                Append to Current Journey
              </button>
              <button className="btn-primary" onClick={handleConfirmNewJourneyFromGpx}>
                Create as New Journey
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedMediaForPreview && (
        <MediaPreviewModal
          asset={selectedMediaForPreview}
          onClose={() => setSelectedMediaForPreview(null)}
          scenes={(journey.timeline.scenes ?? []) as StoryScene[]}
          audioTracks={journey.audio?.tracks ?? []}
          onAssignToScene={handleAssignMediaToScene}
          onAssignToAudioTrack={handleAssignMediaToAudioTrack}
          onDeleteAsset={handleDeleteMediaAsset}
        />
      )}
    </>
  );
}
