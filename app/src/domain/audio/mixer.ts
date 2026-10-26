/* ─── Deterministic Audio Mixer & Synthesis Foundation ───────────────
   Pure mathematical audio timeline evaluation, gain curves,
   Float32Array PCM mixing, clipping prevention, and synthetic tones.
   ─────────────────────────────────────────────────────────────────── */

import { generateId } from '../types';
import type {
  AudioClip,
  AudioTimeline,
  ActiveAudioClipState,
  EvaluatedAudioState,
  AudioDuckingSettings,
} from './types';

export const DEFAULT_DUCKING_SETTINGS: AudioDuckingSettings = {
  enabled: true,
  attenuation: 0.30, // -10.5 dB
  attackSeconds: 0.4,
  releaseSeconds: 0.8,
  marginSeconds: 0.2,
};

/**
 * Calculates instantaneous gain for an audio clip at a specific local offset.
 * Handles volume scaling, fade-in curve, and fade-out curve.
 * Returns 0 if localTime is outside [0, clip.durationSeconds].
 */
export function calculateClipGain(clip: AudioClip, localTimeSeconds: number): number {
  if (clip.muted) return 0;
  if (localTimeSeconds < 0 || localTimeSeconds >= clip.durationSeconds) {
    return 0;
  }

  let gain = Math.max(0, clip.volume ?? 1.0);

  // Fade-in ramp (smooth sinusoidal curve for natural acoustics)
  if (clip.fadeInSeconds > 0 && localTimeSeconds < clip.fadeInSeconds) {
    const fraction = localTimeSeconds / clip.fadeInSeconds;
    // Sinusoidal equal-power fade: sin(fraction * PI / 2)
    const fadeFactor = Math.sin(Math.max(0, Math.min(1, fraction)) * (Math.PI / 2));
    gain *= fadeFactor;
  }

  // Fade-out ramp
  if (clip.fadeOutSeconds > 0) {
    const fadeOutStart = clip.durationSeconds - clip.fadeOutSeconds;
    if (localTimeSeconds > fadeOutStart) {
      const remaining = clip.durationSeconds - localTimeSeconds;
      const fraction = remaining / clip.fadeOutSeconds;
      const fadeFactor = Math.sin(Math.max(0, Math.min(1, fraction)) * (Math.PI / 2));
      gain *= fadeFactor;
    }
  }

  return Math.max(0, gain);
}

/**
 * Pure evaluation of automatic music ducking attenuation at an explicit timeline timestamp.
 * Evaluates active voiceover clips across all voiceover tracks and computes a smooth cosine gain envelope.
 * Returns a linear multiplier in [attenuation, 1.0] applied to background music tracks.
 */
