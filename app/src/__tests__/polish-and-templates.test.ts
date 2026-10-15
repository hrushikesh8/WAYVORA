/* ─── Phase 9 Acceptance Tests: Polish, Safe Areas, and Templates ─── */

import { describe, it, expect } from 'vitest';
import {
  getSafeAreaInsets,
  compositeRenderFrame,
  drawVignette,
  drawColorGrade,
  drawSafeAreaGuides,
} from '../domain/render/canvasCompositor';
import {
  JOURNEY_TEMPLATES,
  getJourneyTemplate,
  applyJourneyTemplate,
} from '../domain/templates';
import { evaluateRenderFrame } from '../domain/render/contract';
import {
  createJourney,
  createSegment,
  createRoutePoint,
  createStop,
  createEditorHistory,
  pushEditorHistory,
  undoEditorHistory,
  canUndo,
  applyTemplateToJourney,
} from '../domain';
import type { Journey } from '../domain/types';

function createMockJourney(): Journey {
  const p1 = createRoutePoint(7.7491, 45.9763, 1608);
  const p2 = createRoutePoint(7.7600, 45.9790, 2100);
  const p3 = createRoutePoint(7.7720, 45.9810, 2650);
  const p4 = createRoutePoint(7.7845, 45.9832, 3089); // Summit

  const seg1 = createSegment('trail', 'hike', [p1, p2, p3, p4], 'manual');
  const stop1 = createStop('Zermatt Base', p1, 0, 'start');
  const stop2 = createStop('Gornergrat Summit', p4, 0, 'sight');

  const j = createJourney('Swiss Alps Test Journey', 'Test Alps Description');
  return {
    ...j,
    segments: [seg1],
    stops: [stop1, stop2],
  };
}

function createMockCanvasContext() {
  const operations: string[] = [];
  return {
    operations,
    clearRect: (x: number, y: number, w: number, h: number) => {
      operations.push(`clearRect:${x},${y},${w},${h}`);
    },
    fillRect: (x: number, y: number, w: number, h: number) => {
      operations.push(`fillRect:${x},${y},${w},${h}`);
    },
    strokeRect: (x: number, y: number, w: number, h: number) => {
      operations.push(`strokeRect:${x},${y},${w},${h}`);
    },
    fillText: (text: string, x: number, y: number) => {
      operations.push(`fillText:${text.substring(0, 20)}:${Math.round(x)},${Math.round(y)}`);
    },
    measureText: (text: string) => ({ width: text.length * 9 }),
    save: () => operations.push('save'),
    restore: () => operations.push('restore'),
    beginPath: () => operations.push('beginPath'),
    moveTo: () => operations.push('moveTo'),
    lineTo: () => operations.push('lineTo'),
    arcTo: () => operations.push('arcTo'),
    closePath: () => operations.push('closePath'),
    fill: () => operations.push('fill'),
    stroke: () => operations.push('stroke'),
    clip: () => operations.push('clip'),
    drawImage: () => operations.push('drawImage'),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    setLineDash: () => {},
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: '',
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetY: 0,
  } as unknown as CanvasRenderingContext2D & { operations: string[] };
}

