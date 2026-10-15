/* ─── Journey Preset Templates ───────────────────────────────────────
   Deterministic presets configuring narrative scenes, camera keyframes,
   audio scores, and cinematic treatments without altering source route geometry.
   ─────────────────────────────────────────────────────────────────── */

import type { Journey, StoryScene, CameraKeyframe, MediaAsset } from '../types';
import type { JourneyTemplate, JourneyTemplateId, TemplateApplyOptions } from './types';
import { synthesizeAudioTone, pcmToWavBlob, createDefaultAudioTimeline } from '../audio/mixer';

export const JOURNEY_TEMPLATES: JourneyTemplate[] = [
  {
    id: 'cinematic-road-trip',
    name: 'Cinematic Road Trip',
    tagline: 'High-speed scenic chase with golden hour warmth',
    description: 'Dynamic road-following camera, look-ahead lead, amber color grading, and cruising ambient soundscape.',
    icon: '🚗',
    recommendedAspectRatio: '16:9',
    defaultDurationSeconds: 30,
    cinematicTreatment: {
      vignette: true,
      vignetteIntensity: 0.32,
      colorGrade: 'golden-hour',
      contrastBoost: 0.15,
    },
    audioStyle: 'ambient-chord',
  },
  {
    id: 'hiking-summit-reveal',
    name: 'Hiking & Summit Reveal',
    tagline: 'High alpine trail ascent culminating in peak orbit',
    description: 'Valley establishing panorama, rugged trail chase, crisp cool mountain grading, and 360° summit orbit.',
    icon: '⛰',
    recommendedAspectRatio: '16:9',
    defaultDurationSeconds: 35,
    cinematicTreatment: {
      vignette: true,
      vignetteIntensity: 0.38,
      colorGrade: 'alpine-cool',
      contrastBoost: 0.20,
    },
    audioStyle: 'ambient-chord',
  },
  {
    id: 'city-exploration',
    name: 'City Exploration',
    tagline: 'Urban architectural cadence and waypoint focus',
    description: 'High-angle building flyovers, crisp stop dwell tracking, high-contrast grading, and log captions.',
    icon: '🏙',
    recommendedAspectRatio: '1:1',
    defaultDurationSeconds: 25,
    cinematicTreatment: {
      vignette: false,
      colorGrade: 'noir-contrast',
      contrastBoost: 0.10,
    },
    audioStyle: 'sine-tone',
  },
  {
    id: 'social-reel-highlights',
    name: 'Short Social Reel',
    tagline: 'Punchy 9:16 vertical cuts for TikTok, Reels & Shorts',
    description: '15-second rapid pacing, safe-area layout, vibrant twilight glow, and high-energy progression.',
    icon: '📱',
    recommendedAspectRatio: '9:16',
    defaultDurationSeconds: 15,
    cinematicTreatment: {
      vignette: true,
      vignetteIntensity: 0.40,
      colorGrade: 'sunset-glow',
      contrastBoost: 0.25,
    },
    audioStyle: 'ambient-chord',
  },
];

/**
 * Returns a template configuration by its ID, or the first template if not found.
 */
export function getJourneyTemplate(templateId: JourneyTemplateId): JourneyTemplate {
  return JOURNEY_TEMPLATES.find((t) => t.id === templateId) || JOURNEY_TEMPLATES[0];
}

/**
 * Applies a preset template to a journey deterministically:
 * Configures timeline duration, narrative scenes, camera keyframes,
 * audio ambient score, and presentation metadata while strictly preserving
 * all recorded GPS points, route segments, elevations, and stops.
 */
