import type { SilenceParams } from '../../types';

export interface DetectedSong {
  srcStartSec: number;
  srcEndSec: number;
  needsReview: boolean;
}

export interface SplitResult {
  songs: DetectedSong[];
  /** 채택된 경계 무음 구간 (초) */
  boundaries: { startSec: number; endSec: number }[];
  warnings: string[];
  durationSec: number;
}

const toDb = (rms: number) => (rms > 1e-10 ? 20 * Math.log10(rms) : -200);

/** 창(windowMs)마다 RMS → dBFS */
export function computeEnvelope(samples: Float32Array, sampleRate: number, windowMs: number): Float32Array {
  const win = Math.max(1, Math.round((sampleRate * windowMs) / 1000));
  const n = Math.ceil(samples.length / win);
  const env = new Float32Array(n);
  for (let w = 0; w < n; w++) {
    const a = w * win;
    const b = Math.min(samples.length, a + win);
    let sum = 0;
    for (let i = a; i < b; i++) sum += samples[i] * samples[i];
    env[w] = toDb(Math.sqrt(sum / Math.max(1, b - a)));
  }
  return env;
}

/**
 * 임계값 미만이면 silent. 무음 사이(또는 파일 가장자리와 무음 사이)에 낀
 * clickMaxWin 이하 길이의 짧은 소리는 무음으로 병합한다.
 */
export function silentMask(env: Float32Array, thresholdDb: number, clickMaxWin: number): Uint8Array {
  const n = env.length;
  const m = new Uint8Array(n);
  for (let i = 0; i < n; i++) m[i] = env[i] < thresholdDb ? 1 : 0;
  let i = 0;
  while (i < n) {
    if (m[i] === 1) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && m[j] === 0) j++;
    const len = j - i;
    const leftSilent = i === 0 || m[i - 1] === 1;
    const rightSilent = j === n || m[j] === 1;
    const touchesBothEdges = i === 0 && j === n;
    if (len <= clickMaxWin && leftSilent && rightSilent && !touchesBothEdges) {
      for (let k = i; k < j; k++) m[k] = 1;
    }
    i = j;
  }
  return m;
}

export interface Run {
  start: number; // window index (inclusive)
  end: number; // window index (exclusive)
}

export function runsOf(mask: Uint8Array, value: number): Run[] {
  const runs: Run[] = [];
  let i = 0;
  while (i < mask.length) {
    if (mask[i] !== value) {
      i++;
      continue;
    }
    let j = i;
    while (j < mask.length && mask[j] === value) j++;
    runs.push({ start: i, end: j });
    i = j;
  }
  return runs;
}

/**
 * 구간 [a, b)에서 가장 조용한 부분(최솟값 +3dB 이내)의 가운데 창.
 * 두 곡 사이 경계에서 앞 곡 꼬리와 다음 곡 도입부를 가르는 기준점으로 쓴다.
 */
export function quietMidpoint(env: Float32Array, a: number, b: number): number {
  if (b <= a) return a;
  let mn = Infinity;
  for (let w = a; w < b; w++) if (env[w] < mn) mn = env[w];
  let first = -1;
  let last = -1;
  for (let w = a; w < b; w++)
    if (env[w] <= mn + 3) {
      if (first < 0) first = w;
      last = w;
    }
  return Math.round((first + last) / 2);
}

export interface EdgeTrim {
  /** 녹화 시작 시 이미 나오던 이전 곡 꼬리 — 이 창 이전은 무시 (없으면 0) */
  headCut: number;
  /** 녹화를 끄기 직전 시작된 다음 곡 도입부 — 이 창부터는 무시 (없으면 n) */
  tailCut: number;
  headSec: number;
  tailSec: number;
}

/**
 * 녹화 가장자리에 걸린 다른 곡 조각을 찾아 무음으로 바꾼다 (mask 수정).
 * - 끝: 소리가 녹화 끝까지 이어지는데(끝에 무음 없음) 그 조각이 짧고(≤15s) 앞에 0.5s 이상 무음이 있으면
 *   → Suno 자동 재생 등으로 녹화된 "다음 곡 도입부"로 보고 제외
 * - 처음: 녹화 시작부터 소리가 나는 짧은 조각 뒤에 0.5s 이상 무음 → "이전 곡 꼬리"로 보고 제외
 * 녹화 끝/처음에 딱 붙어 있는 조각만 대상이라, 곡 안의 극적인 쉼(쉼 → 마지막 화음 → 무음)은 건드리지 않는다.
 */
