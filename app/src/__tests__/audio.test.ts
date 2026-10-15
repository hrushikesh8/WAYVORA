import { describe, it, expect } from 'vitest';
import {
  calculateClipGain,
  evaluateAudioTimelineAtTime,
  createDefaultAudioTimeline,
  validateAudioClip,
  synthesizeAudioTone,
  mixAudioPcm,
} from '../domain/audio/mixer';
import type { AudioClip, AudioTimeline } from '../domain/audio/types';
import {
  addAudioClip,
  updateAudioClip,
  deleteAudioClip,
  setAudioTrackVolume,
  setMasterAudioVolume,
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
});

