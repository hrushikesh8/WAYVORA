import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Map, Marker, type GeoJSONSource } from 'maplibre-gl';
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
import { totalDistance, computeBounds } from './domain/geo';
import type { Journey, TransportMode, CameraMode } from './domain/types';
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
  type EditorHistory,
} from './domain/editor';
import {
  OsrmRoutingProvider,
  MockRoutingProvider,
  type RouteResult,
  type RoutingProfile,
} from './domain/routing';
import { auditJourneyDiagnostics } from './domain/diagnostics';
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

export default function App() {
  const [selectedPreset, setSelectedPreset] = useState('alps');
  const [journey, setJourney] = useState<Journey>(() =>
    journeyFromWaypoints('Swiss Alps Epic: Road to Ridge', MIXED_JOURNEY_WAYPOINTS)
  );
  
  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  // Camera & Visual Director State
  const [cameraMode, setCameraMode] = useState<CameraMode>('overview');
  const [mapPitch, setMapPitch] = useState(45);
  const [mapZoom, setMapZoom] = useState(11);
  const [activeTab, setActiveTab] = useState<'stops' | 'segments' | 'stats'>('stops');
  const [notification, setNotification] = useState<string | null>(null);

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
    });

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

      // Fit map to bounds
      fitMapToBounds(map, allPoints);
    });

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

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
          coordinates: allPoints.map(p => [p.lng, p.lat]),
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

    if (cameraMode === 'chase') {
      map.easeTo({
        center: [position.lng, position.lat],
        bearing: bearing,
        pitch: mapPitch,
        zoom: mapZoom,
        duration: 80,
      });
    } else if (cameraMode === 'ground') {
      map.easeTo({
        center: [position.lng, position.lat],
        bearing: bearing,
        pitch: Math.max(60, mapPitch),
        zoom: Math.max(14, mapZoom),
        duration: 80,
      });
    }
  }, [currentFrame, cameraMode, mapPitch, mapZoom]);

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
            onClick={() => showNotification('Exporting 4K cinematic video render pipeline...')}
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
              className={`tab-btn ${activeTab === 'stats' ? 'active' : ''}`}
              onClick={() => setActiveTab('stats')}
            >
              Metadata
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
          </div>
        </aside>


        {/* Center: Interactive Map & Overlays */}
        <div className="studio-center">
          <div ref={mapContainerRef} className="map-container" />

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
            </div>
            <div className="camera-grid">
              {(['overview', 'flyover', 'chase', 'ground'] as CameraMode[]).map((mode) => (
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
            {journey.timeline.scenes.map((scene) => (
              <div
                key={scene.id}
                className="scene-block"
                style={{
                  width: `${(scene.endPercent - scene.startPercent) * 100}%`,
                }}
              >
                {scene.name} ({scene.cameraMode})
              </div>
            ))}
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
