import type { TitleRoi } from '../types';

/**
 * 전처리 방식
 * - binary : 그레이스케일 → 대비 강화 → (어두운 화면이면) 반전 → Otsu 이진화  (어두운 배경 + 밝은 글자, 일반적인 Suno 화면)
 * - gray   : 그레이스케일 + 대비 강화만 (Tesseract 자체 이진화에 맡김)
 * - white  : '거의 흰색' 픽셀만 글자로 — 밝은 파스텔 배경 위 흰 글자(테두리 글씨) 대응
 * - dark   : '어두운' 픽셀만 글자로 — 밝은 배경 위 어두운 글자
 */
export type PreMode = 'binary' | 'binary-inv' | 'gray' | 'white' | 'dark';
/** clear: selective = 큰 덩어리만 지움(가장자리 글자 조각 보존), all = 가장자리와 이어진 것 모두 지움 */
export type ClearMode = 'selective' | 'all';
export interface PreVariant {
  mode: PreMode;
  clear: ClearMode;
}
/** 시도 순서: 일반 Suno 화면(어두운 배경 + 밝은 글자)용이 먼저, 나머지는 신뢰도가 낮을 때만 */
export const PRE_VARIANTS: PreVariant[] = [
  { mode: 'binary', clear: 'selective' },
  { mode: 'binary-inv', clear: 'all' },
  { mode: 'white', clear: 'all' },
  { mode: 'binary', clear: 'all' },
  { mode: 'binary-inv', clear: 'selective' },
  { mode: 'white', clear: 'selective' },
  { mode: 'dark', clear: 'selective' },
  { mode: 'gray', clear: 'selective' },
];
export const PRE_MODES: PreMode[] = ['binary', 'white', 'binary-inv', 'dark', 'gray'];

/**
 * 테두리 지우기: 이미지 가장자리와 이어진 검은(글자색) 덩어리 중 '큰 것'만 흰색으로 지운다.
 * 글자 주변 후광(glow)·배경·머리카락 같은 큰 영역은 지우고,
 * ROI 가장자리에 살짝 걸친 글자 조각(예: g의 꼬리)은 남긴다.
 */
export function clearBorder(bin: Uint8Array, w: number, h: number, all = false) {
  const seen = new Uint8Array(bin.length);
  const area = w * h;
  const comp: number[] = [];
  const flood = (start: number) => {
    comp.length = 0;
    let minX = w, maxX = 0, minY = h, maxY = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      comp.push(i);
      const x = i % w;
      const y = (i - x) / w;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of nb) if (j >= 0 && !seen[j] && bin[j] === 0) {
        seen[j] = 1;
        stack.push(j);
      }
    }
    const big = all || comp.length > area * 0.02 || maxX - minX > w * 0.5 || maxY - minY > h * 0.6;
    if (big) for (const i of comp) bin[i] = 255;
  };
  const tryAt = (i: number) => {
    if (bin[i] === 0 && !seen[i]) flood(i);
  };
  for (let x = 0; x < w; x++) {
    tryAt(x);
    tryAt((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    tryAt(y * w);
    tryAt(y * w + w - 1);
  }
}

function otsu(hist: Uint32Array, n: number): number {
  let total = 0;
  for (let i = 0; i < 256; i++) total += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (total - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      thr = t;
    }
  }
  return thr;
}