export function applyJourneyTemplate(
  journey: Journey,
  templateId: JourneyTemplateId,
  options?: TemplateApplyOptions
): Journey {
  const template = getJourneyTemplate(templateId);
  const targetDuration = options?.durationSeconds || template.defaultDurationSeconds;

  // Preserve existing user media if requested
  const existingMedia: MediaAsset[] = [];
  if (options?.preserveExistingMedia !== false && journey.timeline.scenes) {
    for (const sc of journey.timeline.scenes) {
      if (sc.media && sc.media.length > 0) {
        existingMedia.push(...sc.media);
      }
    }
  }

  // 1. Synthesize Template Scenes
  const generatedScenes = generateTemplateScenes(journey, template, targetDuration, existingMedia);

  // 2. Synthesize Template Camera Keyframes
  const generatedKeyframes = generateTemplateKeyframes(journey, template, targetDuration);

  // 3. Configure Audio Track
  let updatedAudio = journey.audio || createDefaultAudioTimeline();
  if (options?.attachAmbientAudio !== false) {
    const synthTone = synthesizeAudioTone({
      durationSeconds: targetDuration,
      sampleRate: 44100,
      frequencyHz: template.id === 'hiking-summit-reveal' ? 220 : 261.63,
      style: template.audioStyle || 'ambient-chord',
      gain: 0.65,
    });
    const wavBlob = pcmToWavBlob(synthTone.left, synthTone.right, 44100);
    const audioUrl = URL.createObjectURL(wavBlob);

    const musicTrack = updatedAudio.tracks.find((t) => t.id === 'track-music' || t.type === 'music') || {
      id: 'track-music',
      name: 'Background Score',
      type: 'music' as const,
      volume: 0.85,
      muted: false,
      solo: false,
      clips: [],
    };

    const newClip = {
      id: `template-audio-${Date.now()}`,
      name: `${template.name} Theme`,
      type: 'music' as const,
      assetUrl: audioUrl,
      timelineStartSeconds: 0,
      sourceTrimInSeconds: 0,
      durationSeconds: targetDuration,
      volume: 0.85,
      fadeInSeconds: 0.8,
      fadeOutSeconds: 1.0,
      muted: false,
      metadata: {
        title: `${template.name} Ambient Score`,
        license: 'Procedural Synthesis (MIT)',
      },
    };

    updatedAudio = {
      ...updatedAudio,
      tracks: [
        {
          ...musicTrack,
          clips: [newClip],
        },
        ...updatedAudio.tracks.filter((t) => t.id !== musicTrack.id),
      ],
    };
  }

  return {
    ...journey,
    updatedAt: new Date().toISOString(),
    timeline: {
      ...journey.timeline,
      duration: targetDuration,
      scenes: generatedScenes,
      keyframes: generatedKeyframes,
    },
    audio: updatedAudio,
  };
}

