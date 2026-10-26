/* ─── Video & Audio Exporter Pipeline ─────────────────────────────────
   Deterministic frame-by-frame rendering and offline audiovisual encoding.
   Supports hardware WebCodecs VideoEncoder + AudioEncoder + mp4-muxer
   (primary H.264 MP4 with synchronized AAC audio) with MediaRecorder fallback.
   ─────────────────────────────────────────────────────────────────── */

import { Muxer, ArrayBufferTarget, type MuxerOptions } from 'mp4-muxer';
import type { Journey, MediaAsset } from '../types';
import type {
  ExportJobConfig,
  ExportProgressCallback,
  ExportResult,
  RenderFrame,
} from './types';
import { evaluateRenderFrame } from './contract';
import { compositeRenderFrame, validateRenderedFramePixels } from './canvasCompositor';
import { mixAudioPcm } from '../audio/mixer';
import { prepareJourneyAudioBuffers } from '../audio/audioLoader';
import { prepareVideoSeekers, cleanupVideoSeekers, type VideoFrameSeeker } from './videoSeeker';

export class RenderingError extends Error {
  public readonly frameIndex?: number;
  public readonly timestampSeconds?: number;
  public readonly diagnosticDetails?: Record<string, unknown>;

  constructor(
    message: string,
    details?: {
      frameIndex?: number;
      timestampSeconds?: number;
      diagnosticDetails?: Record<string, unknown>;
    }
  ) {
    super(message);
    this.name = 'RenderingError';
    this.frameIndex = details?.frameIndex;
    this.timestampSeconds = details?.timestampSeconds;
    this.diagnosticDetails = details?.diagnosticDetails;
  }
}

async function preloadMediaElements(journey: Journey): Promise<Map<string, HTMLImageElement>> {
  const cache = new Map<string, HTMLImageElement>();
  if (typeof window === 'undefined' || typeof Image === 'undefined') return cache;

  const allMedia: MediaAsset[] = [];
  if (journey.mediaLibrary) allMedia.push(...journey.mediaLibrary);
  if (journey.timeline?.scenes) {
    for (const sc of journey.timeline.scenes) {
      if (sc.media) allMedia.push(...sc.media);
    }
  }

  await Promise.all(
    allMedia.map(async (m) => {
      if (m.type === 'photo' && m.url && !cache.has(m.id)) {
        try {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          await new Promise<void>((resolve) => {
            img.onload = () => {
              cache.set(m.id, img);
              resolve();
            };
            img.onerror = () => resolve();
            img.src = m.url;
          });
        } catch {
          // Ignore loading errors
        }
      }
    })
  );

  return cache;
}

export function isWebCodecsSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof VideoEncoder !== 'undefined' &&
    typeof VideoFrame !== 'undefined'
  );
}

export function isWebCodecsAudioSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof AudioEncoder !== 'undefined' &&
    typeof AudioData !== 'undefined'
  );
}

export function isMediaRecorderSupported(): boolean {
  return typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined';
}

const H264_CANDIDATE_CODECS = [
  'avc1.640034', // High profile, level 5.2 (4K/1080p60)
  'avc1.640028', // High profile, level 4.0 (1080p30)
  'avc1.4D4028', // Main profile, level 4.0
  'avc1.42E01E', // Baseline profile
];

async function findSupportedH264Codec(
  width: number,
  height: number,
  fps: number,
  bitrateBps: number
): Promise<string | null> {
  if (!isWebCodecsSupported()) return null;

  for (const codec of H264_CANDIDATE_CODECS) {
    try {
      const config: VideoEncoderConfig = {
        codec,
        width,
        height,
        bitrate: bitrateBps,
        framerate: fps,
      };
      const support = await VideoEncoder.isConfigSupported(config);
      if (support.supported) {
        return codec;
      }
    } catch {
      // Try next codec candidate
    }
  }
  return null;
}

