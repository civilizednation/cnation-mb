import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen, ProgressBar } from '../components/Layout';
import { useImport } from '../store/import';
import { useSettings } from '../store/settings';
import { processAll, type Stage } from '../pipeline/process';
import { canvasToBlob } from '../ocr/frameCapture';
import { RoiSelect } from '../components/RoiSelect';
import { keepAwake } from '../audio/player';

const STAGES: { key: Stage; label: string }[] = [
  { key: 'file', label: '개별 파일 처리' },
  { key: 'extract', label: '오디오 추출' },
  { key: 'analyze', label: '분석' },
  { key: 'split', label: '곡 분리' },
  { key: 'ocr', label: '제목 인식' },
];

export default function Processing() {
  const nav = useNavigate();
  const st = useImport();
  const { settings, roi, setRoi } = useSettings();
  const started = useRef(false);
  const [showLog, setShowLog] = useState(false);
  const [done, setDone] = useState<Set<Stage>>(new Set());

  useEffect(() => {
    if (started.current || st.running || st.candidates.length || !st.items.length) return;
    started.current = true;
    const abort = new AbortController();
    const t0 = performance.now();
    useImport.setState({ running: true, abort, startedAt: t0, logs: [], errors: [] });
    keepAwake(true);
    let last: Stage | null = null;
    processAll(
      st.items,
      { multiSong: st.multiSong, songCount: st.songCount, params: settings.silence },
      {
        signal: abort.signal,
        roi,
        progress: (stage, ratio, label) => {
          if (last && last !== stage) setDone((d) => new Set(d).add(last!));
          last = stage;
          useImport.setState({ stage, ratio, label });
        },
        log: (m) => useImport.getState().log(m),
        requestRoi: async (frame) => {
          const blob = await canvasToBlob(frame, 'image/jpeg', 0.85);
          const url = URL.createObjectURL(blob);
          return new Promise((resolve) => {
            useImport.setState({
              roiRequest: {
                frameUrl: url,
                width: frame.width,
                height: frame.height,
                resolve: (r) => {
                  URL.revokeObjectURL(url);
                  useImport.setState({ roiRequest: null });
                  if (r) setRoi(r);
                  resolve(r);
                },
              },
            });
          });
        },
      },
    )
      .then(({ candidates, errors }) => {
        const total = (performance.now() - t0) / 1000;
        useImport.getState().log(`전체 처리 완료: ${total.toFixed(2)}s`);
        useImport.setState({ candidates, errors, running: false, finishedAt: performance.now() });
        if (candidates.length) nav('/review', { replace: true });
      })
      .catch((e) => {
        const aborted = (e as Error)?.name === 'AbortError';
        useImport.setState({ running: false, errors: [aborted ? '취소되었습니다' : String((e as Error)?.message ?? e)] });
        if (aborted) nav(-1);
      })
      .finally(() => keepAwake(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cancel = () => {
    st.abort?.abort();
    st.roiRequest?.resolve(null);
  };

  const failed = !st.running && st.errors.length > 0 && !st.candidates.length;

  return (
    <Screen title="처리 중" right={st.running ? <button className="btn text-sm text-slate-300" onClick={cancel}>취소</button> : null}>
      {!st.items.length && !st.running ? (
        <div className="card text-center">
          <p className="mb-3 text-slate-300">처리할 파일이 없습니다.</p>
          <button className="btn-primary" onClick={() => nav('/', { replace: true })}>
            홈으로
          </button>
        </div>
      ) : (
        <>
          <div className="card mb-4">
            <ol className="space-y-3">
              {STAGES.map((s) => {
                const active = st.stage === s.key && st.running;
                const isDone = done.has(s.key) || (!st.running && !failed && st.stage != null);
                return (
                  <li key={s.key} className="flex items-center gap-3">
                    <span className={`flex h-7 w-7 items-center justify-center rounded-full text-sm ${isDone ? 'bg-emerald-500 text-black' : active ? 'bg-accent' : 'bg-line text-slate-400'}`}>
                      {isDone ? '✓' : active ? '…' : '·'}
                    </span>
                    <span className={active ? 'font-semibold' : 'text-slate-400'}>{s.label}</span>
                  </li>
                );
              })}
            </ol>
            {st.running && (
              <div className="mt-4">
                <div className="mb-2 truncate text-sm text-slate-300">{st.label}</div>
                <ProgressBar value={st.ratio} />
              </div>
            )}
          </div>
          {failed && (
            <div className="card mb-4 border-red-500/40">
              <h3 className="mb-2 font-semibold text-red-300">처리 실패</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm text-slate-300">
                {st.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
              <div className="mt-3 flex gap-2">
                <button className="btn-ghost" onClick={() => nav('/guide')}>
                  녹화 가이드
                </button>
                <button className="btn-primary" onClick={() => nav('/', { replace: true })}>
                  홈으로
                </button>
              </div>
            </div>
          )}
          <p className="mb-2 text-xs text-slate-500">처리 중에는 앱을 닫거나 다른 앱으로 이동하지 마세요 (iOS가 처리를 중단할 수 있어요).</p>
          <button className="text-sm text-slate-400 underline" onClick={() => setShowLog(!showLog)}>
            {showLog ? '처리 로그 숨기기' : '처리 로그 보기 (단계별 소요 시간)'}
          </button>
          {showLog && <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-panel p-3 text-xs text-slate-300">{st.logs.join('\n')}</pre>}
        </>
      )}
      {st.roiRequest && (
        <RoiSelect frameUrl={st.roiRequest.frameUrl} onDone={(r) => st.roiRequest!.resolve(r)} onSkip={() => st.roiRequest!.resolve(null)} />
      )}
    </Screen>
  );
}
