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
    const b = findBoundsInRegion(samples, sampleRate, env, mask, r.from, r.to, Math.max(r.to, nextFirst - 1), p);
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
