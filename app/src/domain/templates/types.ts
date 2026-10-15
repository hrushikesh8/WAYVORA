/* ─── Journey Template Types ──────────────────────────────────────────
   Preset templates that configure story scenes, camera behavior, transitions,
   color grading, and audio score while strictly preserving original route geometry.
   ─────────────────────────────────────────────────────────────────── */

import type { AspectRatio } from '../types';
import type { CinematicTreatment } from '../render/types';

export type JourneyTemplateId =
  | 'cinematic-road-trip'
  | 'hiking-summit-reveal'
  | 'city-exploration'
  | 'social-reel-highlights';

export interface JourneyTemplate {
  id: JourneyTemplateId;
  name: string;
  tagline: string;
  description: string;
  icon: string;
  recommendedAspectRatio: AspectRatio;
  defaultDurationSeconds: number;
  cinematicTreatment: CinematicTreatment;
  audioStyle?: 'ambient-chord' | 'sine-tone';
}

export interface TemplateApplyOptions {
  /** Target duration override (defaults to template default) */
  durationSeconds?: number;
  /** Whether to synthesize and attach a matching ambient score (default true) */
  attachAmbientAudio?: boolean;
  /** Whether to preserve existing user-uploaded media files (default true) */
  preserveExistingMedia?: boolean;
}
