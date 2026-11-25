import { useState } from 'react';
import type { Round, Song } from '../types';
import { useSettings } from '../store/settings';
import { exportSongMp3, saveFiles } from '../audio/export';
import { ProgressBar } from './Layout';
import { toast } from './Toast';
import { formatTime } from '../utils/time';
import { averageRating } from '../store/session';

const KBPS = [128, 192, 256, 320] as const;
const FADES = [0, 10, 1000, 3000];

export function Mp3Sheet({ songs, rounds, segmentRound, onClose }: { songs: Song[]; rounds: Round[]; segmentRound?: Round; onClose: () => void }) {
  const { settings, update } = useSettings();
  const [range, setRange] = useState<'full' | 'segment'>('full');
  const [busy, setBusy] = useState<{ i: number; p: number; label: string } | null>(null);
  const [noticeOk, setNoticeOk] = useState(settings.exportNoticeShown);

  const run = async () => {
    if (!settings.exportNoticeShown) update({ exportNoticeShown: true });
    const files: File[] = [];
    try {
      // 메모리 절약: 순차 처리
      for (let i = 0; i < songs.length; i++) {
        const s = songs[i];
        const f = await exportSongMp3(
          s,
          {
            kbps: settings.mp3Kbps,
            fadeMs: settings.mp3FadeMs,
            artist: settings.artist,
            range:
              range === 'segment' && segmentRound?.relStartSec != null && segmentRound.relEndSec != null
                ? { relStart: segmentRound.relStartSec, relEnd: segmentRound.relEndSec }
                : null,
            comment: (song) => {
              const avg = averageRating(rounds, song.id);
              return avg != null ? `★${avg.toFixed(1)} (cnation-mb)` : 'cnation-mb';
            },
          },
          (p, label) => setBusy({ i, p, label }),
        );
        files.push(f);
      }
      setBusy({ i: songs.length - 1, p: 1, label: '저장' });
      const r = await saveFiles(files, `cnation-mb-${new Date().toISOString().slice(0, 10)}.zip`);
      if (r !== 'cancelled') toast(r === 'shared' ? '공유 시트에서 "파일에 저장"을 선택하세요' : `${files.length}개 파일 저장`);
      onClose();
    } catch (e) {
      toast('MP3 저장 실패: ' + String((e as Error)?.message ?? e), 'error', 5000);
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/70" onClick={() => !busy && onClose()}>
      <div className="safe-bottom max-h-[90dvh] w-full max-w-xl overflow-auto rounded-t-3xl bg-panel p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-4 h-1 w-10 rounded bg-line" />
        <h2 className="mb-3 text-lg font-semibold">MP3 저장 ({songs.length}곡)</h2>
        <ul className="mb-4 max-h-32 overflow-auto text-sm text-slate-300">
          {songs.map((s) => (
            <li key={s.id} className="truncate">
              • {s.displayTitle}.mp3 <span className="text-slate-500">({formatTime(s.endInBlobSec - s.startInBlobSec, 0)})</span>
            </li>
          ))}
        </ul>

        <span className="label">범위</span>
        <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-bg p-1">
          <button className={`btn ${range === 'full' ? 'bg-accent text-white' : ''}`} onClick={() => setRange('full')}>
            곡 전체 (첫 소리~꼬리)
          </button>
          <button className={`btn ${range === 'segment' ? 'bg-accent text-white' : ''}`} disabled={!segmentRound} onClick={() => setRange('segment')}>
            현재 비교 구간
          </button>
        </div>

        <span className="label">음질 (CBR, 원본 샘플레이트 유지, 스테레오)</span>
        <div className="mb-1 grid grid-cols-4 gap-1">
          {KBPS.map((k) => (
            <button key={k} className={`btn ${settings.mp3Kbps === k ? 'bg-accent text-white' : 'bg-panel2'}`} onClick={() => update({ mp3Kbps: k })}>
              {k}
            </button>
          ))}
        </div>
        <p className="mb-3 text-xs text-slate-400">녹화 원본 오디오(AAC) 이상의 음질은 만들 수 없어요. 256kbps면 충분합니다.</p>

        <span className="label">시작/끝 페이드</span>
        <div className="mb-4 grid grid-cols-4 gap-1">
          {FADES.map((f) => (
            <button key={f} className={`btn ${settings.mp3FadeMs === f ? 'bg-accent text-white' : 'bg-panel2'}`} onClick={() => update({ mp3FadeMs: f })}>
              {f === 0 ? '없음' : f < 1000 ? `${f}ms` : `${f / 1000}s`}
            </button>
          ))}
        </div>

        {!settings.exportNoticeShown && (
          <label className="mb-4 flex gap-2 rounded-xl bg-amber-500/10 p-3 text-xs text-amber-200">
            <input type="checkbox" checked={noticeOk} onChange={(e) => setNoticeOk(e.target.checked)} className="mt-0.5" />
            화면 녹화에서 추출한 파일이므로 개인 감상과 비교 용도로 사용하세요. 배포나 업로드용 최종 음원은 Suno 정식 다운로드를 권장합니다.
          </label>
        )}

        {busy ? (
          <div>
            <div className="mb-2 text-sm">
              {busy.i + 1}/{songs.length} · {busy.label}
            </div>
            <ProgressBar value={(busy.i + busy.p) / songs.length} />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-ghost" onClick={onClose}>
              취소
            </button>
            <button className="btn-primary" disabled={!noticeOk || !songs.length} onClick={run}>
              저장
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
