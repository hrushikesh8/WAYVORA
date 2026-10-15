import { describe, it, expect, vi } from 'vitest';
import {
  CANONICAL_TRANSPORT_MODES,
  resolveCanonicalTransportMode,
  TRANSPORT_MODE_METADATA,
  getTransportSvg,
  getTransportSvgDataUrl,
  drawTransportMarker2D,
  attachTransportMapLayers,
  syncTransportSourceData,
  TRANSPORT_SOURCE_ID,
  TRANSPORT_SYMBOL_LAYER_ID,
  TRANSPORT_HALO_LAYER_ID,
  TRANSPORT_PULSE_LAYER_ID,
} from '../domain/transport';
import {
  journeyFromWaypoints,
  createJourney,
  createSegment,
  createStop,
  addSegmentToJourney,
  addStopToJourney,
} from '../domain/journey';
import { evaluateTimeline, computeTimelineSchedule } from '../domain/timeline';
import { evaluateRenderFrame } from '../domain/render/contract';
import { compositeRenderFrame } from '../domain/render/canvasCompositor';
import { MIXED_JOURNEY_WAYPOINTS, SF_TO_LA_WAYPOINTS } from './fixtures';
import type { RoutePoint } from '../domain/types';

describe('Phase 2 — Deterministic 2D Transport Animation', () => {
  describe('1. Canonical Transport Modes & Normalization', () => {
    it('supports all eight canonical transport modes with full metadata', () => {
      expect(CANONICAL_TRANSPORT_MODES).toEqual([
        'car',
        'bus',
        'train',
        'hiker',
        'motorcycle',
        'bicycle',
        'boat',
        'airplane',
      ]);

      for (const mode of CANONICAL_TRANSPORT_MODES) {
        const meta = TRANSPORT_MODE_METADATA[mode];
        expect(meta).toBeDefined();
        expect(meta.id).toBe(mode);
        expect(meta.label.length).toBeGreaterThan(0);
        expect(meta.accentColor).toMatch(/^#[0-9a-fA-F]{6}$/);
        expect(meta.defaultSpeedKmh).toBeGreaterThan(0);
        expect(meta.description.length).toBeGreaterThan(0);
      }
    });

    it('resolves legacy and colloquial aliases into canonical modes', () => {
      expect(resolveCanonicalTransportMode('car')).toBe('car');
      expect(resolveCanonicalTransportMode('automobile')).toBe('car');
      expect(resolveCanonicalTransportMode('camper')).toBe('car');
      expect(resolveCanonicalTransportMode('drive')).toBe('car');

      expect(resolveCanonicalTransportMode('bus')).toBe('bus');
      expect(resolveCanonicalTransportMode('shuttle')).toBe('bus');
      expect(resolveCanonicalTransportMode('coach')).toBe('bus');

      expect(resolveCanonicalTransportMode('train')).toBe('train');
      expect(resolveCanonicalTransportMode('rail')).toBe('train');
      expect(resolveCanonicalTransportMode('metro')).toBe('train');

      expect(resolveCanonicalTransportMode('hiker')).toBe('hiker');
      expect(resolveCanonicalTransportMode('hike')).toBe('hiker');
      expect(resolveCanonicalTransportMode('walk')).toBe('hiker');
      expect(resolveCanonicalTransportMode('trek')).toBe('hiker');
      expect(resolveCanonicalTransportMode('run')).toBe('hiker');

      expect(resolveCanonicalTransportMode('motorcycle')).toBe('motorcycle');
      expect(resolveCanonicalTransportMode('motorbike')).toBe('motorcycle');
      expect(resolveCanonicalTransportMode('moto')).toBe('motorcycle');

      expect(resolveCanonicalTransportMode('bicycle')).toBe('bicycle');
      expect(resolveCanonicalTransportMode('bike')).toBe('bicycle');
      expect(resolveCanonicalTransportMode('cycling')).toBe('bicycle');

      expect(resolveCanonicalTransportMode('boat')).toBe('boat');
      expect(resolveCanonicalTransportMode('ferry')).toBe('boat');
      expect(resolveCanonicalTransportMode('ship')).toBe('boat');
      expect(resolveCanonicalTransportMode('yacht')).toBe('boat');

      expect(resolveCanonicalTransportMode('airplane')).toBe('airplane');
      expect(resolveCanonicalTransportMode('plane')).toBe('airplane');
      expect(resolveCanonicalTransportMode('flight')).toBe('airplane');

      // Null or invalid defaults safely to car
      expect(resolveCanonicalTransportMode(null)).toBe('car');
      expect(resolveCanonicalTransportMode(undefined)).toBe('car');
      expect(resolveCanonicalTransportMode('unknown_rocket')).toBe('car');
    });
  });

  describe('2. SVG Vector Silhouettes', () => {
    it('generates valid, standard 64x64 SVG silhouettes for each mode', () => {
      for (const mode of CANONICAL_TRANSPORT_MODES) {
        const svg = getTransportSvg(mode);
        expect(svg).toContain('<svg');
        expect(svg).toContain('viewBox="0 0 64 64"');
        expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
        expect(svg).toContain('</svg>');

        // Check custom styling options
        const customSvg = getTransportSvg(mode, {
          color: '#ff0055',
          haloColor: '#000000',
          size: 48,
        });
        expect(customSvg).toContain('width="48"');
        expect(customSvg).toContain('height="48"');
        expect(customSvg).toContain('#ff0055');

        // Check data URL generation
        const dataUrl = getTransportSvgDataUrl(mode);
        expect(dataUrl.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
      }
    });
  });

  describe('3. Deterministic Position, Bearing, and Seeking Parity', () => {
    it('evaluates identical position, bearing and mode across repeated seek evaluations', () => {
      const journey = journeyFromWaypoints('California Road Journey', SF_TO_LA_WAYPOINTS);
      const schedule = computeTimelineSchedule(journey);

      const testTimes = [0, 5.25, 12.0, 24.5, 45.0, schedule.totalDuration];

      for (const t of testTimes) {
        const eval1 = evaluateTimeline(journey, t, schedule);
        const eval2 = evaluateTimeline(journey, t, schedule);
        const eval3 = evaluateTimeline(journey, t, schedule);

        expect(eval1.position.lng).toBe(eval2.position.lng);
        expect(eval1.position.lat).toBe(eval2.position.lat);
        expect(eval1.bearing).toBe(eval2.bearing);
        expect(eval1.progress).toBe(eval2.progress);
        expect(eval1.activeTransportMode).toBe('car');

        expect(eval2.position.lng).toBe(eval3.position.lng);
        expect(eval2.bearing).toBe(eval3.bearing);
      }
    });

    it('preserves mathematical determinism backwards and forwards seeking', () => {
      const journey = journeyFromWaypoints('California Road Journey', SF_TO_LA_WAYPOINTS);
      const schedule = computeTimelineSchedule(journey);

      // Seek forward
      const forwardAt15s = evaluateTimeline(journey, 15, schedule);
      // Seek further forward
      evaluateTimeline(journey, 35, schedule);
      // Seek backward to 15s
      const backwardAt15s = evaluateTimeline(journey, 15, schedule);

      expect(backwardAt15s.position.lng).toBe(forwardAt15s.position.lng);
      expect(backwardAt15s.position.lat).toBe(forwardAt15s.position.lat);
      expect(backwardAt15s.bearing).toBe(forwardAt15s.bearing);
      expect(backwardAt15s.progress).toBe(forwardAt15s.progress);
    });

    it('derives correct heading aligned with segment geometry', () => {
      // 2 points going pure East (bearing 90°)
      const eastWaypoints = [
        { name: 'Start', lng: 0, lat: 0, mode: 'car' as const },
        { name: 'East', lng: 1, lat: 0, mode: 'car' as const },
      ];
      const journey = journeyFromWaypoints('Eastbound', eastWaypoints);
      const frame = evaluateTimeline(journey, 10);
      expect(frame.bearing).toBeCloseTo(90, 0);

      // 2 points going pure North (bearing 0°)
      const northWaypoints = [
        { name: 'Start', lng: 0, lat: 0, mode: 'car' as const },
        { name: 'North', lng: 0, lat: 1, mode: 'car' as const },
      ];
      const northJourney = journeyFromWaypoints('Northbound', northWaypoints);
      const northFrame = evaluateTimeline(northJourney, 10);
      expect(northFrame.bearing).toBeCloseTo(0, 0);
    });
  });

  describe('4. Mixed-Mode Journeys and Mode Transitions', () => {
    it('transitions active transport mode smoothly across multi-modal segments', () => {
      const journey = journeyFromWaypoints('Swiss Alps Multimodal', MIXED_JOURNEY_WAYPOINTS);
      const schedule = computeTimelineSchedule(journey);

      // Inspect segment modes configured in MIXED_JOURNEY_WAYPOINTS
      // Segment 0: Zurich -> Interlaken (train)
      // Segment 1: Interlaken -> Grindelwald (bus)
      // Segment 2: Grindelwald -> First Summit (hike)
      expect(journey.segments[0].transportMode).toBe('train');
      expect(journey.segments[1].transportMode).toBe('bus');
      expect(journey.segments[2].transportMode).toBe('hike');

      // Sample timestamps along the schedule
      const startFrame = evaluateTimeline(journey, 0.1, schedule);
      expect(startFrame.activeTransportMode).toBe('train');

      // Evaluate RenderFrame contract
      const renderFrame0 = evaluateRenderFrame(journey, 0.1);
      expect(renderFrame0.transportMode).toBe('train');

      // Find time when traveler enters segment 1 (bus)
      const movePhase1 = schedule.phases.find(
        (p) => p.type === 'move' && p.startProgress > 0.15 && p.endProgress < 0.4
      );
      if (movePhase1) {
        const midTime = (movePhase1.startTime + movePhase1.endTime) / 2;
        const busFrame = evaluateTimeline(journey, midTime, schedule);
        expect(resolveCanonicalTransportMode(busFrame.activeTransportMode)).toBe('bus');
      }

      // Find time when traveler enters hike segment
      const hikePhase = schedule.phases.find(
        (p) => p.type === 'move' && p.startProgress > 0.45 && p.endProgress < 0.65
      );
      if (hikePhase) {
        const midTime = (hikePhase.startTime + hikePhase.endTime) / 2;
        const hikeFrame = evaluateTimeline(journey, midTime, schedule);
        expect(resolveCanonicalTransportMode(hikeFrame.activeTransportMode)).toBe('hiker');
      }
    });

    it('honors segment geometry for nautical and aviation journeys', () => {
      let journey = createJourney('Air & Sea Expedition');

      // Flight segment from London to Paris
      const flightPoints: RoutePoint[] = [
        { lng: -0.1276, lat: 51.5072, ele: 100 },
        { lng: 1.1123, lat: 50.1819, ele: 8500 },
        { lng: 2.3522, lat: 48.8566, ele: 120 },
      ];
      const flightSeg = createSegment('air', 'plane', flightPoints);
      journey = addSegmentToJourney(journey, flightSeg);
      journey = addStopToJourney(
        journey,
        createStop('London Heathrow', flightPoints[0], 0, 'start')
      );
      journey = addStopToJourney(
        journey,
        createStop('Paris CDG', flightPoints[2], 0, 'waypoint')
      );

      // Sea / ferry segment from Paris to Coastal Port
      const seaPoints: RoutePoint[] = [
        { lng: 2.3522, lat: 48.8566, ele: 0 },
        { lng: 0.1077, lat: 49.4944, ele: 0 },
      ];
      const seaSeg = createSegment('sea', 'boat', seaPoints);
      journey = addSegmentToJourney(journey, seaSeg);
      journey = addStopToJourney(
        journey,
        createStop('Le Havre Port', seaPoints[1], 1, 'end')
      );

      const frame1 = evaluateTimeline(journey, 5);
      expect(frame1.activeTransportMode).toBe('plane');
      expect(resolveCanonicalTransportMode(frame1.activeTransportMode)).toBe('airplane');

      const totalDuration = journey.timeline.duration;
      const frame2 = evaluateTimeline(journey, totalDuration - 2);
      expect(frame2.activeTransportMode).toBe('boat');
      expect(resolveCanonicalTransportMode(frame2.activeTransportMode)).toBe('boat');
    });
  });

  describe('5. MapLibre Layer Synchronization & Idempotency', () => {
    function createMockMap() {
      const sources: Record<string, any> = {};
      const layers: Record<string, any> = {};
      const images: Record<string, any> = {};

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
        addLayer: vi.fn((def: any) => {
          if (layers[def.id]) throw new Error(`Layer ${def.id} already exists`);
          layers[def.id] = def;
        }),
        hasImage: vi.fn((id: string) => Boolean(images[id])),
        addImage: vi.fn((id: string, img: any) => {
          images[id] = img;
        }),
        _sources: sources,
        _layers: layers,
        _images: images,
      };

      return map;
    }

    it('attaches transport-source, pulse, halo, and symbol layers idempotently', () => {
      const mockMap = createMockMap();

      attachTransportMapLayers(mockMap as any, { lng: -122.4, lat: 37.7 }, 45, 'car');

      expect(mockMap.addSource).toHaveBeenCalledWith(TRANSPORT_SOURCE_ID, expect.any(Object));
      expect(mockMap.addLayer).toHaveBeenCalledWith(
        expect.objectContaining({ id: TRANSPORT_PULSE_LAYER_ID })
      );
      expect(mockMap.addLayer).toHaveBeenCalledWith(
        expect.objectContaining({ id: TRANSPORT_HALO_LAYER_ID })
      );
      expect(mockMap.addLayer).toHaveBeenCalledWith(
        expect.objectContaining({ id: TRANSPORT_SYMBOL_LAYER_ID })
      );

      // Re-calling (e.g. on style.load) must be idempotent and not throw
      expect(() => {
        attachTransportMapLayers(mockMap as any, { lng: -122.4, lat: 37.7 }, 45, 'car');
      }).not.toThrow();
    });

    it('synchronizes vehicle position, heading, and icon name into GeoJSON source', () => {
      const mockMap = createMockMap();
      attachTransportMapLayers(mockMap as any, { lng: -122.4, lat: 37.7 }, 0, 'car');

      const source = mockMap.getSource(TRANSPORT_SOURCE_ID);
      expect(source).toBeDefined();

      syncTransportSourceData(mockMap as any, { lng: -121.8, lat: 37.3 }, 135, 'train');

      expect(source.setData).toHaveBeenCalledWith({
        type: 'FeatureCollection',
        features: [
          expect.objectContaining({
            geometry: {
              type: 'Point',
              coordinates: [-121.8, 37.3],
            },
            properties: {
              bearing: 135,
              mode: 'train',
              iconName: 'transport-train',
            },
          }),
        ],
      });
    });
  });

  describe('6. Canvas Compositor 2D Drawing & Export Parity', () => {
    function createMockCanvasContext() {
      return {
        save: vi.fn(),
        restore: vi.fn(),
        translate: vi.fn(),
        rotate: vi.fn(),
        beginPath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        closePath: vi.fn(),
        clearRect: vi.fn(),
        drawImage: vi.fn(),
        fillRect: vi.fn(),
        fillText: vi.fn(),
        createRadialGradient: vi.fn(() => ({
          addColorStop: vi.fn(),
        })),
        createLinearGradient: vi.fn(() => ({
          addColorStop: vi.fn(),
        })),
      } as unknown as CanvasRenderingContext2D;
    }

    it('draws 2D transport marker cleanly onto Canvas2D context', () => {
      const mockCtx = createMockCanvasContext();
      const journey = journeyFromWaypoints('California', SF_TO_LA_WAYPOINTS);
      const frame = evaluateRenderFrame(journey, 10);

      drawTransportMarker2D(mockCtx, frame);

      expect(mockCtx.save).toHaveBeenCalled();
      expect(mockCtx.translate).toHaveBeenCalledWith(frame.metadata.width / 2, frame.metadata.height / 2);
      expect(mockCtx.rotate).toHaveBeenCalledWith((frame.bearing * Math.PI) / 180);
      expect(mockCtx.restore).toHaveBeenCalled();
    });

    it('automatically invokes transport drawing in compositeRenderFrame when mapCanvas is fallback', () => {
      const mockCtx = createMockCanvasContext();
      const journey = journeyFromWaypoints('California', SF_TO_LA_WAYPOINTS);
      const frame = evaluateRenderFrame(journey, 10);

      compositeRenderFrame(mockCtx, frame, {
        mapCanvas: null, // simulates export without webgl or unit test
        drawHud: true,
      });

      // Verify that canvas context received transform and draw commands
      expect(mockCtx.translate).toHaveBeenCalledWith(frame.metadata.width / 2, frame.metadata.height / 2);
      expect(mockCtx.rotate).toHaveBeenCalled();
      expect(mockCtx.fillText).toHaveBeenCalledWith(
        expect.stringContaining('Car'),
        expect.any(Number),
        expect.any(Number)
      );
    });
  });
});