export function trimEdgeFragments(env: Float32Array, mask: Uint8Array, p: SilenceParams): EdgeTrim {
  const n = mask.length;
  const winSec = p.windowMs / 1000;
  const gapMin = Math.max(1, Math.round(0.5 / winSec));
  const fragMax = Math.round(15 / winSec);
  const res: EdgeTrim = { headCut: 0, tailCut: n, headSec: 0, tailSec: 0 };
  if (n < 4) return res;

  // 끝 조각
  if (mask[n - 1] === 0) {
    let w = n - 1;
    let silentRun = 0;
    let gapStart = -1;
    for (; w >= 0 && n - 1 - w <= fragMax + gapMin; w--) {
      if (mask[w] === 1) {
        silentRun++;
        if (silentRun >= gapMin) {
          // 무음 구간의 시작까지 이어서 찾기
          let s = w;
          while (s > 0 && mask[s - 1] === 1) s--;
          gapStart = s;
          break;
        }
      } else silentRun = 0;
    }
    if (gapStart >= 0) {
      const fragStart = w + silentRun; // 조각 시작 = 무음 끝
      let gapEnd = fragStart;
      while (gapEnd < n && mask[gapEnd] === 1) gapEnd++;
      let soundBefore = false;
      for (let k = 0; k < gapStart; k++)
        if (mask[k] === 0) {
          soundBefore = true;
          break;
        }
      if (soundBefore && n - gapEnd <= fragMax) {
        for (let k = gapEnd; k < n; k++) mask[k] = 1;
        res.tailCut = quietMidpoint(env, gapStart, gapEnd);
        res.tailSec = (n - gapEnd) * winSec;
      }
    }
  }

  // 처음 조각
  if (mask[0] === 0) {
    let w = 0;
    let silentRun = 0;
    let gapEnd = -1;
    for (; w < n && w <= fragMax + gapMin; w++) {
      if (mask[w] === 1) {
        silentRun++;
        if (silentRun >= gapMin) {
          let e = w;
          while (e + 1 < n && mask[e + 1] === 1) e++;
          gapEnd = e + 1;
          break;
        }
      } else silentRun = 0;
    }
    if (gapEnd >= 0) {
      let gapStart = gapEnd;
      while (gapStart > 0 && mask[gapStart - 1] === 1) gapStart--;
      let soundAfter = false;
      for (let k = gapEnd; k < n; k++)
        if (mask[k] === 0) {
          soundAfter = true;
          break;
        }
      if (soundAfter && gapStart <= fragMax) {
        for (let k = 0; k < gapStart; k++) mask[k] = 1;
        res.headCut = quietMidpoint(env, gapStart, gapEnd);
        res.headSec = gapStart * winSec;
      }
    }
  }
  return res;
}

/** 구간 [fromWin, toWin) 안에서 곡의 시작/끝을 찾는다 (초 단위). */
export function findBoundsInRegion(
  samples: Float32Array,
  sampleRate: number,
  env: Float32Array,
  mask: Uint8Array,
  fromWin: number,
  toWin: number,
  tailLimitWin: number,
  p: SilenceParams,
): { startSec: number; endSec: number } | null {
  const win = Math.max(1, Math.round((sampleRate * p.windowMs) / 1000));
  let first = -1;
  let last = -1;
  for (let w = fromWin; w < toWin; w++) {
    if (mask[w] === 0) {
      if (first < 0) first = w;
      last = w;
    }
  }
  if (first < 0) return null;

  // 시작점 정밀화: 앞 창 포함, 원본 샘플에서 |x| ≥ 10^(silenceDb/20)인 첫 샘플
  const thr = Math.pow(10, p.silenceDb / 20);
  const a = Math.max(0, (first - 1) * win);
  const b = Math.min(samples.length, (first + 1) * win);
  let startSample = first * win;
  for (let i = a; i < b; i++) {
    if (Math.abs(samples[i]) >= thr) {
      startSample = i;
      break;
    }
  }

  // 끝점: 마지막 소리 창에서 이어지는 tailDb 이상 꼬리 (짧은 dip 허용) + 0.3s
  const clickWin = Math.max(1, Math.round(p.clickMaxMs / p.windowMs));
  let tail = last;
  let w = last + 1;
  let dip = 0;
  while (w < tailLimitWin) {
    if (env[w] >= p.tailDb) {
      tail = w;
      dip = 0;
    } else {
      dip++;
      if (dip > clickWin) break;
    }
    w++;
  }
  const limitSec = (tailLimitWin * win) / sampleRate;
  const endSec = Math.min(((tail + 1) * win) / sampleRate + 0.3, limitSec, samples.length / sampleRate);
  return { startSec: startSample / sampleRate, endSec };
}