export async function findSupportedAacCodec(
  sampleRate: number = 44100,
  numberOfChannels: number = 2,
  bitrateBps: number = 128_000
): Promise<string | null> {
  if (!isWebCodecsAudioSupported()) return null;

  const candidateCodecs = ['mp4a.40.2', 'mp4a.40.02', 'mp4a.40.5'];
  for (const codec of candidateCodecs) {
    try {
      const config: AudioEncoderConfig = {
        codec,
        sampleRate,
        numberOfChannels,
        bitrate: bitrateBps,
      };
      const support = await AudioEncoder.isConfigSupported(config);
      if (support.supported) {
        return codec;
      }
    } catch {
      // Try next
    }
  }
  return null;
}

export interface RenderExportOptions {
  config: ExportJobConfig;
  /** Optional callback to render map background for this frame */
  getMapCanvas?: (frame: RenderFrame) => Promise<HTMLCanvasElement | ImageBitmap | null>;
  /** Optional progress callback */
  onProgress?: ExportProgressCallback;
  /** Abort signal for immediate cancellation */
  abortSignal?: AbortSignal;
}

/**
 * Deterministically renders and encodes a journey into an MP4 or WebM video file,
 * multiplexing synchronized AAC audio where available.
 */
export async function exportJourneyVideo(
  journey: Journey,
  options: RenderExportOptions
): Promise<ExportResult> {
  const { config, getMapCanvas, onProgress, abortSignal } = options;

  if (abortSignal?.aborted) {
    throw new DOMException('Export cancelled by user', 'AbortError');
  }

  // 1. Calculate duration and total frame count
  const duration = config.timeRange
    ? config.timeRange.endTime - config.timeRange.startTime
    : journey.timeline.duration || 60;
  const startTime = config.timeRange ? config.timeRange.startTime : 0;
  const fps = config.fps || 30;
  const totalFrames = Math.max(1, Math.ceil(duration * fps));
  const bitrateBps = (config.bitrateMbps || 8) * 1_000_000;

  // 2. Offscreen rendering canvas
  const canvas = document.createElement('canvas');
  canvas.width = config.width;
  canvas.height = config.height;
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!ctx) {
    throw new Error('Failed to acquire 2D canvas rendering context for video export');
  }

  const startTimeMs = performance.now();

  onProgress?.({
    currentFrame: 0,
    totalFrames,
    percent: 0,
    phase: 'preparing',
    elapsedMs: 0,
    estimatedRemainingMs: 0,
    message: 'Preparing audiovisual encoders...',
  });

  // 3. Choose encoder: WebCodecs + mp4-muxer (Primary) or MediaRecorder (Fallback)
  const chosenVideoCodec = await findSupportedH264Codec(config.width, config.height, fps, bitrateBps);

  if (isWebCodecsSupported() && chosenVideoCodec) {
    return await renderWithWebCodecs({
      journey,
      config,
      startTime,
      duration,
      fps,
      totalFrames,
      bitrateBps,
      codec: chosenVideoCodec,
      canvas,
      ctx,
      getMapCanvas,
      onProgress,
      abortSignal,
      startTimeMs,
    });
  } else if (isMediaRecorderSupported()) {
    return await renderWithMediaRecorder({
      journey,
      config,
      startTime,
      duration,
      fps,
      totalFrames,
      canvas,
      ctx,
      getMapCanvas,
      onProgress,
      abortSignal,
      startTimeMs,
    });
  } else {
    throw new Error('Neither WebCodecs VideoEncoder nor MediaRecorder is supported by this browser.');
  }
}

interface WebCodecsPipelineArgs {
  journey: Journey;
  config: ExportJobConfig;
  startTime: number;
  duration: number;
  fps: number;
  totalFrames: number;
  bitrateBps: number;
  codec: string;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  getMapCanvas?: (frame: RenderFrame) => Promise<HTMLCanvasElement | ImageBitmap | null>;
  onProgress?: ExportProgressCallback;
  abortSignal?: AbortSignal;
  startTimeMs: number;
}

interface FirstFrameValidationResult {
  frame0: RenderFrame;
  mapCanvas0: HTMLCanvasElement | ImageBitmap | null;
  activeMedia0?: CanvasImageSource;
}