/** ROI 크롭(+업스케일) 후 모드별 처리. 결과는 흰 바탕 검은 글자 */
export function preprocess(src: HTMLCanvasElement, roi: TitleRoi | null, mode: PreMode = 'binary', clear: ClearMode = 'selective'): HTMLCanvasElement {
  const r = roi ?? { x: 0, y: 0, w: 1, h: 1 };
  const sx = Math.round(r.x * src.width);
  const sy = Math.round(r.y * src.height);
  const sw = Math.max(1, Math.round(r.w * src.width));
  const sh = Math.max(1, Math.round(r.h * src.height));
  // 작은 ROI는 2배, 큰 영역은 원본 크기 (최대 폭 2000px)
  const scale = Math.min(roi ? 2 : 1, 2000 / sw);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * scale));
  c.height = Math.max(1, Math.round(sh * scale));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const n = c.width * c.height;
  const g = new Uint8ClampedArray(n);
  const hist = new Uint32Array(256);

  if (mode === 'white' || mode === 'dark') {
    // white: min(R,G,B) — 흰 글자만 높음(파스텔 배경은 한 채널이 낮음)
    // dark : 255 - max(R,G,B) — 어두운 글자만 높음
    for (let i = 0; i < n; i++) {
      const R = d[i * 4];
      const G = d[i * 4 + 1];
      const B = d[i * 4 + 2];
      g[i] = mode === 'white' ? Math.min(R, G, B) : 255 - Math.max(R, G, B);
      hist[g[i]]++;
    }
    const thr = otsu(hist, n);
    const bin = new Uint8Array(n);
    for (let i = 0; i < n; i++) bin[i] = g[i] > thr ? 0 : 255; // 글자 → 검정
    return writeBin(ctx, img, bin, c, clear);
  }

  let sum = 0;
  let mn = 255;
  let mx = 0;
  for (let i = 0; i < n; i++) {
    const v = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    g[i] = v;
    sum += v;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  const darkUi = sum / n < 128;
  const range = Math.max(1, mx - mn);
  for (let i = 0; i < n; i++) {
    let v = ((g[i] - mn) * 255) / range; // 대비 스트레치
    if (darkUi) v = 255 - v;
    g[i] = v;
    hist[g[i]]++;
  }
  if (mode === 'gray') {
    for (let i = 0; i < n; i++) {
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = g[i];
      d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }
  const thr = otsu(hist, n);
  const inv = mode === 'binary-inv';
  const bin = new Uint8Array(n);
  for (let i = 0; i < n; i++) bin[i] = (g[i] > thr) !== inv ? 255 : 0;
  return writeBin(ctx, img, bin, c, clear);
}

/** 글자 줄 높이 추정: 검은 픽셀이 있는 행들의 연속 구간(줄) 높이의 중앙값 */
export function estimateLineHeight(bin: Uint8Array, w: number, h: number): number {
  const bands: number[] = [];
  let run = 0;
  const minBlack = Math.max(2, w * 0.004);
  for (let y = 0; y < h; y++) {
    let cnt = 0;
    for (let x = 0, o = y * w; x < w; x++) if (bin[o + x] === 0) cnt++;
    if (cnt >= minBlack) run++;
    else {
      if (run >= 8) bands.push(run);
      run = 0;
    }
  }
  if (run >= 8) bands.push(run);
  if (!bands.length) return 0;
  // 잡음 띠보다 실제 글자 줄을 반영하도록 상위 25% 지점 사용
  bands.sort((a, b) => a - b);
  return bands[Math.floor(bands.length * 0.75)];
}

const TARGET_LINE = 48; // Tesseract LSTM이 잘 읽는 글자 높이(px) 근처

function writeBin(ctx: CanvasRenderingContext2D, img: ImageData, bin: Uint8Array, c: HTMLCanvasElement, clear: ClearMode) {
  const n = bin.length;
  // 가장자리와 이어진 덩어리(배경·후광·머리카락)를 지우고, 글자가 너무 적게 남으면 원래대로
  const cleared = bin.slice();
  clearBorder(cleared, c.width, c.height, clear === 'all');
  let black = 0;
  for (let i = 0; i < n; i++) if (cleared[i] === 0) black++;
  const use = black > n * 0.005 ? cleared : bin;
  const d = img.data;
  for (let i = 0; i < n; i++) {
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = use[i];
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // 글자 크기 정규화: 줄 높이가 너무 크거나 작으면 ~48px로 맞춘다
  const lh = estimateLineHeight(use, c.width, c.height);
  // 큰 글자만 축소한다 (작은 글자는 ROI 단계에서 이미 2배 확대됨)
  if (lh > TARGET_LINE * 1.8) {
    const k = Math.max(0.1, TARGET_LINE / lh);
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(c.width * k));
    out.height = Math.max(1, Math.round(c.height * k));
    const o = out.getContext('2d')!;
    o.fillStyle = '#fff';
    o.fillRect(0, 0, out.width, out.height);
    o.imageSmoothingQuality = 'high';
    o.drawImage(c, 0, 0, out.width, out.height);
    // 가장자리 여백 (Tesseract는 글자가 테두리에 붙으면 약함)
    const pad = document.createElement('canvas');
    pad.width = out.width + 40;
    pad.height = out.height + 40;
    const pc = pad.getContext('2d')!;
    pc.fillStyle = '#fff';
    pc.fillRect(0, 0, pad.width, pad.height);
    pc.drawImage(out, 20, 20);
    return pad;
  }
  return c;
}
