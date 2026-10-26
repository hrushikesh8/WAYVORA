import fs from 'node:fs';
import path from 'node:path';

// Read 16-bit PCM WAV file by searching for 'fmt ' and 'data' chunks
function parseWav(buffer) {
  let offset = 12; // Skip 'RIFF' + size + 'WAVE'
  let numChannels = 2;
  let sampleRate = 44100;
  let bitsPerSample = 16;
  let dataOffset = 0;
  let dataSize = 0;

  while (offset < buffer.length - 8) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    offset += 8;

    if (chunkId === 'fmt ') {
      numChannels = buffer.readUInt16LE(offset + 2);
      sampleRate = buffer.readUInt32LE(offset + 4);
      bitsPerSample = buffer.readUInt16LE(offset + 14);
      offset += chunkSize;
    } else if (chunkId === 'data') {
      dataOffset = offset;
      dataSize = chunkSize;
      break;
    } else {
      offset += chunkSize;
    }
  }

  if (dataOffset === 0) {
    throw new Error('data chunk not found in WAV');
  }

  const bytesPerSample = bitsPerSample / 8;
  const numSamples = Math.floor(dataSize / (numChannels * bytesPerSample));

  const left = new Float32Array(numSamples);
  const right = new Float32Array(numSamples);

  let readPtr = dataOffset;
  for (let i = 0; i < numSamples; i++) {
    left[i] = buffer.readInt16LE(readPtr) / 32768.0;
    right[i] = numChannels > 1 ? buffer.readInt16LE(readPtr + 2) / 32768.0 : left[i];
    readPtr += numChannels * 2;
  }

  return { sampleRate, numChannels, numSamples, duration: numSamples / sampleRate, left, right };
}

// Compute RMS amplitude in [t_start, t_end]
function computeRms(channel, sampleRate, tStart, tEnd) {
  const startIdx = Math.max(0, Math.floor(tStart * sampleRate));
  const endIdx = Math.min(channel.length, Math.floor(tEnd * sampleRate));
  if (endIdx <= startIdx) return 0;

  let sumSq = 0;
  for (let i = startIdx; i < endIdx; i++) {
    sumSq += channel[i] * channel[i];
  }
  return Math.sqrt(sumSq / (endIdx - startIdx));
}

// Discrete Fourier Transform magnitude at a specific target frequency
function getFrequencyMagnitude(channel, sampleRate, tStart, tEnd, targetFreqHz) {
  const startIdx = Math.max(0, Math.floor(tStart * sampleRate));
  const endIdx = Math.min(channel.length, Math.floor(tEnd * sampleRate));
  const N = endIdx - startIdx;
  if (N <= 0) return 0;

  let real = 0;
  let imag = 0;
  const omega = (2 * Math.PI * targetFreqHz) / sampleRate;

  for (let i = 0; i < N; i++) {
    const s = channel[startIdx + i];
    const angle = omega * i;
    real += s * Math.cos(angle);
    imag += s * Math.sin(angle);
  }

  return (2 * Math.sqrt(real * real + imag * imag)) / N;
}

const wavPath = path.resolve(process.cwd(), 'test-artifacts/decoded_audio.wav');
if (!fs.existsSync(wavPath)) {
  console.error('decoded_audio.wav not found at:', wavPath);
  process.exit(1);
}

const wavBuf = fs.readFileSync(wavPath);
const wav = parseWav(wavBuf);

console.log('=== WAV DECODED STREAM METADATA ===');
console.log('Sample Rate:', wav.sampleRate, 'Hz');
console.log('Channels:', wav.numChannels);
console.log('Total Samples:', wav.numSamples);
console.log('Total Duration:', wav.duration.toFixed(6), 'seconds');

// Target frequencies in our deterministic fixture:
// Music: 220 Hz
// Voiceover: 880 Hz
// Ambient: 110 Hz
// Muted clip: 440 Hz

console.log('\n=== MEASURED FREQUENCY MAGNITUDES & DUCKING ANALYSIS ===');

// Interval A: t = 0.5s .. 1.2s (Music only, pre-ducking attack)
const musicPreDuckingMag = getFrequencyMagnitude(wav.left, wav.sampleRate, 0.5, 1.2, 220.0);
const voPreDuckingMag = getFrequencyMagnitude(wav.left, wav.sampleRate, 0.5, 1.2, 880.0);
const mutedClipMag = getFrequencyMagnitude(wav.left, wav.sampleRate, 0.5, 1.5, 440.0);
const rmsPre = computeRms(wav.left, wav.sampleRate, 0.5, 1.2);