async function validateAndPrepareFirstFrame(args: {
  journey: Journey;
  config: ExportJobConfig;
  startTime: number;
  fps: number;
  ctx: CanvasRenderingContext2D;
  getMapCanvas?: (frame: RenderFrame) => Promise<HTMLCanvasElement | ImageBitmap | null>;
  videoSeekers: Map<string, VideoFrameSeeker>;
  mediaCache: Map<string, HTMLImageElement>;
}): Promise<FirstFrameValidationResult> {
  const { journey, config, startTime, fps, ctx, getMapCanvas, videoSeekers, mediaCache } = args;

  const frame0 = evaluateRenderFrame(journey, startTime, {
    width: config.width,
    height: config.height,
    fps,
    aspectRatio: config.aspectRatio,
  });

  let mapCanvas0: HTMLCanvasElement | ImageBitmap | null = null;
  if (getMapCanvas) {
    try {
      mapCanvas0 = await getMapCanvas(frame0);
      if (!mapCanvas0) {
        throw new RenderingError('Initial map canvas provider returned null or unready canvas', {
          frameIndex: 0,
          timestampSeconds: startTime,
        });
      }
      if (mapCanvas0.width === 0 || mapCanvas0.height === 0) {
        throw new RenderingError(
          `Initial map canvas has zero dimensions: ${mapCanvas0.width}x${mapCanvas0.height}`,
          { frameIndex: 0, timestampSeconds: startTime }
        );
      }
    } catch (err) {
      if (err instanceof RenderingError) throw err;
      throw new RenderingError(
        `First frame map rendering failed: ${err instanceof Error ? err.message : String(err)}`,
        { frameIndex: 0, timestampSeconds: startTime }
      );
    }
  }

  let activeMedia0: CanvasImageSource | undefined = undefined;
  const asset0 = frame0.story.activeMedia?.[0];
  if (asset0) {
    if (asset0.type === 'video') {
      const seeker = videoSeekers.get(asset0.id);
      if (seeker) {
        const sceneStart = frame0.story.activeScene?.startTime ?? (frame0.isDwelling ? frame0.timestampSeconds : 0);
        const mediaTime = Math.max(0, startTime - sceneStart);
        const videoEl = await seeker.seekTo(mediaTime);
        if (videoEl) activeMedia0 = videoEl;
      }
    } else if (asset0.type === 'photo') {
      activeMedia0 = mediaCache.get(asset0.id);
    }
  }

  compositeRenderFrame(ctx, frame0, {
    mapCanvas: mapCanvas0,
    requireMapCanvas: Boolean(getMapCanvas),
    activeMediaElement: activeMedia0,
    cinematicTreatment: config.cinematicTreatment,
    drawSafeAreaGuides: config.drawSafeAreaGuides,
    attributionText: config.attributionText,
  });

  const check = validateRenderedFramePixels(ctx, config.width, config.height, {
    hasMapCanvas: Boolean(mapCanvas0),
    isTransitioning: Boolean(frame0.story.transition),
    isTitleCard: Boolean(frame0.story.activeTitleCard),
  });

  if (!check.isValid) {
    throw new RenderingError(
      `First frame validation failed: ${check.reason}. The initial frame rendered blank or black.`,
      {
        frameIndex: 0,
        timestampSeconds: startTime,
        diagnosticDetails: check.details,
      }
    );
  }

  return { frame0, mapCanvas0, activeMedia0 };
}

