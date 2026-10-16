/* ─── Story Scene Evaluator & Timeline Manager ─────────────────────────
   Deterministic derivation of scenes, titles, captions, media callouts,
   and visual transitions from timeline time alone.
   ─────────────────────────────────────────────────────────────────── */

import type { StoryScene, EvaluatedStoryState, MediaAsset, SceneIntent, StoryTitleCards, ActiveTitleCardState } from './types';
import type { Stop, Journey, CameraMode } from '../types';
import { DEFAULT_CAMERA_PARAMS } from '../types';
import { computeTimelineSchedule } from '../timeline';
import { getAllPoints } from '../journey';

export interface EvaluateStoryOptions {
  /** Maximum duration in seconds to display title card overlay (default: 4.5s) */
  titleDisplaySeconds?: number;
  /** Default transition duration in seconds (default: 0.8s) */
  defaultTransitionDuration?: number;
  /** Optional cinematic title cards configuration */
  titleCards?: StoryTitleCards;
  /** Total journey duration in seconds (for closing title card evaluation) */
  totalDuration?: number;
}

/**
 * Pure deterministic evaluator that derives active scene, titles, captions,
 * media callouts, cinematic title cards, and transitions from timeline time alone.
 */
export function evaluateStoryAtTime(
  scenes: StoryScene[],
  timeSeconds: number,
  stops: Stop[] = [],
  activeStop: Stop | null = null,
  options: EvaluateStoryOptions = {}
): EvaluatedStoryState {
  const t = Math.max(0, Number.isFinite(timeSeconds) ? timeSeconds : 0);
  const titleDisplaySeconds = options.titleDisplaySeconds ?? 4.5;

  // Determine active opening or closing title card (independent of whether scenes exist)
  let activeTitleCard: ActiveTitleCardState | undefined;
  const titleCards = options.titleCards;
  if (titleCards) {
    // 1. Opening Title Card
    if (titleCards.opening?.enabled && titleCards.opening.title) {
      const openDur = Math.max(0.5, titleCards.opening.duration || 3.5);
      if (t >= 0 && t <= openDur) {
        const progress = Math.min(1, Math.max(0, t / openDur));
        const fadeWindow = Math.min(0.6, openDur * 0.25);
        let opacity = 1;
        if (t < fadeWindow) {
          opacity = t / fadeWindow;
        } else if (t > openDur - fadeWindow) {
          opacity = Math.max(0, (openDur - t) / fadeWindow);
        }
        activeTitleCard = {
          type: 'opening',
          title: titleCards.opening.title,
          subtitle: titleCards.opening.subtitle,
          progress,
          motion: titleCards.opening.motion ?? 'slow-zoom',
          opacity: Math.max(0, Math.min(1, opacity)),
        };
      }
    }

    // 2. Closing Title Card (only if opening is not active)
    if (!activeTitleCard && titleCards.closing?.enabled && titleCards.closing.title) {
      const totalDur = options.totalDuration || (scenes && scenes.length > 0 ? scenes[scenes.length - 1].endTime : 60);
      const closeDur = Math.max(0.5, titleCards.closing.duration || 3.5);
      const closeStart = Math.max(0, totalDur - closeDur);
      if (t >= closeStart && t <= totalDur) {
        const timeIntoClose = t - closeStart;
        const progress = Math.min(1, Math.max(0, timeIntoClose / closeDur));
        const fadeWindow = Math.min(0.6, closeDur * 0.25);
        let opacity = 1;
        if (timeIntoClose < fadeWindow) {
          opacity = timeIntoClose / fadeWindow;
        } else if (timeIntoClose > closeDur - fadeWindow) {
          opacity = Math.max(0, (closeDur - timeIntoClose) / fadeWindow);
        }
        activeTitleCard = {
          type: 'closing',
          title: titleCards.closing.title,
          subtitle: titleCards.closing.subtitle,
          progress,
          motion: titleCards.closing.motion ?? 'fade',
          opacity: Math.max(0, Math.min(1, opacity)),
        };
      }
    }
  }

  if (!scenes || scenes.length === 0) {
    const isDwelling = activeStop != null;
    return {
      activeScene: null,
      activeMedia: activeStop?.media ?? [],
      isStopHighlight: isDwelling,
      activeStopName: activeStop?.name,
      activeStopId: activeStop?.id,
      activeTitleCard,
    };
  }

  // Sort scenes by start time
  const sorted = [...scenes].sort((a, b) => a.startTime - b.startTime);

  // Find active scene at time t
  let activeScene: StoryScene | null = null;
  let activeIndex = -1;

  for (let i = 0; i < sorted.length; i++) {
    const sc = sorted[i];
    const isLast = i === sorted.length - 1;
    if (t >= sc.startTime && (isLast ? t <= sc.endTime : t < sc.endTime)) {
      activeScene = sc;
      activeIndex = i;
      break;
    }
  }

  // Clamp outside boundaries
  if (!activeScene) {
    if (t < sorted[0].startTime) {
      activeScene = sorted[0];
      activeIndex = 0;
    } else {
      activeScene = sorted[sorted.length - 1];
      activeIndex = sorted.length - 1;
    }
  }

  // Determine title and subtitle visibility
  let title: string | undefined;
  let subtitle: string | undefined;
  const timeIntoScene = Math.max(0, t - activeScene.startTime);
  const sceneDuration = Math.max(0.1, activeScene.endTime - activeScene.startTime);
  const maxTitleTime = Math.min(titleDisplaySeconds, sceneDuration);

  if (timeIntoScene <= maxTitleTime && activeScene.title) {
    title = activeScene.title;
    subtitle = activeScene.subtitle;
  }

  // Determine active media assets (scene media + active stop media)
  const activeMedia: MediaAsset[] = [];
  if (activeScene.media) {
    activeMedia.push(...activeScene.media);
  }
  if (activeStop?.media) {
    for (const sm of activeStop.media) {
      if (!activeMedia.some((m) => m.id === sm.id)) {
        activeMedia.push(sm);
      }
    }
  }

  // Determine transition progress if entering a scene with transition
  let transition: EvaluatedStoryState['transition'];
  if (activeScene.transition && activeIndex > 0) {
    if (activeScene.transition.type !== 'cut') {
      const transDur = Math.max(0.1, activeScene.transition.duration);
      if (timeIntoScene < transDur) {
        const prevScene = sorted[activeIndex - 1];
        transition = {
          type: activeScene.transition.type,
          progress: Math.min(1, Math.max(0, timeIntoScene / transDur)),
          fromSceneId: prevScene.id,
          toSceneId: activeScene.id,
        };
      }
    }
  }

  // Stop highlight detection
  const isStopHighlight =
    activeStop != null ||
    activeScene.intent === 'stop' ||
    Boolean(activeScene.stopId);

  const matchedStop = activeStop ?? stops.find((s) => s.id === activeScene?.stopId);

  return {
    activeScene,
    title,
    subtitle,
    caption: activeScene.caption,
    activeMedia,
    transition,
    isStopHighlight,
    activeStopName: matchedStop?.name,
    activeStopId: matchedStop?.id,
    activeTitleCard,
  };
}