function generateTemplateScenes(
  journey: Journey,
  template: JourneyTemplate,
  duration: number,
  existingMedia: MediaAsset[]
): StoryScene[] {
  const stops = journey.stops;
  const startStop = stops[0];
  const endStop = stops[stops.length - 1];

  // Find highest elevation stop (e.g. summit)
  let summitStop = stops[0];
  for (const s of stops) {
    if ((s.position.ele ?? 0) > (summitStop?.position.ele ?? 0)) {
      summitStop = s;
    }
  }

  const startName = startStop?.name || journey.name || 'Starting Point';
  const endName = endStop?.name || 'Destination Point';
  const summitName = summitStop?.name || 'High Alpine Ridge';

  if (template.id === 'social-reel-highlights') {
    // Rapid 3-scene cut for 9:16 vertical video
    const t1 = Math.round((duration * 0.33) * 10) / 10;
    const t2 = Math.round((duration * 0.66) * 10) / 10;
    return [
      {
        id: `reel-scene-1`,
        name: `Departure · ${startName}`,
        intent: 'establishing',
        startTime: 0,
        endTime: t1,
        cameraMode: 'chase',
        params: { zoom: 12, pitch: 55, bearing: 45, rotationSpeed: 0 },
        title: startName.toUpperCase(),
        subtitle: 'STAGE 01 · EXPEDITION START',
        caption: `Kicking off the journey across ${journey.name}.`,
        media: existingMedia.slice(0, 1),
        transition: { type: 'fade', duration: 0.4 },
      },
      {
        id: `reel-scene-2`,
        name: `High Point · ${summitName}`,
        intent: 'highlight',
        startTime: t1,
        endTime: t2,
        cameraMode: 'orbit',
        params: { zoom: 14, pitch: 65, bearing: 180, rotationSpeed: 25 },
        title: summitName.toUpperCase(),
        subtitle: `ELEVATION · ${summitStop?.position.ele ? Math.round(summitStop.position.ele) + 'm' : 'HIGH ALPINE'}`,
        caption: 'Pushing through the crux of the expedition.',
        media: existingMedia.slice(1, 2),
        transition: { type: 'dissolve', duration: 0.4 },
      },
      {
        id: `reel-scene-3`,
        name: `Arrival · ${endName}`,
        intent: 'arrival',
        startTime: t2,
        endTime: duration,
        cameraMode: 'chase',
        params: { zoom: 13, pitch: 50, bearing: 90, rotationSpeed: 0 },
        title: endName.toUpperCase(),
        subtitle: 'STAGE 03 · FINAL DESTINATION',
        caption: `Completing the journey with full honors at ${endName}.`,
        media: existingMedia.slice(2, 3),
        transition: { type: 'fade', duration: 0.5 },
      },
    ];
  }

  if (template.id === 'hiking-summit-reveal') {
    const t1 = Math.round((duration * 0.28) * 10) / 10;
    const t2 = Math.round((duration * 0.72) * 10) / 10;
    return [
      {
        id: `hike-scene-1`,
        name: `Trailhead Departure · ${startName}`,
        intent: 'establishing',
        startTime: 0,
        endTime: t1,
        cameraMode: 'overview',
        params: { zoom: 10, pitch: 35, bearing: 40, rotationSpeed: 0 },
        title: 'TRAILHEAD DEPARTURE',
        subtitle: `${startName.toUpperCase()} · VALLEY COMMENCEMENT`,
        caption: `Departing the valley floor toward the alpine heights.`,
        media: existingMedia.slice(0, 1),
        transition: { type: 'fade', duration: 0.6 },
      },
      {
        id: `hike-scene-2`,
        name: `Summit Ascent · ${summitName}`,
        intent: 'highlight',
        startTime: t1,
        endTime: t2,
        cameraMode: 'orbit',
        params: { zoom: 14, pitch: 65, bearing: 120, rotationSpeed: 18 },
        title: 'SUMMIT REVEAL',
        subtitle: `${summitName.toUpperCase()} · ${summitStop?.position.ele ? Math.round(summitStop.position.ele) + 'm' : 'SUMMIT'}`,
        caption: `Ascending into high relief terrain with panoramic mountain vistas.`,
        media: existingMedia.slice(1, 2),
        transition: { type: 'dissolve', duration: 0.8 },
      },
      {
        id: `hike-scene-3`,
        name: `Descent & Arrival · ${endName}`,
        intent: 'arrival',
        startTime: t2,
        endTime: duration,
        cameraMode: 'chase',
        params: { zoom: 12, pitch: 45, bearing: 80, rotationSpeed: 0 },
        title: 'DESTINATION REACHED',
        subtitle: `${endName.toUpperCase()} · MISSION COMPLETE`,
        caption: `Descending into ${endName} to conclude the expedition.`,
        media: existingMedia.slice(2, 3),
        transition: { type: 'fade', duration: 0.6 },
      },
    ];
  }

  if (template.id === 'city-exploration') {
    const t1 = Math.round((duration * 0.35) * 10) / 10;
    const t2 = Math.round((duration * 0.70) * 10) / 10;
    return [
      {
        id: `city-scene-1`,
        name: `Urban Departure · ${startName}`,
        intent: 'establishing',
        startTime: 0,
        endTime: t1,
        cameraMode: 'flyover',
        params: { zoom: 13, pitch: 55, bearing: 30, rotationSpeed: 0 },
        title: startName.toUpperCase(),
        subtitle: 'CITY OVERLOOK · URBAN DEPARTURE',
        caption: `Navigating the urban transit corridors from ${startName}.`,
        media: existingMedia.slice(0, 1),
        transition: { type: 'fade', duration: 0.5 },
      },
      {
        id: `city-scene-2`,
        name: `Historic Quarter · ${summitName}`,
        intent: 'highlight',
        startTime: t1,
        endTime: t2,
        cameraMode: 'chase',
        params: { zoom: 15, pitch: 60, bearing: 90, rotationSpeed: 0 },
        title: summitName.toUpperCase(),
        subtitle: 'WAYPOINT HIGHLIGHT · METROPOLITAN CRUX',
        caption: `Crossing through architectural landmarks and pedestrian promenades.`,
        media: existingMedia.slice(1, 2),
        transition: { type: 'dissolve', duration: 0.5 },
      },
      {
        id: `city-scene-3`,
        name: `Terminal Arrival · ${endName}`,
        intent: 'arrival',
        startTime: t2,
        endTime: duration,
        cameraMode: 'flyover',
        params: { zoom: 13, pitch: 45, bearing: 140, rotationSpeed: 0 },
        title: endName.toUpperCase(),
        subtitle: 'JOURNEY TERMINUS · SAFE ARRIVAL',
        caption: `Arriving at the final destination terminal in ${endName}.`,
        media: existingMedia.slice(2, 3),
        transition: { type: 'fade', duration: 0.6 },
      },
    ];
  }

  // Default: Cinematic Road Trip
  const t1 = Math.round((duration * 0.30) * 10) / 10;
  const t2 = Math.round((duration * 0.70) * 10) / 10;
  return [
    {
      id: `road-scene-1`,
      name: `Open Highway · ${startName}`,
      intent: 'establishing',
      startTime: 0,
      endTime: t1,
      cameraMode: 'chase',
      params: { zoom: 11, pitch: 50, bearing: 60, rotationSpeed: 0 },
      title: 'OPEN HIGHWAY',
      subtitle: `${startName.toUpperCase()} · ROADS AHEAD`,
      caption: `Hitting the open tarmac under sweeping horizons.`,
      media: existingMedia.slice(0, 1),
      transition: { type: 'fade', duration: 0.5 },
    },
    {
      id: `road-scene-2`,
      name: `Scenic Crossing · ${summitName}`,
      intent: 'highlight',
      startTime: t1,
      endTime: t2,
      cameraMode: 'chase',
      params: { zoom: 13, pitch: 62, bearing: 110, rotationSpeed: 0 },
      title: 'SCENIC PASS',
      subtitle: `${summitName.toUpperCase()} · HIGHWAY VISTAS`,
      caption: `Cruising through winding highway switchbacks and scenic overlooks.`,
      media: existingMedia.slice(1, 2),
      transition: { type: 'dissolve', duration: 0.6 },
    },
    {
      id: `road-scene-3`,
      name: `Arrival · ${endName}`,
      intent: 'arrival',
      startTime: t2,
      endTime: duration,
      cameraMode: 'overview',
      params: { zoom: 10, pitch: 40, bearing: 75, rotationSpeed: 0 },
      title: 'DESTINATION REACHED',
      subtitle: `${endName.toUpperCase()} · TRIP COMPLETE`,
      caption: `Pulling in to the final stop after an unforgettable road trip.`,
      media: existingMedia.slice(2, 3),
      transition: { type: 'fade', duration: 0.6 },
    },
  ];
}

