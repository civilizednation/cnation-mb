import type { TitleRoi } from '../types';

/** ROI 크롭 → 2배 업스케일 → 그레이스케일 → 대비 강화 → (다크 UI면) 반전 → 이진화(Otsu) */
export function preprocess(src: HTMLCanvasElement, roi: TitleRoi | null): HTMLCanvasElement {
  const r = roi ?? { x: 0, y: 0, w: 1, h: 1 };
  const sx = Math.round(r.x * src.width);
  const sy = Math.round(r.y * src.height);
  const sw = Math.max(1, Math.round(r.w * src.width));
  const sh = Math.max(1, Math.round(r.h * src.height));
  const scale = roi ? 2 : 1;
  const c = document.createElement('canvas');
  c.width = sw * scale;
  c.height = sh * scale;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const n = c.width * c.height;
  const g = new Uint8ClampedArray(n);
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
  const dark = sum / n < 128;
  const range = Math.max(1, mx - mn);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    let v = ((g[i] - mn) * 255) / range; // 대비 스트레치
    if (dark) v = 255 - v;
    g[i] = v;
    hist[g[i]]++;
  }
  // Otsu
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
  for (let i = 0; i < n; i++) {
    const v = g[i] > thr ? 255 : 0;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
