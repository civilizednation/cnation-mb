import type { TitleRoi } from '../types';
import { preprocess } from './preprocess';
import { cleanOcrTitle } from './titles';

type TWorker = import('tesseract.js').Worker;
let workerP: Promise<TWorker> | null = null;

export function getOcrWorker(onProgress?: (p: number, status: string) => void): Promise<TWorker> {
  if (!workerP) {
    workerP = (async () => {
      const T = await import('tesseract.js');
      return T.createWorker('kor+eng', 1, {
        // 자체 호스팅 (scripts/copy-vendor.mjs) — 외부 CDN 불필요
        workerPath: '/vendor/tesseract/worker.min.js',
        corePath: '/vendor/tesseract/core',
        langPath: '/vendor/tesseract/lang',
        workerBlobURL: false,
        logger: (m: { progress: number; status: string }) => onProgress?.(m.progress, m.status),
      });
    })().catch((e) => {
      workerP = null;
      throw e;
    });
  }
  return workerP;
}

export async function terminateOcr() {
  if (workerP) {
    const w = await workerP.catch(() => null);
    workerP = null;
    await w?.terminate();
  }
}

export interface OcrResult {
  text: string;
  confidence: number;
}

export async function recognizeTitle(frame: HTMLCanvasElement, roi: TitleRoi | null): Promise<OcrResult> {
  const w = await getOcrWorker();
  const img = preprocess(frame, roi);
  const { data } = await w.recognize(img);
  if (roi) {
    // ROI: 가장 신뢰도 높은/긴 줄 우선, 여러 줄이면 첫 줄 (제목은 보통 한 줄)
    const lines = (data.lines ?? []).filter((l) => cleanOcrTitle(l.text).length > 0);
    if (lines.length) {
      const top = lines.reduce((a, b) => (b.bbox.y1 - b.bbox.y0 > (a.bbox.y1 - a.bbox.y0) * 1.15 ? b : a));
      return { text: cleanOcrTitle(top.text), confidence: top.confidence };
    }
    return { text: cleanOcrTitle(data.text), confidence: data.confidence };
  }
  // ROI 없음: 전체 화면에서 가장 큰 글자 줄
  const lines = (data.lines ?? []).filter((l) => cleanOcrTitle(l.text).length >= 2 && l.confidence > 30);
  if (!lines.length) return { text: '', confidence: 0 };
  const big = lines.reduce((a, b) => (b.bbox.y1 - b.bbox.y0 > a.bbox.y1 - a.bbox.y0 ? b : a));
  return { text: cleanOcrTitle(big.text), confidence: Math.min(big.confidence, 55) };
}
