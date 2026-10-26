# ADR-020: Moving Video Media Rendering & Cinematic Export Parity

**Status**: ACCEPTED  
**Date**: 2026-10-26  
**Domain**: Offline Canvas Composition, WebCodecs Video Export, MediaRecorder Fallback, HTMLVideoElement Frame Seeking, Aspect-Ratio Geometry, Audio Stream Isolation  

---

## 1. Context & Problem Statement

WAYVORA enables travelers to combine GPX routes, 3D terrain animations, captions, multi-track audio, and media into cinematic exported MP4 videos.

In Phase 7, the Media Library successfully allowed importing and previewing video files. However, during offline export (`exporter.ts`), `preloadMediaElements` only cached photos (`m.type === 'photo'`), causing video assets on story scenes to fall back to static placeholder cards (`drawMediaFallbackBox`).

### Core Challenges:
1. **Frame-Accurate Moving Footage**: Offline export renders non-real-time frames at fixed $\Delta t = 1/\text{fps}$ intervals (e.g. 30 fps). The export engine must retrieve the exact video frame corresponding to each presentation timestamp without dropping frames or freezing.
2. **Asynchronous Seeking & Decoders**: Standard `video.currentTime = target` triggers asynchronous hardware decoding. Starting overlapping seeks or drawing before `'seeked'` fires causes stale or black frames.
3. **Audio Interference**: Video elements contain embedded audio tracks. If connected to audio output or unmuted, they would leak into the browser audio context and contaminate the multi-track audio mixer.
4. **Aspect Ratio & Framing**: User videos arrive in arbitrary aspect ratios (16:9, 4:3, 9:16 vertical reels). Drawing them without proper cover-fit calculations distorts geometry.
5. **Resource Lifecycle**: Media decoders and off-screen DOM elements consume hardware resources. Leaking them across export cancellations or completions exhausts browser decoder instances.

---

## 2. Architectural Decisions

### 2.1 Native Off-Screen Sequential Seeking via `VideoFrameSeeker`
- **Component**: `app/src/domain/render/videoSeeker.ts`
- **Decision**: Employ off-screen `HTMLVideoElement` instances managed by `VideoFrameSeeker` with zero external demuxer dependencies.
- **Sequential Forward Invariant**: Offline export steps presentation time forward monotonically. Modern browser hardware decoders step forward from previous keyframes rapidly (5–15 ms per frame), achieving high throughput without demuxing overhead.
- **Bounded Timeout with Recovery**: Each seek is protected by a 350 ms safety timeout and concurrency lock (`currentSeekPromise`). If an individual frame seek stalls, the system logs the condition and recovers gracefully without crashing the export pipeline.
- **Audio Isolation**: All seeker video elements are created with `video.muted = true` and `video.volume = 0` and are never routed to the Web Audio `AudioContext`. Video audio is completely isolated from the multi-track mixer.

### 2.2 Cover-Cropping Aspect-Ratio Geometry
- **Component**: `app/src/domain/render/canvasCompositor.ts` (`drawMediaCalloutBox`)
- **Decision**: Support `HTMLVideoElement`, `HTMLImageElement`, and `ImageBitmap` with aspect-ratio cover cropping.
  - When source aspect ratio exceeds target container aspect ratio ($w/h > w_{dst}/h_{dst}$), horizontal excess is centered and cropped.
  - When source is taller (e.g. 9:16 vertical reels), vertical excess is centered and cropped.
  - Eliminates image/video distortion while preserving rounded-corner container geometry.
  - Appends a prominent `▶ VIDEO` chip badge in the card callout footer.

### 2.3 Unified Dual-Pipeline Integration
- **Component**: `app/src/domain/render/exporter.ts`
- **Decision**: Integrate `VideoFrameSeeker` uniformly into both export paths:
  1. `renderWithWebCodecs`: Hardware-accelerated `VideoEncoder` + `AudioEncoder` + `mp4-muxer`.
  2. `renderWithMediaRecorder`: Real-time canvas stream fallback.
