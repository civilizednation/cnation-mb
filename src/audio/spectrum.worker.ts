/// <reference lib="webworker" />
/**
 * 곡 전체를 미리 분석해 이퀄라이저 막대 높이(0~255)를 프레임마다 계산.
 * 입력: 모노 PCM (저샘플레이트), 출력: Uint8Array(frames × bands)
 */
interface Req {
  samples: Float32Array;
  sampleRate: number;
  bands: number;
  fftSize: number;
  hop: number;
}

function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

self.onmessage = (e: MessageEvent<Req>) => {
  try {
    const { samples, sampleRate, bands, fftSize, hop } = e.data;
    const frames = Math.max(1, Math.floor((samples.length - fftSize) / hop) + 1);
    const half = fftSize / 2;
    const binHz = sampleRate / fftSize;
    // 로그 간격 밴드 경계 (50Hz ~ 나이퀴스트의 90%)
    const fLo = 50;
    const fHi = Math.min(sampleRate * 0.45, 5000);
    const edges: number[] = [];
    for (let b = 0; b <= bands; b++) edges.push(fLo * Math.pow(fHi / fLo, b / bands));
    const lo = new Int32Array(bands);
    const hi = new Int32Array(bands);
    for (let b = 0; b < bands; b++) {
      lo[b] = Math.max(1, Math.floor(edges[b] / binHz));
      hi[b] = Math.min(half - 1, Math.max(lo[b], Math.ceil(edges[b + 1] / binHz) - 1));
    }
    const win = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fftSize - 1));
    const db = new Float32Array(frames * bands);
    const re = new Float32Array(fftSize);
    const im = new Float32Array(fftSize);
    for (let f = 0; f < frames; f++) {
      const off = f * hop;
      for (let i = 0; i < fftSize; i++) {
        re[i] = (samples[off + i] ?? 0) * win[i];
        im[i] = 0;
      }
      fft(re, im);
      for (let b = 0; b < bands; b++) {
        let p = 0;
        for (let k = lo[b]; k <= hi[b]; k++) p += re[k] * re[k] + im[k] * im[k];
        p /= hi[b] - lo[b] + 1;
        // 고음 쪽이 약하게 보이지 않도록 기울기 보정 (+0~9dB)
        db[f * bands + b] = 10 * Math.log10(p + 1e-12) + (b / (bands - 1)) * 9;
      }
    }
    // 곡 전체 기준 자동 스케일: 상위 2% 값을 최대로, 그 아래 45dB 범위를 0~1로
    const sorted = Float32Array.from(db).sort();
    const top = sorted[Math.floor(sorted.length * 0.98)] ?? 0;
    const floor = top - 45;
    const out = new Uint8Array(frames * bands);
    for (let i = 0; i < out.length; i++) {
      const v = (db[i] - floor) / (top - floor);
      out[i] = Math.round(Math.max(0, Math.min(1, v)) * 255);
    }
    (self as any).postMessage({ ok: true, data: out, frames, frameSec: hop / sampleRate }, [out.buffer]);
  } catch (err) {
    (self as any).postMessage({ ok: false, error: String((err as Error)?.message ?? err) });
  }
};
