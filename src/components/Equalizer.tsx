import { useEffect, useRef } from 'react';
import { analyzeTrack, bandsAt, EQ_BANDS, type Spectrum } from '../audio/spectrum';
import { getSimpleAudioTime, useSimplePlayer } from '../audio/simplePlayer';

/**
 * 연속 듣기 이퀄라이저 (시안 A: 클래식 막대)
 * - 아래에서 올라오는 둥근 막대 28개, 보라 → 하늘색 그라데이션
 * - 화면이 보이고 재생 중일 때만 그리기, 일시정지하면 가라앉은 뒤 멈춤
 */
export function Equalizer({ height = 64 }: { height?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const track = useSimplePlayer((s) => s.tracks[s.index]);
  const playing = useSimplePlayer((s) => s.playing);
  const spec = useRef<Spectrum | null>(null);
  const level = useRef(new Float32Array(EQ_BANDS).fill(0.03));
  const target = useRef(new Float32Array(EQ_BANDS));
  const raf = useRef(0);

  // 곡이 바뀌면 분석 (캐시되면 즉시)
  useEffect(() => {
    spec.current = null;
    if (!track) return;
    let alive = true;
    analyzeTrack(track.id, track.url, track.size).then((s) => {
      if (alive) spec.current = s;
    });
    return () => {
      alive = false;
    };
  }, [track?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let w = 0;
    let h = 0;
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = c.getBoundingClientRect();
      w = r.width;
      h = r.height;
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(c);

    let last = 0;
    const draw = (now: number) => {
      raf.current = 0;
      if (document.hidden) return; // 화면이 안 보이면 그리지 않음 (visibilitychange에서 재개)
      if (reduce && now - last < 100) {
        raf.current = requestAnimationFrame(draw);
        return;
      }
      last = now;
      const lv = level.current;
      const tg = target.current;
      const isPlaying = useSimplePlayer.getState().playing;
      if (isPlaying && spec.current) bandsAt(spec.current, getSimpleAudioTime(), tg);
      else tg.fill(isPlaying ? 0.06 : 0.03);
      let moving = false;
      for (let i = 0; i < EQ_BANDS; i++) {
        const d = tg[i] - lv[i];
        lv[i] += d * (d > 0 ? 0.55 : 0.18); // 빠르게 올라가고 천천히 내려감
        if (Math.abs(d) > 0.004) moving = true;
      }
      ctx.clearRect(0, 0, w, h);
      const g = ctx.createLinearGradient(0, h, 0, 0);
      g.addColorStop(0, '#7c5cff');
      g.addColorStop(1, '#22d3ee');
      ctx.fillStyle = g;
      const gap = w * 0.012;
      const bw = (w - gap * (EQ_BANDS - 1)) / EQ_BANDS;
      for (let i = 0; i < EQ_BANDS; i++) {
        const bh = Math.max(3, lv[i] * h);
        const x = i * (bw + gap);
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, h - bh, bw, bh, Math.min(bw / 2, bh / 2));
        else ctx.rect(x, h - bh, bw, bh);
        ctx.fill();
      }
      // 재생 중이거나 아직 가라앉는 중일 때만 다음 프레임
      if (isPlaying || moving) raf.current = requestAnimationFrame(draw);
    };
    const kick = () => {
      if (!raf.current && !document.hidden) raf.current = requestAnimationFrame(draw);
    };
    kick();
    document.addEventListener('visibilitychange', kick);
    (c as any).__kick = kick;
    return () => {
      ro.disconnect();
      document.removeEventListener('visibilitychange', kick);
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
  }, []);

  // 재생/일시정지가 바뀌면 그리기 재개
  useEffect(() => {
    (canvas.current as any)?.__kick?.();
  }, [playing, track?.id]);

  return <canvas ref={canvas} className="mb-3 block w-full" style={{ height }} role="img" aria-label="이퀄라이저" />;
}
