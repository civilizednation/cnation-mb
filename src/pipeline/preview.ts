import { containerBytes } from '../audio/extract';
import { getAudioContext, unlockAudio } from '../audio/decode';
import type { Candidate } from './types';
import { toArrayBuffer } from './process';

let current: AudioBufferSourceNode | null = null;

export function stopPreview() {
  try {
    current?.stop();
  } catch {
    /* noop */
  }
  current = null;
}

/** 후보(녹화/파일)의 [fromSec, toSec] 구간을 재생 (마커 미리듣기) */
export async function previewRange(c: Candidate, fromSec: number, toSec: number) {
  await unlockAudio();
  stopPreview();
  const ctx = getAudioContext();
  let buf: AudioBuffer;
  let offset: number;
  if (c.kind === 'recording' && c.extracted.kind === 'frames') {
    const ex = c.extracted;
    const spf = ex.frames.samplesPerFrame;
    const sr = ex.frames.sampleRate;
    const from = Math.max(0, Math.floor(((fromSec - 0.3) * sr) / spf));
    const to = Math.min(ex.frames.frameStarts.length - 1, Math.ceil(((toSec + 0.1) * sr) / spf));
    buf = await ctx.decodeAudioData(toArrayBuffer(containerBytes(ex, from, to)));
    offset = Math.max(0, fromSec - (from * spf) / sr);
  } else if (c.kind === 'recording' && c.extracted.kind === 'pcm') {
    buf = c.extracted.buffer;
    offset = Math.max(0, fromSec);
  } else if (c.kind === 'file') {
    buf = await ctx.decodeAudioData(await c.blob.arrayBuffer());
    offset = Math.max(0, fromSec);
  } else return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start(0, offset, Math.max(0.05, toSec - fromSec));
  current = src;
}