function generateTemplateKeyframes(
  _journey: Journey,
  template: JourneyTemplate,
  duration: number
): CameraKeyframe[] {
  if (template.id === 'hiking-summit-reveal') {
    return [
      {
        id: 'kf-hike-1',
        time: 0,
        mode: 'overview',
        bearing: 40,
        pitch: 35,
        zoom: 9.5,
        easing: 'easeInOutCubic',
        label: 'Valley Overview',
      },
      {
        id: 'kf-hike-2',
        time: Math.round(duration * 0.3 * 10) / 10,
        mode: 'chase',
        bearing: 75,
        pitch: 55,
        zoom: 12.5,
        easing: 'easeInOutCubic',
        label: 'Mountain Trail Chase',
      },
      {
        id: 'kf-hike-3',
        time: Math.round(duration * 0.6 * 10) / 10,
        mode: 'orbit',
        bearing: 160,
        pitch: 68,
        zoom: 14.5,
        easing: 'easeInOutCubic',
        label: 'Summit 360° Reveal',
      },
      {
        id: 'kf-hike-4',
        time: duration,
        mode: 'chase',
        bearing: 85,
        pitch: 45,
        zoom: 11.5,
        easing: 'easeOutQuad',
        label: 'Descent Arrival',
      },
    ];
  }

  if (template.id === 'social-reel-highlights') {
    return [
      {
        id: 'kf-reel-1',
        time: 0,
        mode: 'chase',
        bearing: 45,
        pitch: 60,
        zoom: 12.0,
        easing: 'easeInOutQuad',
        label: 'Fast Chase Launch',
      },
      {
        id: 'kf-reel-2',
        time: Math.round(duration * 0.45 * 10) / 10,
        mode: 'orbit',
        bearing: 180,
        pitch: 70,
        zoom: 14.0,
        easing: 'easeInOutCubic',
        label: 'Midpoint Orbit Snap',
      },
      {
        id: 'kf-reel-3',
        time: duration,
        mode: 'flyover',
        bearing: 90,
        pitch: 50,
        zoom: 13.0,
        easing: 'easeOutQuad',
        label: 'Arrival Glide',
      },
    ];
  }

  if (template.id === 'city-exploration') {
    return [
      {
        id: 'kf-city-1',
        time: 0,
        mode: 'flyover',
        bearing: 30,
        pitch: 55,
        zoom: 13.0,
        easing: 'easeInOutCubic',
        label: 'Urban Establishing Flyover',
      },
      {
        id: 'kf-city-2',
        time: Math.round(duration * 0.5 * 10) / 10,
        mode: 'chase',
        bearing: 95,
        pitch: 62,
        zoom: 15.0,
        easing: 'easeInOutCubic',
        label: 'Street Corridor Tracking',
      },
      {
        id: 'kf-city-3',
        time: duration,
        mode: 'flyover',
        bearing: 130,
        pitch: 45,
        zoom: 13.5,
        easing: 'easeOutQuad',
        label: 'City Destination Descent',
      },
    ];
  }

  // Default: Cinematic Road Trip
  return [
    {
      id: 'kf-road-1',
      time: 0,
      mode: 'overview',
      bearing: 50,
      pitch: 40,
      zoom: 10.0,
      easing: 'easeInOutCubic',
      label: 'Highway Panoramic Start',
    },
    {
      id: 'kf-road-2',
      time: Math.round(duration * 0.35 * 10) / 10,
      mode: 'chase',
      bearing: 85,
      pitch: 62,
      zoom: 13.5,
      easing: 'easeInOutCubic',
      label: 'Fast Highway Chase',
    },
    {
      id: 'kf-road-3',
      time: Math.round(duration * 0.75 * 10) / 10,
      mode: 'chase',
      bearing: 110,
      pitch: 58,
      zoom: 12.8,
      easing: 'easeInOutCubic',
      label: 'Scenic Ridge Pass',
    },
    {
      id: 'kf-road-4',
      time: duration,
      mode: 'overview',
      bearing: 80,
      pitch: 42,
      zoom: 10.5,
      easing: 'easeOutQuad',
      label: 'Trip Destination Arrival',
    },
  ];
}
