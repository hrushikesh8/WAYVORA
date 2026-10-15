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
import { evaluateTimeline } from './domain/timeline';
import { deserializeProject, downloadProject } from './domain/serialization';
import { totalDistance, computeBounds } from './domain/geo';
import type { Journey, TransportMode, CameraMode } from './domain/types';
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
  const [activeTab, setActiveTab] = useState<'stops' | 'stats'>('stops');
  const [notification, setNotification] = useState<string | null>(null);

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
  const currentFrame = useMemo(() => evaluateTimeline(journey, currentTime), [journey, currentTime]);

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
        if (next >= journey.timeline.duration) {
          setIsPlaying(false);
          return journey.timeline.duration;
        }
        return next;
      });

      animationFrameRef.current = requestAnimationFrame(loop);
    };

    animationFrameRef.current = requestAnimationFrame(loop);

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isPlaying, playbackSpeed, journey.timeline.duration]);

  // Timeline scrub handler
  const handleTimelineScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    setCurrentTime(ratio * journey.timeline.duration);
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
    setJourney(updated);
    showNotification(`Added stop: ${name}`);
  };

  // Project Export & Import
  const handleSaveProject = () => {
    downloadProject(journey);
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
          </select>
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
              Timeline Stops ({journey.stops.length})
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
                        </div>
                        <div className="stop-details">
                          <span>{stop.position.lat.toFixed(3)}°N, {stop.position.lng.toFixed(3)}°E</span>
                          {stop.position.ele != null && <span>▲ {stop.position.ele}m</span>}
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
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '12px' }}>
                <div className="control-header">Project Info</div>
                <div style={{ color: 'var(--text-secondary)' }}>
                  Name: <strong>{journey.name}</strong>
                </div>
                <div style={{ color: 'var(--text-secondary)' }}>
                  Created: <strong>{new Date(journey.createdAt).toLocaleDateString()}</strong>
                </div>
                <div style={{ color: 'var(--text-secondary)' }}>
                  Timeline Duration: <strong>{journey.timeline.duration}s @ {journey.timeline.fps} FPS</strong>
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
              {currentTime.toFixed(1)}s <span>/ {journey.timeline.duration.toFixed(1)}s</span>
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
          </div>
        </div>

        {/* Timeline Track with Scene Markers and Playhead */}
        <div className="timeline-track-wrapper" onClick={handleTimelineScrub}>
          <div
            className="timeline-progress-bar"
            style={{ width: `${(currentTime / journey.timeline.duration) * 100}%` }}
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
            style={{ left: `${(currentTime / journey.timeline.duration) * 100}%` }}
          />
        </div>
      </footer>

      {/* Toast Notification */}
      {notification && <div className="notification-toast">{notification}</div>}
    </>
  );
}
