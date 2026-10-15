/* ─── Audio Asset Loading & Decoding ──────────────────────────────────
   Asynchronously decodes audio files and synthetic tones into Float32Array PCM.
   Prevents unhandled promise rejections and manages audio resource lifecycles.
   ─────────────────────────────────────────────────────────────────── */

import type { Journey } from '../types';
import type { DecodedAudioBuffer } from './mixer';
import { synthesizeAudioTone } from './mixer';

const decodedBufferCache = new Map<string, DecodedAudioBuffer>();

let _sharedAudioContext: AudioContext | null = null;

function getSharedAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!_sharedAudioContext || _sharedAudioContext.state === 'closed') {
    try {
      _sharedAudioContext = new AudioCtx({ sampleRate: 44100 });
    } catch {
      _sharedAudioContext = new AudioCtx();
    }
  }
  return _sharedAudioContext;
}

/**
 * Decodes an audio source URL (blob, object URL, data URL, or synthetic generator uri)
 * into a stereo Float32Array DecodedAudioBuffer.
 */
export async function decodeAudioSource(
  assetUrl: string,
  options?: { durationSeconds?: number }
): Promise<DecodedAudioBuffer | null> {
  if (!assetUrl) return null;

  // Check in-memory cache
  if (decodedBufferCache.has(assetUrl)) {
    return decodedBufferCache.get(assetUrl)!;
  }

  // Handle synthetic procedural tones without network or DOM dependency
  if (assetUrl.startsWith('synthetic:')) {
    const duration = options?.durationSeconds || 30;
    const style = assetUrl.includes('sine') ? 'sine-tone' : 'ambient-chord';
    const synth = synthesizeAudioTone({
      durationSeconds: duration,
      sampleRate: 44100,
      frequencyHz: 220,
      style,
      gain: 0.6,
    });
    const decoded: DecodedAudioBuffer = {
      left: synth.left,
      right: synth.right,
      sampleRate: synth.sampleRate,
      durationSeconds: synth.durationSeconds,
    };
    decodedBufferCache.set(assetUrl, decoded);
    return decoded;
  }

  // Handle standard audio files via browser AudioContext
  const ctx = getSharedAudioContext();
  if (!ctx) {
    return null;
  }

  try {
    const response = await fetch(assetUrl);
    if (!response.ok) {
      console.warn(`Failed to fetch audio asset: ${assetUrl} (${response.status} ${response.statusText})`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    // decodeAudioData consumes the ArrayBuffer
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

    const sampleRate = audioBuffer.sampleRate;
    const left = audioBuffer.getChannelData(0);
    // If mono, mirror left channel to right channel
    const right = audioBuffer.numberOfChannels > 1
      ? audioBuffer.getChannelData(1)
      : new Float32Array(left);

    const decoded: DecodedAudioBuffer = {
      left: new Float32Array(left),
      right: new Float32Array(right),
      sampleRate,
      durationSeconds: audioBuffer.duration,
    };

    decodedBufferCache.set(assetUrl, decoded);
    return decoded;
  } catch (err) {
    console.warn(`Audio decoding failed for ${assetUrl}:`, err);
    return null;
  }
}

/**
 * Prepares and decodes all audio clips referenced in a journey's audio timeline.
 */
export async function prepareJourneyAudioBuffers(
  journey: Journey
): Promise<Map<string, DecodedAudioBuffer>> {
  const buffers = new Map<string, DecodedAudioBuffer>();

  if (!journey.audio || !journey.audio.tracks) {
    return buffers;
  }

  const clipsToLoad = journey.audio.tracks
    .filter((t) => !t.muted)
    .flatMap((t) => t.clips.filter((c) => !c.muted));

  await Promise.all(
    clipsToLoad.map(async (clip) => {
      try {
        const decoded = await decodeAudioSource(clip.assetUrl, {
          durationSeconds: clip.durationSeconds + clip.sourceTrimInSeconds,
        });
        if (decoded) {
          buffers.set(clip.assetUrl, decoded);
          buffers.set(clip.id, decoded);
        }
      } catch (err) {
        console.warn(`Could not prepare audio buffer for clip ${clip.name} (${clip.id}):`, err);
      }
    })
  );

  return buffers;
}

/**
 * Clears the in-memory decoded audio cache to free RAM when needed.
 */
export function clearDecodedAudioCache(): void {
  decodedBufferCache.clear();
}