export function calculateDuckingGainAtTime(
  timeline: AudioTimeline | undefined,
  timeSeconds: number
): number {
  if (!timeline || !timeline.ducking || !timeline.ducking.enabled) {
    return 1.0;
  }

  const {
    attenuation = 0.3,
    attackSeconds = 0.4,
    releaseSeconds = 0.8,
    marginSeconds = 0.2,
  } = timeline.ducking;

  const voTracks = (timeline.tracks || []).filter(
    (t) => t.type === 'voiceover' && !t.muted && (t.volume ?? 1.0) > 0
  );
  if (voTracks.length === 0) return 1.0;

  let minGain = 1.0;

  for (const track of voTracks) {
    for (const clip of track.clips) {
      if (clip.muted || (clip.volume ?? 1.0) <= 0 || clip.durationSeconds <= 0) continue;

      const speechStart = clip.timelineStartSeconds;
      const speechEnd = speechStart + clip.durationSeconds;

      const attStart = Math.max(0, speechStart - marginSeconds - attackSeconds);
      const attEnd = Math.max(0, speechStart - marginSeconds);
      const relStart = speechEnd + marginSeconds;
      const relEnd = relStart + releaseSeconds;

      if (timeSeconds < attStart || timeSeconds > relEnd) {
        continue;
      }

      let factor = 1.0;

      if (timeSeconds >= attEnd && timeSeconds <= relStart) {
        // Full ducking attenuation plateau
        factor = attenuation;
      } else if (timeSeconds >= attStart && timeSeconds < attEnd) {
        // Attack phase: fade down from 1.0 to attenuation using smooth cosine easing
        const attackDur = attEnd - attStart;
        if (attackDur <= 0.0001) {
          factor = attenuation;
        } else {
          const tau = (timeSeconds - attStart) / attackDur;
          const curve = 0.5 * (1 - Math.cos(Math.PI * tau));
          factor = 1.0 - (1.0 - attenuation) * curve;
        }
      } else if (timeSeconds > relStart && timeSeconds <= relEnd) {
        // Release phase: fade up from attenuation to 1.0 using smooth cosine easing
        const relDur = relEnd - relStart;
        if (relDur <= 0.0001) {
          factor = attenuation;
        } else {
          const tau = (timeSeconds - relStart) / relDur;
          const curve = 0.5 * (1 - Math.cos(Math.PI * tau));
          factor = attenuation + (1.0 - attenuation) * curve;
        }
      }

      if (factor < minGain) {
        minGain = factor;
      }
    }
  }

  return Math.max(0, Math.min(1.0, minGain));
}

/**
 * Pure evaluation of the active audio state at an explicit timeline timestamp.
 * Includes ducking attenuation for background music during voiceover narration.
 */
export function evaluateAudioTimelineAtTime(
  timeline: AudioTimeline | undefined,
  timeSeconds: number
): EvaluatedAudioState {
  if (!timeline || !timeline.tracks || timeline.tracks.length === 0) {
    return {
      activeClips: [],
      masterVolume: 1.0,
      isSilent: true,
      timeSeconds,
      duckingGain: 1.0,
      isDucking: false,
    };
  }

  const masterVol = Math.max(0, timeline.masterVolume ?? 1.0);
  if (masterVol <= 0) {
    return {
      activeClips: [],
      masterVolume: 0,
      isSilent: true,
      timeSeconds,
      duckingGain: 1.0,
      isDucking: false,
    };
  }

  const duckingGain = calculateDuckingGainAtTime(timeline, timeSeconds);
  const isDucking = duckingGain < 0.999;
  const activeClips: ActiveAudioClipState[] = [];

  for (const track of timeline.tracks) {
    if (track.muted || (track.volume ?? 1.0) <= 0) continue;
    const trackVol = track.volume ?? 1.0;
    const isMusicTrack = track.type === 'music';
    const trackDucking = isMusicTrack ? duckingGain : 1.0;

    for (const clip of track.clips) {
      if (clip.muted) continue;
      const start = clip.timelineStartSeconds;
      const end = start + clip.durationSeconds;

      if (timeSeconds >= start && timeSeconds < end) {
        const localTime = timeSeconds - start;
        const clipGain = calculateClipGain(clip, localTime);
        const effectiveGain = clipGain * trackVol * masterVol * trackDucking;

        activeClips.push({
          clip,
          trackId: track.id,
          currentGain: effectiveGain,
          sourceOffsetSeconds: clip.sourceTrimInSeconds + localTime,
          remainingSeconds: end - timeSeconds,
        });
      }
    }
  }

  const isSilent = masterVol === 0 || activeClips.every((c) => c.currentGain === 0);

  return {
    activeClips,
    masterVolume: masterVol,
    isSilent,
    timeSeconds,
    duckingGain,
    isDucking,
  };
}

/**
 * Creates a standard AudioTimeline with music, voiceover narration, and ambient environmental audio tracks.
 */
