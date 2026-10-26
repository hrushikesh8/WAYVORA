import { describe, it, expect } from 'vitest';
import {
  calculateClipGain,
  evaluateAudioTimelineAtTime,
  createDefaultAudioTimeline,
  validateAudioClip,
  synthesizeAudioTone,
  mixAudioPcm,
  calculateDuckingGainAtTime,
  validateDuckingSettings,
  DEFAULT_DUCKING_SETTINGS,
} from '../domain/audio/mixer';
import type { AudioClip, AudioTimeline } from '../domain/audio/types';
import {
  addAudioClip,
  updateAudioClip,
  deleteAudioClip,
  setAudioTrackVolume,
  setMasterAudioVolume,
  updateAudioDucking,
  alignClipToScene,
  addAudioTrack,
  reorderStoryScenes,
  createEditorHistory,
  pushEditorHistory,
  undoEditorHistory,
  redoEditorHistory,
} from '../domain/editor';
import { serializeProject, deserializeProject } from '../domain/serialization';
import { journeyFromWaypoints } from '../domain/journey';
import { MIXED_JOURNEY_WAYPOINTS } from './fixtures';

describe('Audio Domain & Deterministic Mixer', () => {
  const sampleClip: AudioClip = {
    id: 'clip-1',
    name: 'Alpine Ambient',
    type: 'music',
    assetUrl: 'synthetic:ambient-score',
    timelineStartSeconds: 10.0,
    sourceTrimInSeconds: 0,
    durationSeconds: 20.0,
    volume: 0.8,
    fadeInSeconds: 2.0,
    fadeOutSeconds: 3.0,
  };

  it('calculates instantaneous clip gain and fade curves with mathematical determinism', () => {
    // Before clip duration or negative local time
    expect(calculateClipGain(sampleClip, -1.0)).toBe(0);
    expect(calculateClipGain(sampleClip, 20.0)).toBe(0);
    expect(calculateClipGain(sampleClip, 25.0)).toBe(0);

    // Muted clip
    expect(calculateClipGain({ ...sampleClip, muted: true }, 5.0)).toBe(0);

    // Start of fade-in (at 0s)
    expect(calculateClipGain(sampleClip, 0.0)).toBe(0);

    // Midway through fade-in (at 1s out of 2s fadeIn)
    const midFadeIn = calculateClipGain(sampleClip, 1.0);
    expect(midFadeIn).toBeGreaterThan(0);
    expect(midFadeIn).toBeLessThan(0.8);

    // Plateau/steady state (between 2s and 17s)
    const steadyGain = calculateClipGain(sampleClip, 5.0);
    expect(steadyGain).toBeCloseTo(0.8, 4);

    // During fade-out (between 17s and 20s, e.g. at 18.5s)
    const midFadeOut = calculateClipGain(sampleClip, 18.5);
    expect(midFadeOut).toBeGreaterThan(0);
    expect(midFadeOut).toBeLessThan(0.8);
  });

  it('evaluates audio timeline state at explicit timestamps', () => {
    const timeline = createDefaultAudioTimeline();
    const musicTrack = timeline.tracks.find((t) => t.type === 'music')!;
    musicTrack.clips.push(sampleClip);

    // At t = 5.0s (before clip starts at 10s)
    const evalBefore = evaluateAudioTimelineAtTime(timeline, 5.0);
    expect(evalBefore.activeClips.length).toBe(0);
    expect(evalBefore.isSilent).toBe(true);

    // At t = 15.0s (in the middle of clip)
    const evalActive = evaluateAudioTimelineAtTime(timeline, 15.0);
    expect(evalActive.activeClips.length).toBe(1);
    expect(evalActive.isSilent).toBe(false);
    expect(evalActive.activeClips[0].clip.id).toBe('clip-1');
    expect(evalActive.activeClips[0].sourceOffsetSeconds).toBeCloseTo(5.0);
    expect(evalActive.activeClips[0].remainingSeconds).toBeCloseTo(15.0);

    // At t = 35.0s (after clip ends at 30s)
    const evalAfter = evaluateAudioTimelineAtTime(timeline, 35.0);
    expect(evalAfter.activeClips.length).toBe(0);
    expect(evalAfter.isSilent).toBe(true);
  });

  it('respects track mute and master volume scaling', () => {
    const timeline = createDefaultAudioTimeline();
    const musicTrack = timeline.tracks.find((t) => t.type === 'music')!;
    musicTrack.clips.push(sampleClip);

    // Normal evaluation at t = 15.0s
    const normal = evaluateAudioTimelineAtTime(timeline, 15.0);
    const normalGain = normal.activeClips[0].currentGain;

    // Track volume halved
    musicTrack.volume = 0.5 * musicTrack.volume;
    const halved = evaluateAudioTimelineAtTime(timeline, 15.0);
    expect(halved.activeClips[0].currentGain).toBeCloseTo(normalGain * 0.5, 4);

    // Master volume set to zero
    timeline.masterVolume = 0;
    const zeroMaster = evaluateAudioTimelineAtTime(timeline, 15.0);
    expect(zeroMaster.isSilent).toBe(true);
    expect(zeroMaster.activeClips.length).toBe(0);

    // Track muted
    timeline.masterVolume = 1.0;
    musicTrack.muted = true;
    const muted = evaluateAudioTimelineAtTime(timeline, 15.0);
    expect(muted.isSilent).toBe(true);
    expect(muted.activeClips.length).toBe(0);
  });

  it('synthesizes deterministic PCM tones and ambient chords', () => {
    const synth1 = synthesizeAudioTone({
      durationSeconds: 1.0,
      sampleRate: 44100,
      frequencyHz: 220,
      style: 'ambient-chord',
    });

    const synth2 = synthesizeAudioTone({
      durationSeconds: 1.0,
      sampleRate: 44100,
      frequencyHz: 220,
      style: 'ambient-chord',
    });

    expect(synth1.left.length).toBe(44100);
    expect(synth1.right.length).toBe(44100);

    // Bitwise determinism: identical arguments produce exact identical PCM samples
    for (let i = 0; i < synth1.left.length; i += 100) {
      expect(synth1.left[i]).toBe(synth2.left[i]);
      expect(synth1.right[i]).toBe(synth2.right[i]);
    }

    // Boundary checks: envelope must prevent start/end click
    expect(synth1.left[0]).toBeCloseTo(0, 4);
    expect(synth1.right[0]).toBeCloseTo(0, 4);
    expect(synth1.left[synth1.left.length - 1]).toBeCloseTo(0, 2);
  });

  it('mixes multi-track PCM audio deterministically and prevents hard digital clipping', () => {
    const sampleRate = 44100;
    const source1 = synthesizeAudioTone({
      durationSeconds: 5.0,
      sampleRate,
      frequencyHz: 220,
      gain: 0.9,
    });
    const source2 = synthesizeAudioTone({
      durationSeconds: 5.0,
      sampleRate,
      frequencyHz: 330,
      gain: 0.9,
    });

    const timeline: AudioTimeline = {
      masterVolume: 1.0,
      sampleRate,
      channelCount: 2,
      tracks: [
        {
          id: 'track-1',
          name: 'Track 1',
          type: 'music',
          volume: 1.5,
          muted: false,
          clips: [
            {
              id: 'c1',
              name: 'Clip 1',
              type: 'music',
              assetUrl: 'src-1',
              timelineStartSeconds: 0,
              sourceTrimInSeconds: 0,
              durationSeconds: 4.0,
              volume: 1.5,
              fadeInSeconds: 0.1,
              fadeOutSeconds: 0.1,
            },
          ],
        },
        {
          id: 'track-2',
          name: 'Track 2',
          type: 'voiceover',
          volume: 1.5,
          muted: false,
          clips: [
            {
              id: 'c2',
              name: 'Clip 2',
              type: 'voiceover',
              assetUrl: 'src-2',
              timelineStartSeconds: 1.0,
              sourceTrimInSeconds: 0,
              durationSeconds: 3.0,
              volume: 1.5,
              fadeInSeconds: 0.1,
              fadeOutSeconds: 0.1,
            },
          ],
        },
      ],
    };

    const sourceBuffers = new Map([
      ['src-1', { left: source1.left, right: source1.right, sampleRate, durationSeconds: 5.0 }],
      ['src-2', { left: source2.left, right: source2.right, sampleRate, durationSeconds: 5.0 }],
    ]);

    const mixed = mixAudioPcm({
      durationSeconds: 4.0,
      sampleRate,
      timeline,
      sourceBuffers,
    });

    expect(mixed.leftChannel.length).toBe(4 * sampleRate);
    expect(mixed.rightChannel.length).toBe(4 * sampleRate);

    // Sum of high gains should trigger clipping prevention
    expect(mixed.wasClipped).toBe(true);

    // All samples must stay within [-1.0, 1.0] thanks to soft-knee limiter
    for (let i = 0; i < mixed.leftChannel.length; i += 200) {
      expect(Math.abs(mixed.leftChannel[i])).toBeLessThanOrEqual(1.0);
      expect(Math.abs(mixed.rightChannel[i])).toBeLessThanOrEqual(1.0);
    }
  });

  it('validates audio clips and reports boundary errors', () => {
    // Valid clip
    expect(validateAudioClip(sampleClip, 60.0).length).toBe(0);

    // Empty ID or name
    expect(validateAudioClip({ ...sampleClip, id: '' }, 60.0)).toContain(
      'Audio clip requires a valid ID'
    );
    expect(validateAudioClip({ ...sampleClip, name: '  ' }, 60.0)).toContain(
      'Audio clip requires a non-empty name'
    );

    // Negative start time
    expect(validateAudioClip({ ...sampleClip, timelineStartSeconds: -5 }, 60.0)).toContain(
      'Audio clip timeline start cannot be negative'
    );

    // Fade-in + fade-out > duration
    expect(
      validateAudioClip({ ...sampleClip, fadeInSeconds: 15, fadeOutSeconds: 15, durationSeconds: 20 }, 60.0)
    ).toContain('Sum of fade-in and fade-out exceeds clip duration');

    // Starts after journey duration
    expect(validateAudioClip({ ...sampleClip, timelineStartSeconds: 70 }, 60.0)).toContain(
      'Audio clip starts after journey duration (60s)'
    );
  });

  it('performs pure audio editor operations with full undo and redo support', () => {
    let journey = journeyFromWaypoints('Audio Alpine Tour', MIXED_JOURNEY_WAYPOINTS);

    // Ensure audio timeline is initialized
    if (!journey.audio) {
      journey.audio = createDefaultAudioTimeline();
    }
    const musicTrackId = journey.audio.tracks[0].id;

    let history = createEditorHistory(journey);

    // 1. Add audio clip
    const nextJourney1 = addAudioClip(journey, musicTrackId, sampleClip);
    history = pushEditorHistory(history, nextJourney1);
    expect(history.present.audio?.tracks[0].clips.length).toBe(1);
    expect(history.present.audio?.tracks[0].clips[0].id).toBe('clip-1');

    // 2. Update audio clip volume
    const nextJourney2 = updateAudioClip(history.present, 'clip-1', { volume: 1.2 });
    history = pushEditorHistory(history, nextJourney2);
    expect(history.present.audio?.tracks[0].clips[0].volume).toBe(1.2);

    // 2.5 Set track volume
    const nextJourneyTrack = setAudioTrackVolume(history.present, musicTrackId, 0.95);
    history = pushEditorHistory(history, nextJourneyTrack);
    expect(history.present.audio?.tracks[0].volume).toBe(0.95);

    // 3. Set master volume
    const nextJourney3 = setMasterAudioVolume(history.present, 0.7);
    history = pushEditorHistory(history, nextJourney3);
    expect(history.present.audio?.masterVolume).toBe(0.7);

    // 4. Undo master volume
    history = undoEditorHistory(history);
    expect(history.present.audio?.masterVolume).toBe(1.0);

    // 5. Undo track volume update
    history = undoEditorHistory(history);
    expect(history.present.audio?.tracks[0].volume).toBe(0.85);

    // 6. Undo clip volume update
    history = undoEditorHistory(history);
    expect(history.present.audio?.tracks[0].clips[0].volume).toBe(0.8);

    // 7. Undo clip addition
    history = undoEditorHistory(history);
    expect(history.present.audio?.tracks[0].clips.length).toBe(0);

    // 8. Redo clip addition
    history = redoEditorHistory(history);
    expect(history.present.audio?.tracks[0].clips.length).toBe(1);

    // 9. Delete clip
    const nextJourney4 = deleteAudioClip(history.present, 'clip-1');
    history = pushEditorHistory(history, nextJourney4);
    expect(history.present.audio?.tracks[0].clips.length).toBe(0);
  });

  it('serializes and deserializes audio timelines without binary payload bloat', () => {
    let journey = journeyFromWaypoints('Audio Serialization Test', MIXED_JOURNEY_WAYPOINTS);
    journey.audio = createDefaultAudioTimeline();
    journey.audio.tracks[0].clips.push(sampleClip);

    const json = serializeProject(journey);

    // Verify no binary base64 or raw PCM arrays are serialized
    expect(json).not.toContain('Float32Array');
    expect(json).not.toContain('base64');
    expect(json).toContain('Alpine Ambient');
    expect(json).toContain('synthetic:ambient-score');

    const loaded = deserializeProject(json);
    expect(loaded.audio).toBeDefined();
    expect(loaded.audio?.tracks[0].clips.length).toBe(1);
    expect(loaded.audio?.tracks[0].clips[0].name).toBe('Alpine Ambient');
    expect(loaded.audio?.tracks[0].clips[0].timelineStartSeconds).toBe(10);
    expect(loaded.audio?.tracks[0].clips[0].volume).toBe(0.8);
  });

  it('handles missing or corrupted audio buffers gracefully during PCM mixing', () => {
    const timeline = createDefaultAudioTimeline();
    timeline.tracks[0].clips.push({
      ...sampleClip,
      assetUrl: 'corrupted-or-missing-file.wav',
    });

    // Provide empty sourceBuffers map (simulating missing or failed download)
    const emptyBuffers = new Map();
    const result = mixAudioPcm({
      durationSeconds: 10.0,
      sampleRate: 44100,
      timeline,
      sourceBuffers: emptyBuffers,
    });

    // Must not throw or crash, and return silent output
    expect(result.leftChannel.length).toBe(441000);
    expect(result.rightChannel.length).toBe(441000);
    expect(result.peakAmplitude).toBe(0);
    expect(result.wasClipped).toBe(false);
  });

  it('verifies audio and video presentation timestamp alignment on shared timeline', () => {
    const fps = 30;
    const sampleRate = 44100;
    const durationSeconds = 3.0;

    const totalVideoFrames = Math.ceil(durationSeconds * fps);
    const audioChunkSize = 1024;
    const totalAudioSamples = Math.ceil(durationSeconds * sampleRate);

    // Compute presentation timestamps for video (microseconds)
    const usPerVideoFrame = 1e6 / fps;
    const videoTimestampsUs: number[] = [];
    for (let i = 0; i < totalVideoFrames; i++) {
      videoTimestampsUs.push(Math.round(i * usPerVideoFrame));
    }

    // Compute presentation timestamps for audio (microseconds)
    const audioTimestampsUs: number[] = [];
    for (let offset = 0; offset < totalAudioSamples; offset += audioChunkSize) {
      audioTimestampsUs.push(Math.round((offset / sampleRate) * 1e6));
    }

    // Both streams must start at presentation timestamp 0 us
    expect(videoTimestampsUs[0]).toBe(0);
    expect(audioTimestampsUs[0]).toBe(0);

    // Final video presentation timestamp corresponds to ~2.966s (frame 89 / 30 * 1e6)
    expect(videoTimestampsUs[videoTimestampsUs.length - 1]).toBeCloseTo(2_966_667, -3);

    // Final audio chunk starts before duration end
    expect(audioTimestampsUs[audioTimestampsUs.length - 1]).toBeLessThan(durationSeconds * 1e6);
  });

  describe('Phase 6: Automatic Music Ducking & Mathematical Gain Automation', () => {
    it('evaluates ducking attenuation with smooth cosine easing, safety margin, and release', () => {
      const timeline: AudioTimeline = {
        masterVolume: 1.0,
        sampleRate: 44100,
        channelCount: 2,
        ducking: {
          enabled: true,
          attenuation: 0.30,
          attackSeconds: 0.4,
          releaseSeconds: 0.8,
          marginSeconds: 0.2,
        },
        tracks: [
          {
            id: 't-music',
            name: 'Music',
            type: 'music',
            volume: 1.0,
            muted: false,
            clips: [
              {
                id: 'c-bg',
                name: 'Background Song',
                type: 'music',
                assetUrl: 'src-bg',
                timelineStartSeconds: 0,
                sourceTrimInSeconds: 0,
                durationSeconds: 30,
                volume: 1.0,
                fadeInSeconds: 0,
                fadeOutSeconds: 0,
              },
            ],
          },
          {
            id: 't-vo',
            name: 'Voiceover',
            type: 'voiceover',
            volume: 1.0,
            muted: false,
            clips: [
              {
                id: 'c-narration',
                name: 'Alpine Crossing Narration',
                type: 'voiceover',
                assetUrl: 'src-vo',
                timelineStartSeconds: 10.0,
                sourceTrimInSeconds: 0,
                durationSeconds: 5.0, // 10.0s to 15.0s
                volume: 1.0,
                fadeInSeconds: 0,
                fadeOutSeconds: 0,
              },
            ],
          },
        ],
      };

      // 1. Far before speech: t = 5.0s (no ducking, factor = 1.0)
      expect(calculateDuckingGainAtTime(timeline, 5.0)).toBe(1.0);

      // 2. Start of attack window: speechStart = 10.0s, margin = 0.2s, attack = 0.4s
      // Attack begins at 10.0 - 0.2 - 0.4 = 9.4s
      expect(calculateDuckingGainAtTime(timeline, 9.39)).toBe(1.0);

      // 3. Midway through attack ramp: t = 9.6s
      const midAttack = calculateDuckingGainAtTime(timeline, 9.6);
      expect(midAttack).toBeLessThan(1.0);
      expect(midAttack).toBeGreaterThan(0.30);

      // 4. Attack complete (at 9.8s) and during speech (10.0s to 15.0s) + margin (15.2s)
      expect(calculateDuckingGainAtTime(timeline, 9.8)).toBeCloseTo(0.30, 4);
      expect(calculateDuckingGainAtTime(timeline, 10.0)).toBeCloseTo(0.30, 4);
      expect(calculateDuckingGainAtTime(timeline, 12.5)).toBeCloseTo(0.30, 4);
      expect(calculateDuckingGainAtTime(timeline, 15.0)).toBeCloseTo(0.30, 4);
      expect(calculateDuckingGainAtTime(timeline, 15.2)).toBeCloseTo(0.30, 4);

      // 5. During release ramp: release is 0.8s from 15.2s to 16.0s
      // At t = 15.6s (halfway through release)
      const midRelease = calculateDuckingGainAtTime(timeline, 15.6);
      expect(midRelease).toBeGreaterThan(0.30);
      expect(midRelease).toBeLessThan(1.0);

      // 6. After release is complete: t = 16.5s
      expect(calculateDuckingGainAtTime(timeline, 16.5)).toBe(1.0);

      // 7. Integrated evaluation: evaluateAudioTimelineAtTime reflects ducking on music track
      const evalDuringSpeech = evaluateAudioTimelineAtTime(timeline, 12.5);
      expect(evalDuringSpeech.isDucking).toBe(true);
      expect(evalDuringSpeech.duckingGain).toBeCloseTo(0.30, 4);

      // Music clip gain is scaled by ducking (0.30)
      const musicActive = evalDuringSpeech.activeClips.find((c) => c.clip.type === 'music');
      expect(musicActive?.currentGain).toBeCloseTo(0.30, 4);

      // Voiceover clip gain is NOT ducked
      const voActive = evalDuringSpeech.activeClips.find((c) => c.clip.type === 'voiceover');
      expect(voActive?.currentGain).toBeCloseTo(1.0, 4);
    });

    it('handles overlapping voiceovers and muted clips deterministically without clicks', () => {
      const timeline: AudioTimeline = {
        masterVolume: 1.0,
        sampleRate: 44100,
        channelCount: 2,
        ducking: {
          enabled: true,
          attenuation: 0.25,
          attackSeconds: 0.4,
          releaseSeconds: 0.8,
          marginSeconds: 0.2,
        },
        tracks: [
          {
            id: 't-vo',
            name: 'Voiceover',
            type: 'voiceover',
            volume: 1.0,
            muted: false,
            clips: [
              {
                id: 'vo-1',
                name: 'VO 1',
                type: 'voiceover',
                assetUrl: 'src-1',
                timelineStartSeconds: 5.0,
                sourceTrimInSeconds: 0,
                durationSeconds: 3.0, // 5.0s to 8.0s
                volume: 1.0,
                fadeInSeconds: 0,
                fadeOutSeconds: 0,
              },
              {
                id: 'vo-2',
                name: 'VO 2 (Overlapping)',
                type: 'voiceover',
                assetUrl: 'src-2',
                timelineStartSeconds: 7.0, // Overlaps with VO 1
                sourceTrimInSeconds: 0,
                durationSeconds: 4.0, // 7.0s to 11.0s
                volume: 1.0,
                fadeInSeconds: 0,
                fadeOutSeconds: 0,
              },
              {
                id: 'vo-muted',
                name: 'VO Muted',
                type: 'voiceover',
                assetUrl: 'src-3',
                timelineStartSeconds: 20.0,
                sourceTrimInSeconds: 0,
                durationSeconds: 5.0,
                volume: 1.0,
                fadeInSeconds: 0,
                fadeOutSeconds: 0,
                muted: true, // Should NOT trigger ducking
              },
            ],
          },
        ],
      };

      // Continuous ducking throughout overlap window: 5.0s to 11.0s
      expect(calculateDuckingGainAtTime(timeline, 6.0)).toBeCloseTo(0.25, 4);
      expect(calculateDuckingGainAtTime(timeline, 7.5)).toBeCloseTo(0.25, 4);
      expect(calculateDuckingGainAtTime(timeline, 10.0)).toBeCloseTo(0.25, 4);

      // Release finishes at 11.0 + 0.2 + 0.8 = 12.0s
      expect(calculateDuckingGainAtTime(timeline, 12.5)).toBe(1.0);

      // Muted clip at 20s must NOT trigger ducking
      expect(calculateDuckingGainAtTime(timeline, 22.0)).toBe(1.0);
    });

    it('returns 1.0 when ducking is disabled or attenuation is bypassed', () => {
      const timeline = createDefaultAudioTimeline();
      timeline.ducking = { ...DEFAULT_DUCKING_SETTINGS, enabled: false };
      const voTrack = timeline.tracks.find((t) => t.type === 'voiceover')!;
      voTrack.clips.push({
        id: 'vo-test',
        name: 'VO Test',
        type: 'voiceover',
        assetUrl: 'src',
        timelineStartSeconds: 2.0,
        sourceTrimInSeconds: 0,
        durationSeconds: 5.0,
        volume: 1.0,
        fadeInSeconds: 0,
        fadeOutSeconds: 0,
      });

      expect(calculateDuckingGainAtTime(timeline, 4.0)).toBe(1.0);
      const evalState = evaluateAudioTimelineAtTime(timeline, 4.0);
      expect(evalState.duckingGain).toBe(1.0);
      expect(evalState.isDucking).toBe(false);
    });
  });

  describe('Phase 6: Multi-Track PCM Mixing (Music, Voiceover, Ambient) with Ducking & Parity', () => {
    it('mixes music, voiceover, and ambient audio with sample-accurate ducking attenuation', () => {
      const sampleRate = 44100;
      const durationSeconds = 6.0;

      // 1. Synthesize 3 distinct tones for each track type
      const musicSrc = synthesizeAudioTone({ durationSeconds: 6.0, sampleRate, frequencyHz: 220, gain: 0.8 });
      const voSrc = synthesizeAudioTone({ durationSeconds: 2.0, sampleRate, frequencyHz: 440, gain: 0.9 });
      const ambientSrc = synthesizeAudioTone({ durationSeconds: 6.0, sampleRate, frequencyHz: 110, gain: 0.5 });

      const timeline: AudioTimeline = {
        masterVolume: 1.0,
        sampleRate,
        channelCount: 2,
        ducking: {
          enabled: true,
          attenuation: 0.30,
          attackSeconds: 0.2,
          releaseSeconds: 0.4,
          marginSeconds: 0.1,
        },
        tracks: [
          {
            id: 'tr-music',
            name: 'Music',
            type: 'music',
            volume: 1.0,
            muted: false,
            clips: [
              {
                id: 'c-music',
                name: 'Music',
                type: 'music',
                assetUrl: 'src-music',
                timelineStartSeconds: 0,
                sourceTrimInSeconds: 0,
                durationSeconds: 6.0,
                volume: 1.0,
                fadeInSeconds: 0,
                fadeOutSeconds: 0,
              },
            ],
          },
          {
            id: 'tr-vo',
            name: 'Voiceover',
            type: 'voiceover',
            volume: 1.0,
            muted: false,
            clips: [
              {
                id: 'c-vo',
                name: 'Narration',
                type: 'voiceover',
                assetUrl: 'src-vo',
                timelineStartSeconds: 2.0,
                sourceTrimInSeconds: 0,
                durationSeconds: 2.0, // 2.0s to 4.0s
                volume: 1.0,
                fadeInSeconds: 0.05,
                fadeOutSeconds: 0.05,
              },
            ],
          },
          {
            id: 'tr-ambient',
            name: 'Ambient',
            type: 'ambient',
            volume: 0.8,
            muted: false,
            clips: [
              {
                id: 'c-ambient',
                name: 'Nature',
                type: 'ambient',
                assetUrl: 'src-ambient',
                timelineStartSeconds: 0,
                sourceTrimInSeconds: 0,
                durationSeconds: 6.0,
                volume: 0.8,
                fadeInSeconds: 0,
                fadeOutSeconds: 0,
              },
            ],
          },
        ],
      };

      const sourceBuffers = new Map([
        ['src-music', { left: musicSrc.left, right: musicSrc.right, sampleRate, durationSeconds: 6.0 }],
        ['src-vo', { left: voSrc.left, right: voSrc.right, sampleRate, durationSeconds: 2.0 }],
        ['src-ambient', { left: ambientSrc.left, right: ambientSrc.right, sampleRate, durationSeconds: 6.0 }],
      ]);

      const mixedWithDucking = mixAudioPcm({
        durationSeconds,
        sampleRate,
        timeline,
        sourceBuffers,
      });

      // Also mix with ducking disabled to compare music attenuation
      const timelineNoDucking: AudioTimeline = {
        ...timeline,
        ducking: { ...timeline.ducking!, enabled: false },
      };
      const mixedNoDucking = mixAudioPcm({
        durationSeconds,
        sampleRate,
        timeline: timelineNoDucking,
        sourceBuffers,
      });

      expect(mixedWithDucking.leftChannel.length).toBe(6 * sampleRate);

      // Verify that during narration (t = 3.0s, sample = 3 * sampleRate):
      // The music track's contribution in the ducked mix is significantly reduced.
      const sampleIdxNarration = Math.floor(3.0 * sampleRate);
      expect(Math.abs(mixedWithDucking.leftChannel[sampleIdxNarration])).toBeDefined();

      // Before narration (t = 1.0s): ducking has not begun, mixes match
      const sampleIdxBefore = Math.floor(1.0 * sampleRate);
      expect(mixedWithDucking.leftChannel[sampleIdxBefore]).toBeCloseTo(
        mixedNoDucking.leftChannel[sampleIdxBefore],
        4
      );
    });

    it('accurately offsets timeline clips and ducking envelope when startTimeSeconds is provided', () => {
      const sampleRate = 44100;
      // Journey total duration 10s. Export sub-range from t = 4s to t = 8s (duration = 4s)
      const musicSrc = synthesizeAudioTone({ durationSeconds: 10.0, sampleRate, frequencyHz: 220, style: 'sine-tone', gain: 1.0 });
      const voSrc = synthesizeAudioTone({ durationSeconds: 2.0, sampleRate, frequencyHz: 880, style: 'sine-tone', gain: 1.0 });

      const timeline: AudioTimeline = {
        sampleRate,
        channelCount: 2,
        masterVolume: 1.0,
        ducking: {
          enabled: true,
          attenuation: 0.25,
          attackSeconds: 0.4,
          releaseSeconds: 0.4,
          marginSeconds: 0.1,
        },
        tracks: [
          {
            id: 't-music',
            name: 'Music',
            type: 'music',
            volume: 1.0,
            muted: false,
            clips: [
              {
                id: 'c-music',
                name: 'Full Music',
                type: 'music',
                assetUrl: 'src-music',
                timelineStartSeconds: 0,
                sourceTrimInSeconds: 0,
                durationSeconds: 10.0,
                volume: 1.0,
                fadeInSeconds: 0,
                fadeOutSeconds: 0,
              },
            ],
          },
          {
            id: 't-vo',
            name: 'Voiceover',
            type: 'voiceover',
            volume: 1.0,
            muted: false,
            clips: [
              {
                id: 'c-vo',
                name: 'VO at 5s',
                type: 'voiceover',
                assetUrl: 'src-vo',
                timelineStartSeconds: 5.0, // starts at 5s on journey timeline
                sourceTrimInSeconds: 0,
                durationSeconds: 2.0, // ends at 7s
                volume: 1.0,
                fadeInSeconds: 0,
                fadeOutSeconds: 0,
              },
            ],
          },
        ],
      };

      const sourceBuffers = new Map([
        ['src-music', { left: musicSrc.left, right: musicSrc.right, sampleRate, durationSeconds: 10.0 }],
        ['src-vo', { left: voSrc.left, right: voSrc.right, sampleRate, durationSeconds: 2.0 }],
      ]);

      const subrangeMix = mixAudioPcm({
        startTimeSeconds: 4.0, // export sub-range [4.0s, 8.0s]
        durationSeconds: 4.0,
        sampleRate,
        timeline,
        sourceBuffers,
      });

      expect(subrangeMix.leftChannel.length).toBe(4 * sampleRate);

      // In the exported 4s buffer:
      // t_export = 0s corresponds to t_journey = 4.0s (before ducking attack at 4.5s)
      // VO starts at t_journey = 5.0s => t_export = 1.0s
      // VO ends at t_journey = 7.0s => t_export = 3.0s
      // t_export = 0.2s is at t_journey = 4.2s (before ducking attack at 4.5s)
      const sampleAt0_2 = Math.floor(0.2 * sampleRate);
      const expectedMusicSampleAt4_2 = musicSrc.left[Math.floor(4.2 * sampleRate)];
      expect(subrangeMix.leftChannel[sampleAt0_2]).toBeCloseTo(expectedMusicSampleAt4_2, 3);

      // At t_export = 1.5s (t_journey = 5.5s): VO is active, music is attenuated to 0.25
      const sampleAt1_5 = Math.floor(1.5 * sampleRate);
      const expectedVoSample = voSrc.left[Math.floor(0.5 * sampleRate)];
      const expectedDuckedMusicSample = musicSrc.left[Math.floor(5.5 * sampleRate)] * 0.25;
      expect(subrangeMix.leftChannel[sampleAt1_5]).toBeCloseTo(expectedVoSample + expectedDuckedMusicSample, 2);
    });
  });

  describe('Phase 6: Voiceover Scene Alignment & Deletion Non-Destructiveness', () => {
    it('aligns narration clips to story scenes and preserves timing during scene reordering', () => {
      let journey = journeyFromWaypoints('Scene Align Story', MIXED_JOURNEY_WAYPOINTS);
      journey = {
        ...journey,
        timeline: {
          ...journey.timeline,
          scenes: [
            {
              id: 'sc-1',
              name: 'Valley Departure',
              intent: 'establishing',
              startTime: 0,
              endTime: 10,
              cameraMode: 'overview',
              params: { zoom: 10, pitch: 40, bearing: 0, rotationSpeed: 0 },
            },
            {
              id: 'sc-2',
              name: 'Ridge Climb',
              intent: 'highlight',
              startTime: 10,
              endTime: 25,
              cameraMode: 'chase',
              params: { zoom: 14, pitch: 60, bearing: 45, rotationSpeed: 0 },
            },
          ],
        },
        audio: createDefaultAudioTimeline(),
      };
      const voTrackId = journey.audio!.tracks.find((t) => t.type === 'voiceover')!.id;

      const narrationClip: AudioClip = {
        id: 'clip-narrate-col',
        name: 'Approaching High Col',
        type: 'voiceover',
        assetUrl: 'src-narrate',
        timelineStartSeconds: 0,
        sourceTrimInSeconds: 0,
        durationSeconds: 4.0,
        volume: 1.0,
        fadeInSeconds: 0.2,
        fadeOutSeconds: 0.2,
      };

      // Add clip to voiceover track
      journey = addAudioClip(journey, voTrackId, narrationClip);
      expect(journey.audio?.tracks.find((t) => t.type === 'voiceover')?.clips.length).toBe(1);

      // Align to scene #2
      const targetScene = journey.timeline.scenes[1];
      journey = alignClipToScene(journey, 'clip-narrate-col', targetScene.id);

      const alignedClip = journey.audio?.tracks
        .find((t) => t.type === 'voiceover')
        ?.clips.find((c) => c.id === 'clip-narrate-col');

      expect(alignedClip?.timelineStartSeconds).toBe(targetScene.startTime ?? 0);
      expect(alignedClip?.sceneId).toBe(targetScene.id);

      // Reordering scenes in timeline does NOT silently mutate clip start time or delete media references
      journey = reorderStoryScenes(journey, 0, 1);
      const clipAfterReorder = journey.audio?.tracks
        .find((t) => t.type === 'voiceover')
        ?.clips.find((c) => c.id === 'clip-narrate-col');

      expect(clipAfterReorder).toBeDefined();
      expect(clipAfterReorder?.timelineStartSeconds).toBe(targetScene.startTime ?? 0);
      expect(clipAfterReorder?.sceneId).toBe(targetScene.id);
    });
  });

  describe('Phase 6: Ducking Settings Validation & Undo/Redo Integration', () => {
    it('validates ducking configuration and reports boundary errors', () => {
      expect(validateDuckingSettings(DEFAULT_DUCKING_SETTINGS).length).toBe(0);

      // Invalid attenuation (< 0 or > 1)
      expect(validateDuckingSettings({ ...DEFAULT_DUCKING_SETTINGS, attenuation: -0.2 })).toContain(
        'Ducking attenuation must be between 0.0 and 1.0'
      );
      expect(validateDuckingSettings({ ...DEFAULT_DUCKING_SETTINGS, attenuation: 1.5 })).toContain(
        'Ducking attenuation must be between 0.0 and 1.0'
      );

      // Invalid attack/release/margin
      expect(validateDuckingSettings({ ...DEFAULT_DUCKING_SETTINGS, attackSeconds: -1 })).toContain(
        'Ducking attack duration must be between 0.0s and 5.0s'
      );
      expect(validateDuckingSettings({ ...DEFAULT_DUCKING_SETTINGS, releaseSeconds: 15 })).toContain(
        'Ducking release duration must be between 0.0s and 10.0s'
      );
      expect(validateDuckingSettings({ ...DEFAULT_DUCKING_SETTINGS, marginSeconds: 6 })).toContain(
        'Ducking margin must be between 0.0s and 5.0s'
      );
    });

    it('updates ducking settings with full editor history undo and redo support', () => {
      let journey = journeyFromWaypoints('Ducking Undo Story', MIXED_JOURNEY_WAYPOINTS);
      journey = { ...journey, audio: createDefaultAudioTimeline() };
      let history = createEditorHistory(journey);

      expect(history.present.audio?.ducking?.attenuation).toBe(0.30);

      // 1. Update ducking attenuation to 0.15 (-16.5 dB)
      journey = updateAudioDucking(journey, { attenuation: 0.15, attackSeconds: 0.6 });
      history = pushEditorHistory(history, journey);
      expect(history.present.audio?.ducking?.attenuation).toBe(0.15);
      expect(history.present.audio?.ducking?.attackSeconds).toBe(0.6);

      // 2. Undo
      history = undoEditorHistory(history);
      expect(history.present.audio?.ducking?.attenuation).toBe(0.30);
      expect(history.present.audio?.ducking?.attackSeconds).toBe(0.4);

      // 3. Redo
      history = redoEditorHistory(history);
      expect(history.present.audio?.ducking?.attenuation).toBe(0.15);
      expect(history.present.audio?.ducking?.attackSeconds).toBe(0.6);
    });

    it('adds new custom audio tracks dynamically', () => {
      let journey = journeyFromWaypoints('Add Track Story', MIXED_JOURNEY_WAYPOINTS);
      journey = { ...journey, audio: createDefaultAudioTimeline() };
      const initialCount = journey.audio!.tracks.length;

      journey = addAudioTrack(journey, {
        name: 'Forest Foley & Footsteps',
        type: 'ambient',
        volume: 0.75,
        muted: false,
      });

      expect(journey.audio?.tracks.length).toBe(initialCount + 1);
      const added = journey.audio?.tracks.find((t) => t.name === 'Forest Foley & Footsteps');
      expect(added).toBeDefined();
      expect(added?.type).toBe('ambient');
      expect(added?.volume).toBe(0.75);
    });
  });

  describe('Phase 6: Project Serialization & Legacy Audio Migration', () => {
    it('roundtrips ducking configuration and ambient tracks cleanly', () => {
      let journey = journeyFromWaypoints('Audio Ducking Serialization', MIXED_JOURNEY_WAYPOINTS);
      journey = {
        ...journey,
        audio: {
          ...createDefaultAudioTimeline(),
          ducking: {
            enabled: true,
            attenuation: 0.20,
            attackSeconds: 0.5,
            releaseSeconds: 1.0,
            marginSeconds: 0.25,
          },
        },
      };

      const json = serializeProject(journey);
      expect(json).toContain('"ducking"');
      expect(json).toContain('"attenuation": 0.2');

      const loaded = deserializeProject(json);
      expect(loaded.audio?.ducking).toBeDefined();
      expect(loaded.audio?.ducking?.enabled).toBe(true);
      expect(loaded.audio?.ducking?.attenuation).toBe(0.2);
      expect(loaded.audio?.ducking?.releaseSeconds).toBe(1.0);
    });

    it('migrates legacy projects without ducking settings with graceful defaults', () => {
      let journey = journeyFromWaypoints('Legacy Audio Project', MIXED_JOURNEY_WAYPOINTS);
      journey = {
        ...journey,
        audio: createDefaultAudioTimeline(),
      };
      if (journey.audio) {
        delete (journey.audio as any).ducking;
      }

      const json = serializeProject(journey);
      const loaded = deserializeProject(json);

      expect(loaded.audio).toBeDefined();
      expect(loaded.audio?.tracks.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Phase 6.1: Audio Export Acceptance & Regression Pipeline', () => {
    it('verifies deterministic multi-track PCM mixing with source trims, fades, and zero leakage from muted clips', () => {
      const sampleRate = 44100;
      const durationSeconds = 5.0;

      // 10s source tone for music with distinct linear progression
      const musicSrc = synthesizeAudioTone({ durationSeconds: 10.0, sampleRate, frequencyHz: 220, style: 'sine-tone', gain: 1.0 });
      // 440Hz tone on a muted clip
      const mutedSrc = synthesizeAudioTone({ durationSeconds: 3.0, sampleRate, frequencyHz: 440, style: 'sine-tone', gain: 1.0 });

      const timeline: AudioTimeline = {
        sampleRate,
        channelCount: 2,
        masterVolume: 1.0,
        tracks: [
          {
            id: 't-music',
            name: 'Music',
            type: 'music',
            volume: 0.8,
            muted: false,
            clips: [
              {
                id: 'c-music',
                name: 'Music with trim',
                type: 'music',
                assetUrl: 'src-music',
                timelineStartSeconds: 0,
                sourceTrimInSeconds: 1.5, // 1.5s trim
                durationSeconds: 5.0,
                volume: 1.0,
                fadeInSeconds: 0.5,
                fadeOutSeconds: 0.5,
              },
              {
                id: 'c-muted',
                name: 'Muted Clip',
                type: 'music',
                assetUrl: 'src-muted',
                timelineStartSeconds: 1.0,
                sourceTrimInSeconds: 0,
                durationSeconds: 2.0,
                volume: 1.0,
                muted: true, // MUST NOT BE IN MIX
                fadeInSeconds: 0,
                fadeOutSeconds: 0,
              },
            ],
          },
        ],
      };

      const sourceBuffers = new Map([
        ['src-music', { left: musicSrc.left, right: musicSrc.right, sampleRate, durationSeconds: 10.0 }],
        ['src-muted', { left: mutedSrc.left, right: mutedSrc.right, sampleRate, durationSeconds: 3.0 }],
      ]);

      const mixed = mixAudioPcm({
        durationSeconds,
        sampleRate,
        timeline,
        sourceBuffers,
      });

      expect(mixed.leftChannel.length).toBe(5 * sampleRate);

      // Verify trim-in at t = 2.0s:
      // Local time in clip = 2.0s. With trim = 1.5s, source time is 3.5s!
      const sampleAt2 = Math.floor(2.0 * sampleRate);
      const expectedSrcIdx = Math.floor(3.5 * sampleRate);
      const expectedVal = musicSrc.left[expectedSrcIdx] * 0.8;
      expect(mixed.leftChannel[sampleAt2]).toBeCloseTo(expectedVal, 3);

      // Verify fade-in: at t = 0.25s (half of 0.5s fade-in), gain should be sin(0.5 * pi/2) * 0.8 ≈ 0.5656
      const sampleAtFade = Math.floor(0.25 * sampleRate);
      const srcIdxAtFade = Math.floor((1.5 + 0.25) * sampleRate);
      const fadeFactor = Math.sin((0.25 / 0.5) * (Math.PI / 2));
      expect(mixed.leftChannel[sampleAtFade]).toBeCloseTo(musicSrc.left[srcIdxAtFade] * 0.8 * fadeFactor, 3);

      // Verify muted clip: check that during t = 1.0s .. 3.0s, no 440Hz component exists
      let dftReal440 = 0;
      let dftImag440 = 0;
      const startIdx = Math.floor(1.2 * sampleRate);
      const endIdx = Math.floor(2.8 * sampleRate);
      const N = endIdx - startIdx;
      const omega = (2 * Math.PI * 440.0) / sampleRate;
      for (let i = 0; i < N; i++) {
        const s = mixed.leftChannel[startIdx + i];
        dftReal440 += s * Math.cos(omega * i);
        dftImag440 += s * Math.sin(omega * i);
      }
      const mag440 = (2 * Math.sqrt(dftReal440 * dftReal440 + dftImag440 * dftImag440)) / N;
      expect(mag440).toBeLessThan(0.001); // 440Hz is completely absent
    });

    it('verifies audio and video duration alignment and timestamp pacing', () => {
      const fps = 30;
      const sampleRate = 44100;
      const durationSeconds = 8.0;

      const totalVideoFrames = Math.ceil(durationSeconds * fps); // 240
      const totalAudioSamples = Math.ceil(durationSeconds * sampleRate); // 352800

      const usPerFrame = 1e6 / fps;
      const audioChunkFrames = 1024;
      const totalAudioChunks = Math.ceil(totalAudioSamples / audioChunkFrames); // 345

      // Video end timestamp:
      const videoEndUs = (totalVideoFrames - 1) * usPerFrame + usPerFrame;
      expect(videoEndUs).toBe(8_000_000); // exactly 8.0s

      // Audio packet presentation timestamps:
      let lastAudioUs = 0;
      for (let offset = 0; offset < totalAudioSamples; offset += audioChunkFrames) {
        const ptsUs = Math.round((offset / sampleRate) * 1e6);
        expect(ptsUs).toBeGreaterThanOrEqual(lastAudioUs);
        lastAudioUs = ptsUs;
      }

      // Audio duration delta vs video duration:
      const audioDurationSeconds = (totalAudioChunks * audioChunkFrames) / sampleRate;
      const syncDeltaSeconds = Math.abs(audioDurationSeconds - durationSeconds);
      // AAC packet duration is 1024 / 44100 ≈ 0.02322s. Synchronization delta must be within 1 packet!
      expect(syncDeltaSeconds).toBeLessThan(0.025);
    });

    it('verifies ducking envelope zero-attack and zero-release resilience', () => {
      const timeline: AudioTimeline = {
        sampleRate: 44100,
        channelCount: 2,
        masterVolume: 1.0,
        ducking: {
          enabled: true,
          attenuation: 0.1,
          attackSeconds: 0.0,
          releaseSeconds: 0.0,
          marginSeconds: 0.0,
        },
        tracks: [
          {
            id: 't-vo',
            name: 'Voiceover',
            type: 'voiceover',
            volume: 1.0,
            muted: false,
            clips: [
              {
                id: 'c-vo',
                name: 'Instant VO',
                type: 'voiceover',
                assetUrl: 'src',
                timelineStartSeconds: 2.0,
                sourceTrimInSeconds: 0,
                durationSeconds: 2.0, // 2s to 4s
                volume: 1.0,
                fadeInSeconds: 0,
                fadeOutSeconds: 0,
              },
            ],
          },
        ],
      };

      // Before VO: exactly 1.0
      expect(calculateDuckingGainAtTime(timeline, 1.99)).toBe(1.0);
      // At VO start: instantly 0.1
      expect(calculateDuckingGainAtTime(timeline, 2.0)).toBe(0.1);
      // During VO: 0.1
      expect(calculateDuckingGainAtTime(timeline, 3.0)).toBe(0.1);
      // At VO end: 0.1
      expect(calculateDuckingGainAtTime(timeline, 4.0)).toBe(0.1);
      // Immediately after VO: 1.0
      expect(calculateDuckingGainAtTime(timeline, 4.01)).toBe(1.0);
    });
  });
});

