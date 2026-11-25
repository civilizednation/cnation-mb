import { useRef, useState } from 'react';
import type { TitleRoi } from '../types';

/** 캡처 화면에서 제목 영역을 드래그로 박스 지정 (비율 좌표 0~1) */
export function RoiSelect({ frameUrl, initial, onDone, onSkip }: { frameUrl: string; initial?: TitleRoi | null; onDone: (r: TitleRoi) => void; onSkip: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [roi, setRoi] = useState<TitleRoi | null>(initial ?? null);
  const startP = useRef<{ x: number; y: number } | null>(null);
  const pt = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
  };
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-black/95">
      <div className="safe-top px-4 pb-2">
        <h2 className="text-lg font-semibold">제목 영역 지정 (최초 1회)</h2>
        <p className="text-sm text-slate-300">캡처 화면에서 <b>곡 제목</b> 부분을 손가락으로 드래그해 박스로 지정하세요. 다음부터 자동으로 사용돼요.</p>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center px-4">
        <div
          ref={box}
          className="relative max-h-full touch-none select-none"
          onPointerDown={(e) => {
            (e.target as Element).setPointerCapture(e.pointerId);
            startP.current = pt(e);
            setRoi({ ...startP.current, w: 0, h: 0 });
          }}
          onPointerMove={(e) => {
            if (!startP.current) return;
            const p = pt(e);
            const s = startP.current;
            setRoi({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
          }}
          onPointerUp={() => (startP.current = null)}
        >
          <img src={frameUrl} alt="캡처 화면" className="pointer-events-none block max-h-[65dvh] w-auto rounded-lg" draggable={false} />
          {roi && roi.w > 0 && (
            <div
              className="pointer-events-none absolute border-2 border-accent2 bg-accent2/20"
              style={{ left: `${roi.x * 100}%`, top: `${roi.y * 100}%`, width: `${roi.w * 100}%`, height: `${roi.h * 100}%` }}
            />
          )}
        </div>
      </div>
      <div className="safe-bottom grid grid-cols-2 gap-2 px-4 pt-3">
        <button className="btn-ghost" onClick={onSkip}>
          건너뛰기 (전체 화면 인식)
        </button>
        <button className="btn-primary" disabled={!roi || roi.w < 0.02 || roi.h < 0.005} onClick={() => roi && onDone(roi)}>
          이 영역 사용
        </button>
      </div>
    </div>
  );
}