export function createDefaultAudioTimeline(): AudioTimeline {
  return {
    masterVolume: 1.0,
    sampleRate: 44100,
    channelCount: 2,
    ducking: { ...DEFAULT_DUCKING_SETTINGS },
    tracks: [
      {
        id: generateId(),
        name: 'Background Music',
        type: 'music',
        clips: [],
        volume: 0.85,
        muted: false,
      },
      {
        id: generateId(),
        name: 'Narration & Commentary',
        type: 'voiceover',
        clips: [],
        volume: 1.0,
        muted: false,
      },
      {
        id: generateId(),
        name: 'Ambient & Environment',
        type: 'ambient',
        clips: [],
        volume: 0.70,
        muted: false,
      },
    ],
  };
}

/**
 * Validates an audio clip against journey boundaries and parameters.
 */
export function validateAudioClip(clip: AudioClip, journeyDuration: number): string[] {
  const errors: string[] = [];

  if (!clip.id || clip.id.trim() === '') {
    errors.push('Audio clip requires a valid ID');
  }
  if (!clip.name || clip.name.trim() === '') {
    errors.push('Audio clip requires a non-empty name');
  }
  if (clip.durationSeconds <= 0) {
    errors.push('Audio clip duration must be greater than 0');
  }
  if (clip.timelineStartSeconds < 0) {
    errors.push('Audio clip timeline start cannot be negative');
  }
  if (clip.sourceTrimInSeconds < 0) {
    errors.push('Audio clip source trim cannot be negative');
  }
  if (clip.volume < 0 || clip.volume > 2.0) {
    errors.push('Audio clip volume must be between 0.0 and 2.0');
  }
  if (clip.fadeInSeconds < 0 || clip.fadeOutSeconds < 0) {
    errors.push('Fade durations cannot be negative');
  }
  if (clip.fadeInSeconds + clip.fadeOutSeconds > clip.durationSeconds) {
    errors.push('Sum of fade-in and fade-out exceeds clip duration');
  }
  if (journeyDuration > 0 && clip.timelineStartSeconds > journeyDuration) {
    errors.push(`Audio clip starts after journey duration (${journeyDuration}s)`);
  }

  return errors;
}

/**
 * Validates audio ducking configuration.
 */
export function validateDuckingSettings(settings: AudioDuckingSettings): string[] {
  const errors: string[] = [];
  if (settings.attenuation < 0 || settings.attenuation > 1.0) {
    errors.push('Ducking attenuation must be between 0.0 and 1.0');
  }
  if (settings.attackSeconds < 0 || settings.attackSeconds > 5.0) {
    errors.push('Ducking attack duration must be between 0.0s and 5.0s');
  }
  if (settings.releaseSeconds < 0 || settings.releaseSeconds > 10.0) {
    errors.push('Ducking release duration must be between 0.0s and 10.0s');
  }
  if (settings.marginSeconds < 0 || settings.marginSeconds > 5.0) {
    errors.push('Ducking margin must be between 0.0s and 5.0s');
  }
  return errors;
}

export interface SyntheticToneOptions {
  durationSeconds: number;
  sampleRate?: number;
  /** Primary fundamental frequency (e.g., 220Hz for A3, 440Hz for A4) */
  frequencyHz?: number;
  /** Style: 'ambient-chord' (triad pad) or 'sine-tone' (pure sine wave) */
  style?: 'ambient-chord' | 'sine-tone';
  /** Gain amplitude (0.0 to 1.0) */
  gain?: number;
}

/**
 * Deterministically generates raw Float32Array PCM audio.
 * Useful for zero-dependency test fixtures and generative ambient travel scores.
 */
