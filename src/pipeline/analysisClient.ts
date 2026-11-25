import type { SilenceParams } from '../types';
import type { SplitResult, DetectedSong } from '../audio/analyze/silence';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();

function w(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../audio/analyze/analysis.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data);
      else p.reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || '분석 워커 오류'));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

function call<T>(msg: any, transfer: Transferable[]): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w().postMessage({ ...msg, id }, transfer);
  });
}

/** samples는 워커로 이전(transfer)되었다가 결과와 함께 돌아온다 */
export async function analyzeSplit(samples: Float32Array, sampleRate: number, params: SilenceParams, songCount: number | null) {
  const r = await call<{ result: SplitResult; peaks: Float32Array; ms: number; samples: Float32Array }>(
    { type: 'split', samples, sampleRate, params, songCount },
    [samples.buffer],
  );
  return r;
}

export async function analyzeRegions(samples: Float32Array, sampleRate: number, params: SilenceParams, cuts: number[]) {
  return call<{ songs: DetectedSong[]; samples: Float32Array }>({ type: 'regions', samples, sampleRate, params, cuts }, [samples.buffer]);
}

export async function analyzeBounds(samples: Float32Array, sampleRate: number, params: SilenceParams) {
  const r = await call<{ bounds: { startSec: number; endSec: number } }>({ type: 'bounds', samples, sampleRate, params }, [samples.buffer]);
  return r.bounds;
}