async function renderWithWebCodecs(args: WebCodecsPipelineArgs): Promise<ExportResult> {
  const {
    journey,
    config,
    startTime,
    duration,
    fps,
    totalFrames,
    bitrateBps,
    codec,
    canvas,
    ctx,
    getMapCanvas,
    onProgress,
    abortSignal,
    startTimeMs,
  } = args;

  // 1. Determine audio eligibility and load buffers
  const wantAudio = config.includeAudio !== false;
  const audioBitrateBps = (config.audioBitrateKbps || 128) * 1000;
  const sampleRate = journey.audio?.sampleRate || 44100;
  const channelCount = 2;

  let hasAudio = false;
  let aacCodec: string | null = null;
  let mixedAudio: { leftChannel: Float32Array; rightChannel: Float32Array } | null = null;

  if (wantAudio && journey.audio && journey.audio.tracks && journey.audio.tracks.length > 0) {
    const hasClips = journey.audio.tracks.some((t) => !t.muted && t.clips.some((c) => !c.muted));
    if (hasClips) {
      onProgress?.({
        currentFrame: 0,
        totalFrames,
        percent: 1,
        phase: 'preparing',
        elapsedMs: Math.round(performance.now() - startTimeMs),
        estimatedRemainingMs: 0,
        message: 'Decoding and mixing audio tracks...',
      });

      try {
        const sourceBuffers = await prepareJourneyAudioBuffers(journey);
        if (sourceBuffers.size > 0) {
          aacCodec = await findSupportedAacCodec(sampleRate, channelCount, audioBitrateBps);
          if (aacCodec) {
            mixedAudio = mixAudioPcm({
              durationSeconds: duration,
              startTimeSeconds: startTime,
              sampleRate,
              timeline: journey.audio,
              sourceBuffers,
            });
            hasAudio = true;
          }
        }
      } catch (audioErr) {
        console.warn('Audio preparation warning; proceeding with video-only export:', audioErr);
      }
    }
  }

  // 2. Initialize MP4 Muxer with video (and optional audio) tracks
  const muxerTarget = new ArrayBufferTarget();
  const muxerOptions: MuxerOptions<ArrayBufferTarget> = {
    target: muxerTarget,
    video: {
      codec: 'avc',
      width: config.width,
      height: config.height,
      frameRate: fps,
    },
    fastStart: 'in-memory',
    firstTimestampBehavior: hasAudio ? 'cross-track-offset' : 'offset',
  };

  if (hasAudio) {
    muxerOptions.audio = {
      codec: 'aac',
      numberOfChannels: channelCount,
      sampleRate,
    };
  }

  const muxer = new Muxer(muxerOptions);

  // 3. Initialize VideoEncoder
  let encoderError: Error | null = null;
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => {
      encoderError = err;
    },
  });

  videoEncoder.configure({
    codec,
    width: config.width,
    height: config.height,
    bitrate: bitrateBps,
    framerate: fps,
    latencyMode: 'quality',
    avc: { format: 'avc' },
  });

  // 4. Initialize AudioEncoder if audio track is active
  let audioEncoder: AudioEncoder | null = null;
  let audioEncoderError: Error | null = null;

  if (hasAudio && aacCodec) {
    audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (err) => {
        audioEncoderError = err;
      },
    });

    audioEncoder.configure({
      codec: aacCodec,
      sampleRate,
      numberOfChannels: channelCount,
      bitrate: audioBitrateBps,
    });
  }

  const usPerFrame = 1e6 / fps;
  const mediaCache = await preloadMediaElements(journey);
  const videoSeekers = await prepareVideoSeekers(journey);

  try {
    // 5. Pre-flight First-Frame Rendering & Pixel Validation Gate
    onProgress?.({
      currentFrame: 0,
      totalFrames,
      percent: 0,
      phase: 'preparing',
      elapsedMs: Math.round(performance.now() - startTimeMs),
      estimatedRemainingMs: 0,
      message: 'Validating initial frame rendering readiness...',
    });

    await validateAndPrepareFirstFrame({
      journey,
      config,
      startTime,
      fps,
      ctx,
      getMapCanvas,
      videoSeekers,
      mediaCache,
    });

    // 6. Render and encode video frames
    for (let i = 0; i < totalFrames; i++) {
      if (abortSignal?.aborted) {
        videoEncoder.close();
        if (audioEncoder && audioEncoder.state !== 'closed') audioEncoder.close();
        throw new DOMException('Export cancelled by user', 'AbortError');
      }
      if (encoderError) {
        throw encoderError;
      }
      if (audioEncoderError) {
        throw audioEncoderError;
      }

      const timeSeconds = startTime + i / fps;

      // Frame 0 was already composited and validated in pre-flight gate.
      // Re-composite for all subsequent frames (i > 0).
      if (i > 0) {
        const frame = evaluateRenderFrame(journey, timeSeconds, {
          width: config.width,
          height: config.height,
          fps,
          aspectRatio: config.aspectRatio,
        });

        // Obtain map snapshot if available
        let mapCanvas: HTMLCanvasElement | ImageBitmap | null = null;
        if (getMapCanvas) {
          try {
            mapCanvas = await getMapCanvas(frame);
            if (!mapCanvas) {
              throw new RenderingError(`Map canvas provider returned null for frame ${i} (t=${timeSeconds.toFixed(3)}s)`, {
                frameIndex: i,
                timestampSeconds: timeSeconds,
              });
            }
            if (mapCanvas.width === 0 || mapCanvas.height === 0) {
              throw new RenderingError(`Map canvas for frame ${i} has zero dimensions: ${mapCanvas.width}x${mapCanvas.height}`, {
                frameIndex: i,
                timestampSeconds: timeSeconds,
              });
            }
          } catch (mapErr) {
            if (mapErr instanceof RenderingError) throw mapErr;
            throw new RenderingError(
              `Failed to obtain map frame ${i} at t=${timeSeconds.toFixed(3)}s: ${mapErr instanceof Error ? mapErr.message : String(mapErr)}`,
              { frameIndex: i, timestampSeconds: timeSeconds }
            );
          }
        }

        const activeAsset = frame.story.activeMedia?.[0];
        let activeMediaElement: CanvasImageSource | undefined = undefined;

        if (activeAsset) {
          if (activeAsset.type === 'video') {
            const seeker = videoSeekers.get(activeAsset.id);
            if (seeker) {
              const sceneStart = frame.story.activeScene?.startTime ?? (frame.isDwelling ? frame.timestampSeconds : 0);
              const mediaTime = Math.max(0, timeSeconds - sceneStart);
              const videoEl = await seeker.seekTo(mediaTime);
              if (videoEl) {
                activeMediaElement = videoEl;
              }
            }
          } else if (activeAsset.type === 'photo') {
            activeMediaElement = mediaCache.get(activeAsset.id);
          }
        }

        // Composite complete visual frame
        compositeRenderFrame(ctx, frame, {
          mapCanvas,
          requireMapCanvas: Boolean(getMapCanvas),
          activeMediaElement,
          cinematicTreatment: config.cinematicTreatment,
          drawSafeAreaGuides: config.drawSafeAreaGuides,
          attributionText: config.attributionText,
        });
      }

      // Encode video frame
      const presentationUs = Math.round(i * usPerFrame);
      const videoFrame = new VideoFrame(canvas, {
        timestamp: presentationUs,
        duration: Math.round(usPerFrame),
      });

      const isKeyFrame = i % (fps * 2) === 0;
      videoEncoder.encode(videoFrame, { keyFrame: isKeyFrame });
      videoFrame.close();

      // Video encoder backpressure management
      while (videoEncoder.encodeQueueSize > 4) {
        await new Promise((r) => setTimeout(r, 4));
      }

      // Progress reporting
      const elapsedMs = performance.now() - startTimeMs;
      const avgMsPerFrame = elapsedMs / (i + 1);
      const estimatedRemainingMs = Math.round(avgMsPerFrame * (totalFrames - (i + 1)));

      onProgress?.({
        currentFrame: i + 1,
        totalFrames,
        percent: Math.round(((i + 1) / totalFrames) * (hasAudio ? 90 : 98)),
        phase: 'rendering',
        elapsedMs: Math.round(elapsedMs),
        estimatedRemainingMs,
        message: `Rendering video frame ${i + 1} of ${totalFrames}...`,
      });
    }

    // 6. Encode synchronized AAC audio chunks
    if (hasAudio && audioEncoder && mixedAudio) {
      onProgress?.({
        currentFrame: totalFrames,
        totalFrames,
        percent: 92,
        phase: 'encoding',
        elapsedMs: Math.round(performance.now() - startTimeMs),
        estimatedRemainingMs: 30,
        message: 'Encoding synchronized AAC audio track...',
      });

      const audioChunkFrames = 1024;
      const totalAudioSamples = mixedAudio.leftChannel.length;

      for (let offset = 0; offset < totalAudioSamples; offset += audioChunkFrames) {
        if (abortSignal?.aborted) {
          videoEncoder.close();
          audioEncoder.close();
          throw new DOMException('Export cancelled by user', 'AbortError');
        }
        if (audioEncoderError) {
          throw audioEncoderError;
        }

        const framesThisChunk = Math.min(audioChunkFrames, totalAudioSamples - offset);
        const planarBuffer = new Float32Array(framesThisChunk * 2);
        planarBuffer.set(mixedAudio.leftChannel.subarray(offset, offset + framesThisChunk), 0);
        planarBuffer.set(mixedAudio.rightChannel.subarray(offset, offset + framesThisChunk), framesThisChunk);

        const presentationAudioUs = Math.round((offset / sampleRate) * 1e6);
        const audioData = new AudioData({
          format: 'f32-planar',
          sampleRate,
          numberOfFrames: framesThisChunk,
          numberOfChannels: channelCount,
          timestamp: presentationAudioUs,
          data: planarBuffer,
        });

        audioEncoder.encode(audioData);
        audioData.close();

        while (audioEncoder.encodeQueueSize > 8) {
          await new Promise((r) => setTimeout(r, 4));
        }
      }

      await audioEncoder.flush();
      audioEncoder.close();
    }

    onProgress?.({
      currentFrame: totalFrames,
      totalFrames,
      percent: 99,
      phase: 'muxing',
      elapsedMs: Math.round(performance.now() - startTimeMs),
      estimatedRemainingMs: 20,
      message: 'Finalizing MP4 container (H.264 + AAC)...',
    });

    await videoEncoder.flush();
    videoEncoder.close();

    if (encoderError) throw encoderError;
    if (audioEncoderError) throw audioEncoderError;

    muxer.finalize();
    const buffer = muxerTarget.buffer;
    const blob = new Blob([buffer], { type: 'video/mp4' });
    const filename = `${journey.name.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}_${config.profileName.toLowerCase().replace(/[^a-z0-9]/g, '_')}.mp4`;

    const result: ExportResult = {
      blob,
      mimeType: 'video/mp4',
      filename,
      durationSeconds: duration,
      totalFrames,
      width: config.width,
      height: config.height,
      sizeBytes: blob.size,
      hasAudioTrack: hasAudio,
      audioCodec: hasAudio ? (aacCodec ?? 'aac') : undefined,
      audioChannels: hasAudio ? channelCount : undefined,
      audioSampleRate: hasAudio ? sampleRate : undefined,
    };

    onProgress?.({
      currentFrame: totalFrames,
      totalFrames,
      percent: 100,
      phase: 'complete',
      elapsedMs: Math.round(performance.now() - startTimeMs),
      estimatedRemainingMs: 0,
      message: `Export completed successfully (${(blob.size / (1024 * 1024)).toFixed(2)} MB${hasAudio ? ' with AAC audio' : ''})`,
    });

    return result;
  } catch (err) {
    if (videoEncoder.state !== 'closed') {
      videoEncoder.close();
    }
    if (audioEncoder && audioEncoder.state !== 'closed') {
      audioEncoder.close();
    }
    throw err;
  } finally {
    cleanupVideoSeekers(videoSeekers);
  }
}

