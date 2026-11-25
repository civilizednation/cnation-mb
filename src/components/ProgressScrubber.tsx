import { useRef, useState } from 'react';
import { formatTime } from '../utils/time';

/**
 * 큰 프로그레스바: 탭/드래그로 스크럽, 시작/끝 핸들 드래그.
 * 드래그 중 현재 시간 실시간 표시.
 */
export function ProgressScrubber({
  duration,
  position,
  onSeek,
  start,
  end,
  onStart,
  onEnd,
  peaks,
}: {
  duration: number;
  position: number;
  onSeek: (t: number) => void;
  start?: number;
  end?: number;
  onStart?: (t: number) => void;
  onEnd?: (t: number) => void;
  peaks?: Float32Array;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<null | 'seek' | 'start' | 'end'>(null);
  const [dragT, setDragT] = useState(0);
  const pct = (t: number) => `${(Math.max(0, Math.min(duration, t)) / Math.max(0.001, duration)) * 100}%`;
  const tAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(duration, ((clientX - r.left) / r.width) * duration));
  };
  const handleDown = (which: 'start' | 'end') => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    setDrag(which);
    setDragT(which === 'start' ? start ?? 0 : end ?? 0);
  };
  const shown = drag ? dragT : position;

  return (
    <div className="select-none">
      <div
        ref={ref}
        className="relative h-14 touch-none rounded-xl bg-panel2"
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture(e.pointerId);
          setDrag('seek');
          const t = tAt(e.clientX);
          setDragT(t);
        }}
        onPointerMove={(e) => {
          if (!drag) return;
          const t = tAt(e.clientX);
          setDragT(t);
          if (drag === 'start') onStart?.(Math.min(t, (end ?? duration) - 0.1));
          if (drag === 'end') onEnd?.(Math.max(t, (start ?? 0) + 0.1));
        }}
        onPointerUp={(e) => {
          if (drag === 'seek') onSeek(tAt(e.clientX));
          setDrag(null);
        }}
        onPointerCancel={() => setDrag(null)}
      >
        {peaks && (
          <div className="absolute inset-0 flex items-center gap-px overflow-hidden rounded-xl px-0.5 opacity-50">
            {Array.from({ length: 120 }, (_, i) => {
              const a = Math.floor((i / 120) * peaks.length);
              const b = Math.max(a + 1, Math.floor(((i + 1) / 120) * peaks.length));
              let m = 0;
              for (let j = a; j < b; j++) m = Math.max(m, peaks[j] ?? 0);
              return <div key={i} className="flex-1 rounded-sm bg-slate-500" style={{ height: `${Math.max(4, Math.sqrt(m) * 90)}%` }} />;
            })}
          </div>
        )}
        {start != null && end != null && (
          <div className="absolute inset-y-0 bg-accent/30" style={{ left: pct(start), width: `calc(${pct(end)} - ${pct(start)})` }} />
        )}
        <div className="absolute inset-y-0 left-0 rounded-l-xl bg-accent2/25" style={{ width: pct(shown) }} />
        <div className="absolute inset-y-0 w-0.5 bg-white" style={{ left: pct(shown) }} />
        {start != null && onStart && (
          <div onPointerDown={handleDown('start')} className="absolute -top-2 bottom-0 z-10 flex w-11 -translate-x-1/2 touch-none flex-col items-center" style={{ left: pct(start) }}>
            <div className="rounded bg-emerald-400 px-1 text-[10px] font-bold text-black">시작</div>
            <div className="w-1 flex-1 rounded bg-emerald-400" />
          </div>
        )}
        {end != null && onEnd && (
          <div onPointerDown={handleDown('end')} className="absolute -top-2 bottom-0 z-10 flex w-11 -translate-x-1/2 touch-none flex-col items-center" style={{ left: pct(end) }}>
            <div className="rounded bg-rose-400 px-1 text-[10px] font-bold text-black">끝</div>
            <div className="w-1 flex-1 rounded bg-rose-400" />
          </div>
        )}
      </div>
      <div className="mt-1 flex justify-between font-mono text-xs tabular-nums text-slate-400">
        <span className={drag ? 'text-accent2' : ''}>{formatTime(shown)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}