export function synthesizeAudioTone(options: SyntheticToneOptions): {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  durationSeconds: number;
} {
  const sampleRate = options.sampleRate || 44100;
  const duration = Math.max(0.1, options.durationSeconds);
  const totalSamples = Math.ceil(duration * sampleRate);
  const baseFreq = options.frequencyHz || 220.0; // A3
  const gain = Math.max(0, Math.min(1.0, options.gain ?? 0.5));
  const style = options.style || 'ambient-chord';

  const left = new Float32Array(totalSamples);
  const right = new Float32Array(totalSamples);

  // Frequencies for a rich, warm major triad with gentle detune: Root (A3), Major 3rd (C#4), 5th (E4)
  const freqs =
    style === 'ambient-chord'
      ? [baseFreq, baseFreq * 1.2599, baseFreq * 1.4983]
      : [baseFreq];

  const fadeSamples = Math.min(sampleRate * 0.5, totalSamples * 0.2);

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;

    // Amplitude envelope: fade-in and fade-out to prevent clicks
    let env = 1.0;
    if (i < fadeSamples) {
      env = i / fadeSamples;
    } else if (i > totalSamples - fadeSamples) {
      env = (totalSamples - i) / fadeSamples;
    }

    // Slow ambient LFO (0.2 Hz) for subtle spatial movement
    const lfo = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.2 * t);

    let sampleL = 0;
    let sampleR = 0;

    for (let f = 0; f < freqs.length; f++) {
      const freq = freqs[f];
      // Left channel slight phase shift
      const valL = Math.sin(2 * Math.PI * freq * t);
      // Right channel slight chorus detune
      const valR = Math.sin(2 * Math.PI * (freq * 1.002) * t);

      sampleL += (valL / freqs.length) * gain * env;
      sampleR += (valR / freqs.length) * gain * env;
    }

    // Spatial balance
    left[i] = sampleL * (0.8 + 0.2 * lfo);
    right[i] = sampleR * (0.8 + 0.2 * (1 - lfo));
  }

  return {
    left,
    right,
    sampleRate,
    durationSeconds: duration,
  };
}

export interface DecodedAudioBuffer {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  durationSeconds: number;
}

export interface MixAudioPcmOptions {
  durationSeconds: number;
  startTimeSeconds?: number;
  sampleRate?: number;
  timeline: AudioTimeline;
  /** Source PCM buffers keyed by clip.assetUrl or clip.id */
  sourceBuffers: Map<string, DecodedAudioBuffer>;
}

/**
 * Mixes multiple audio tracks and clips into a single stereo Float32Array PCM buffer.
 * Performs deterministic sample-accurate accumulation, automatic background-music ducking, and soft-knee peak limiting.
 */
