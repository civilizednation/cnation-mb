import { useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Screen, Section, Toggle } from '../components/Layout';
import { useImport } from '../store/import';
import type { ImportItem } from '../pipeline/types';
import { isVideo } from '../pipeline/process';
import { DRIVE_MEDIA_MIMES } from '../gdrive';
import { DriveButton } from '../components/DriveButton';
import { formatBytes } from '../utils/time';
import { toast } from '../components/Toast';
import { unlockAudio } from '../audio/decode';

const ACCEPT = 'audio/*,video/*,.mp3,.wav,.m4a,.webm,.mp4,.mov,.aac';
const OK_EXT = /\.(mp3|wav|m4a|webm|mp4|mov|aac|m4v|ogg|flac)$/i;

export default function Import() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const sessionId = sp.get('session');
  const [mode, setMode] = useState<'recording' | 'files'>(sp.get('mode') === 'files' ? 'files' : 'recording');
  const [items, setItems] = useState<ImportItem[]>([]);
  const [multiSong, setMultiSong] = useState(true);
  const [songCount, setSongCount] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const setRequest = useImport((s) => s.setRequest);

  const hasVideo = useMemo(() => items.some((i) => isVideo(i.file)), [items]);
  const recCount = items.filter((i) => isVideo(i.file) && multiSong).length;

  const addFiles = (files: File[], sourceKind: ImportItem['sourceKind']) => {
    const ok = files.filter((f) => OK_EXT.test(f.name) || /^(audio|video)\//.test(f.type));
    if (ok.length < files.length) toast(`지원하지 않는 형식 ${files.length - ok.length}개는 제외했어요`, 'error');
    setItems((prev) => [...prev, ...ok.map((file) => ({ file, sourceKind }))]);
  };

  const start = async () => {
    await unlockAudio();
    setRequest({ items, multiSong, songCount: recCount ? songCount : null, targetSessionId: sessionId });
    nav('/processing');
  };

  return (
    <Screen title={sessionId ? '곡 추가' : '불러오기'} back>
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-panel p-1">
        {(['recording', 'files'] as const).map((m) => (
          <button key={m} className={`btn ${mode === m ? 'bg-accent text-white' : 'text-slate-300'}`} onClick={() => setMode(m)}>
            {m === 'recording' ? '🎬 녹화 영상' : '🎵 개별 음악 파일'}
          </button>
        ))}
      </div>

      <p className="mb-3 text-sm text-slate-400">
        {mode === 'recording'
          ? 'Suno에서 여러 곡을 연속 재생하며 화면 녹화한 영상(.mp4/.mov)을 선택하세요. 개별 음악 파일도 함께 추가해 한 세션에서 비교할 수 있어요.'
          : '비교할 음악 파일을 여러 개 선택하세요. 각 파일의 앞뒤 무음은 자동으로 제거되고 첫 소리가 0:00이 됩니다. 녹화 영상도 함께 추가할 수 있어요.'}
      </p>

      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          addFiles(Array.from(e.target.files ?? []), 'file');
          e.target.value = '';
        }}
      />
      <div className="mb-2 grid grid-cols-2 gap-2">
        <button className="btn-primary py-4" onClick={() => input.current?.click()}>
          📁 기기 파일
        </button>
        <DriveButton
          mimes={DRIVE_MEDIA_MIMES}
          onFile={(f) => addFiles([f], 'gdrive')}
          onBeforeLogin={() => !items.length || confirm('구글 로그인 화면으로 이동하면 지금 고른 파일 목록이 비워져요. 계속할까요? (로그인은 처음 한 번만 필요해요)')}
        />
      </div>
      <p className="mb-4 rounded-xl bg-panel2 p-3 text-xs text-slate-300">
        💡 사진 앱보다 <b>파일 앱</b>에서 선택하면 더 빨라요 (사진 앱은 iOS가 변환 대기를 할 수 있음).
      </p>
      {items.length > 0 && (
        <Section title={`선택한 파일 ${items.length}개`} right={<button className="text-sm text-slate-400" onClick={() => setItems([])}>모두 지우기</button>}>
          <ul className="space-y-2">
            {items.map((it, i) => {
              const v = isVideo(it.file);
              return (
                <li key={i} className="card flex items-center gap-3 py-3">
                  <span className="text-2xl">{v ? '🎬' : '🎵'}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{it.file.name}</div>
                    <div className="text-xs text-slate-400">
                      {formatBytes(it.file.size)} · {v ? (multiSong ? '녹화 영상(여러 곡 분리)' : '영상(단일 곡)') : '음악 파일'}
                      {it.sourceKind === 'gdrive' ? ' · 드라이브' : ''}
                    </div>
                  </div>
                  <button aria-label="제거" className="btn h-11 w-11 p-0 text-slate-400" onClick={() => setItems(items.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {(hasVideo || mode === 'recording') && (
        <Section title="녹화 영상 옵션">
          <div className="card">
            <Toggle checked={multiSong} onChange={setMultiSong} label="여러 곡이 연속 녹화된 영상" hint="끄면 영상 1개 = 곡 1개로 처리" />
            {multiSong && (
              <div className="mt-3">
                <span className="label">곡 수 (입력하면 정확도가 올라가요)</span>
                <div className="flex flex-wrap gap-2">
                  {[null, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                    <button key={String(n)} className={`btn h-11 min-w-[52px] px-3 ${songCount === n ? 'bg-accent text-white' : 'bg-panel2'}`} onClick={() => setSongCount(n)}>
                      {n ?? '자동'}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Section>
      )}

      <div className="sticky bottom-0 -mx-4 bg-gradient-to-t from-bg via-bg to-transparent px-4 pb-2 pt-4">
        <button className="btn-primary w-full py-4 text-lg" disabled={!items.length} onClick={start}>
          불러오기 시작 ({items.length})
        </button>
      </div>
    </Screen>
  );
}
