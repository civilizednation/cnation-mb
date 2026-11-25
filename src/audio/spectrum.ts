/**
 * 연속 듣기 이퀄라이저용 곡 미리 분석 (②방식)
 * - 재생은 <audio>가 그대로 담당 → 백그라운드/잠금화면 재생에 영향 없음
 * - 곡이 바뀌면 한 번만: 저음질(11kHz 모노) 디코딩 → 워커에서 FFT → 프레임별 막대 높이
 * - 결과는 곡당 수십~수백 KB, 최근 6곡만 메모리에 보관
 */
export const EQ_BANDS = 28;
const SR = 11025;
const FFT = 512;
const HOP = 512; // ≈ 46ms
const MAX_BYTES = 80 * 1024 * 1024; // 이보다 큰 파일은 분석 생략 (메모리 보호)

export interface Spectrum {
  data: Uint8Array; // frames × EQ_BANDS (0~255)
  frames: number;
  frameSec: number;
}

const cache = new Map<string, Spectrum>();
const inflight = new Map<string, Promise<Spectrum | null>>();

function decodeLowRate(buf: ArrayBuffer): Promise<AudioBuffer> {
  const OAC: typeof OfflineAudioContext = (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  const ctx = new OAC(1, 1, SR);
  return new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(buf, resolve, reject);
    if (p && typeof (p as Promise<AudioBuffer>).catch === 'function') (p as Promise<AudioBuffer>).catch(reject);
  });
}

function runWorker(samples: Float32Array): Promise<Spectrum> {
  const w = new Worker(new URL('./spectrum.worker.ts', import.meta.url), { type: 'module' });
  return new Promise<Spectrum>((resolve, reject) => {
    w.onmessage = (e) => {
      w.terminate();
      if (e.data.ok) resolve({ data: e.data.data, frames: e.data.frames, frameSec: e.data.frameSec });
      else reject(new Error(e.data.error));
    };
    w.onerror = (e) => {
      w.terminate();
      reject(new Error(e.message || '분석 실패'));
    };
    w.postMessage({ samples, sampleRate: SR, bands: EQ_BANDS, fftSize: FFT, hop: HOP }, [samples.buffer]);
  });
}

/** 곡 분석 (같은 곡은 캐시). 실패하거나 너무 큰 파일이면 null → 막대는 낮게 유지 */
export function analyzeTrack(id: string, url: string, size: number): Promise<Spectrum | null> {
  const hit = cache.get(id);
  if (hit) {
    cache.delete(id);
    cache.set(id, hit);
    return Promise.resolve(hit);
  }
  const running = inflight.get(id);
  if (running) return running;
  if (size > MAX_BYTES) return Promise.resolve(null);
  const p = (async () => {
    try {
      const buf = await (await fetch(url)).arrayBuffer();
      const ab = await decodeLowRate(buf);
      let mono = ab.getChannelData(0);
      if (ab.numberOfChannels > 1) {
        const m = new Float32Array(ab.length);
        for (let c = 0; c < ab.numberOfChannels; c++) {
          const d = ab.getChannelData(c);
          for (let i = 0; i < d.length; i++) m[i] += d[i] / ab.numberOfChannels;
        }
        mono = m;
      } else mono = new Float32Array(mono);
      const spec = await runWorker(mono);
      cache.set(id, spec);
      while (cache.size > 6) cache.delete(cache.keys().next().value as string);
      return spec;
    } catch {
      return null;
    } finally {
      inflight.delete(id);
    }
  })();
  inflight.set(id, p);
  return p;
}

/** 재생 시각의 막대 높이 (0~1), 프레임 사이는 선형 보간 */
export function bandsAt(spec: Spectrum, t: number, out: Float32Array) {
  const x = t / spec.frameSec;
  const f0 = Math.max(0, Math.min(spec.frames - 1, Math.floor(x)));
  const f1 = Math.min(spec.frames - 1, f0 + 1);
  const k = Math.max(0, Math.min(1, x - f0));
  for (let b = 0; b < EQ_BANDS; b++) {
    const a = spec.data[f0 * EQ_BANDS + b];
    const c = spec.data[f1 * EQ_BANDS + b];
    out[b] = (a + (c - a) * k) / 255;
  }
}