- **Scene Relative Mapping**: Video presentation time is accurately offset relative to the scene start timestamp:
  $$\text{mediaTime} = \max(0, \text{exportTimestamp} - \text{sceneStartTime})$$
  Clamped between $0$ and the asset's verified duration.
- **Resource Teardown**: Seekers are allocated via `prepareVideoSeekers(journey)` prior to frame loops and deterministically disposed in a `finally` block via `cleanupVideoSeekers(videoSeekers)`.

---

## 3. Empirical Verification & Evidence

The implementation was proven through an actual browser-driven export of an 8.0-second MP4 containing real moving video footage in Scene 2 ($t = 4.0\text{s}$ to $8.0\text{s}$) alongside photo rendering in Scene 1 and multi-track audio.

### 3.1 Container & Stream Architecture (ffprobe)
- **Container**: ISO Base Media / MP4 (`isomavc1mp41`)
- **Video Stream**: H.264 High Profile (`avc1`), 640x360, 30.0 fps, 240 frames, 1.10 Mbps.
- **Audio Stream**: AAC-LC (`mp4a`), 44100 Hz, stereo, 8.01s duration, 128 kbps.

### 3.2 Frame-by-Frame Motion Proof
FFmpeg extracted frames at timestamps $t = 4.5\text{s}$, $5.0\text{s}$, $5.5\text{s}$, and $6.0\text{s}$. Pixel-level analysis across the video callout window demonstrated genuine moving footage:

| Comparison Interval | Video Media Time | Changed Pixels in Video Window | Max Color Delta | Structural Similarity (SSIM) | Peak Signal-to-Noise (PSNR) | Motion Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **t = 4.5s vs t = 5.0s** | 0.5s → 1.0s | **6,069 / 20,000 (30.34%)** | 687 | **0.937267** | **12.03 dB** | **VERIFIED MOVING FOOTAGE** |
| **t = 5.0s vs t = 5.5s** | 1.0s → 1.5s | **3,431 / 20,000 (17.16%)** | 185 | **0.992302** | **34.97 dB** | **VERIFIED MOVING FOOTAGE** |
| **t = 5.5s vs t = 6.0s** | 1.5s → 2.0s | **5,937 / 20,000 (29.68%)** | 143 | **0.990956** | **35.12 dB** | **VERIFIED MOVING FOOTAGE** |

In comparison, Scene 1 (Photo scene) demonstrated high visual stability between $t = 3.0\text{s}$ and $3.5\text{s}$ with SSIM **0.998053** and PSNR **41.24 dB**, verifying photo rendering did not regress.

### 3.3 Audio Mixing & Ducking Verification
Spectral analysis of the decoded audio track (`phase8_decoded_audio.wav`) confirmed zero regression:
- **Music (220 Hz)**: Pre-ducking magnitude = 0.4236; during voiceover = 0.0960; measured attenuation = **-12.90 dB** (matching configured 0.25 / -12.04 dB ducking).
- **Voiceover (880 Hz)**: Active magnitude = 0.7025; pre-narration = 0.000040 (silence).
- **Ambient (110 Hz)**: Continuous across $t = 1.0\text{s}$ to $7.0\text{s}$, ending cleanly at $t = 7.0\text{s}$.

---

## 4. Known Limitations & Constraints

1. **Browser Decoding Performance**: Native `HTMLVideoElement` sequential seeking requires hardware video decode capabilities. Extremely high-resolution 4K/60fps video assets may seek slower on low-end hardware.
2. **Browser Codec Support**: Relies on browser-supported video formats (H.264/MP4, WebM/VP8/VP9, AV1). Formats unsupported by the host browser's media stack (e.g. proprietary HEVC profiles on unsupported platforms) will fall back to the safe placeholder card.
3. **Sub-Frame Audio from Video**: Embedded audio tracks inside video assets are intentionally muted to preserve deterministic multi-track audio control. Video soundtrack ingestion should be performed via the audio timeline.