/**
 * Validates an array of StoryScenes for timeline integrity.
 * Returns a list of human-readable validation error messages.
 */
export function validateStoryScenes(scenes: StoryScene[]): string[] {
  const errors: string[] = [];
  if (!scenes) return errors;

  for (let i = 0; i < scenes.length; i++) {
    const sc = scenes[i];
    if (!sc.id) errors.push(`Scene #${i + 1} is missing an id`);
    if (!sc.name || !sc.name.trim()) errors.push(`Scene #${i + 1} must have a name`);
    if (sc.startTime < 0) errors.push(`Scene "${sc.name}" start time cannot be negative`);
    if (sc.endTime <= sc.startTime) {
      errors.push(`Scene "${sc.name}" end time (${sc.endTime}s) must be greater than start time (${sc.startTime}s)`);
    }

    if (sc.transition) {
      const sceneDur = sc.endTime - sc.startTime;
      if (sc.transition.duration < 0) {
        errors.push(`Scene "${sc.name}" transition duration cannot be negative`);
      } else if (sc.transition.duration > sceneDur) {
        errors.push(`Scene "${sc.name}" transition duration (${sc.transition.duration}s) exceeds scene duration (${sceneDur}s)`);
      }
    }

    // Check overlap with next scene
    if (i < scenes.length - 1) {
      const next = scenes[i + 1];
      if (sc.endTime > next.startTime + 0.05) {
        errors.push(`Scene "${sc.name}" overlaps with scene "${next.name}" (${sc.endTime}s > ${next.startTime}s)`);
      }
    }
  }

  return errors;
}

/**
 * Validates opening and closing title cards.
 */
export function validateTitleCards(titleCards?: StoryTitleCards): string[] {
  const errors: string[] = [];
  if (!titleCards) return errors;

  if (titleCards.opening?.enabled) {
    if (!titleCards.opening.title || !titleCards.opening.title.trim()) {
      errors.push('Opening title card must have a title if enabled');
    }
    if ((titleCards.opening.duration ?? 0) <= 0) {
      errors.push('Opening title card duration must be greater than 0s');
    }
  }

  if (titleCards.closing?.enabled) {
    if (!titleCards.closing.title || !titleCards.closing.title.trim()) {
      errors.push('Closing title card must have a title if enabled');
    }
    if ((titleCards.closing.duration ?? 0) <= 0) {
      errors.push('Closing title card duration must be greater than 0s');
    }
  }

  return errors;
}

/**
 * Generates default opening and closing title cards for a journey.
 */
