/* ─── Audio Domain Types ──────────────────────────────────────────────
   Domain models for background music, narration/voiceovers,
   timeline scheduling, audio tracks, and mixer states.
   ─────────────────────────────────────────────────────────────────── */

export type AudioClipType = 'music' | 'voiceover' | 'ambient' | 'sfx';

export interface AudioClipMetadata {
  artist?: string;
  title?: string;
  license?: string;
  provenance?: string;
  sampleRate?: number;
  channelCount?: number;
  sourceDurationSeconds?: number;
  [key: string]: unknown;
}

export interface AudioClip {
  id: string;
  name: string;
  type: AudioClipType;
  /** Audio asset reference (object URL, relative URL, or synthetic generator URI) */
  assetUrl: string;
  filename?: string;
  /** Timeline start offset in seconds along the journey */
  timelineStartSeconds: number;
  /** Source trim-in offset in seconds into the source audio */
  sourceTrimInSeconds: number;
  /** Play duration on the journey timeline in seconds */
  durationSeconds: number;
  /** Linear gain multiplier (0.0 to 2.0, default 1.0) */
  volume: number;
  /** Fade-in duration in seconds (default 0) */
  fadeInSeconds: number;
  /** Fade-out duration in seconds (default 0) */
  fadeOutSeconds: number;
  /** Optional association with a StoryScene */
  sceneId?: string;
  muted?: boolean;
  metadata?: AudioClipMetadata;
}

export interface AudioTrack {
  id: string;
  name: string;
  type: AudioClipType;
  clips: AudioClip[];
  /** Track master volume (0.0 to 2.0, default 1.0) */
  volume: number;
  muted: boolean;
}

export interface AudioDuckingSettings {
  enabled: boolean;
  /** Linear gain multiplier applied to background music during voiceover narration (0.05 to 0.9, default 0.30) */
  attenuation: number;
  /** Duration in seconds to ramp down music volume when narration begins (default 0.4s) */
  attackSeconds: number;
  /** Duration in seconds to ramp music volume back up after narration ends (default 0.8s) */
  releaseSeconds: number;
  /** Pre- and post-speech silence margin in seconds around narration (default 0.2s) */
  marginSeconds: number;
}

export interface AudioTimeline {
  tracks: AudioTrack[];
  /** Master output volume (0.0 to 2.0, default 1.0) */
  masterVolume: number;
  /** Standard sample rate (e.g., 44100 Hz) */
  sampleRate: number;
  /** Standard channel count (e.g., 2 for stereo) */
  channelCount: number;
  /** Automatic background music ducking configuration */
  ducking?: AudioDuckingSettings;
}

export interface ActiveAudioClipState {
  clip: AudioClip;
  trackId: string;
  /** Instantaneous gain at this timestamp (volume * fades * track * master * ducking if music) */
  currentGain: number;
  /** Playhead position within the source audio in seconds */
  sourceOffsetSeconds: number;
  /** Remaining playback duration in seconds */
  remainingSeconds: number;
}

export interface EvaluatedAudioState {
  activeClips: ActiveAudioClipState[];
  masterVolume: number;
  isSilent: boolean;
  timeSeconds: number;
  /** Instantaneous ducking attenuation factor applied to background music (0.0 to 1.0) */
  duckingGain?: number;
  /** Whether automatic ducking is currently active at this timestamp */
  isDucking?: boolean;
}
