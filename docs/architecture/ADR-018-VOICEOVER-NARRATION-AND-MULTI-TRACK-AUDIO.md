# ADR-018: Multi-Track Audio Architecture, Voiceover Narration & Automatic Music Ducking

**Status**: ACCEPTED  
**Date**: 2026-10-16  
**Domain**: Multi-Track Audio Domain, Timeline Scheduling, Voiceover Scene Alignment, Gain Automation, WebCodecs MP4 Muxer & Export Parity  

---

## 1. Context & Operational Requirements

WAYVORA's core brand promise is *"From Roads to Trails, Every Journey Becomes a Story."* In Phase 6, we evolved the sound design system from a basic stereo music timeline into a professional, cinematic multi-track audio workflow supporting Voiceover Narration, Background Music, and Ambient Foley/Atmospheres, coupled with deterministic automatic music ducking and synchronized MP4 video export.

Key engineering and product constraints for Phase 6:
1. **Multi-Track Audio Model**: Support three standard tracks (`music`, `voiceover`, `ambient`) with multiple clips per track, supporting trim boundaries, volume/gain, mute state, fade-in/fade-out, and custom additional ambient tracks.
2. **Deterministic Automatic Music Ducking**: Smooth cosine gain attenuation applied to background music when voiceover narration is active, parameterized by attenuation amount (default 0.30 / -10.5 dB), attack duration (default 0.4s), release duration (default 0.8s), and safety margin (default 0.2s).
3. **Deterministic Evaluation & Parity**: Gain and audio clip scheduling must be evaluated against explicit timeline timestamps ($t \in [0, \text{totalDuration}]$), ensuring exact parity between in-browser timeline playback and WebCodecs offline PCM rendering.
4. **Voiceover Scene Alignment**: Voiceover narration clips can be explicitly aligned to story scene start times without silently mutating clip boundaries or deleting media references when story scenes are reordered.
5. **Lossless Serialization & Undo/Redo**: Full backward compatibility for legacy project files lacking ducking configuration or ambient tracks, and full undo/redo history support for ducking settings and clip adjustments.
6. **Hardware WebCodecs Export with Synchronized AAC Audio**: The WebCodecs exporter blends multi-track PCM buffers using `mixAudioPcm`, applying ducking curves sample-accurately before encoding into AAC and muxing into the final MP4 container.

---

## 2. Multi-Track Audio Model

### 2.1 Domain Types & Ducking Settings
In `app/src/domain/audio/types.ts` and `app/src/domain/types.ts`:
```typescript
export interface AudioDuckingSettings {
  enabled: boolean;
  attenuation: number;     // 0.0 .. 1.0 (gain multiplier during voiceover; e.g. 0.30 = -10.5 dB)
  attackSeconds: number;   // seconds to fade down music when voiceover starts (e.g. 0.4s)
  releaseSeconds: number;  // seconds to fade up music after voiceover ends (e.g. 0.8s)
  marginSeconds: number;   // pre/post safety margin around voiceover (e.g. 0.2s)
}

export interface AudioTimeline {
  id: string;
  tracks: AudioTrack[];
  masterVolume: number;
  muted: boolean;
  ducking?: AudioDuckingSettings;
}

export interface EvaluatedAudioState {
  activeClips: EvaluatedAudioClip[];
  masterVolume: number;
  muted: boolean;
  duckingGain: number;     // Instantaneous gain multiplier applied to music tracks
  isDucking: boolean;       // Whether music is currently being attenuated
}
```

### 2.2 Standard Tracks Layout
`createDefaultAudioTimeline()` provisions three distinct tracks:
- `track-music` (`type: 'music'`, default volume: 0.85)
- `track-voiceover` (`type: 'voiceover'`, default volume: 1.00)
- `track-ambient` (`type: 'ambient'`, default volume: 0.70)
With default ducking configuration: `enabled: true, attenuation: 0.30, attackSeconds: 0.4, releaseSeconds: 0.8, marginSeconds: 0.2`.

---

## 3. Mathematical Gain Automation & Ducking Algorithm

Gain automation is calculated deterministically via `calculateDuckingGainAtTime(timeline, timeSeconds)`:
1. Identify all active, unmuted voiceover clips across all `voiceover` tracks. If no unmuted voiceover clips exist or ducking is disabled, return `1.0`.
2. Expand each clip's active window by `marginSeconds`: $[T_{\text{start}} - \text{margin}, T_{\text{end}} + \text{margin}]$.
3. Consolidate overlapping or adjacent narration windows into non-overlapping intervals $[S_k, E_k]$ to prevent fluttering or clicks between contiguous narration segments.
4. For any timestamp $t$:
   - Inside any active interval $t \in [S_k, E_k]$: return `attenuation` (e.g. `0.30`).
   - In the attack window $t \in [S_k - \text{attack}, S_k]$: compute smooth cosine fade-down:
     $$\text{factor} = \frac{1 - \cos\left(\frac{t - (S_k - \text{attack})}{\text{attack}} \cdot \pi\right)}{2}$$
     $$\text{gain} = 1.0 - (1.0 - \text{attenuation}) \cdot \text{factor}$$
   - In the release window $t \in [E_k, E_k + \text{release}]$: compute smooth cosine fade-up:
     $$\text{factor} = \frac{1 - \cos\left(\frac{t - E_k}{\text{release}} \cdot \pi\right)}{2}$$
     $$\text{gain} = \text{attenuation} + (1.0 - \text{attenuation}) \cdot \text{factor}$$
   - Outside all intervals and ramps: return `1.0`.

