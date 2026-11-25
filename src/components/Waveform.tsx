import { useCallback, useEffect, useRef, useState } from 'react';

export interface WaveSong {
  start: number;
  end: number;
  review?: boolean;
  enabled?: boolean;
}

const COLORS = ['#7c5cff', '#22d3ee', '#f472b6', '#34d399', '#fbbf24', '#fb7185', '#60a5fa', '#a3e635'];

/**
 * 전체 파형 + 곡 구간 색상 밴드 + 시작(▶)/끝(■) 마커 드래그.
 * 줌(버튼/핀치) 시 가로 스크롤.
 */
export function Waveform({
  peaks,
  duration,
  songs,
  selected,
  onSelect,
  onMarker,
  onMarkerEnd,
  onTap,
  cursor,
}: {
  peaks: Float32Array;
  duration: number;
  songs: WaveSong[];
  selected: number;
  onSelect: (i: number) => void;
  onMarker: (i: number, which: 'start' | 'end', t: number) => void;
  onMarkerEnd?: (i: number, which: 'start' | 'end', t: number) => void;
  onTap?: (t: number) => void;
  cursor?: number | null;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [w, setW] = useState(320);
  const H = 150;
  const drag = useRef<{ i: number; which: 'start' | 'end' } | null>(null);
  const pinch = useRef<{ d: number; z: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const tapStart = useRef<{ x: number; t: number } | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const width = Math.round(w * zoom);
  const tToX = useCallback((t: number) => (t / Math.max(0.001, duration)) * width, [duration, width]);
  const xToT = useCallback((x: number) => Math.max(0, Math.min(duration, (x / width) * duration)), [duration, width]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = width * dpr;
    c.height = H * dpr;
    c.style.width = `${width}px`;
    c.style.height = `${H}px`;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, H);
    // 곡 밴드
    songs.forEach((s, i) => {
      const x0 = tToX(s.start);
      const x1 = tToX(s.end);
      ctx.fillStyle = COLORS[i % COLORS.length] + (s.enabled === false ? '10' : i === selected ? '40' : '22');
      ctx.fillRect(x0, 0, Math.max(1, x1 - x0), H);
    });
    // 파형
    const mid = H / 2;
    ctx.fillStyle = '#cbd5e1';
    const n = peaks.length;
    for (let x = 0; x < width; x++) {
      const a = Math.floor((x / width) * n);
      const b = Math.max(a + 1, Math.floor(((x + 1) / width) * n));
      let m = 0;
      for (let i = a; i < b && i < n; i++) if (peaks[i] > m) m = peaks[i];
      const h = Math.max(1, Math.sqrt(m) * (H / 2 - 14));
      ctx.fillRect(x, mid - h, 1, h * 2);
    }
    // 마커
    songs.forEach((s, i) => {
      const col = COLORS[i % COLORS.length];
      const x0 = tToX(s.start);
      const x1 = tToX(s.end);
      ctx.fillStyle = col;
      ctx.fillRect(x0 - 1, 0, 2, H);
      ctx.fillRect(x1 - 1, 0, 2, H);
      // ▶
      ctx.beginPath();
      ctx.moveTo(x0, 2);
      ctx.lineTo(x0 + 12, 9);
      ctx.lineTo(x0, 16);
      ctx.fill();
      // ■
      ctx.fillRect(x1 - 10, H - 14, 10, 10);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px system-ui';
      ctx.fillText(String(i + 1), x0 + 4, 30);
      if (s.review) {
        ctx.fillStyle = '#fbbf24';
        ctx.fillText('!', x0 + 4, 44);
      }
    });
    if (cursor != null) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(tToX(cursor), 0, 1, H);
    }
  }, [peaks, songs, selected, width, tToX, cursor]);

  const localX = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return e.clientX - r.left;
  };

  const hit = (x: number) => {
    let best: { i: number; which: 'start' | 'end'; d: number } | null = null;
    songs.forEach((s, i) => {
      for (const which of ['start', 'end'] as const) {
        const d = Math.abs(tToX(which === 'start' ? s.start : s.end) - x);
        if (d < 22 && (!best || d < best.d || (d === best.d && i === selected))) best = { i, which, d };
      }
    });
    return best as { i: number; which: 'start' | 'end'; d: number } | null;
  };

  return (
    <div>
      <div ref={wrap} className="relative w-full overflow-x-auto overflow-y-hidden rounded-xl border border-line bg-bg" style={{ touchAction: 'pan-x' }}>
        <canvas
          ref={canvas}
          className="block"
          style={{ touchAction: drag.current ? 'none' : 'pan-x' }}
          onPointerDown={(e) => {
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pointers.current.size === 2) {
              const [a, b] = [...pointers.current.values()];
              pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), z: zoom };
              drag.current = null;
              return;
            }
            const x = localX(e);
            const h = hit(x);
            if (h) {
              drag.current = { i: h.i, which: h.which };
              onSelect(h.i);
              (e.target as Element).setPointerCapture(e.pointerId);
              e.preventDefault();
            } else tapStart.current = { x: e.clientX, t: xToT(x) };
          }}
          onPointerMove={(e) => {
            if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pinch.current && pointers.current.size === 2) {
              const [a, b] = [...pointers.current.values()];
              const d = Math.hypot(a.x - b.x, a.y - b.y);
              setZoom(Math.max(1, Math.min(64, (pinch.current.z * d) / pinch.current.d)));
              return;
            }
            if (!drag.current) return;
            e.preventDefault();
            onMarker(drag.current.i, drag.current.which, xToT(localX(e)));
          }}
          onPointerUp={(e) => {
            pointers.current.delete(e.pointerId);
            if (pointers.current.size < 2) pinch.current = null;
            if (drag.current) {
              onMarkerEnd?.(drag.current.i, drag.current.which, xToT(localX(e)));
              drag.current = null;
            } else if (tapStart.current && Math.abs(e.clientX - tapStart.current.x) < 6) {
              const t = tapStart.current.t;
              const idx = songs.findIndex((s) => t >= s.start && t <= s.end);
              if (idx >= 0) onSelect(idx);
              onTap?.(t);
            }
            tapStart.current = null;
          }}
          onPointerCancel={(e) => {
            pointers.current.delete(e.pointerId);
            pinch.current = null;
            drag.current = null;
          }}
        />
      </div>
      <div className="mt-2 flex items-center gap-2 text-sm text-slate-400">
        <button className="btn-ghost h-9 min-h-0 px-3" onClick={() => setZoom((z) => Math.max(1, z / 2))} aria-label="축소">
          −
        </button>
        <span className="w-14 text-center tabular-nums">×{zoom.toFixed(zoom < 10 ? 1 : 0)}</span>
        <button className="btn-ghost h-9 min-h-0 px-3" onClick={() => setZoom((z) => Math.min(64, z * 2))} aria-label="확대">
          +
        </button>
        <span className="ml-auto text-xs">마커(▶/■)를 드래그해 보정 · 두 손가락 확대</span>
      </div>
    </div>
  );
}

export const SONG_COLORS = COLORS;
