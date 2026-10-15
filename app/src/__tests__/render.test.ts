/* ─── Render Domain, Media Playback & Deterministic Frame Tests ─────
   Verifies RenderFrame contract, mathematical determinism, media playback
   resolution, fixed-step frame generators, and canvas compositor.
   ─────────────────────────────────────────────────────────────────── */

import { describe, it, expect } from 'vitest';
import { journeyFromWaypoints } from '../domain/journey';
import { MIXED_JOURNEY_WAYPOINTS } from './fixtures';
import {
  evaluateRenderFrame,
  generateRenderFrames,
  classifyDeterminism,
} from '../domain/render/contract';
import {
  resolveMediaPlayback,
  isSupportedVideoFormat,
  isSupportedImageFormat,
  mediaRegistry,
} from '../domain/render/mediaManager';
import { compositeRenderFrame } from '../domain/render/canvasCompositor';
import { exportJourneyVideo } from '../domain/render/exporter';
import { createMediaAsset, generateDefaultStoryScenes } from '../domain/story';
import { serializeProject, deserializeProject } from '../domain/serialization';
import type { StoryScene, MediaAsset } from '../domain/types';

describe('Render Domain, Media Playback & Deterministic Rendering Foundation', () => {
  describe('RenderFrame Contract & Evaluation', () => {
    it('evaluates complete composite RenderFrame at explicit timestamps', () => {
      let journey = journeyFromWaypoints('Render Journey', MIXED_JOURNEY_WAYPOINTS);
      journey.timeline.scenes = generateDefaultStoryScenes(journey) as StoryScene[];

      // Evaluate at t = 2.0s
      const frame = evaluateRenderFrame(journey, 2.0, {
        width: 1920,
        height: 1080,
        fps: 30,
        aspectRatio: '16:9',
      });

      expect(frame.frameIndex).toBe(60); // 2.0 * 30fps
      expect(frame.timestampSeconds).toBe(2.0);
      expect(frame.totalDurationSeconds).toBeGreaterThan(0);
      expect(frame.spatialProgress).toBeGreaterThanOrEqual(0);
      expect(frame.spatialProgress).toBeLessThanOrEqual(1);

      // Coordinates
      expect(typeof frame.position.lng).toBe('number');
      expect(typeof frame.position.lat).toBe('number');
      expect(Number.isFinite(frame.position.lng)).toBe(true);
      expect(Number.isFinite(frame.position.lat)).toBe(true);

      // Camera pose
      expect(frame.camera).toBeDefined();
      expect(Number.isFinite(frame.camera.bearing)).toBe(true);
      expect(Number.isFinite(frame.camera.pitch)).toBe(true);
      expect(Number.isFinite(frame.camera.zoom)).toBe(true);
      expect(Number.isFinite(frame.camera.altitude)).toBe(true);
      expect(frame.camera.eye).toBeDefined();

      // Story overlay
      expect(frame.story).toBeDefined();
      expect(frame.story.activeScene).not.toBeNull();
      expect(frame.story.title).toBeDefined();

      // Metadata
      expect(frame.metadata.width).toBe(1920);
      expect(frame.metadata.height).toBe(1080);
      expect(frame.metadata.fps).toBe(30);
    });

    it('guarantees 100% mathematical determinism across repeated seeks', () => {
      const journey = journeyFromWaypoints('Determinism Test', MIXED_JOURNEY_WAYPOINTS);
      journey.timeline.scenes = generateDefaultStoryScenes(journey) as StoryScene[];

      const time = 12.345;
      const frameA = evaluateRenderFrame(journey, time);
      const frameB = evaluateRenderFrame(journey, time);

      // Coordinates must be bitwise identical
      expect(frameA.position.lng).toBe(frameB.position.lng);
      expect(frameA.position.lat).toBe(frameB.position.lat);
      expect(frameA.position.ele).toBe(frameB.position.ele);
      expect(frameA.bearing).toBe(frameB.bearing);
      expect(frameA.spatialProgress).toBe(frameB.spatialProgress);

      // Camera pose must be bitwise identical
      expect(frameA.camera.bearing).toBe(frameB.camera.bearing);
      expect(frameA.camera.pitch).toBe(frameB.camera.pitch);
      expect(frameA.camera.zoom).toBe(frameB.camera.zoom);
      expect(frameA.camera.altitude).toBe(frameB.camera.altitude);
      expect(frameA.camera.eye.lng).toBe(frameB.camera.eye.lng);
      expect(frameA.camera.eye.lat).toBe(frameB.camera.eye.lat);

      // Story overlay must be identical
      expect(frameA.story.activeScene?.id).toBe(frameB.story.activeScene?.id);
      expect(frameA.story.title).toBe(frameB.story.title);
      expect(frameA.story.caption).toBe(frameB.story.caption);
    });

    it('classifies mathematical determinism vs environmental runtime factors', () => {
      const report = classifyDeterminism();
      expect(report.mathematicalDeterminism.spatialPosition).toBe(true);
      expect(report.mathematicalDeterminism.cameraPositionAndAngles).toBe(true);
      expect(report.mathematicalDeterminism.storySceneSelection).toBe(true);
      expect(report.environmentalDeterminism.mapTileRasterization).toBe(
        'asynchronous-network-cache-dependent'
      );
    });
  });

  describe('Synchronization Across Journey Movement, Camera and Story', () => {
    it('synchronizes stop dwell state, camera framing, and stop highlight flag', () => {
      const journey = journeyFromWaypoints('Sync Journey', MIXED_JOURNEY_WAYPOINTS);
      // First stop is at index 0, dwell duration 8s
      journey.stops[0].durationAtStop = 8;
      journey.timeline.scenes = generateDefaultStoryScenes(journey) as StoryScene[];

      // Evaluate at t = 0.5s (during first stop dwell)
      const dwellFrame = evaluateRenderFrame(journey, 0.5);
      expect(dwellFrame.isDwelling).toBe(true);
      expect(dwellFrame.activeStop).not.toBeNull();
      expect(dwellFrame.activeStop?.name).toBe(journey.stops[0].name);
      expect(dwellFrame.story.isStopHighlight).toBe(true);

      // Evaluate later when moving
      const moveFrame = evaluateRenderFrame(journey, 15.0);
      expect(moveFrame.isDwelling).toBe(false);
      expect(moveFrame.activeStop).toBeNull();
    });

    it('respects custom camera keyframes synchronized with narrative scenes', () => {
      const journey = journeyFromWaypoints('Cam Keyframe Sync', MIXED_JOURNEY_WAYPOINTS);
      journey.timeline.keyframes = [
        {
          id: 'kf-summit',
          time: 3.0,
          mode: 'orbit',
          bearing: 90,
          pitch: 65,
          zoom: 15,
          label: 'Summit Orbit',
        },
      ];
      journey.timeline.scenes = [
        {
          id: 'scene-summit',
          name: 'Summit Approach',
          intent: 'highlight',
          startTime: 0,
          endTime: 10,
          cameraMode: 'orbit',
          params: { zoom: 15, pitch: 65, bearing: 90, rotationSpeed: 36 },
          title: 'Summit Panorama',
        },
      ];

      const frame = evaluateRenderFrame(journey, 3.0);
      expect(frame.camera.mode).toBe('orbit');
      expect(frame.camera.bearing).toBe(90);
      expect(frame.camera.pitch).toBe(65);
      expect(frame.story.title).toBe('Summit Panorama');
    });
  });

  describe('Fixed-Step Frame Scheduling (generateRenderFrames)', () => {
    it('yields exact sequential frames without gaps or drift', () => {
      const journey = journeyFromWaypoints('Grid Test', MIXED_JOURNEY_WAYPOINTS);
      journey.timeline.duration = 10;
      const fps = 30;

      const frames: number[] = [];
      for (const frame of generateRenderFrames(journey, { fps })) {
        frames.push(frame.timestampSeconds);
      }

      // Expected total: 10s * 30fps + 1 = 301 frames
      expect(frames.length).toBe(301);
      expect(frames[0]).toBe(0);
      expect(frames[frames.length - 1]).toBe(10);

      // Monotonic step check
      for (let i = 1; i < frames.length; i++) {
        const delta = frames[i] - frames[i - 1];
        expect(Math.abs(delta - 1 / fps)).toBeLessThan(1e-6);
      }
    });
  });

  describe('Media Playback Resolution & Synchronization', () => {
    it('accurately resolves image and video media states relative to scene timeline', () => {
      const photo: MediaAsset = createMediaAsset('alpine.jpg', 'images/alpine.jpg');
      const video: MediaAsset = createMediaAsset('flight.mp4', 'videos/flight.mp4', {
        mimeType: 'video/mp4',
      });

      // Active photo during scene [5s, 15s] evaluated at t = 8s
      const photoState = resolveMediaPlayback(photo, 8.0, 5.0, 15.0);
      expect(photoState.isActive).toBe(true);
      expect(photoState.isImage).toBe(true);
      expect(photoState.isVideo).toBe(false);
      expect(photoState.mediaTimeSeconds).toBe(3.0);
      expect(photoState.status).toBe('ready');

      // Video media time offset
      const videoState = resolveMediaPlayback(video, 11.5, 5.0, 15.0);
      expect(videoState.isActive).toBe(true);
      expect(videoState.isVideo).toBe(true);
      expect(videoState.mediaTimeSeconds).toBe(6.5);

      // Inactive when evaluated outside scene bounds
      const inactiveState = resolveMediaPlayback(photo, 20.0, 5.0, 15.0);
      expect(inactiveState.isActive).toBe(false);
    });

    it('identifies missing media assets without substituting unrelated files', () => {
      const missingAsset: MediaAsset = createMediaAsset('deleted.jpg', '', {
        isMissing: true,
      });

      const res = resolveMediaPlayback(missingAsset, 2.0, 0, 10);
      expect(res.status).toBe('missing');
      expect(res.errorMessage).toContain('Source file missing');
    });

    it('detects unsupported file formats gracefully', () => {
      const unknownAsset: MediaAsset = createMediaAsset('document.pdf', 'files/document.pdf');
      const res = resolveMediaPlayback(unknownAsset, 2.0, 0, 10);
      expect(res.status).toBe('unsupported');
      expect(res.errorMessage).toContain('Format not supported');
    });

    it('detects supported image and video formats accurately', () => {
      expect(isSupportedImageFormat('view.jpg')).toBe(true);
      expect(isSupportedImageFormat('PHOTO.PNG')).toBe(true);
      expect(isSupportedImageFormat('render.webp')).toBe(true);
      expect(isSupportedVideoFormat('clip.mp4')).toBe(true);
      expect(isSupportedVideoFormat('DRONE.WEBM')).toBe(true);
      expect(isSupportedVideoFormat('track.gpx')).toBe(false);
    });

    it('cleans up tracked media URLs to prevent browser memory leaks', () => {
      // Mock URL.createObjectURL and revokeObjectURL in vitest environment if absent
      if (typeof URL.createObjectURL === 'undefined') {
        URL.createObjectURL = () => 'blob:mock-url';
        URL.revokeObjectURL = () => {};
      }

      const blob = new Blob(['sample data'], { type: 'text/plain' });
      const url = mediaRegistry.createTrackedUrl(blob);
      expect(mediaRegistry.getActiveCount()).toBeGreaterThan(0);

      mediaRegistry.revoke(url);
      mediaRegistry.cleanupAll();
      expect(mediaRegistry.getActiveCount()).toBe(0);
    });
  });

  describe('Canvas Compositor', () => {
    it('composites complete RenderFrame without throwing', () => {
      const journey = journeyFromWaypoints('Compositor Test', MIXED_JOURNEY_WAYPOINTS);
      journey.timeline.scenes = generateDefaultStoryScenes(journey) as StoryScene[];

      const frame = evaluateRenderFrame(journey, 2.0);

      // Create synthetic canvas context mock
      const calls: string[] = [];
      const mockCtx = {
        clearRect: () => calls.push('clearRect'),
        createLinearGradient: () => ({ addColorStop: () => {} }),
        fillRect: () => calls.push('fillRect'),
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        stroke: () => {},
        arcTo: () => {},
        closePath: () => {},
        fill: () => {},
        save: () => calls.push('save'),
        restore: () => calls.push('restore'),
        fillText: (txt: string) => calls.push(`fillText:${txt}`),
        drawImage: () => calls.push('drawImage'),
        clip: () => {},
      } as unknown as CanvasRenderingContext2D;

      expect(() => {
        compositeRenderFrame(mockCtx, frame);
      }).not.toThrow();

      expect(calls).toContain('clearRect');
      expect(calls).toContain('save');
      expect(calls).toContain('restore');
    });
  });

  describe('Export Cancellation & Error Handling', () => {
    it('aborts immediately when AbortSignal is already cancelled', async () => {
      const journey = journeyFromWaypoints('Cancel Test', MIXED_JOURNEY_WAYPOINTS);
      const controller = new AbortController();
      controller.abort();

      await expect(
        exportJourneyVideo(journey, {
          config: {
            profileName: 'Draft',
            width: 1280,
            height: 720,
            fps: 30,
            bitrateMbps: 4,
            codec: 'h264',
            aspectRatio: '16:9',
          },
          abortSignal: controller.signal,
        })
      ).rejects.toThrow('Export cancelled');
    });
  });

  describe('Backward Compatibility with Project Serialization', () => {
    it('preserves serialized journey integrity and roundtrips through render evaluation', () => {
      let journey = journeyFromWaypoints('Compat Test', MIXED_JOURNEY_WAYPOINTS);
      journey.timeline.scenes = generateDefaultStoryScenes(journey) as StoryScene[];

      const jsonStr = serializeProject(journey);
      const parsed = deserializeProject(jsonStr);

      const frame = evaluateRenderFrame(parsed, 1.0);
      expect(frame.story.title).toBeDefined();
      expect(frame.camera.mode).toBeDefined();
      expect(Number.isFinite(frame.position.lng)).toBe(true);
    });
  });
});
