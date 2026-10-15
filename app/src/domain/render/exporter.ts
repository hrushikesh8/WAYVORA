/* ─── Video Exporter Pipeline ────────────────────────────────────────
   Deterministic frame-by-frame rendering and offline video encoding.
   Supports hardware WebCodecs VideoEncoder + mp4-muxer (primary H.264 MP4)
   with MediaRecorder WebM fallback.
   ─────────────────────────────────────────────────────────────────── */

import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import type { Journey } from '../types';
import type {
  ExportJobConfig,
  ExportProgressCallback,
  ExportResult,
  RenderFrame,
} from './types';
import { evaluateRenderFrame } from './contract';
import { compositeRenderFrame } from './canvasCompositor';

export function isWebCodecsSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof VideoEncoder !== 'undefined' &&
    typeof VideoFrame !== 'undefined'
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
 * Deterministically renders and encodes a journey into an MP4 or WebM video file.
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
    message: 'Initializing video encoder...',
  });

  // 3. Choose encoder: WebCodecs + mp4-muxer (Primary) or MediaRecorder (Fallback)
  const chosenCodec = await findSupportedH264Codec(config.width, config.height, fps, bitrateBps);

  if (isWebCodecsSupported() && chosenCodec) {
    return await renderWithWebCodecs({
      journey,
      config,
      startTime,
      duration,
      fps,
      totalFrames,
      bitrateBps,
      codec: chosenCodec,
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

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: {
      codec: 'avc',
      width: config.width,
      height: config.height,
      frameRate: fps,
    },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  let encoderError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => {
      encoderError = err;
    },
  });

  encoder.configure({
    codec,
    width: config.width,
    height: config.height,
    bitrate: bitrateBps,
    framerate: fps,
    latencyMode: 'quality',
    avc: { format: 'avc' },
  });

  const usPerFrame = 1e6 / fps;

  try {
    for (let i = 0; i < totalFrames; i++) {
      if (abortSignal?.aborted) {
        encoder.close();
        throw new DOMException('Export cancelled by user', 'AbortError');
      }
      if (encoderError) {
        throw encoderError;
      }

      const timeSeconds = startTime + i / fps;
      const frame = evaluateRenderFrame(journey, timeSeconds, {
        width: config.width,
        height: config.height,
        fps,
        aspectRatio: config.aspectRatio,
      });

      // Obtain map snapshot if available
      const mapCanvas = getMapCanvas ? await getMapCanvas(frame) : null;

      // Composite complete visual frame
      compositeRenderFrame(ctx, frame, { mapCanvas });

      // Encode frame
      const presentationUs = Math.round(i * usPerFrame);
      const videoFrame = new VideoFrame(canvas, {
        timestamp: presentationUs,
        duration: Math.round(usPerFrame),
      });

      const isKeyFrame = i % (fps * 2) === 0;
      encoder.encode(videoFrame, { keyFrame: isKeyFrame });
      videoFrame.close();

      // Encoder backpressure management
      while (encoder.encodeQueueSize > 4) {
        await new Promise((r) => setTimeout(r, 4));
      }

      // Progress reporting
      const elapsedMs = performance.now() - startTimeMs;
      const avgMsPerFrame = elapsedMs / (i + 1);
      const estimatedRemainingMs = Math.round(avgMsPerFrame * (totalFrames - (i + 1)));

      onProgress?.({
        currentFrame: i + 1,
        totalFrames,
        percent: Math.round(((i + 1) / totalFrames) * 100),
        phase: 'rendering',
        elapsedMs: Math.round(elapsedMs),
        estimatedRemainingMs,
        message: `Rendering frame ${i + 1} of ${totalFrames}...`,
      });
    }

    onProgress?.({
      currentFrame: totalFrames,
      totalFrames,
      percent: 99,
      phase: 'muxing',
      elapsedMs: Math.round(performance.now() - startTimeMs),
      estimatedRemainingMs: 50,
      message: 'Finalizing MP4 container...',
    });

    await encoder.flush();
    encoder.close();

    if (encoderError) {
      throw encoderError;
    }

    muxer.finalize();
    const buffer = muxer.target.buffer;
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
    };

    onProgress?.({
      currentFrame: totalFrames,
      totalFrames,
      percent: 100,
      phase: 'complete',
      elapsedMs: Math.round(performance.now() - startTimeMs),
      estimatedRemainingMs: 0,
      message: `Export completed successfully (${(blob.size / (1024 * 1024)).toFixed(2)} MB)`,
    });

    return result;
  } catch (err) {
    if (encoder.state !== 'closed') {
      encoder.close();
    }
    throw err;
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

  recorder.start();

  try {
    for (let i = 0; i < totalFrames; i++) {
      if (abortSignal?.aborted) {
        recorder.stop();
        throw new DOMException('Export cancelled by user', 'AbortError');
      }

      const timeSeconds = startTime + i / fps;
      const frame = evaluateRenderFrame(journey, timeSeconds, {
        width: config.width,
        height: config.height,
        fps,
        aspectRatio: config.aspectRatio,
      });

      const mapCanvas = getMapCanvas ? await getMapCanvas(frame) : null;
      compositeRenderFrame(ctx, frame, { mapCanvas });

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