export function generateDefaultTitleCards(journey: Journey): StoryTitleCards {
  const stops = journey.stops ?? [];
  const startStop = stops.find((s) => s.type === 'start') ?? stops[0];
  const endStop = stops.find((s) => s.type === 'end') ?? stops[stops.length - 1];

  const openingSubtitle = startStop
    ? `Expedition beginning from ${startStop.name}`
    : 'From Roads to Trails, Every Journey Becomes a Story';

  const closingSubtitle = endStop
    ? `Destination reached at ${endStop.name} · Created with Wayvora`
    : `${stops.length} Stops · Created with Wayvora`;

  return {
    opening: {
      enabled: true,
      title: journey.name || 'Wayvora Expedition',
      subtitle: openingSubtitle,
      duration: 3.5,
      motion: 'slow-zoom',
    },
    closing: {
      enabled: true,
      title: 'Journey Complete',
      subtitle: closingSubtitle,
      duration: 3.5,
      motion: 'fade',
    },
  };
}

/**
 * Automatically synthesizes an intelligent narrative sequence of StoryScenes
 * based on journey duration, transport mode transitions, and stop dwells.
 */
export function generateDefaultStoryScenes(journey: Journey): StoryScene[] {
  const schedule = computeTimelineSchedule(journey);
  const totalDuration = schedule.totalDuration;
  const allPoints = getAllPoints(journey);
  if (totalDuration <= 0 || allPoints.length === 0) return [];

  const scenes: StoryScene[] = [];
  const stops = journey.stops;

  // Scene 1: Establishing Departure (Start)
  const firstStop = stops.find((s) => s.type === 'start') ?? stops[0];
  const departureDuration = Math.min(5, Math.max(3, totalDuration * 0.15));

  scenes.push({
    id: `story-scene-depart`,
    name: `Departure: ${firstStop?.name ?? 'Starting Point'}`,
    intent: 'establishing',
    startTime: 0,
    endTime: departureDuration,
    cameraMode: 'overview',
    params: DEFAULT_CAMERA_PARAMS.overview,
    title: journey.name,
    subtitle: `Beginning journey at ${firstStop?.name ?? 'Start'}`,
    caption: `Setting out from ${firstStop?.name ?? 'the valley'}. The road ahead awaits.`,
    stopId: firstStop?.id,
    media: firstStop?.media ? [...firstStop.media] : [],
    transition: { type: 'fade', duration: 1.0 },
  });

  // Intermediate Stop & Travel Phases
  let currentTime = departureDuration;
  const intermediateStops = stops.filter((s) => s.type !== 'start' && s.type !== 'end');

  if (intermediateStops.length > 0) {
    const timeSlicePerStop = Math.max(4, (totalDuration - departureDuration - 6) / intermediateStops.length);

    intermediateStops.forEach((stop, idx) => {
      const sceneStart = currentTime;
      const sceneEnd = Math.min(totalDuration - 5, sceneStart + timeSlicePerStop);
      currentTime = sceneEnd;

      const isDwell = (stop.durationAtStop ?? 0) > 0;
      const intent: SceneIntent = isDwell ? 'stop' : 'highlight';
      const mode: CameraMode = isDwell ? 'orbit' : 'chase';

      scenes.push({
        id: `story-scene-stop-${idx}-${stop.id}`,
        name: `${isDwell ? 'Stop' : 'Waymarker'}: ${stop.name}`,
        intent,
        startTime: Math.round(sceneStart * 10) / 10,
        endTime: Math.round(sceneEnd * 10) / 10,
        cameraMode: mode,
        params: DEFAULT_CAMERA_PARAMS[mode],
        title: stop.name,
        subtitle: stop.description ?? (stop.position.ele ? `Elevation: ${stop.position.ele}m` : undefined),
        caption: stop.description ?? `Reaching ${stop.name}.`,
        stopId: stop.id,
        media: stop.media ? [...stop.media] : [],
        transition: { type: 'dissolve', duration: 0.8 },
      });
    });
  } else {
    // Single continuous travel segment
    const travelEnd = Math.max(departureDuration + 2, totalDuration - 6);
    scenes.push({
      id: `story-scene-travel`,
      name: `Open Route Travel`,
      intent: 'travel',
      startTime: departureDuration,
      endTime: travelEnd,
      cameraMode: 'chase',
      params: DEFAULT_CAMERA_PARAMS.chase,
      title: 'Journey in Motion',
      subtitle: `${journey.segments.length} segment(s)`,
      caption: `Moving along the route through changing landscapes.`,
      transition: { type: 'cut', duration: 0.5 },
    });
    currentTime = travelEnd;
  }

  // Final Scene: Arrival Destination
  const finalStop = stops.find((s) => s.type === 'end') ?? stops[stops.length - 1];
  scenes.push({
    id: `story-scene-arrival`,
    name: `Arrival: ${finalStop?.name ?? 'Destination'}`,
    intent: 'arrival',
    startTime: Math.round(currentTime * 10) / 10,
    endTime: totalDuration,
    cameraMode: 'overview',
    params: DEFAULT_CAMERA_PARAMS.overview,
    title: `Arrived at ${finalStop?.name ?? 'Destination'}`,
    subtitle: `Journey Completed`,
    caption: `End of the route at ${finalStop?.name ?? 'our destination'}. Journey complete.`,
    stopId: finalStop?.id,
    media: finalStop?.media ? [...finalStop.media] : [],
    transition: { type: 'fade', duration: 1.2 },
  });

  return scenes;
}
