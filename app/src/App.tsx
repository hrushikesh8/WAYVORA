import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Map, Marker, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl';
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
import type { Journey, TransportMode, CameraMode, CameraKeyframe } from './domain/types';
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
  removeMedia,
  addAudioClip,
  updateAudioClip,
  deleteAudioClip,
  setAudioTrackVolume,
  setMasterAudioVolume,
  type EditorHistory,
} from './domain/editor';
import {
  type AudioClip,
  synthesizeAudioTone,
  pcmToWavBlob,
} from './domain/audio';
import {
  type StoryScene,
  type SceneIntent,
  createMediaAsset,
  parseJpegExif,
  generateDefaultStoryScenes,
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
  const [activeTab, setActiveTab] = useState<'stops' | 'segments' | 'story' | 'audio' | 'stats' | 'export'>('stops');
  const [notification, setNotification] = useState<string | null>(null);

  // Audio Timeline State & Refs
  const audioFileInputRef = useRef<HTMLInputElement>(null);
  const targetTrackIdForAudio = useRef<string | null>(null);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const [previewingClipId, setPreviewingClipId] = useState<string | null>(null);

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

  // 3D Terrain State
  const [isTerrain3dEnabled, setIsTerrain3dEnabled] = useState(true);
  const [terrainExaggeration, setTerrainExaggeration] = useState(1.2);
  const [terrainStatus, setTerrainStatus] = useState<'ready' | 'fallback' | 'disabled'>('ready');

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
  const mapInstanceRef = useRef<Map | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastTimestampRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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


  // Initialize MapLibre
  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Use OpenFreeMap Dark style (free, open, no API key, no watermark)
    // with graceful fallback if offline
    const map = new Map({
      container: mapContainerRef.current,
      style: 'https://tiles.openfreemap.org/styles/dark',
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
    const el = document.createElement('div');
    el.className = 'wayvora-marker';
    el.innerHTML = '✦';
    const marker = new Marker({ element: el })
      .setLngLat([allPoints[0]?.lng ?? 0, allPoints[0]?.lat ?? 0])
      .addTo(map);
    markerRef.current = marker;

    map.on('load', () => {
      // Add Route Line Source
      map.addSource('route-source', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: allPoints.map(p => [p.lng, p.lat]),
          },
        },
      });

      // Route Glow Layer
      map.addLayer({
        id: 'route-glow',
        type: 'line',
        source: 'route-source',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#00f2fe',
          'line-width': 8,
          'line-opacity': 0.35,
          'line-blur': 4,
        },
      });

      // Route Main Line
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route-source',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#4facfe',
          'line-width': 3.5,
          'line-opacity': 0.95,
        },
      });

      // Editable segment points source
      map.addSource('segment-points-source', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      });

      // Segment points layer
      map.addLayer({
        id: 'segment-points-layer',
        type: 'circle',
        source: 'segment-points-source',
        paint: {
          'circle-radius': [
            'case',
            ['boolean', ['get', 'selected'], false],
            8,
            5,
          ],
          'circle-color': [
            'case',
            ['boolean', ['get', 'selected'], false],
            '#00f2fe',
            '#fbbf24',
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#0d1117',
        },
      });

      map.on('click', 'segment-points-layer', (e) => {
        if (e.features && e.features.length > 0) {
          const ptIdx = e.features[0].properties?.pointIndex;
          if (typeof ptIdx === 'number') {
            setSelectedPointIndex(ptIdx);
          }
        }
      });
      map.on('mouseenter', 'segment-points-layer', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'segment-points-layer', () => {
        map.getCanvas().style.cursor = '';
      });

      // Add AWS Open Data Terrarium 3D Terrain Source
      try {
        map.addSource('terrain-source', {
          type: 'raster-dem',
          tiles: [
            'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
          ],
          tileSize: 256,
          encoding: 'terrarium',
          maxzoom: 15,
        });

        if (isTerrain3dEnabled) {
          map.setTerrain({ source: 'terrain-source', exaggeration: terrainExaggeration });
        }
      } catch (err: unknown) {
        console.warn('MapLibre 3D terrain initialization warning:', err);
      }

      // Fit map to bounds
      fitMapToBounds(map, allPoints);
    });

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Synchronize 3D Terrain and exaggeration
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !map.isStyleLoaded()) return;

    try {
      if (isTerrain3dEnabled && map.getSource('terrain-source')) {
        map.setTerrain({ source: 'terrain-source', exaggeration: terrainExaggeration });
        setTerrainStatus('ready');
      } else {
        map.setTerrain(null);
        setTerrainStatus(isTerrain3dEnabled ? 'fallback' : 'disabled');
      }
    } catch (err: unknown) {
      console.warn('MapLibre terrain update error, falling back to 2D:', err);
      map.setTerrain(null);
      setTerrainStatus('fallback');
    }
  }, [isTerrain3dEnabled, terrainExaggeration]);

  // Update Route geometry when journey changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const source = map.getSource('route-source') as GeoJSONSource | undefined;
    if (source) {
      source.setData({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: allPoints.map((p) => [p.lng, p.lat]),
        },
      });
    }

    fitMapToBounds(map, allPoints);
  }, [allPoints]);

  const fitMapToBounds = (map: Map, points: typeof allPoints) => {
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

  // Sync editable segment vertices on map
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const source = map.getSource('segment-points-source') as GeoJSONSource | undefined;
    if (!source) return;

    if (!selectedSegmentId) {
      source.setData({ type: 'FeatureCollection', features: [] });
      return;
    }

    const seg = journey.segments.find((s) => s.id === selectedSegmentId);
    if (!seg) {
      source.setData({ type: 'FeatureCollection', features: [] });
      return;
    }

    const features = seg.points.map((pt, idx) => ({
      type: 'Feature' as const,
      properties: {
        pointIndex: idx,
        selected: selectedPointIndex === idx,
      },
      geometry: {
        type: 'Point' as const,
        coordinates: [pt.lng, pt.lat],
      },
    }));

    source.setData({
      type: 'FeatureCollection',
      features,
    });
  }, [selectedSegmentId, selectedPointIndex, journey]);

  // Sync Marker & Camera on frame update
  useEffect(() => {
    if (!markerRef.current || !currentFrame.position) return;
    const { position, bearing } = currentFrame;
    markerRef.current.setLngLat([position.lng, position.lat]);

    const markerEl = markerRef.current.getElement();
    if (markerEl) {
      markerEl.style.transform = `rotate(${bearing}deg)`;
    }

    const map = mapInstanceRef.current;
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

  const handleRemoveMedia = (mediaId: string) => {
    const updated = removeMedia(journey, mediaId);
    applyJourneyEdit(updated, 'Media removed');
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

  // Video Export Profiles and Dispatchers
  const exportProfiles: ExportJobConfig[] = useMemo(() => [
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
    },
  ], [exportFps, exportVignette, exportColorGrade, exportSafeGuides]);

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
                          {['car', 'hike', 'bike', 'walk', 'train', 'bus', 'motorcycle', 'plane', 'boat'].map((m) => (
                            <option key={m} value={m}>{m.toUpperCase()}</option>
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
                  <span>Audio Timeline & Sound Director</span>
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

                {/* Audio Tracks */}
                {(!journey.audio?.tracks || journey.audio.tracks.length === 0) ? (
                  <div className="audio-empty-msg">No audio tracks available.</div>
                ) : (
                  journey.audio.tracks.map((track) => (
                    <div key={track.id} className="audio-track-card">
                      <div className="audio-track-header">
                        <span className="audio-track-title">
                          {track.type === 'music' ? '🎵' : '🎙️'} {track.name}
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
                          return (
                            <div key={clip.id} className={`audio-clip-card ${isPreviewing ? 'previewing' : ''}`}>
                              <div className="audio-clip-header">
                                <span className="audio-clip-name" title={clip.name}>
                                  {clip.name}
                                </span>
                                <span className={`audio-badge ${clip.type}`}>
                                  {clip.type}
                                </span>
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

                              {/* Timeline & Trim Inputs */}
                              <div className="audio-clip-grid">
                                <div className="audio-input-group">
                                  <label>Start (s)</label>
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

          {/* Cinematic Story Overlays (Canvas Layer) */}
          {currentFrame.storyState?.title && (
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
              <div>
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
                  (journey.timeline.scenes as StoryScene[]).map((scene) => {
                    const isActive = currentFrame.storyState?.activeScene?.id === scene.id;
                    return (
                      <div
                        key={scene.id}
                        className={`story-scene-card ${isActive ? 'active-scene' : ''}`}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span className={`scene-intent-badge intent-${scene.intent ?? 'travel'}`}>
                            {scene.intent ?? 'travel'}
                          </span>
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

                        {/* Controls Row: Mode & Intent */}
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
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
                            title="Attach photo to scene"
                          >
                            📷 + Photo
                          </button>
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
                                  onClick={() => handleRemoveMedia(med.id)}
                                  title="Remove photo"
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

          {/* 3D Terrain & Relief Director */}
          <div className="control-group">
            <div className="control-header">
              <span>3D Terrain & Relief</span>
              <span style={{ fontSize: '10px', color: isTerrain3dEnabled ? '#34d399' : 'var(--text-muted)' }}>
                {isTerrain3dEnabled ? (terrainStatus === 'fallback' ? 'Flat Fallback' : 'Active 3D') : 'Disabled'}
              </span>
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
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
              Source: AWS Open Data Terrarium DEM
            </div>
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
    </>
  );
}