console.log('[Interval 0.5s - 1.2s: Pre-Narration (Music Active, Ducking Idle)]');
console.log('  RMS Level:', rmsPre.toFixed(4), `(${(20 * Math.log10(rmsPre)).toFixed(2)} dBFS)`);
console.log('  220 Hz (Music):', musicPreDuckingMag.toFixed(4));
console.log('  880 Hz (Voiceover):', voPreDuckingMag.toFixed(4), '(expected ~0)');
console.log('  440 Hz (Muted Clip):', mutedClipMag.toFixed(4), '(expected ~0)');

// Interval B: t = 2.5s .. 4.5s (Voiceover active, Music ducked)
const musicDuringDuckingMag = getFrequencyMagnitude(wav.left, wav.sampleRate, 2.5, 4.5, 220.0);
const voDuringNarrationMag = getFrequencyMagnitude(wav.left, wav.sampleRate, 2.5, 4.5, 880.0);
const ambientDuringMag = getFrequencyMagnitude(wav.left, wav.sampleRate, 2.5, 4.5, 110.0);
const rmsDuring = computeRms(wav.left, wav.sampleRate, 2.5, 4.5);

console.log('\n[Interval 2.5s - 4.5s: During Narration (Voiceover Active, Music Ducked)]');
console.log('  RMS Level:', rmsDuring.toFixed(4), `(${(20 * Math.log10(rmsDuring)).toFixed(2)} dBFS)`);
console.log('  220 Hz (Music Ducked):', musicDuringDuckingMag.toFixed(4));
console.log('  880 Hz (Voiceover Active):', voDuringNarrationMag.toFixed(4));
console.log('  110 Hz (Ambient Drone):', ambientDuringMag.toFixed(4));

// Measured Ducking Attenuation Ratio:
const measuredAttenuationRatio = musicDuringDuckingMag / musicPreDuckingMag;
const measuredAttenuationDb = 20 * Math.log10(measuredAttenuationRatio);
console.log('\n=== DUCKING ATTENUATION RATIO & DB DROP ===');
console.log('  Configured Target Attenuation: 0.25 (-12.04 dB)');
console.log('  Measured Attenuation Ratio:', measuredAttenuationRatio.toFixed(4));
console.log('  Measured Decibel Drop:', measuredAttenuationDb.toFixed(2), 'dB');

// Interval C: t = 6.2s .. 7.0s (Voiceover finished at 5.0s + 0.2s margin + 0.8s release = 6.0s; Music fully restored)
const musicPostReleaseMag = getFrequencyMagnitude(wav.left, wav.sampleRate, 6.2, 7.0, 220.0);
const voPostReleaseMag = getFrequencyMagnitude(wav.left, wav.sampleRate, 6.2, 7.0, 880.0);
const ambientPostReleaseMag = getFrequencyMagnitude(wav.left, wav.sampleRate, 6.2, 7.0, 110.0);

console.log('\n[Interval 6.2s - 7.0s: Post-Narration (Release Complete, Music Restored)]');
console.log('  220 Hz (Music Restored):', musicPostReleaseMag.toFixed(4));
console.log('  880 Hz (Voiceover Ended):', voPostReleaseMag.toFixed(4), '(expected ~0)');
console.log('  110 Hz (Ambient Drone):', ambientPostReleaseMag.toFixed(4));
const restorationRatio = musicPostReleaseMag / musicPreDuckingMag;
console.log('  Music Restoration Ratio (vs pre-ducking):', restorationRatio.toFixed(4), `(${(20 * Math.log10(restorationRatio)).toFixed(2)} dB)`);

// Interval D: t = 7.2s .. 7.8s (Ambient ended at 7.0s; only Music remaining)
const musicOnlyMag = getFrequencyMagnitude(wav.left, wav.sampleRate, 7.2, 7.7, 220.0);
const ambientEndedMag = getFrequencyMagnitude(wav.left, wav.sampleRate, 7.2, 7.7, 110.0);
console.log('\n[Interval 7.2s - 7.7s: Ambient Ended (Music Only)]');
console.log('  220 Hz (Music):', musicOnlyMag.toFixed(4));
console.log('  110 Hz (Ambient Ended):', ambientEndedMag.toFixed(4), '(expected ~0)');

// Output summary JSON for programmatic verification
const report = {
  sampleRate: wav.sampleRate,
  duration: wav.duration,
  musicPreDuckingMag,
  musicDuringDuckingMag,
  measuredAttenuationRatio,
  measuredAttenuationDb,
  musicPostReleaseMag,
  restorationRatio,
  voPreDuckingMag,
  voDuringNarrationMag,
  voPostReleaseMag,
  ambientDuringMag,
  ambientEndedMag,
  mutedClipMag,
};

fs.writeFileSync(
  path.resolve(process.cwd(), 'test-artifacts/audio_export_analysis.json'),
  JSON.stringify(report, null, 2)
);
console.log('\nSaved numerical analysis to: test-artifacts/audio_export_analysis.json');
