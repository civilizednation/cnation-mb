import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen, ProgressBar } from '../components/Layout';
import { Waveform } from '../components/Waveform';
import { Thumb } from '../components/Thumb';
import { useImport } from '../store/import';
import { useSettings } from '../store/settings';
import { useSession } from '../store/session';
import type { Candidate, RecordingCandidate, RecSong } from '../pipeline/types';
import { analyzeRegions, analyzeSplit } from '../pipeline/analysisClient';
import { captureAndOcr } from '../pipeline/process';
import { commitCandidates } from '../pipeline/commit';
import { previewRange, stopPreview } from '../pipeline/preview';
import { computeDisplayTitles } from '../ocr/titles';
import { formatTime, formatDuration } from '../utils/time';
import { uid } from '../utils/id';
import { toast } from '../components/Toast';
import { requestPersist } from '../db';

type Key = string; // rs.id or file cand.id

function entriesOf(cands: Candidate[]) {
  const map = new Map<Key, { cand: Candidate; rs?: RecSong }>();
  for (const c of cands) {
    if (c.kind === 'recording') for (const rs of c.songs) map.set(rs.id, { cand: c, rs });
    else map.set(c.id, { cand: c });
  }
  return map;
}

export default function SplitReview() {
  const nav = useNavigate();
  const st = useImport();
  const { settings } = useSettings();
  const session = useSession();
  const [, force] = useState(0);
  const rerender = () => force((x) => x + 1);
  const [order, setOrder] = useState<Key[]>(() => [...entriesOf(useImport.getState().candidates).keys()]);
  const [sel, setSel] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<{ label: string; ratio: number } | null>(null);
  const [addMode, setAddMode] = useState<string | null>(null);

  useEffect(() => () => stopPreview(), []);

  const cands = st.candidates;
  const entries = useMemo(() => entriesOf(cands), [cands, order]); // eslint-disable-line react-hooks/exhaustive-deps

  // 후보에 새로 생긴/사라진 곡을 순서 목록에 반영
  const syncOrder = () => {
    const keys = [...entriesOf(useImport.getState().candidates).keys()];
    setOrder((prev) => {
      const kept = prev.filter((k) => keys.includes(k));
      const added = keys.filter((k) => !kept.includes(k));
      // 새 곡은 같은 녹화의 기존 곡 위치 근처에 넣는다 → 단순화: 녹화 내 순서를 유지하도록 재구성
      const out: Key[] = [];
      const seenCand = new Set<string>();
      for (const k of [...kept, ...added]) {
        const e = entriesOf(useImport.getState().candidates).get(k)!;
        if (e.cand.kind === 'recording') {
          if (seenCand.has(e.cand.id)) continue;
          seenCand.add(e.cand.id);
          out.push(...e.cand.songs.map((s) => s.id));
        } else out.push(k);
      }
      return out;
    });
  };

  const displayTitles = computeDisplayTitles(order.map((k) => {
    const e = entries.get(k);
    return e ? (e.rs ? e.rs.title : (e.cand as any).title) : '';
  }));

  if (!cands.length) {
    return (
      <Screen title="분리 결과 확인" back="/">
        <div className="card text-center text-slate-300">
          확인할 결과가 없습니다.
          <div className="mt-3">
            <button className="btn-primary" onClick={() => nav('/', { replace: true })}>
              홈으로
            </button>
          </div>
        </div>
      </Screen>
    );
  }

  const recs = cands.filter((c): c is RecordingCandidate => c.kind === 'recording');

  const resplit = async (c: RecordingCandidate, count: number | null) => {
    setBusy({ label: '재분리 중', ratio: 0.3 });
    try {
      const r = await analyzeSplit(c.samples8k, 8000, settings.silence, count);
      c.samples8k = r.samples;
      c.peaks = r.peaks;
      c.songCount = count;
      c.warnings = r.result.warnings;
      for (const s of c.songs) if (s.thumbUrl) URL.revokeObjectURL(s.thumbUrl);
      c.songs = r.result.songs.map((s, i) => ({
        id: uid('rs_'),
        srcStartSec: s.srcStartSec,
        srcEndSec: s.srcEndSec,
        needsReview: s.needsReview,
        rawTitle: '',
        title: `곡 ${i + 1}`,
        startEdited: false,
        endEdited: false,
        enabled: true,
      }));
      await ocrAgain(c);
      syncOrder();
    } catch (e) {
      toast(String((e as Error)?.message ?? e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const ocrAgain = async (c: RecordingCandidate, only?: RecSong[]) => {
    const target = only ? { ...c, songs: only } : c;
    await captureAndOcr(target as RecordingCandidate, {
      progress: (_s, ratio, label) => setBusy({ label, ratio }),
      log: () => {},
      requestRoi: async () => null,
      roi: useSettings.getState().roi,
      signal: new AbortController().signal,
    }).catch(() => {});
  };

  /** 경계 추가: 곡 i 안의 시각 t에서 둘로 나눈다 */
  const addBoundary = async (c: RecordingCandidate, t: number) => {
    const songs = [...c.songs].sort((a, b) => a.srcStartSec - b.srcStartSec);
    const idx = songs.findIndex((s) => t > s.srcStartSec + 1 && t < s.srcEndSec - 1);
    if (idx < 0) return toast('곡 구간 안쪽을 탭하세요', 'error');
    setBusy({ label: '경계 추가 중', ratio: 0.5 });
    try {
      const orig = songs[idx];
      const r = await analyzeRegions(c.samples8k, 8000, settings.silence, [orig.srcStartSec - 0.01, t, orig.srcEndSec + 0.01].filter((x) => x > 0));
      c.samples8k = r.samples;
      const parts = r.songs.filter((s) => s.srcStartSec >= orig.srcStartSec - 0.05 && s.srcEndSec <= orig.srcEndSec + 0.35);
      if (parts.length < 2) {
        // 무음이 없으면 탭 위치 그대로 자른다
        parts.splice(0, parts.length, { srcStartSec: orig.srcStartSec, srcEndSec: t, needsReview: true }, { srcStartSec: t, srcEndSec: orig.srcEndSec, needsReview: true });
      }
      const a: RecSong = { ...orig, srcEndSec: parts[0].srcEndSec, endEdited: true, needsReview: true };
      const b: RecSong = {
        id: uid('rs_'),
        srcStartSec: parts[1].srcStartSec,
        srcEndSec: orig.srcEndSec,
        needsReview: true,
        rawTitle: '',
        title: `곡 ${songs.length + 1}`,
        startEdited: true,
        endEdited: orig.endEdited,
        enabled: true,
      };
      songs.splice(idx, 1, a, b);
      c.songs = songs;
      await ocrAgain(c, [b]);
      syncOrder();
    } finally {
      setBusy(null);
      setAddMode(null);
    }
  };

  const mergeNext = (c: RecordingCandidate, s: RecSong) => {
    const songs = [...c.songs].sort((a, b) => a.srcStartSec - b.srcStartSec);
    const i = songs.indexOf(s);
    if (i < 0 || i + 1 >= songs.length) return;
    const nx = songs[i + 1];
    const merged: RecSong = { ...s, srcEndSec: nx.srcEndSec, endEdited: nx.endEdited, needsReview: true };
    if (nx.thumbUrl) URL.revokeObjectURL(nx.thumbUrl);
    songs.splice(i, 2, merged);
    c.songs = songs;
    syncOrder();
  };

  const removeKey = (k: Key) => {
    const e = entries.get(k);
    if (!e) return;
    if (e.cand.kind === 'recording') {
      e.cand.songs = e.cand.songs.filter((s) => s.id !== k);
      if (!e.cand.songs.length) useImport.setState({ candidates: cands.filter((c) => c !== e.cand) });
    } else useImport.setState({ candidates: cands.filter((c) => c !== e.cand) });
    setOrder((o) => o.filter((x) => x !== k));
  };

  const move = (k: Key, d: number) => {
    setOrder((o) => {
      const i = o.indexOf(k);
      const j = i + d;
      if (j < 0 || j >= o.length) return o;
      const n = [...o];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  };

  const setTitle = (k: Key, title: string) => {
    const e = entries.get(k);
    if (!e) return;
    if (e.rs) e.rs.title = title;
    else (e.cand as any).title = title;
    rerender();
  };

  const confirm = async () => {
    stopPreview();
    setBusy({ label: '곡 잘라내는 중', ratio: 0 });
    try {
      await requestPersist();
      let sid = st.targetSessionId;
      if (!sid) {
        const s = session.createSession();
        await session.save(s);
        sid = s.id;
      }
      // 확정 순서대로 후보 정렬 (녹화 곡은 순서 키로 정렬됨)
      const results = await commitCandidates(cands, sid, settings.silence, (ratio, label) => setBusy({ label, ratio }));
      const byKey = new Map(results.map((r) => [r.key, r.song]));
      const ordered = order.map((k) => byKey.get(k)).filter(Boolean) as typeof results[number]['song'][];
      await session.addSongs(sid, ordered);
      useImport.getState().reset();
      nav(`/s/${sid}/setup`, { replace: true });
    } catch (e) {
      toast(String((e as Error)?.message ?? e), 'error', 5000);
      setBusy(null);
    }
  };

  const totalSongs = order.length;

  return (
    <Screen title="분리 결과 확인" back="/" wide>
      {recs.map((c) => {
        const songsSorted = [...c.songs].sort((a, b) => a.srcStartSec - b.srcStartSec);
        const selIdx = sel[c.id] ?? 0;
        return (
          <div key={c.id} className="mb-5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">🎬 {c.name}</div>
                <div className="text-xs text-slate-400">
                  {formatDuration(c.durationSec)} · {c.songs.length}곡 감지 · {c.extracted.method}
                </div>
              </div>
            </div>
            {c.warnings.map((w, i) => (
              <div key={i} className="mb-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                ⚠️ {w}
              </div>
            ))}
            <Waveform
              peaks={c.peaks}
              duration={c.durationSec}
              songs={songsSorted.map((s) => ({ start: s.srcStartSec, end: s.srcEndSec, review: s.needsReview }))}
              selected={selIdx}
              onSelect={(i) => setSel({ ...sel, [c.id]: i })}
              onMarker={(i, which, t) => {
                const s = songsSorted[i];
                const prev = songsSorted[i - 1];
                const next = songsSorted[i + 1];
                if (which === 'start') {
                  s.srcStartSec = Math.max(prev ? prev.srcEndSec : 0, Math.min(t, s.srcEndSec - 1));
                  s.startEdited = true;
                } else {
                  s.srcEndSec = Math.min(next ? next.srcStartSec : c.durationSec, Math.max(t, s.srcStartSec + 1));
                  s.endEdited = true;
                }
                rerender();
              }}
              onMarkerEnd={(i, which) => {
                const s = songsSorted[i];
                const t = which === 'start' ? s.srcStartSec : s.srcEndSec;
                previewRange(c, which === 'start' ? t : t - 2, which === 'start' ? t + 2 : t + 0.5);
              }}
              onTap={addMode === c.id ? (t) => addBoundary(c, t) : undefined}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-400">곡 수 재분리:</span>
              {[null, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                <button key={String(n)} className={`btn h-9 min-h-0 px-2.5 text-sm ${c.songCount === n ? 'bg-accent text-white' : 'bg-panel2'}`} onClick={() => resplit(c, n)} disabled={!!busy}>
                  {n ?? '자동'}
                </button>
              ))}
              <button className={`btn h-9 min-h-0 px-3 text-sm ${addMode === c.id ? 'bg-amber-500 text-black' : 'bg-panel2'}`} onClick={() => setAddMode(addMode === c.id ? null : c.id)}>
                {addMode === c.id ? '파형을 탭해 경계 추가…' : '+ 경계 추가'}
              </button>
            </div>
          </div>
        );
      })}

      <h2 className="mb-2 mt-2 text-sm font-semibold text-slate-400">곡 목록 ({totalSongs}) — 이 순서로 비교합니다</h2>
      <ul className="space-y-2">
        {order.map((k, idx) => {
          const e = entries.get(k);
          if (!e) return null;
          const rs = e.rs;
          const c = e.cand;
          const start = rs ? rs.srcStartSec : (c as any).startSec;
          const end = rs ? rs.srcEndSec : (c as any).endSec;
          const review = rs ? rs.needsReview : false;
          const recSongs = c.kind === 'recording' ? [...c.songs].sort((a, b) => a.srcStartSec - b.srcStartSec) : [];
          const isLastInRec = rs ? recSongs[recSongs.length - 1]?.id === rs.id : true;
          return (
            <li key={k} className={`card ${review ? 'border-amber-500/50' : ''}`}>
              <div className="flex gap-3">
                <Thumb url={rs?.thumbUrl} className="h-20 w-14" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">{idx + 1}</span>
                    <input className="input min-h-[40px] py-1" value={rs ? rs.title : (c as any).title} onChange={(ev) => setTitle(k, ev.target.value)} aria-label="제목" />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-slate-400">
                    <span>{c.kind === 'recording' ? '🎬' : '🎵'}</span>
                    <span className="font-mono">
                      {formatTime(start)} ~ {formatTime(end)}
                    </span>
                    <span>({formatDuration(end - start)})</span>
                    {displayTitles[idx] !== (rs ? rs.title : (c as any).title).trim() && <span className="text-slate-300">→ “{displayTitles[idx]}”</span>}
                    {review && <span className="chip bg-amber-500/20 text-amber-300">확인 필요</span>}
                    {rs?.ocrConfidence != null && <span>OCR {Math.round(rs.ocrConfidence)}</span>}
                  </div>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button className="btn-ghost h-9 min-h-0 px-3 text-sm" onClick={() => previewRange(c, start, start + 4)}>
                  ▶ 시작 듣기
                </button>
                <button className="btn-ghost h-9 min-h-0 px-3 text-sm" onClick={() => previewRange(c, Math.max(start, end - 4), end)}>
                  ■ 끝 듣기
                </button>
                <button className="btn-ghost h-9 min-h-0 px-3 text-sm" onClick={stopPreview}>
                  ⏹
                </button>
                <span className="flex-1" />
                <button className="btn-ghost h-9 min-h-0 w-9 px-0" aria-label="위로" onClick={() => move(k, -1)}>
                  ↑
                </button>
                <button className="btn-ghost h-9 min-h-0 w-9 px-0" aria-label="아래로" onClick={() => move(k, 1)}>
                  ↓
                </button>
                {rs && !isLastInRec && (
                  <button className="btn-ghost h-9 min-h-0 px-2 text-sm" onClick={() => mergeNext(c as RecordingCandidate, rs)}>
                    다음과 합치기
                  </button>
                )}
                <button className="btn-danger h-9 min-h-0 px-3 text-sm" onClick={() => removeKey(k)}>
                  삭제
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {st.errors.length > 0 && (
        <div className="card mt-4 border-red-500/40 text-sm text-red-300">
          일부 파일 처리 실패:
          <ul className="list-disc pl-5">
            {st.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-4 text-xs text-slate-500">확인을 누르면 곡별 오디오만 저장되고 원본 영상은 저장하지 않아요. 추출 완료 후 원본 영상은 삭제해도 됩니다.</p>
      <div className="sticky bottom-0 -mx-4 mt-2 bg-gradient-to-t from-bg via-bg to-transparent px-4 pb-2 pt-4">
        {busy ? (
          <div className="card">
            <div className="mb-2 text-sm">{busy.label}</div>
            <ProgressBar value={busy.ratio} />
          </div>
        ) : (
          <button className="btn-primary w-full py-4 text-lg" disabled={!totalSongs} onClick={confirm}>
            확인 ({totalSongs}곡)
          </button>
        )}
      </div>
    </Screen>
  );
}
