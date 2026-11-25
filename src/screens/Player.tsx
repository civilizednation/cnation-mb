import { useRef } from 'react';
import { Screen } from '../components/Layout';
import { useSimplePlayer, primeSimpleAudio, AUDIO_ACCEPT, isAudioFile, playlistBytes, limitBytes } from '../audio/simplePlayer';
import { Link } from 'react-router-dom';
import { gdriveConfigured } from '../gdrive';
import { DriveButton } from '../components/DriveButton';
import { formatTime, formatBytes } from '../utils/time';
import { toast } from '../components/Toast';

/** 단순 연속 듣기 플레이어: 음악 파일 여러 개 → 바로 이어서 재생, 전체 반복 */
export default function Player() {
  const p = useSimplePlayer();
  const input = useRef<HTMLInputElement>(null);
  const cur = p.tracks[p.index];

  const add = (files: File[]) => {
    const ok = files.filter(isAudioFile);
    if (ok.length < files.length) toast(`음악 파일이 아닌 ${files.length - ok.length}개(영상 등)는 제외했어요`, 'error');
    p.addFiles(ok);
  };

  return (
    <Screen
      title="연속 듣기"
      back="/"
      right={
        p.tracks.length ? (
          <button className="btn text-sm text-slate-400" onClick={() => confirm('재생 목록을 비울까요?') && p.clear()}>
            비우기
          </button>
        ) : null
      }
    >
      <input
        ref={input}
        type="file"
        multiple
        accept={AUDIO_ACCEPT}
        className="hidden"
        onChange={(e) => {
          add(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />

      {/* 지금 재생 중 */}
      <div className="card mb-4">
        <div className="mb-4 flex items-center gap-4">
          <div className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-accent2 text-3xl ${p.playing ? 'animate-pulse' : ''}`}>
            🎧
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-lg font-bold">{cur ? cur.title : '음악 파일을 추가하세요'}</div>
            <div className="text-sm text-slate-400">{cur ? `${p.index + 1} / ${p.tracks.length}${!p.playing && p.time > 1 ? ` · ${formatTime(p.time, 0)}부터 이어 듣기` : ''}` : '여러 곡을 골라 이어서 들어요'}</div>
          </div>
        </div>

        <input
          type="range"
          aria-label="재생 위치"
          className="w-full accent-accent"
          min={0}
          max={p.duration || 0}
          step={0.1}
          value={Math.min(p.time, p.duration || 0)}
          disabled={!cur || !p.duration}
          onChange={(e) => p.seek(Number(e.target.value))}
        />
        <div className="mb-3 flex justify-between font-mono text-xs tabular-nums text-slate-400">
          <span>{formatTime(p.time, 0)}</span>
          <span>{formatTime(p.duration, 0)}</span>
        </div>

        <div className="grid grid-cols-4 gap-2">
          <button className="btn-ghost text-xl" aria-label="이전 곡" disabled={!p.tracks.length} onClick={p.prev}>
            ⏮
          </button>
          <button className="btn-primary col-span-2 text-2xl" aria-label={p.playing ? '일시정지' : '재생'} disabled={!p.tracks.length} onClick={p.toggle}>
            {p.playing ? '❚❚' : '▶'}
          </button>
          <button className="btn-ghost text-xl" aria-label="다음 곡" disabled={!p.tracks.length} onClick={() => p.next()}>
            ⏭
          </button>
        </div>
        <button
          role="switch"
          aria-checked={p.repeatAll}
          className={`btn mt-2 w-full ${p.repeatAll ? 'bg-accent2/20 text-accent2' : 'bg-panel2 text-slate-400'}`}
          onClick={() => p.setRepeat(!p.repeatAll)}
        >
          🔁 전체 반복 {p.repeatAll ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* 추가 */}
      <div className="mb-2 grid grid-cols-2 gap-2">
        <button
          className="btn-primary py-4"
          onClick={() => {
            primeSimpleAudio();
            input.current?.click();
          }}
        >
          📁 기기 음악 파일
        </button>
        <DriveButton kind="audio" onFile={(f) => add([f])} />
      </div>
      <p className="mb-4 text-xs text-slate-500">mp3 · wav · m4a · aac · ogg · flac 여러 개 선택 가능 (영상 파일은 불러올 수 없어요){!gdriveConfigured ? ' · 구글 드라이브는 준비 중' : ''}</p>
      {/* 재생 목록 */}
      {p.tracks.length > 0 && (
        <ul className="space-y-1.5">
          {p.tracks.map((t, i) => {
            const on = i === p.index;
            return (
              <li key={t.id} className={`flex items-center gap-2 rounded-xl border px-3 ${on ? 'border-accent/60 bg-accent/10' : 'border-line bg-panel'}`}>
                <button className="flex min-h-[52px] min-w-0 flex-1 items-center gap-3 text-left" onClick={() => p.playAt(i)}>
                  <span className={`w-6 text-center text-sm ${on ? 'text-accent2' : 'text-slate-500'}`}>{on && p.playing ? '♪' : i + 1}</span>
                  <span className={`min-w-0 flex-1 truncate ${on ? 'font-semibold' : ''} ${t.error ? 'text-red-300 line-through' : ''}`}>{t.title}</span>
                  {t.error && <span className="text-xs text-red-300">재생 불가</span>}
                  {t.temp && <span className="chip bg-amber-500/20 text-amber-300">임시</span>}
                </button>
                <button className="btn h-10 min-h-0 w-10 min-w-0 p-0 text-slate-500" aria-label={`${t.title} 삭제`} onClick={() => p.remove(t.id)}>
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {p.saveError && <p className="mt-3 rounded-xl bg-red-500/10 p-3 text-xs text-red-300">일부 곡을 기기에 저장하지 못했어요 (저장공간 부족 등). 이번 실행 동안만 재생됩니다: {p.saveError}</p>}
      {p.tracks.length > 0 && (
        <p className="mt-3 text-xs text-slate-500">
          목록은 이 기기에 자동 저장돼 앱을 다시 열어도 그대로 남아요. 저장 {formatBytes(playlistBytes())}
          {limitBytes() ? ` / 한도 ${formatBytes(limitBytes())} (넘으면 오래된 곡부터 자동 삭제)` : ' (한도 없음)'} ·{' '}
          <Link to="/settings" className="underline">
            한도 설정
          </Link>
          . 다른 화면으로 가거나 화면이 꺼져도 계속 재생돼요.
        </p>
      )}
    </Screen>
  );
}