export function mixAudioPcm(options: MixAudioPcmOptions): {
  leftChannel: Float32Array;
  rightChannel: Float32Array;
  sampleRate: number;
  durationSeconds: number;
  peakAmplitude: number;
  wasClipped: boolean;
} {
  const sampleRate = options.sampleRate || options.timeline.sampleRate || 44100;
  const duration = Math.max(0, options.durationSeconds);
  const startTime = Math.max(0, options.startTimeSeconds ?? 0);
  const endTime = startTime + duration;
  const totalSamples = Math.ceil(duration * sampleRate);

  const leftChannel = new Float32Array(totalSamples);
  const rightChannel = new Float32Array(totalSamples);

  const masterVol = Math.max(0, options.timeline.masterVolume ?? 1.0);
  if (masterVol === 0 || !options.timeline.tracks || options.timeline.tracks.length === 0) {
    return {
      leftChannel,
      rightChannel,
      sampleRate,
      durationSeconds: duration,
      peakAmplitude: 0,
      wasClipped: false,
    };
  }

  // Precalculate ducking envelope across the entire duration for sample-accurate music attenuation
  const duckingEnvelope = new Float32Array(totalSamples);
  if (options.timeline.ducking?.enabled !== false && options.timeline.ducking) {
    for (let i = 0; i < totalSamples; i++) {
      const timelineTime = startTime + i / sampleRate;
      duckingEnvelope[i] = calculateDuckingGainAtTime(options.timeline, timelineTime);
    }
  } else {
    duckingEnvelope.fill(1.0);
  }

  // Iterate over each track
  for (const track of options.timeline.tracks) {
    if (track.muted || (track.volume ?? 1.0) <= 0) continue;
    const trackVol = track.volume ?? 1.0;
    const isMusicTrack = track.type === 'music';

    for (const clip of track.clips) {
      if (clip.muted || (clip.volume ?? 1.0) <= 0) continue;

      // Find decoded source buffer (by assetUrl or id)
      const source =
        options.sourceBuffers.get(clip.assetUrl) ||
        options.sourceBuffers.get(clip.id);

      if (!source || source.left.length === 0) {
        // Missing or undecodable audio buffer — handle gracefully without crashing
        continue;
      }

      const clipStart = clip.timelineStartSeconds;
      const clipEnd = clipStart + clip.durationSeconds;

      // Check overlap with the export timeline window [startTime, endTime]
      if (clipEnd <= startTime || clipStart >= endTime) continue;

      const relStart = clipStart - startTime;
      const relEnd = clipEnd - startTime;
      const startSample = Math.max(0, Math.floor(relStart * sampleRate));
      const endSample = Math.min(totalSamples, Math.ceil(relEnd * sampleRate));

      const srcRate = source.sampleRate;
      const srcTrimSec = clip.sourceTrimInSeconds;

      for (let i = startSample; i < endSample; i++) {
        const timelineTime = startTime + i / sampleRate;
        const localTime = timelineTime - clipStart;
        const duckFactor = isMusicTrack ? duckingEnvelope[i] : 1.0;
        const gain = calculateClipGain(clip, localTime) * trackVol * masterVol * duckFactor;

        if (gain <= 0.00001) continue;

        // Source sample coordinate
        const srcTime = srcTrimSec + localTime;
        const srcSampleIdx = Math.floor(srcTime * srcRate);

        if (srcSampleIdx >= 0 && srcSampleIdx < source.left.length) {
          leftChannel[i] += source.left[srcSampleIdx] * gain;
          const rSample = source.right.length > srcSampleIdx
            ? source.right[srcSampleIdx]
            : source.left[srcSampleIdx];
          rightChannel[i] += rSample * gain;
        }
      }
    }
  }

  // Peak analysis and soft-knee limiter (tanh compression to prevent hard digital clipping)
  let peak = 0;
  for (let i = 0; i < totalSamples; i++) {
    const absL = Math.abs(leftChannel[i]);
    const absR = Math.abs(rightChannel[i]);
    if (absL > peak) peak = absL;
    if (absR > peak) peak = absR;
  }

  let wasClipped = false;
  if (peak > 1.0) {
    wasClipped = true;
    // Apply soft limiter: tanh compression smoothly rounds peaks above 0.8
    for (let i = 0; i < totalSamples; i++) {
      leftChannel[i] = Math.tanh(leftChannel[i] * 0.95);
      rightChannel[i] = Math.tanh(rightChannel[i] * 0.95);
    }
  }

  return {
    leftChannel,
    rightChannel,
    sampleRate,
    durationSeconds: duration,
    peakAmplitude: peak,
    wasClipped,
  };
}

/**
 * Encodes stereo Float32Array PCM samples into a standard 16-bit stereo WAV Blob.
 * Pure mathematical binary encoding with zero external dependencies.
 */
export function pcmToWavBlob(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number = 44100
): Blob {
  const numSamples = left.length;
  const numChannels = 2;
  const bytesPerSample = 2; // 16-bit
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataByteLength = numSamples * blockAlign;
  const bufferLength = 44 + dataByteLength;

  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);

  // RIFF chunk descriptor
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + dataByteLength, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"

  // "fmt " sub-chunk
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true); // 16 for PCM
  view.setUint16(20, 1, true); // PCM = 1
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample

  // "data" sub-chunk
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataByteLength, true);

  // 16-bit interleaved PCM writing
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const sL = Math.max(-1, Math.min(1, left[i]));
    const sR = Math.max(-1, Math.min(1, right[i] ?? sL));

    const intL = sL < 0 ? Math.round(sL * 32768) : Math.round(sL * 32767);
    const intR = sR < 0 ? Math.round(sR * 32768) : Math.round(sR * 32767);

    view.setInt16(offset, intL, true);
    view.setInt16(offset + 2, intR, true);
    offset += 4;
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}