/** 개별 파일: 앞뒤 무음 제거 (곡 분리 없음) */
export function detectBounds(
  samples: Float32Array,
  sampleRate: number,
  p: SilenceParams,
): { startSec: number; endSec: number } {
  const env = computeEnvelope(samples, sampleRate, p.windowMs);
  const clickWin = Math.max(1, Math.round(p.clickMaxMs / p.windowMs));
  const mask = silentMask(env, p.silenceDb, clickWin);
  const r = findBoundsInRegion(samples, sampleRate, env, mask, 0, env.length, env.length, p);
  return r ?? { startSec: 0, endSec: samples.length / sampleRate };
}

/**
 * 녹화 오디오에서 곡 분리.
 * @param songCount 곡 수(2~8). null/0이면 자동.
 */
export function splitSongs(
  samples: Float32Array,
  sampleRate: number,
  p: SilenceParams,
  songCount?: number | null,
): SplitResult {
  const durationSec = samples.length / sampleRate;
  const winSec = p.windowMs / 1000;
  const env = computeEnvelope(samples, sampleRate, p.windowMs);
  const clickWin = Math.max(1, Math.round(p.clickMaxMs / p.windowMs));
  const mask = silentMask(env, p.silenceDb, clickWin);
  const warnings: string[] = [];
  const n = env.length;
  // 녹화 끝/처음에 걸린 다른 곡 조각 제외 (예: 녹화를 끄기 전 Suno가 다음 곡을 자동 재생)
  const edge = trimEdgeFragments(env, mask, p);
  if (edge.tailSec > 0) warnings.push(`녹화 끝에 다른 곡의 시작 부분(약 ${edge.tailSec.toFixed(1)}초)이 있어 제외했어요.`);
  if (edge.headSec > 0) warnings.push(`녹화 처음에 이전 곡의 끝부분(약 ${edge.headSec.toFixed(1)}초)이 있어 제외했어요.`);

  const silences = runsOf(mask, 1);
  // 맨 앞/맨 뒤 무음(녹화 여유)은 후보 제외
  const internal = silences.filter((r) => r.start > 0 && r.end < n);
  const lenSec = (r: Run) => (r.end - r.start) * winSec;

  let chosen: Run[] = [];
  let lowConfidence = new Set<Run>();

  if (songCount && songCount >= 2) {
    const need = songCount - 1;
    const sorted = [...internal].sort((x, y) => lenSec(y) - lenSec(x));
    const strong = sorted.filter((r) => lenSec(r) >= p.minGapSec);
    if (strong.length >= need) {
      chosen = strong.slice(0, need);
    } else {
      chosen = sorted.slice(0, need);
      if (chosen.length < need) {
        warnings.push(
          `곡 경계 후보가 부족합니다 (요청 ${songCount}곡, 감지 ${chosen.length + 1}곡). 파형에서 경계를 추가해 주세요.`,
        );
      } else {
        warnings.push(`일부 경계의 무음이 ${p.minGapSec}초보다 짧습니다. 확인해 주세요.`);
      }
      for (const r of chosen) if (lenSec(r) < p.minGapSec) lowConfidence.add(r);
    }
    // 신뢰도: 채택된 가장 짧은 경계와 탈락한 가장 긴 후보의 길이 차이가 작으면 확인 필요
    const rest = sorted.filter((r) => !chosen.includes(r));
    if (chosen.length && rest.length) {
      const weakest = chosen.reduce((a, b) => (lenSec(a) < lenSec(b) ? a : b));
      const runnerUp = rest[0];
      if (lenSec(runnerUp) >= p.minGapSec && lenSec(weakest) - lenSec(runnerUp) < 0.5) {
        lowConfidence.add(weakest);
        warnings.push('경계 무음 길이가 비슷한 후보가 있어 확인이 필요합니다.');
      }
    }
  } else {
    const autoMin = Math.max(2.0, p.minGapSec);
    chosen = internal.filter((r) => lenSec(r) >= autoMin);
  }
  chosen.sort((a, b) => a.start - b.start);

  // 경계로 구간 나누기
  const regionsOf = (bs: Run[]) => {
    const regions: { from: number; to: number; prevB?: Run; nextB?: Run }[] = [];
    let from = 0;
    for (let i = 0; i <= bs.length; i++) {
      const to = i < bs.length ? bs[i].start : n;
      regions.push({ from, to, prevB: bs[i - 1], nextB: bs[i] });
      if (i < bs.length) from = bs[i].end;
    }
    return regions;
  };

  // 자동 모드: minSongSec 미만 조각은 인접 곡에 병합 (더 짧은 쪽 경계 제거)
  if (!(songCount && songCount >= 2)) {
    let changed = true;
    while (changed && chosen.length) {
      changed = false;
      const regions = regionsOf(chosen);
      for (let i = 0; i < regions.length; i++) {
        const r = regions[i];
        let soundWins = 0;
        let f = -1;
        let l = -1;
        for (let w = r.from; w < r.to; w++)
          if (mask[w] === 0) {
            soundWins++;
            if (f < 0) f = w;
            l = w;
          }
        const span = f < 0 ? 0 : (l - f + 1) * winSec;
        if (span < p.minSongSec) {
          // 소리가 아예 없는 조각(앞/뒤 여유)은 경계 제거로 흡수
          const cands = [r.prevB, r.nextB].filter(Boolean) as Run[];
          if (!cands.length) break;
          const drop = cands.reduce((a, b) => (lenSec(a) <= lenSec(b) ? a : b));
          chosen = chosen.filter((x) => x !== drop);
          changed = true;
          break;
        }
      }
    }
  }

  const regions = regionsOf(chosen);
  const songs: DetectedSong[] = [];
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i];
    const tailLimit = i + 1 < regions.length ? regions[i + 1].from : n;
    // 다음 곡의 첫 소리 이전까지 꼬리 탐색 허용
    let nextFirst = tailLimit;
    if (i + 1 < regions.length) {
      for (let w = regions[i + 1].from; w < regions[i + 1].to; w++)
        if (mask[w] === 0) {
          nextFirst = w;
          break;
        }
    }
    // 앞 곡 꼬리는 두 곡 사이에서 가장 조용한 구간의 가운데까지만 (다음 곡의 작은 도입부가 붙지 않게)
    const cap =
      i + 1 < regions.length
        ? Math.max(r.to, quietMidpoint(env, r.to, Math.max(r.to + 1, nextFirst)))
        : Math.min(n, edge.tailCut);
    const b = findBoundsInRegion(samples, sampleRate, env, mask, Math.max(r.from, i === 0 ? edge.headCut : 0), r.to, cap, p);
    if (!b) continue;
    const review = (r.prevB && lowConfidence.has(r.prevB)) || (r.nextB && lowConfidence.has(r.nextB)) || false;
    songs.push({ srcStartSec: b.startSec, srcEndSec: b.endSec, needsReview: review });
  }

  if (songCount && songCount >= 2 && songs.length !== songCount) {
    warnings.push(`감지된 곡 수(${songs.length})가 입력값(${songCount})과 다릅니다.`);
  }
  if (!songs.length) warnings.push('소리가 감지되지 않았습니다. 오디오가 없는 녹화인지 확인하세요.');

  return {
    songs,
    boundaries: chosen.map((r) => ({ startSec: r.start * winSec, endSec: r.end * winSec })),
    warnings: Array.from(new Set(warnings)),
    durationSec,
  };
}

