import { describe, it, expect } from 'vitest';
import { splitSongs, detectBounds, silentMask, computeEnvelope } from '../src/audio/analyze/silence';
import { DEFAULT_SILENCE } from '../src/types';

const SR = 8000;

/** 테스트용 신호 생성: [{type:'sil'|'tone'|'click'|'fade', sec}] */
function build(parts: { t: 'sil' | 'tone' | 'click' | 'fade' | 'quiet'; s: number }[]) {
  const total = parts.reduce((a, p) => a + Math.round(p.s * SR), 0);
  const x = new Float32Array(total);
  let o = 0;
  const marks: number[] = [];
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (const p of parts) {
    const n = Math.round(p.s * SR);
    marks.push(o / SR);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      if (p.t === 'tone') x[o + i] = 0.3 * Math.sin(2 * Math.PI * 440 * t) + 0.05 * rnd();
      else if (p.t === 'click') x[o + i] = 0.5 * rnd();
      else if (p.t === 'fade') x[o + i] = 0.3 * Math.pow(10, (-60 * (i / n)) / 20) * Math.sin(2 * Math.PI * 440 * t) * (i / n < 0.9 ? 1 : 1);
      else if (p.t === 'quiet') x[o + i] = 0.0001 * rnd();
      else x[o + i] = 0.00001 * rnd();
    }
    o += n;
  }
  return { x, marks };
}

describe('silentMask', () => {
  it('merges short clicks inside silence', () => {
    const { x } = build([{ t: 'sil', s: 2 }, { t: 'click', s: 0.1 }, { t: 'sil', s: 2 }, { t: 'tone', s: 5 }]);
    const env = computeEnvelope(x, SR, 20);
    const m = silentMask(env, -50, 15);
    // click region (~2.0~2.1s → windows 100~105) should be silent
    expect(m[102]).toBe(1);
    expect(m[230]).toBe(0);
  });
});

describe('splitSongs', () => {
  const song = (s: number) => [{ t: 'tone' as const, s }, { t: 'fade' as const, s: 2 }];

  it('splits 4 songs exactly with song count and trims lead/tail', () => {
    const { x, marks } = build([
      { t: 'sil', s: 5 },
      ...song(40),
      { t: 'sil', s: 3 },
      ...song(35),
      { t: 'sil', s: 2.5 },
      ...song(45),
      { t: 'sil', s: 4 },
      ...song(38),
      { t: 'sil', s: 8 },
    ]);
    const r = splitSongs(x, SR, DEFAULT_SILENCE, 4);
    expect(r.songs).toHaveLength(4);
    const starts = [marks[1], marks[4], marks[7], marks[10]];
    r.songs.forEach((s, i) => {
      expect(Math.abs(s.srcStartSec - starts[i])).toBeLessThan(0.02);
      // 꼬리(fade 2s)를 포함해야 함: fade 시작점 이후로 끝나야
      const fadeStart = marks[2 + i * 3];
      expect(s.srcEndSec).toBeGreaterThan(fadeStart + 1.0);
    });
    expect(r.songs[0].srcStartSec).toBeGreaterThan(4.9);
  });

  it('ignores a mid-song break shorter than real gaps when count given', () => {
    const { x } = build([
      { t: 'sil', s: 3 },
      { t: 'tone', s: 30 },
      { t: 'sil', s: 1.2 }, // 곡 중간 브레이크
      { t: 'tone', s: 30 },
      { t: 'sil', s: 3 },
      { t: 'tone', s: 50 },
      { t: 'sil', s: 3 },
    ]);
    const r = splitSongs(x, SR, DEFAULT_SILENCE, 2);
    expect(r.songs).toHaveLength(2);
    expect(r.songs[0].srcEndSec).toBeGreaterThan(60);
  });

  it('auto mode merges fragments shorter than minSongSec', () => {
    const { x } = build([
      { t: 'sil', s: 3 },
      { t: 'tone', s: 60 },
      { t: 'sil', s: 3 },
      { t: 'tone', s: 5 }, // 짧은 잡음 덩어리
      { t: 'sil', s: 2.5 },
      { t: 'tone', s: 60 },
      { t: 'sil', s: 3 },
    ]);
    const r = splitSongs(x, SR, DEFAULT_SILENCE, null);
    expect(r.songs).toHaveLength(2);
  });

  it('warns when not enough boundaries', () => {
    const { x } = build([{ t: 'sil', s: 2 }, { t: 'tone', s: 40 }, { t: 'sil', s: 2 }]);
    const r = splitSongs(x, SR, DEFAULT_SILENCE, 3);
    expect(r.songs.length).toBe(1);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('detectBounds', () => {
  it('finds first sound within 10ms', () => {
    const { x, marks } = build([{ t: 'sil', s: 1.234 }, { t: 'tone', s: 10 }, { t: 'fade', s: 2 }, { t: 'sil', s: 3 }]);
    const b = detectBounds(x, SR, DEFAULT_SILENCE);
    expect(Math.abs(b.startSec - marks[1])).toBeLessThan(0.01);
    expect(b.endSec).toBeGreaterThan(marks[2] + 1);
    expect(b.endSec).toBeLessThan(marks[3] + 0.5);
  });
});
