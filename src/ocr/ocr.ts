import type { TitleRoi } from '../types';
import { preprocess, PRE_VARIANTS } from './preprocess';
import { cleanOcrTitle } from './titles';
import { useSettings } from '../store/settings';

type TWorker = import('tesseract.js').Worker;
const workers = new Map<string, Promise<TWorker>>();

function createWorker(key: string, onProgress?: (p: number, status: string) => void): Promise<TWorker> {
  let p = workers.get(key);
  if (!p) {
    p = (async () => {
      const T = await import('tesseract.js');
      return T.createWorker(key, 1, {
        // 자체 호스팅 (scripts/copy-vendor.mjs) — 외부 CDN 불필요
        workerPath: '/vendor/tesseract/worker.min.js',
        corePath: '/vendor/tesseract/core',
        langPath: '/vendor/tesseract/lang',
        workerBlobURL: false,
        logger: (m: { progress: number; status: string }) => onProgress?.(m.progress, m.status),
      });
    })().catch((e) => {
      workers.delete(key);
      throw e;
    });
    workers.set(key, p);
  }
  return p;
}

/**
 * 언어 그룹: Tesseract는 첫 번째 언어를 주 모델로 쓰기 때문에
 * 한국어와 중국어를 한 워커에 섞으면 서로를 잘못 읽는다(한자를 한글로 등).
 * 그래서 '한국어 우선'과 '중국어 우선' 그룹으로 나눠 각각 인식하고 신뢰도가 높은 쪽을 고른다.
 */
export function langGroups(langs: string[] = currentLangs()): string[] {
  const has = (l: string) => langs.includes(l);
  const groups: string[][] = [];
  if (has('kor')) groups.push(['kor', ...(has('eng') ? ['eng'] : [])]);
  const chi = ['chi_sim', 'chi_tra'].filter(has);
  if (chi.length) groups.push([...chi, ...(has('eng') ? ['eng'] : [])]);
  if (!groups.length) groups.push(has('eng') ? ['eng'] : ['kor', 'eng']);
  return groups.map((g) => g.join('+'));
}

/** 설정된 언어 그룹의 워커를 모두 준비 (언어 데이터 최초 1회 다운로드) */
export async function getOcrWorker(onProgress?: (p: number, status: string) => void): Promise<TWorker[]> {
  const keys = langGroups();
  // 설정에서 빠진 그룹 워커는 정리
  for (const [k, p] of workers) {
    if (!keys.includes(k)) {
      workers.delete(k);
      p.then((w) => w.terminate()).catch(() => {});
    }
  }
  return Promise.all(keys.map((k) => createWorker(k, onProgress)));
}

function currentLangs(): string[] {
  return useSettings.getState().settings.ocrLangs;
}

export async function terminateOcr() {
  const all = [...workers.values()];
  workers.clear();
  await Promise.all(all.map((p) => p.then((w) => w.terminate()).catch(() => {})));
}

export interface OcrResult {
  text: string;
  confidence: number;
}

type Line = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } };

/**
 * 제목 줄 고르기: 가장 큰 글자 줄을 기준으로, 비슷한 크기(≥ 70%)이고
 * 위아래로 붙어 있는 줄들을 이어 붙인다 (두 줄 제목 대응, 작은 부제·아티스트명은 제외).
 */
export function pickTitleLines(lines: Line[]): { text: string; confidence: number } | null {
  const ls = lines.filter((l) => cleanOcrTitle(l.text).length > 0).sort((a, b) => a.bbox.y0 - b.bbox.y0);
  if (!ls.length) return null;
  const h = (l: Line) => l.bbox.y1 - l.bbox.y0;
  const big = ls.reduce((a, b) => (h(b) > h(a) ? b : a));
  const H = h(big);
  const i0 = ls.indexOf(big);
  const picked = [big];
  const similar = (l: Line) => h(l) >= H * 0.7 && h(l) <= H * 1.4;
  for (let i = i0 - 1; i >= 0; i--) {
    const l = ls[i];
    if (!similar(l) || picked[0].bbox.y0 - l.bbox.y1 > H * 1.2) break;
    picked.unshift(l);
  }
  for (let i = i0 + 1; i < ls.length; i++) {
    const l = ls[i];
    const last = picked[picked.length - 1];
    if (!similar(l) || l.bbox.y0 - last.bbox.y1 > H * 1.2) break;
    picked.push(l);
  }
  const text = cleanOcrTitle(picked.map((l) => l.text).join(' '));
  const confidence = picked.reduce((a, l) => a + l.confidence, 0) / picked.length;
  return text ? { text, confidence } : null;
}

const GOOD_ENOUGH = 80;

/**
 * 전처리 방식 × 언어 그룹을 차례로 시도해 가장 신뢰도 높은 제목을 고른다.
 * 일반적인 경우(어두운 Suno 화면 + 한국어/영어)는 첫 시도에서 바로 끝난다.
 */
export async function recognizeTitle(frame: HTMLCanvasElement, roi: TitleRoi | null): Promise<OcrResult> {
  const ws = await getOcrWorker();
  let best: OcrResult = { text: '', confidence: 0 };
  // ROI 없이 전체 화면을 읽을 때는 시간이 오래 걸리므로 기본 후보만
  for (const v of roi ? PRE_VARIANTS : PRE_VARIANTS.slice(0, 2)) {
    const img = preprocess(frame, roi, v.mode, v.clear);
    for (const w of ws) {
      let lines: Line[] = [];
      try {
        const { data } = await w.recognize(img);
        lines = (data.lines ?? []) as Line[];
      } catch {
        continue;
      }
      const r = roi ? pickTitleLines(lines) : pickTitleLines(lines.filter((l) => cleanOcrTitle(l.text).length >= 2 && l.confidence > 30));
      if (r && r.confidence > best.confidence) best = r;
      if (best.confidence >= GOOD_ENOUGH) return roi ? best : { ...best, confidence: Math.min(best.confidence, 55) };
    }
  }
  return roi ? best : { text: best.text, confidence: Math.min(best.confidence, 55) };
}
