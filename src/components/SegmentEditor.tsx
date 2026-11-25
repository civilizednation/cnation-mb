import { useEffect, useState } from 'react';
import type { Song, SegmentPreset } from '../types';
import { player, songLength } from '../audio/player';
import { usePlayer } from '../hooks';
import { ProgressScrubber } from './ProgressScrubber';
import { TimeInput } from './TimeInput';
import { formatTime } from '../utils/time';

export interface Segment {
  relStart: number;
  relEnd: number;
}

function Nudge({ onNudge }: { onNudge: (d: number) => void }) {
  return (
    <div className="flex gap-1">
      {[-1, -0.1, 0.1, 1].map((d) => (
        <button key={d} className="btn-ghost h-10 min-h-0 min-w-0 flex-1 px-2 text-sm tabular-nums" onClick={() => onNudge(d)}>
          {d > 0 ? '+' : '−'}
          {Math.abs(d)}s
        </button>
      ))}
    </div>
  );
}

/** F6-2 특정 구간 편집기 (기준곡 플레이어) */
export function SegmentEditor({
  refSong,
  segment,
  onChange,
  presets,
  onSavePreset,
  onDeletePreset,
}: {
  refSong: Song;
  segment: Segment;
  onChange: (s: Segment) => void;
  presets: SegmentPreset[];
  onSavePreset: (label: string) => void;
  onDeletePreset: (id: string) => void;
}) {
  const { playing, song, position } = usePlayer();
  const len = songLength(refSong);
  const [loop, setLoop] = useState(false);
  const isRef = song?.id === refSong.id;
  const pos = isRef ? position : 0;
  const { relStart, relEnd } = segment;

  const set = (s: number, e: number) => {
    s = Math.max(0, Math.min(s, len - 0.1));
    e = Math.max(s + 0.1, Math.min(e, len));
    onChange({ relStart: Math.round(s * 1000) / 1000, relEnd: Math.round(e * 1000) / 1000 });
  };

  useEffect(() => {
    if (isRef && loop) player.setRange(relStart, relEnd);
  }, [relStart, relEnd, loop, isRef]);

  const playFull = async (from: number) => {
    setLoop(false);
    await player.play(refSong, 0, len, { from });
  };

  const toggle = () => {
    if (isRef && playing) player.pause();
    else if (isRef && !playing && !loop) player.resume();
    else playFull(pos);
  };

  const toggleLoop = async () => {
    if (loop) {
      setLoop(false);
      player.stop();
    } else {
      setLoop(true);
      await player.play(refSong, relStart, relEnd, { loop: true });
    }
  };

  return (
    <div className="card">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="text-slate-400">기준곡</span>
        <span className="truncate font-medium">{refSong.displayTitle}</span>
      </div>
      <ProgressScrubber
        duration={len}
        position={pos}
        peaks={refSong.peaks}
        onSeek={(t) => (isRef && playing ? player.seek(t) : playFull(t))}
        start={relStart}
        end={relEnd}
        onStart={(t) => set(t, relEnd)}
        onEnd={(t) => set(relStart, t)}
      />
      <div className="mt-3 grid grid-cols-3 gap-2">
        <button className="btn-ghost" onClick={() => set(pos, Math.max(relEnd, pos + 0.1))}>
          시작 지점 설정
        </button>
        <button className="btn-primary text-xl" onClick={toggle} aria-label={playing && isRef ? '일시정지' : '재생'}>
          {playing && isRef && !loop ? '❚❚' : '▶'}
        </button>
        <button className="btn-ghost" onClick={() => set(Math.min(relStart, pos - 0.1), pos)}>
          끝 지점 설정
        </button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm text-emerald-300">시작</span>
            <TimeInput value={relStart} onChange={(v) => set(v, relEnd)} label="시작 시간" />
          </div>
          <Nudge onNudge={(d) => set(relStart + d, relEnd)} />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm text-rose-300">끝</span>
            <TimeInput value={relEnd} onChange={(v) => set(relStart, v)} label="끝 시간" />
          </div>
          <Nudge onNudge={(d) => set(relStart, relEnd + d)} />
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="font-mono text-sm tabular-nums text-slate-300">
          {formatTime(relStart)} ~ {formatTime(relEnd)} ({(relEnd - relStart).toFixed(1)}초)
        </span>
        <button className={`btn h-10 min-h-0 px-3 text-sm ${loop ? 'bg-accent2 text-black' : 'bg-panel2'}`} onClick={toggleLoop}>
          🔁 구간 미리듣기
        </button>
      </div>

      <div className="mt-4 border-t border-line pt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm text-slate-400">구간 프리셋</span>
          <button
            className="text-sm text-accent2"
            onClick={() => {
              const label = prompt('프리셋 이름 (예: 후렴1, 인트로)');
              if (label?.trim()) onSavePreset(label.trim());
            }}
          >
            + 현재 구간 저장
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {presets.length === 0 && <span className="text-xs text-slate-500">저장된 프리셋이 없어요</span>}
          {presets.map((p) => (
            <span key={p.id} className="inline-flex items-center overflow-hidden rounded-full bg-panel2 text-sm">
              <button className="px-3 py-2" onClick={() => onChange({ relStart: p.relStartSec, relEnd: p.relEndSec })}>
                {p.label} <span className="text-xs text-slate-400">{formatTime(p.relStartSec, 0)}~{formatTime(p.relEndSec, 0)}</span>
              </button>
              <button className="px-2 py-2 text-slate-500" aria-label="프리셋 삭제" onClick={() => onDeletePreset(p.id)}>
                ✕
              </button>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
