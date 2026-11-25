/// <reference lib="webworker" />
import { Mp3Encoder } from '@breezystack/lamejs';
import { addGaplessTag } from './lameTag';

interface Req {
  channels: Float32Array[];
  sampleRate: number;
  kbps: number;
  fadeInSamples: number;
  fadeOutSamples: number;
}

const toInt16 = (x: Float32Array, a: number, b: number) => {
  const out = new Int16Array(b - a);
  for (let i = a; i < b; i++) {
    const v = Math.max(-1, Math.min(1, x[i]));
    out[i - a] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
};

self.onmessage = (e: MessageEvent<Req>) => {
  try {
    const { channels, sampleRate, kbps, fadeInSamples, fadeOutSamples } = e.data;
    const n = channels[0].length;
    // 페이드 적용
    for (const ch of channels) {
      for (let i = 0; i < Math.min(fadeInSamples, n); i++) ch[i] *= i / fadeInSamples;
      for (let i = 0; i < Math.min(fadeOutSamples, n); i++) ch[n - 1 - i] *= i / fadeOutSamples;
    }
    const stereo = channels.length >= 2;
    const enc = new Mp3Encoder(stereo ? 2 : 1, sampleRate, kbps);
    const parts: Uint8Array[] = [];
    const BLOCK = 1152 * 16;
    let lastReport = 0;
    for (let i = 0; i < n; i += BLOCK) {
      const b = Math.min(n, i + BLOCK);
      const l = toInt16(channels[0], i, b);
      const buf = stereo ? enc.encodeBuffer(l, toInt16(channels[1], i, b)) : enc.encodeBuffer(l);
      if (buf.length) parts.push(new Uint8Array(buf));
      const p = b / n;
      if (p - lastReport > 0.02) {
        lastReport = p;
        (self as any).postMessage({ type: 'progress', progress: p });
      }
    }
    const end = enc.flush();
    if (end.length) parts.push(new Uint8Array(end));
    const total = parts.reduce((a, p) => a + p.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    // 갭리스 태그: 디코더가 인코더 지연/패딩을 건너뛰어 첫 소리에서 정확히 시작
    const tagged = addGaplessTag(out, n);
    (self as any).postMessage({ type: 'done', data: tagged }, [tagged.buffer]);
  } catch (err) {
    (self as any).postMessage({ type: 'error', error: String((err as Error)?.message ?? err) });
  }
};