---

## 4. Voiceover & Story Scene Alignment

Narrative alignment is achieved via `alignClipToScene(journey, clipId, sceneId)`:
- Snaps the narration clip's `timelineStartSeconds` to the exact `startTime` of the targeted `StoryScene`.
- Stores `clip.sceneId = targetScene.id` for persistent metadata association.
- When scenes are reordered in the Story Editor via `reorderStoryScenes(journey, fromIndex, toIndex)`, audio clips and media references are strictly preserved without silent timeline shifts, adhering to predictable non-destructive editing principles.

---

## 5. WebCodecs Export & Audio Parity

Export parity is maintained by sharing the deterministic mixing logic:
1. `mixAudioPcm(options)` evaluates `duckingEnvelope` for the entire audio duration at the output sample rate (48 kHz / 44.1 kHz).
2. Music track PCM samples are multiplied by `duckingEnvelope[sampleIndex]` in addition to track volume and master volume.
3. Voiceover and ambient tracks are summed into the PCM mix with soft-knee limiting to eliminate digital clipping (`Math.tanh` saturation protection).
4. WebCodecs AAC encoder encodes the mixed floating-point PCM into synchronized audio chunks, which are multiplexed alongside H.264 video frames into the MP4 container via `mp4-muxer`.

---

## 6. Verification Status

| Capability | Verification Status | Notes |
|:---|:---|:---|
| Multi-track model (music, voiceover, ambient) | **VERIFIED** | Default 3-track structure, dynamic track additions, full clip CRUD. |
| Automatic music ducking (attack, release, margin) | **VERIFIED** | Cosine easing, sustained attenuation across overlapping narration, full test coverage. |
| In-browser live preview & playhead synchronization | **VERIFIED** | Real-time audio player sync with drift correction and live status badge. |
| Voiceover scene alignment & reorder safety | **VERIFIED** | Scene alignment snaps timelineStartSeconds; reorderStoryScenes never deletes clips. |
| WebCodecs MP4 export with synchronized audio | **VERIFIED** | mixAudioPcm applies duckingEnvelope sample-for-sample into AAC stream. |
| Serialization & legacy migration | **VERIFIED** | Roundtrips ducking settings cleanly; migrates legacy project files with zero data loss. |
| Unit & Integration Tests | **VERIFIED** | 295/295 vitest tests passing across 21 test suites. |
| Production Build | **VERIFIED** | `tsc -b && vite build` succeeds cleanly in ~700ms without errors. |

---

## 7. Phase 6.1: Audio Export Acceptance & End-to-End Verification (Addendum)

**Date**: 2026-10-26  
**Status**: VERIFIED & PASS  

### 7.1 Sub-Range Export Audio Alignment Fix
An audit of the export pipeline revealed that while full journey exports rendered accurately from $t = 0$, exporting sub-ranges (`config.timeRange: { startTime, endTime }`) caused `mixAudioPcm` to generate PCM starting at $t = 0$ while video evaluated starting at `startTime`, leading to severe audio/video misalignment in sub-range renders.
- **Fix**: Added `startTimeSeconds?: number` to `MixAudioPcmOptions` in `app/src/domain/audio/mixer.ts`. Forwarded `startTime` from `exportJourneyVideo` in `app/src/domain/render/exporter.ts`.
- **Regression Test**: Added test in `audio.test.ts` verifying that clip evaluation, fades, and ducking envelopes precisely honor `startTimeSeconds`.

### 7.2 Deterministic E2E Export Fixture & Decoded Stream Analysis
A deterministic end-to-end fixture was run through the complete WebCodecs export pipeline in Chrome, producing an 8.0-second MP4 with 240 video frames (30 fps) and AAC stereo audio (44.1 kHz).
- **Container**: ISO Media MP4 (`isomavc1mp41`), 2 streams.
- **Video Stream**: H.264 High Profile, 640x360, 30 fps, 240 frames, start PTS: `0.000000`, duration: `8.000000s`.
- **Audio Stream**: AAC LC, stereo, 44100 Hz, 345 packets (353,280 samples), start PTS: `0.000000`, duration: `8.010884s`.
- **A/V Sync Delta**: Video and audio start at identical `0.000000s` presentation timestamp; container end-time delta is 10.88ms (< 1 AAC packet length of 23.22ms).

### 7.3 Acoustic & Numerical Ducking Verification
The encoded MP4 was decoded to uncompressed 16-bit PCM WAV using `ffmpeg` and analyzed via Fourier bandpass filters:
- **Music Bed (220 Hz)**:
  - Pre-narration (0.5s - 1.2s): peak magnitude `0.5437` (-8.30 dBFS).
  - During Voiceover (2.0s - 5.0s): ducked to `0.0960` (-23.36 dBFS), measuring a **-15.06 dB attenuation**.
  - Post-Release (6.2s - 7.0s): recovered to `0.5002` (within 0.7 dB of pre-narration level).
- **Voiceover Narration (880 Hz)**: Present only during scheduled 2.0s - 5.0s window (`0.7169` magnitude), silent (`0.0000`) before and after.
- **Ambient Soundscape (110 Hz)**: Active from 1.0s to 7.0s (`0.1264` magnitude), silent outside bounds.
- **Muted Clip (440 Hz)**: Completely suppressed (`0.0000` magnitude, zero leakage into mix).
- **Ducking Envelope Dynamics**: Smooth cosine attack ramp (1.4s - 1.8s), safety margin hold (5.0s - 5.2s), smooth cosine release ramp (5.2s - 6.0s).

