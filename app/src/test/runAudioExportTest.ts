/* ─── Deterministic End-to-End Audio Export Test Fixture Runner ───────
   Runs the complete WebCodecs export pipeline in the real browser,
   exercises multi-track audio, automatic music ducking, and saves the
   real encoded MP4 file to disk via the dev server sink for ffprobe analysis.
   ─────────────────────────────────────────────────────────────────── */

import { journeyFromWaypoints } from '../domain/journey';
import { synthesizeAudioTone, pcmToWavBlob } from '../domain/audio/mixer';
import type { AudioTimeline } from '../domain/audio/types';
import type { StoryScene } from '../domain/types';
import { exportJourneyVideo } from '../domain/render/exporter';

export async function runDeterministicAudioExport(): Promise<{
  ok: boolean;
  filename: string;
  sizeBytes: number;
  durationSeconds: number;
  totalFrames: number;
  hasAudioTrack: boolean;
  audioCodec?: string;
  audioChannels?: number;
  audioSampleRate?: number;
  serverSavePath?: string;
}> {
  console.log('[E2E Audio Export] Setting up deterministic journey fixture...');

  // 1. Waypoints and Route
  const waypoints = [
    { name: 'Valley Start', lng: 7.9000, lat: 46.6000, ele: 795, mode: 'car' as const },
    { name: 'Mountain Base', lng: 7.9350, lat: 46.5700, ele: 915, mode: 'car' as const },
    { name: 'Alpine Summit', lng: 7.9700, lat: 46.5450, ele: 2240, mode: 'hike' as const },
  ];

  let journey = journeyFromWaypoints('Phase 6.1 Audio Acceptance Journey', waypoints);
  journey.timeline.duration = 8.0;

  // Create a distinctive in-memory test image
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = 64;
  sampleCanvas.height = 64;
  const sCtx = sampleCanvas.getContext('2d')!;
  sCtx.fillStyle = '#f59e0b'; // Gold
  sCtx.fillRect(0, 0, 64, 64);
  sCtx.fillStyle = '#10b981'; // Emerald center
  sCtx.fillRect(16, 16, 32, 32);
  const samplePhotoUrl = sampleCanvas.toDataURL('image/png');

  const photoAsset = {
    id: 'asset-test-photo',
    type: 'photo' as const,
    filename: 'alps_summit_marker.png',
    url: samplePhotoUrl,
    title: 'Alps Summit Marker',
    geoPosition: { lng: 7.97, lat: 46.545, ele: 2240 },
  };
  journey.mediaLibrary = [photoAsset];

  // 2. Story Scenes & Title Cards
  const scenes: StoryScene[] = [
    {
      id: 'sc-1-gateway',
      name: 'Valley Gateway',
      intent: 'establishing',
      startTime: 0.0,
      endTime: 4.0,
      cameraMode: 'overview',
      params: { zoom: 11, pitch: 45, bearing: 0, rotationSpeed: 0 },
      title: 'Alpine Journey Begins',
      subtitle: 'Starting from the green valley floor',
      transition: { type: 'fade', duration: 0.5 },
      media: [photoAsset],
    },
    {
      id: 'sc-2-ascent',
      name: 'Ridge Ascent',
      intent: 'highlight',
      startTime: 4.0,
      endTime: 8.0,
      cameraMode: 'chase',
      params: { zoom: 14, pitch: 60, bearing: 45, rotationSpeed: 0 },
      title: 'Climbing to the Summit',
      subtitle: 'Approaching the rocky ridges',
      transition: { type: 'crossfade', duration: 0.8 },
    },
  ];

  journey.timeline.scenes = scenes;
  journey.timeline.titleCards = {
    opening: {
      enabled: true,
      title: 'Alpine Expedition',
      subtitle: 'From Roads to Trails',
      duration: 2.5,
      motion: 'slow-zoom',
    },
    closing: {
      enabled: false,
      title: '',
      duration: 2.0,
      motion: 'fade',
    },
  };

  // 3. Synthesize Distinct Deterministic Audio Tones (WAV Blobs)
  const sampleRate = 44100;

  // Music: 220 Hz (A3), 10s source with 1.0s trim-in, plays from 0.0s to 8.0s
  const musicTone = synthesizeAudioTone({
    durationSeconds: 10.0,
    sampleRate,
    frequencyHz: 220.0,
    style: 'sine-tone',
    gain: 0.8,
  });
  const musicBlob = pcmToWavBlob(musicTone.left, musicTone.right, sampleRate);
  const musicUrl = URL.createObjectURL(musicBlob);

  // Voiceover: 880 Hz (A5), 3.0s duration, plays from 2.0s to 5.0s
  const voTone = synthesizeAudioTone({
    durationSeconds: 3.0,
    sampleRate,
    frequencyHz: 880.0,
    style: 'sine-tone',
    gain: 0.9,
  });
  const voBlob = pcmToWavBlob(voTone.left, voTone.right, sampleRate);
  const voUrl = URL.createObjectURL(voBlob);

  // Ambient: 110 Hz (A2), 6.0s duration, plays from 1.0s to 7.0s
  const ambientTone = synthesizeAudioTone({
    durationSeconds: 6.0,
    sampleRate,
    frequencyHz: 110.0,
    style: 'sine-tone',
    gain: 0.4,
  });
  const ambientBlob = pcmToWavBlob(ambientTone.left, ambientTone.right, sampleRate);
  const ambientUrl = URL.createObjectURL(ambientBlob);

  // Muted: 440 Hz (A4), 2.0s duration, muted: true
  const mutedTone = synthesizeAudioTone({
    durationSeconds: 2.0,
    sampleRate,
    frequencyHz: 440.0,
    style: 'sine-tone',
    gain: 0.9,
  });
  const mutedBlob = pcmToWavBlob(mutedTone.left, mutedTone.right, sampleRate);
  const mutedUrl = URL.createObjectURL(mutedBlob);

  // 4. Construct Multi-Track Audio Timeline with Automatic Ducking
  const audioTimeline: AudioTimeline = {
    masterVolume: 1.0,
    sampleRate: 44100,
    channelCount: 2,
    ducking: {
      enabled: true,
      attenuation: 0.25,     // -12.04 dB
      attackSeconds: 0.4,
      releaseSeconds: 0.8,
      marginSeconds: 0.2,
    },
    tracks: [
      {
        id: 'track-music',
        name: 'Background Music (220Hz)',
        type: 'music',
        volume: 0.8,
        muted: false,
        clips: [
          {
            id: 'clip-music-1',
            name: 'Music Bed 220Hz',
            type: 'music',
            assetUrl: musicUrl,
            timelineStartSeconds: 0.0,
            sourceTrimInSeconds: 1.0, // 1s trim test
            durationSeconds: 8.0,
            volume: 1.0,
            fadeInSeconds: 0.5,
            fadeOutSeconds: 0.5,
          },
          {
            id: 'clip-muted-test',
            name: 'Muted 440Hz Test Clip',
            type: 'music',
            assetUrl: mutedUrl,
            timelineStartSeconds: 0.5,
            sourceTrimInSeconds: 0.0,
            durationSeconds: 2.0,
            volume: 1.0,
            muted: true, // MUST NOT BE AUDIBLE
            fadeInSeconds: 0,
            fadeOutSeconds: 0,
          },
        ],
      },
      {
        id: 'track-voiceover',
        name: 'Voiceover Narration (880Hz)',
        type: 'voiceover',
        volume: 1.0,
        muted: false,
        clips: [
          {
            id: 'clip-vo-1',
            name: 'Narration 880Hz',
            type: 'voiceover',
            assetUrl: voUrl,
            timelineStartSeconds: 2.0,
            sourceTrimInSeconds: 0.0,
            durationSeconds: 3.0, // ends at 5.0s
            volume: 1.0,
            fadeInSeconds: 0.2,
            fadeOutSeconds: 0.2,
            sceneId: 'sc-1-gateway',
          },
        ],
      },
      {
        id: 'track-ambient',
        name: 'Ambient Drone (110Hz)',
        type: 'ambient',
        volume: 0.5,
        muted: false,
        clips: [
          {
            id: 'clip-ambient-1',
            name: 'Ambient 110Hz',
            type: 'ambient',
            assetUrl: ambientUrl,
            timelineStartSeconds: 1.0,
            sourceTrimInSeconds: 0.0,
            durationSeconds: 6.0, // ends at 7.0s
            volume: 1.0,
            fadeInSeconds: 0.5,
            fadeOutSeconds: 0.5,
          },
        ],
      },
    ],
  };

  journey.audio = audioTimeline;

  console.log('[E2E Audio Export] Starting real WebCodecs export (8s, 240 frames, 640x360)...');

  // 5. Execute Real Export Pipeline
  const statusEl = document.getElementById('status-msg');
  if (statusEl) statusEl.innerText = 'Encoding video and audio via WebCodecs...';

  const exportResult = await exportJourneyVideo(journey, {
    config: {
      profileName: 'E2E_Audio_Acceptance',
      width: 640,
      height: 360,
      fps: 30,
      bitrateMbps: 2.5,
      codec: 'h264',
      aspectRatio: '16:9',
      includeAudio: true,
      audioBitrateKbps: 128,
      cinematicTreatment: {
        colorGrade: 'golden-hour',
        vignette: true,
      },
    },
    onProgress: (prog) => {
      if (statusEl) {
        statusEl.innerText = `[${prog.phase.toUpperCase()}] ${prog.percent}% — ${prog.message}`;
      }
      console.log(`[E2E Progress] ${prog.phase} ${prog.percent}% (${prog.currentFrame}/${prog.totalFrames})`);
    },
  });

  console.log('[E2E Audio Export] Export finished! Blob size:', exportResult.sizeBytes, 'bytes');

  // 6. POST the real MP4 blob to the dev server sink
  if (statusEl) statusEl.innerText = 'Saving MP4 artifact to disk...';

  const targetFilename = 'phase6_e2e_audio_export.mp4';
  const saveResp = await fetch('/api/save-test-export', {
    method: 'POST',
    headers: {
      'Content-Type': 'video/mp4',
      'x-filename': targetFilename,
    },
    body: exportResult.blob,
  });

  const saveJson = await saveResp.json();
  console.log('[E2E Audio Export] Server save response:', saveJson);

  if (statusEl) {
    statusEl.innerHTML = `<span style="color:#10b981;font-weight:bold;">✓ EXPORT COMPLETE & SAVED TO DISK</span><br>
File: ${targetFilename} (${(exportResult.sizeBytes / 1024 / 1024).toFixed(2)} MB)<br>
Audio Track: ${exportResult.hasAudioTrack ? 'YES (AAC)' : 'NO'}<br>
Sample Rate: ${exportResult.audioSampleRate} Hz · Channels: ${exportResult.audioChannels}`;
  }

  // Display video preview
  const videoEl = document.getElementById('preview-player') as HTMLVideoElement;
  if (videoEl) {
    videoEl.src = URL.createObjectURL(exportResult.blob);
    videoEl.style.display = 'block';
  }

  const resultObj = {
    ok: true,
    filename: targetFilename,
    sizeBytes: exportResult.sizeBytes,
    durationSeconds: exportResult.durationSeconds,
    totalFrames: exportResult.totalFrames,
    hasAudioTrack: exportResult.hasAudioTrack ?? false,
    audioCodec: exportResult.audioCodec,
    audioChannels: exportResult.audioChannels,
    audioSampleRate: exportResult.audioSampleRate,
    serverSavePath: saveJson.path,
  };

  (window as unknown as { __E2E_EXPORT_RESULT__: typeof resultObj }).__E2E_EXPORT_RESULT__ = resultObj;
  return resultObj;
}

// Auto-run if loaded in test page
if (typeof window !== 'undefined') {
  (window as unknown as { runDeterministicAudioExport: typeof runDeterministicAudioExport }).runDeterministicAudioExport = runDeterministicAudioExport;
  window.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('run-btn');
    if (btn) {
      btn.addEventListener('click', () => {
        runDeterministicAudioExport().catch((err) => {
          console.error('[E2E Audio Export Error]', err);
          const statusEl = document.getElementById('status-msg');
          if (statusEl) statusEl.innerText = `Error: ${err.message}`;
        });
      });
    }
  });
}