/** 사용자가 직접 지정한 경계(초)로 곡 시작/끝 재계산 */
export function boundsForRegions(
  samples: Float32Array,
  sampleRate: number,
  p: SilenceParams,
  cutsSec: number[],
): DetectedSong[] {
  const env = computeEnvelope(samples, sampleRate, p.windowMs);
  const clickWin = Math.max(1, Math.round(p.clickMaxMs / p.windowMs));
  const mask = silentMask(env, p.silenceDb, clickWin);
  const winSec = p.windowMs / 1000;
  const cuts = [...cutsSec].sort((a, b) => a - b).map((c) => Math.round(c / winSec));
  const edges = [0, ...cuts, env.length];
  const out: DetectedSong[] = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    const b = findBoundsInRegion(samples, sampleRate, env, mask, edges[i], edges[i + 1], edges[i + 1], p);
    if (b) out.push({ srcStartSec: b.startSec, srcEndSec: b.endSec, needsReview: false });
  }
  return out;
}

/** 파형 미리보기용 peaks (최대 절대값) */
export function computePeaks(samples: Float32Array, points = 2000): Float32Array {
  const n = Math.max(1, Math.min(points, samples.length));
  const out = new Float32Array(n);
  const step = samples.length / n;
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * step);
    const b = Math.min(samples.length, Math.floor((i + 1) * step));
    let m = 0;
    for (let j = a; j < b; j++) {
      const v = Math.abs(samples[j]);
      if (v > m) m = v;
    }
    out[i] = m;
  }
  return out;
}

/** 다채널 → mono 평균 */
export function downmix(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const n = channels[0].length;
  const out = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i];
  const k = 1 / channels.length;
  for (let i = 0; i < n; i++) out[i] *= k;
  return out;
}
