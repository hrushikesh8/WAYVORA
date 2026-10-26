/* ─── Phase 1: Rendering Reliability Acceptance & Unit Tests ───────────
   Verifies blank and black frame detection, first-frame readiness validation,
   MapLibre canvas error handling, and diagnostic reporting.
   ─────────────────────────────────────────────────────────────────── */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { journeyFromWaypoints } from '../domain/journey';
import { MIXED_JOURNEY_WAYPOINTS } from './fixtures';
import { evaluateRenderFrame } from '../domain/render/contract';
import {
  compositeRenderFrame,
  validateRenderedFramePixels,
} from '../domain/render/canvasCompositor';
import {
  exportJourneyVideo,
  RenderingError,
} from '../domain/render/exporter';

describe('Phase 1: Rendering Reliability & Blank/Black Frame Prevention', () => {
  describe('1. Pixel Validation Engine (validateRenderedFramePixels)', () => {
    it('returns isValid: false when canvas dimensions are zero or invalid', () => {
      const mockCtx = {} as CanvasRenderingContext2D;
      const res0 = validateRenderedFramePixels(mockCtx, 0, 1080);
      expect(res0.isValid).toBe(false);
      expect(res0.reason).toContain('Invalid canvas dimensions');

      const resNeg = validateRenderedFramePixels(mockCtx, 1920, -10);
      expect(resNeg.isValid).toBe(false);
    });

    it('returns isValid: true when getImageData is unavailable in mock environments', () => {
      const mockCtx = {} as CanvasRenderingContext2D;
      const res = validateRenderedFramePixels(mockCtx, 1920, 1080);
      expect(res.isValid).toBe(true);
    });

    it('detects and flags completely transparent canvas output', () => {
      // 10x10 mock imageData with all alpha = 0
      const width = 10;
      const height = 10;
      const data = new Uint8ClampedArray(width * height * 4); // all zeros

      const mockCtx = {
        getImageData: vi.fn(() => ({
          data,
          width,
          height,
          colorSpace: 'srgb' as PredefinedColorSpace,
        })),
      } as unknown as CanvasRenderingContext2D;

      const res = validateRenderedFramePixels(mockCtx, width, height);
      expect(res.isValid).toBe(false);
      expect(res.reason).toContain('completely transparent');
      expect(res.details?.isCompletelyTransparent).toBe(true);
    });

    it('detects and flags completely pitch-black canvas output in non-transition scene', () => {
      const width = 10;
      const height = 10;
      const data = new Uint8ClampedArray(width * height * 4);
      // All alpha = 255, but RGB = 0
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 0;     // R
        data[i + 1] = 0; // G
        data[i + 2] = 0; // B
        data[i + 3] = 255; // A
      }

      const mockCtx = {
        getImageData: vi.fn(() => ({
          data,
          width,
          height,
          colorSpace: 'srgb' as PredefinedColorSpace,
        })),
      } as unknown as CanvasRenderingContext2D;

      const res = validateRenderedFramePixels(mockCtx, width, height, {
        isTransitioning: false,
      });

      expect(res.isValid).toBe(false);
      expect(res.reason).toContain('completely black');
      expect(res.details?.isCompletelyBlack).toBe(true);
    });

    it('permits intentional dark frames during active fade transitions', () => {
      const width = 10;
      const height = 10;
      const data = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 255;
      }

      const mockCtx = {
        getImageData: vi.fn(() => ({
          data,
          width,
          height,
          colorSpace: 'srgb' as PredefinedColorSpace,
        })),
      } as unknown as CanvasRenderingContext2D;

      const res = validateRenderedFramePixels(mockCtx, width, height, {
        isTransitioning: true,
      });

      expect(res.isValid).toBe(true);
      expect(res.details?.isCompletelyBlack).toBe(true);
    });

    it('validates and approves frames with healthy luminance and alpha', () => {
      const width = 10;
      const height = 10;
      const data = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 50;
        data[i + 1] = 120;
        data[i + 2] = 200;
        data[i + 3] = 255;
      }

      const mockCtx = {
        getImageData: vi.fn(() => ({
          data,
          width,
          height,
          colorSpace: 'srgb' as PredefinedColorSpace,
        })),
      } as unknown as CanvasRenderingContext2D;

      const res = validateRenderedFramePixels(mockCtx, width, height);
      expect(res.isValid).toBe(true);
      expect(res.details?.isCompletelyBlack).toBe(false);
      expect(res.details?.isCompletelyTransparent).toBe(false);
      expect(res.details?.averageLuminance).toBeGreaterThan(50);
    });
  });

  describe('2. RenderingError Diagnostics', () => {
    it('creates RenderingError with frame index, timestamp, and diagnostic details', () => {
      const err = new RenderingError('Frame failed to render', {
        frameIndex: 42,
        timestampSeconds: 1.4,
        diagnosticDetails: { reason: 'WebGL context lost', sampledLum: 0 },
      });

      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('RenderingError');
      expect(err.message).toBe('Frame failed to render');
      expect(err.frameIndex).toBe(42);
      expect(err.timestampSeconds).toBe(1.4);
      expect(err.diagnosticDetails?.reason).toBe('WebGL context lost');
    });
  });

  describe('3. Canvas Compositor Map Error Guard (requireMapCanvas)', () => {
    it('throws when requireMapCanvas is true and mapCanvas is null', () => {
      const journey = journeyFromWaypoints('Compositor Error Test', MIXED_JOURNEY_WAYPOINTS);
      const frame = evaluateRenderFrame(journey, 0);

      const mockCtx = {
        clearRect: vi.fn(),
        createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
        fillRect: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        arcTo: vi.fn(),
        closePath: vi.fn(),
        fill: vi.fn(),
      } as unknown as CanvasRenderingContext2D;

      expect(() => {
        compositeRenderFrame(mockCtx, frame, {
          mapCanvas: null,
          requireMapCanvas: true,
        });
      }).toThrow('Required map canvas was missing or null');
    });

    it('throws when requireMapCanvas is true and mapCanvas has 0x0 dimensions', () => {
      const journey = journeyFromWaypoints('Zero Dim Test', MIXED_JOURNEY_WAYPOINTS);
      const frame = evaluateRenderFrame(journey, 0);

      const mockCtx = {
        clearRect: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
      } as unknown as CanvasRenderingContext2D;

      const zeroCanvas = {
        width: 0,
        height: 0,
      } as unknown as HTMLCanvasElement;

      expect(() => {
        compositeRenderFrame(mockCtx, frame, {
          mapCanvas: zeroCanvas,
          requireMapCanvas: true,
        });
      }).toThrow('zero dimensions');
    });
  });

  describe('4. Export Pipeline First-Frame Readiness Gate', () => {
    const originalDocument = globalThis.document;
    const originalWindow = globalThis.window;
    const originalMediaRecorder = (globalThis as any).MediaRecorder;

    beforeEach(() => {
      // Provide lightweight canvas DOM mock for Node/Vitest test runner
      const mockCtx = {
        clearRect: vi.fn(),
        drawImage: vi.fn(),
        fillRect: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        arcTo: vi.fn(),
        closePath: vi.fn(),
        fill: vi.fn(),
        fillText: vi.fn(),
        createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
        getImageData: vi.fn(() => {
          const data = new Uint8ClampedArray(640 * 360 * 4);
          data.fill(120); // healthy non-black pixels
          return { data, width: 640, height: 360 };
        }),
      };

      const mockCanvas = {
        width: 640,
        height: 360,
        getContext: vi.fn(() => mockCtx),
        captureStream: vi.fn(() => ({})),
      };

      globalThis.document = {
        createElement: vi.fn((tag: string) => {
          if (tag === 'canvas') return mockCanvas as unknown as HTMLCanvasElement;
          return {} as HTMLElement;
        }),
      } as unknown as Document;

      globalThis.window = globalThis as unknown as (Window & typeof globalThis);
      (globalThis as any).MediaRecorder = class MockMediaRecorder {
        public state = 'inactive';
        public ondataavailable: ((e: any) => void) | null = null;
        public onstop: (() => void) | null = null;
        public onerror: ((e: any) => void) | null = null;
        static isTypeSupported() {
          return true;
        }
        start() {
          this.state = 'recording';
        }
        stop() {
          this.state = 'inactive';
          if (this.onstop) this.onstop();
        }
      };
    });

    afterEach(() => {
      globalThis.document = originalDocument;
      globalThis.window = originalWindow;
      (globalThis as any).MediaRecorder = originalMediaRecorder;
    });

    it('fails fast with RenderingError on frame 0 if getMapCanvas returns null', async () => {
      const journey = journeyFromWaypoints('Gate Test', MIXED_JOURNEY_WAYPOINTS);

      await expect(
        exportJourneyVideo(journey, {
          config: {
            profileName: 'Draft',
            width: 640,
            height: 360,
            fps: 30,
            bitrateMbps: 2,
            codec: 'h264',
            aspectRatio: '16:9',
          },
          getMapCanvas: async () => null,
        })
      ).rejects.toThrow('Initial map canvas provider returned null or unready canvas');
    });

    it('fails fast with RenderingError on frame 0 if getMapCanvas returns 0x0 canvas', async () => {
      const journey = journeyFromWaypoints('Zero Canvas Test', MIXED_JOURNEY_WAYPOINTS);

      await expect(
        exportJourneyVideo(journey, {
          config: {
            profileName: 'Draft',
            width: 640,
            height: 360,
            fps: 30,
            bitrateMbps: 2,
            codec: 'h264',
            aspectRatio: '16:9',
          },
          getMapCanvas: async () => ({ width: 0, height: 0 } as HTMLCanvasElement),
        })
      ).rejects.toThrow('zero dimensions');
    });

    it('fails fast with RenderingError on frame 0 if getMapCanvas throws', async () => {
      const journey = journeyFromWaypoints('Throwing Map Test', MIXED_JOURNEY_WAYPOINTS);

      await expect(
        exportJourneyVideo(journey, {
          config: {
            profileName: 'Draft',
            width: 640,
            height: 360,
            fps: 30,
            bitrateMbps: 2,
            codec: 'h264',
            aspectRatio: '16:9',
          },
          getMapCanvas: async () => {
            throw new Error('MapLibre WebGL context lost during initialization');
          },
        })
      ).rejects.toThrow('First frame map rendering failed: MapLibre WebGL context lost');
    });
    it('fails fast with RenderingError on frame 0 if frame pixel validation detects pitch-black canvas', async () => {
      const journey = journeyFromWaypoints('Black Frame Test', MIXED_JOURNEY_WAYPOINTS);

      // Override mock getImageData to return all zeros (pitch black)
      const mockCanvas = document.createElement('canvas');
      const ctx = mockCanvas.getContext('2d') as any;
      ctx.getImageData = vi.fn(() => ({
        data: new Uint8ClampedArray(640 * 360 * 4), // zeros
        width: 640,
        height: 360,
      }));

      await expect(
        exportJourneyVideo(journey, {
          config: {
            profileName: 'Draft',
            width: 640,
            height: 360,
            fps: 30,
            bitrateMbps: 2,
            codec: 'h264',
            aspectRatio: '16:9',
          },
          getMapCanvas: async () => ({ width: 640, height: 360 } as HTMLCanvasElement),
        })
      ).rejects.toThrow('First frame validation failed: Canvas is completely transparent');
    });

    it('fails fast with RenderingError if getMapCanvas fails on intermediate frames during export', async () => {
      const journey = journeyFromWaypoints('Intermediate Fail Test', MIXED_JOURNEY_WAYPOINTS);
      journey.timeline.duration = 0.2; // 6 frames at 30 fps

      let callCount = 0;
      await expect(
        exportJourneyVideo(journey, {
          config: {
            profileName: 'Draft',
            width: 640,
            height: 360,
            fps: 30,
            bitrateMbps: 2,
            codec: 'h264',
            aspectRatio: '16:9',
          },
          getMapCanvas: async () => {
            callCount++;
            // Succeed on frame 0, fail on subsequent frame
            if (callCount > 1) {
              return null;
            }
            return { width: 640, height: 360 } as HTMLCanvasElement;
          },
        })
      ).rejects.toThrow('Map canvas provider returned null for frame 1');
    });
  });
});

