/// <reference lib="webworker" />
import { splitSongs, computePeaks, boundsForRegions, detectBounds } from './silence';
import type { SilenceParams } from '../../types';

type Req =
  | { id: number; type: 'split'; samples: Float32Array; sampleRate: number; params: SilenceParams; songCount: number | null }
  | { id: number; type: 'regions'; samples: Float32Array; sampleRate: number; params: SilenceParams; cuts: number[] }
  | { id: number; type: 'bounds'; samples: Float32Array; sampleRate: number; params: SilenceParams };

self.onmessage = (e: MessageEvent<Req>) => {
  const m = e.data;
  try {
    if (m.type === 'split') {
      const t0 = performance.now();
      const result = splitSongs(m.samples, m.sampleRate, m.params, m.songCount);
      const peaks = computePeaks(m.samples, 2000);
      (self as any).postMessage({ id: m.id, ok: true, result, peaks, ms: performance.now() - t0, samples: m.samples }, [
        m.samples.buffer,
        peaks.buffer,
      ]);
    } else if (m.type === 'regions') {
      const songs = boundsForRegions(m.samples, m.sampleRate, m.params, m.cuts);
      (self as any).postMessage({ id: m.id, ok: true, songs, samples: m.samples }, [m.samples.buffer]);
    } else {
      const b = detectBounds(m.samples, m.sampleRate, m.params);
      (self as any).postMessage({ id: m.id, ok: true, bounds: b });
    }
  } catch (err) {
    (self as any).postMessage({ id: m.id, ok: false, error: String((err as Error)?.message ?? err) });
  }
};