interface MediaRecorderPipelineArgs {
  journey: Journey;
  config: ExportJobConfig;
  startTime: number;
  duration: number;
  fps: number;
  totalFrames: number;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  getMapCanvas?: (frame: RenderFrame) => Promise<HTMLCanvasElement | ImageBitmap | null>;
  onProgress?: ExportProgressCallback;
  abortSignal?: AbortSignal;
  startTimeMs: number;
}

async function renderWithMediaRecorder(args: MediaRecorderPipelineArgs): Promise<ExportResult> {
  const {
    journey,
    config,
    startTime,
    duration,
    fps,
    totalFrames,
    canvas,
    ctx,
    getMapCanvas,
    onProgress,
    abortSignal,
    startTimeMs,
  } = args;

  const stream = canvas.captureStream(fps);
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm';

  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: (config.bitrateMbps || 8) * 1_000_000,
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const mediaCache = await preloadMediaElements(journey);
  const videoSeekers = await prepareVideoSeekers(journey);

  try {
    // Pre-flight First-Frame Rendering & Pixel Validation Gate
    onProgress?.({
      currentFrame: 0,
      totalFrames,
      percent: 0,
      phase: 'preparing',
      elapsedMs: Math.round(performance.now() - startTimeMs),
      estimatedRemainingMs: 0,
      message: 'Validating initial frame rendering readiness...',
    });

    await validateAndPrepareFirstFrame({
      journey,
      config,
      startTime,
      fps,
      ctx,
      getMapCanvas,
      videoSeekers,
      mediaCache,
    });

    recorder.start();

    for (let i = 0; i < totalFrames; i++) {
      if (abortSignal?.aborted) {
        recorder.stop();
        throw new DOMException('Export cancelled by user', 'AbortError');
      }

      const timeSeconds = startTime + i / fps;

      // Frame 0 was already composited and validated in pre-flight gate.
      // Re-composite for all subsequent frames (i > 0).
      if (i > 0) {
        const frame = evaluateRenderFrame(journey, timeSeconds, {
          width: config.width,
          height: config.height,
          fps,
          aspectRatio: config.aspectRatio,
        });

        let mapCanvas: HTMLCanvasElement | ImageBitmap | null = null;
        if (getMapCanvas) {
          try {
            mapCanvas = await getMapCanvas(frame);
            if (!mapCanvas) {
              throw new RenderingError(`Map canvas provider returned null for frame ${i} (t=${timeSeconds.toFixed(3)}s)`, {
                frameIndex: i,
                timestampSeconds: timeSeconds,
              });
            }
            if (mapCanvas.width === 0 || mapCanvas.height === 0) {
              throw new RenderingError(`Map canvas for frame ${i} has zero dimensions: ${mapCanvas.width}x${mapCanvas.height}`, {
                frameIndex: i,
                timestampSeconds: timeSeconds,
              });
            }
          } catch (mapErr) {
            if (mapErr instanceof RenderingError) throw mapErr;
            throw new RenderingError(
              `Failed to obtain map frame ${i} at t=${timeSeconds.toFixed(3)}s: ${mapErr instanceof Error ? mapErr.message : String(mapErr)}`,
              { frameIndex: i, timestampSeconds: timeSeconds }
            );
          }
        }

        const activeAsset = frame.story.activeMedia?.[0];
        let activeMediaElement: CanvasImageSource | undefined = undefined;

        if (activeAsset) {
          if (activeAsset.type === 'video') {
            const seeker = videoSeekers.get(activeAsset.id);
            if (seeker) {
              const sceneStart = frame.story.activeScene?.startTime ?? (frame.isDwelling ? frame.timestampSeconds : 0);
              const mediaTime = Math.max(0, timeSeconds - sceneStart);
              const videoEl = await seeker.seekTo(mediaTime);
              if (videoEl) {
                activeMediaElement = videoEl;
              }
            }
          } else if (activeAsset.type === 'photo') {
            activeMediaElement = mediaCache.get(activeAsset.id);
          }
        }

        compositeRenderFrame(ctx, frame, {
          mapCanvas,
          requireMapCanvas: Boolean(getMapCanvas),
          activeMediaElement,
          cinematicTreatment: config.cinematicTreatment,
          drawSafeAreaGuides: config.drawSafeAreaGuides,
          attributionText: config.attributionText,
        });
      }

      // Frame interval wait for real-time stream capture
      await new Promise((r) => setTimeout(r, Math.round(1000 / fps)));

      const elapsedMs = performance.now() - startTimeMs;
      const estimatedRemainingMs = Math.round((elapsedMs / (i + 1)) * (totalFrames - (i + 1)));

      onProgress?.({
        currentFrame: i + 1,
        totalFrames,
        percent: Math.round(((i + 1) / totalFrames) * 100),
        phase: 'rendering',
        elapsedMs: Math.round(elapsedMs),
        estimatedRemainingMs,
        message: `Recording frame ${i + 1} of ${totalFrames}...`,
      });
    }

    return await new Promise<ExportResult>((resolve, reject) => {
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType });
        const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
        const filename = `${journey.name.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}.${ext}`;
        resolve({
          blob,
          mimeType,
          filename,
          durationSeconds: duration,
          totalFrames,
          width: config.width,
          height: config.height,
          sizeBytes: blob.size,
          hasAudioTrack: false,
        });
      };
      recorder.onerror = (e) => reject(e);
      recorder.stop();
    });
  } catch (err) {
    if (recorder.state !== 'inactive') {
      recorder.stop();
    }
    throw err;
  } finally {
    cleanupVideoSeekers(videoSeekers);
  }
}

/**
 * Initiates browser download of an exported video Blob.
 */
export function downloadExportBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 15_000);
}