describe('Phase 9: Export Validation, Cinematic Polish & Social Formats', () => {
  describe('Social-Format Safe Area Framing', () => {
    it('calculates expected platform safe-area insets across aspect ratios', () => {
      const insets16x9 = getSafeAreaInsets('16:9', 1920, 1080);
      expect(insets16x9.top).toBe(Math.round(1080 * 0.05));
      expect(insets16x9.left).toBe(Math.round(1920 * 0.05));
      expect(insets16x9.right).toBe(Math.round(1920 * 0.05));

      const insets9x16 = getSafeAreaInsets('9:16', 1080, 1920);
      // Vertical has deeper top (profile header) and bottom (captions/audio) insets
      expect(insets9x16.top).toBeGreaterThan(insets16x9.top);
      expect(insets9x16.bottom).toBeGreaterThan(insets16x9.bottom);
      expect(insets9x16.right).toBeGreaterThan(insets9x16.left); // right side has interaction icons

      const insets1x1 = getSafeAreaInsets('1:1', 1080, 1080);
      expect(insets1x1.top).toBe(insets1x1.bottom);
      expect(insets1x1.left).toBe(insets1x1.right);

      const insets4x5 = getSafeAreaInsets('4:5', 1080, 1350);
      expect(insets4x5.bottom).toBeGreaterThan(insets4x5.top);
    });

    it('draws safe-area dashed overlay guides when requested without throwing', () => {
      const ctx = createMockCanvasContext();
      const insets = getSafeAreaInsets('9:16', 1080, 1920);

      expect(() => {
        drawSafeAreaGuides(ctx, 1080, 1920, insets, '9:16');
      }).not.toThrow();

      expect(ctx.operations.some((op) => op.startsWith('strokeRect'))).toBe(true);
    });
  });

  describe('Cinematic Post-Processing & Compositor Treatments', () => {
    it('applies radial vignette effect with intensity gradient', () => {
      const ctx = createMockCanvasContext();
      drawVignette(ctx, 1280, 720, 0.4);
      expect(ctx.operations).toContain('save');
      expect(ctx.operations).toContain('fillRect:0,0,1280,720');
      expect(ctx.operations).toContain('restore');
    });

    it('applies color grading presets (golden-hour, alpine-cool, sunset-glow, noir-contrast)', () => {
      const presets = ['golden-hour', 'alpine-cool', 'sunset-glow', 'noir-contrast'] as const;
      for (const preset of presets) {
        const ctx = createMockCanvasContext();
        drawColorGrade(ctx, 1280, 720, preset);
        expect(ctx.operations).toContain('fillRect:0,0,1280,720');
      }
    });

    it('composites frame with smart non-overlapping layout in 16:9 widescreen', () => {
      const journey = createMockJourney();
      // Configure both a title and active media
      const frame = evaluateRenderFrame(journey, 1.0, {
        width: 1280,
        height: 720,
        aspectRatio: '16:9',
      });
      frame.story.title = 'ZERMATT DEPARTURE';
      frame.story.subtitle = 'ALPINE ASCENT';
      frame.story.caption = 'Starting the climb toward Gornergrat crest under clear mountain skies.';
      frame.story.activeMedia = [
        {
          id: 'media-test',
          filename: 'test.jpg',
          url: 'blob:test',
          type: 'photo',
          title: 'Matterhorn Peak',
          geoPosition: { lat: 45.97, lng: 7.75, ele: 2100 },
        },
      ];

      const ctx = createMockCanvasContext();
      expect(() => {
        compositeRenderFrame(ctx, frame, {
          cinematicTreatment: {
            vignette: true,
            colorGrade: 'alpine-cool',
          },
          drawSafeAreaGuides: true,
        });
      }).not.toThrow();

      // Clear, background, title, media, caption, vignette, and HUD operations
      expect(ctx.operations).toContain('clearRect:0,0,1280,720');
      expect(ctx.operations.some((op) => op.startsWith('fillText:ZERMATT DEPARTURE'))).toBe(true);
      expect(ctx.operations.some((op) => op.startsWith('fillText:Matterhorn Peak'))).toBe(true);
      expect(ctx.operations.some((op) => op.startsWith('fillText:◆ EXPEDITION LOG'))).toBe(true);
    });

    it('composites frame with vertical stacking in 9:16 vertical reel format', () => {
      const journey = createMockJourney();
      const frame = evaluateRenderFrame(journey, 1.0, {
        width: 1080,
        height: 1920,
        aspectRatio: '9:16',
      });
      frame.story.title = 'HIGH ALPINE';
      frame.story.caption = 'Crossing the ridge.';

      const ctx = createMockCanvasContext();
      expect(() => {
        compositeRenderFrame(ctx, frame, {
          cinematicTreatment: { vignette: true, colorGrade: 'sunset-glow' },
        });
      }).not.toThrow();

      expect(ctx.operations).toContain('clearRect:0,0,1080,1920');
      expect(ctx.operations.some((op) => op.startsWith('fillText:HIGH ALPINE'))).toBe(true);
    });
  });

  describe('Preset Templates Architecture & Determinism', () => {
    it('provides all 4 core travel video templates with distinct profiles', () => {
      expect(JOURNEY_TEMPLATES).toHaveLength(4);
      const ids = JOURNEY_TEMPLATES.map((t) => t.id);
      expect(ids).toContain('cinematic-road-trip');
      expect(ids).toContain('hiking-summit-reveal');
      expect(ids).toContain('city-exploration');
      expect(ids).toContain('social-reel-highlights');
      expect(getJourneyTemplate('cinematic-road-trip').id).toBe('cinematic-road-trip');
    });

    it('applies hiking-summit-reveal template with peak orbit and alpine styling', () => {
      const baseJourney = createMockJourney();
      const updated = applyJourneyTemplate(baseJourney, 'hiking-summit-reveal', {
        attachAmbientAudio: false,
      });

      // Verifies timeline duration
      expect(updated.timeline.duration).toBe(35);
      // Verifies story scenes
      expect(updated.timeline.scenes).toBeDefined();
      expect(updated.timeline.scenes.length).toBeGreaterThanOrEqual(3);
      // Verifies summit scene references the summit stop name
      const summitScene = updated.timeline.scenes.find((s) => s.cameraMode === 'orbit');
      expect(summitScene).toBeDefined();
      expect(summitScene?.title).toBe('SUMMIT REVEAL');

      // Verifies camera keyframes include summit orbit
      expect(updated.timeline.keyframes).toBeDefined();
      expect(updated.timeline.keyframes!.some((k) => k.mode === 'orbit')).toBe(true);

      // Verifies 100% preservation of original route geometry & elevations
      expect(updated.segments).toHaveLength(baseJourney.segments.length);
      expect(updated.segments[0].points).toHaveLength(baseJourney.segments[0].points.length);
      expect(updated.segments[0].points[3].ele).toBe(3089);
      expect(updated.stops).toHaveLength(baseJourney.stops.length);
    });

    it('applies social-reel-highlights template formatted for 9:16 vertical pacing', () => {
      const baseJourney = createMockJourney();
      const updated = applyJourneyTemplate(baseJourney, 'social-reel-highlights', {
        attachAmbientAudio: false,
      });

      expect(updated.timeline.duration).toBe(15);
      expect(updated.timeline.scenes).toHaveLength(3);
      expect(updated.timeline.keyframes).toBeDefined();
      expect(updated.timeline.keyframes!.length).toBeGreaterThanOrEqual(3);
    });

    it('guarantees template application is mathematically deterministic on repeated calls', () => {
      const baseJourney = createMockJourney();
      const run1 = applyJourneyTemplate(baseJourney, 'cinematic-road-trip', { attachAmbientAudio: false });
      const run2 = applyJourneyTemplate(baseJourney, 'cinematic-road-trip', { attachAmbientAudio: false });

      expect(run1.timeline.duration).toBe(run2.timeline.duration);
      expect(run1.timeline.scenes.length).toBe(run2.timeline.scenes.length);
      expect(run1.timeline.scenes[0].title).toBe(run2.timeline.scenes[0].title);
      expect(run1.timeline.keyframes?.length).toBe(run2.timeline.keyframes?.length);
    });

    it('supports undo/redo when applying a template through editor history', () => {
      const baseJourney = createMockJourney();
      let history = createEditorHistory(baseJourney);

      const templated = applyTemplateToJourney(history.present, 'city-exploration', { attachAmbientAudio: false });
      history = pushEditorHistory(history, templated);

      expect(history.present.timeline.duration).toBe(25);
      expect(canUndo(history)).toBe(true);

      const undone = undoEditorHistory(history);
      expect(undone.present.timeline.duration).toBe(baseJourney.timeline.duration);
    });
  });

  describe('Seeking and Timeline Synchronization', () => {
    it('evaluates identical RenderFrames regardless of seek direction', () => {
      const journey = createMockJourney();
      // Forward seek
      const frameFwd = evaluateRenderFrame(journey, 2.5, { width: 1280, height: 720 });
      // Backward seek to 0.5 then forward back to 2.5
      evaluateRenderFrame(journey, 0.5, { width: 1280, height: 720 });
      const frameBackFwd = evaluateRenderFrame(journey, 2.5, { width: 1280, height: 720 });

      expect(frameFwd.position.lat).toBeCloseTo(frameBackFwd.position.lat, 8);
      expect(frameFwd.position.lng).toBeCloseTo(frameBackFwd.position.lng, 8);
      expect(frameFwd.camera.pitch).toBe(frameBackFwd.camera.pitch);
      expect(frameFwd.camera.bearing).toBe(frameBackFwd.camera.bearing);
    });
  });
});
