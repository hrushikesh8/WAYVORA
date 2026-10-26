import fs from 'node:fs';
import path from 'node:path';

function parseWav(buffer) {
  let offset = 12;
  let numChannels = 2;
  let sampleRate = 44100;
  let dataOffset = 0;
  let dataSize = 0;

  while (offset < buffer.length - 8) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    offset += 8;

    if (chunkId === 'fmt ') {
      numChannels = buffer.readUInt16LE(offset + 2);
      sampleRate = buffer.readUInt32LE(offset + 4);
      offset += chunkSize;
    } else if (chunkId === 'data') {
      dataOffset = offset;
      dataSize = chunkSize;
      break;
    } else {
      offset += chunkSize;
    }
  }

  const numSamples = Math.floor(dataSize / (numChannels * 2));
  const left = new Float32Array(numSamples);

  let readPtr = dataOffset;
  for (let i = 0; i < numSamples; i++) {
    left[i] = buffer.readInt16LE(readPtr) / 32768.0;
    readPtr += numChannels * 2;
  }

  return { sampleRate, numSamples, left };
}

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

const wavBuf = fs.readFileSync(path.resolve(process.cwd(), 'test-artifacts/decoded_audio.wav'));
const wav = parseWav(wavBuf);

console.log('=== REAL DECODED AUDIO: SECOND-BY-SECOND DUCKING ENVELOPE ===');
console.log('Time (s) | 220Hz (Music) | 880Hz (VO) | 110Hz (Amb) | Status');
console.log('-----------------------------------------------------------');

for (let t = 1.0; t <= 6.5; t += 0.25) {
  const winStart = t - 0.1;
  const winEnd = t + 0.1;
  const magMusic = getFrequencyMagnitude(wav.left, wav.sampleRate, winStart, winEnd, 220.0);
  const magVO = getFrequencyMagnitude(wav.left, wav.sampleRate, winStart, winEnd, 880.0);
  const magAmb = getFrequencyMagnitude(wav.left, wav.sampleRate, winStart, winEnd, 110.0);

  let status = '';
  if (t < 1.4) status = 'Music full, VO inactive';
  else if (t >= 1.4 && t <= 1.8) status = 'ATTACK (Fading down)';
  else if (t > 1.8 && t < 2.0) status = 'Pre-VO margin (Ducked)';
  else if (t >= 2.0 && t <= 5.0) status = 'VO ACTIVE (Ducked)';
  else if (t > 5.0 && t <= 5.2) status = 'Post-VO margin (Ducked)';
  else if (t > 5.2 && t <= 6.0) status = 'RELEASE (Fading up)';
  else status = 'RESTORED (Music full)';

  console.log(`${t.toFixed(2)}s     | ${magMusic.toFixed(4)}        | ${magVO.toFixed(4)}   | ${magAmb.toFixed(4)}    | ${status}`);
}
