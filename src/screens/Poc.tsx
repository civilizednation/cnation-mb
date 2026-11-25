import { useRef, useState } from 'react';
import { Screen } from '../components/Layout';
import { extractAudio } from '../audio/extract';
import { decodeForAnalysis } from '../pipeline/process';
import { analyzeSplit } from '../pipeline/analysisClient';
import { useSettings } from '../store/settings';
import { FrameGrabber, thumbnailOf } from '../ocr/frameCapture';
import { supportsAudioSession, unlockAudio } from '../audio/decode';
import { formatTime, formatBytes } from '../utils/time';

interface Row {
  step: string;
  ms?: number;
  note: string;
}

/** Phase 0 PoC: 실기기에서 단계별 소요 시간과 곡 분리 결과를 확인 */
export default function Poc() {
  const input = useRef<HTMLInputElement>(null);
  const { settings } = useSettings();
  const [rows, setRows] = useState<Row[]>([]);
  const [songs, setSongs] = useState<{ s: number; e: number }[]>([]);
  const [thumb, setThumb] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [running, setRunning] = useState(false);

  const add = (r: Row) => setRows((x) => [...x, r]);
  const mem = () => {
    const m = (performance as any).memory;
    return m ? ` · JS heap ${formatBytes(m.usedJSHeapSize)}` : '';
  };

  const run = async (file: File) => {
    await unlockAudio();
    setRunning(true);
    setRows([]);
    setSongs([]);
    setThumb(null);
    add({ step: '파일', note: `${file.name} · ${formatBytes(file.size)} · ${navigator.userAgent.match(/(iPhone|iPad|Mac|Android|Windows)[^;)]*/)?.[0] ?? ''}` });
    try {
      let t = performance.now();
      const ex = await extractAudio(file, () => {});
      add({ step: '1. 오디오 추출', ms: performance.now() - t, note: `${ex.method}${ex.kind === 'frames' ? ` · ${ex.container} · ${ex.frames.sampleRate}Hz ${ex.frames.channels}ch · ${ex.frames.frameStarts.length - 1} frames · AAC ${formatBytes(ex.frames.data.length)}` : ''} · 오디오→영상 오프셋 ${ex.audioToVideoSec.toFixed(3)}s${mem()}` });
      t = performance.now();
      const samples = await decodeForAnalysis(ex);
      add({ step: '2. 8kHz 디코딩', ms: performance.now() - t, note: `${samples.length} samples (${formatTime(samples.length / 8000)})${mem()}` });
      t = performance.now();
      const r = await analyzeSplit(samples, 8000, settings.silence, count);
      add({ step: '3. 곡 분리 (Worker)', ms: performance.now() - t, note: `${r.result.songs.length}곡 ${r.result.warnings.join(' / ')}` });
      setSongs(r.result.songs.map((s) => ({ s: s.srcStartSec, e: s.srcEndSec })));
      if (r.result.songs[0]) {
        t = performance.now();
        const g = new FrameGrabber(file);
        try {
          const c = await g.grab(r.result.songs[0].srcStartSec + 3 + ex.audioToVideoSec);
          const b = await thumbnailOf(c);
          setThumb(URL.createObjectURL(b));
          add({ step: '4. video seek + canvas 캡처', ms: performance.now() - t, note: `${g.size.w}×${g.size.h}` });
        } catch (e) {
          add({ step: '4. video seek + canvas 캡처', note: '실패: ' + String((e as Error)?.message ?? e) });
        } finally {
          g.dispose();
        }
      }
    } catch (e) {
      add({ step: '오류', note: String((e as Error)?.message ?? e) });
    }
    add({ step: 'navigator.audioSession', note: supportsAudioSession() ? `지원 (type=${(navigator as any).audioSession.type})` : '미지원 → 무음 스위치 안내 필요' });
    setRunning(false);
  };

  const total = rows.reduce((a, r) => a + (r.ms ?? 0), 0);

  return (
    <Screen title="기술 검증 (PoC)" back>
      <p className="mb-3 text-sm text-slate-400">아이폰 화면 녹화(.mov/.mp4) 파일로 추출 → 디코딩 → 분리 → 캡처 단계별 소요 시간을 측정합니다. 결과는 docs/poc-result.md에 기록하세요.</p>
      <div className="mb-3 flex flex-wrap gap-2">
        {[null, 2, 3, 4, 5].map((n) => (
          <button key={String(n)} className={`btn h-10 min-h-0 px-3 ${count === n ? 'bg-accent text-white' : 'bg-panel2'}`} onClick={() => setCount(n)}>
            {n ?? '자동'}
          </button>
        ))}
      </div>
      <input ref={input} type="file" accept="video/*,audio/*,.mov,.mp4" className="hidden" onChange={(e) => e.target.files?.[0] && run(e.target.files[0])} />
      <button className="btn-primary mb-4 w-full" disabled={running} onClick={() => input.current?.click()}>
        {running ? '측정 중…' : '녹화 파일 선택'}
      </button>
      {rows.length > 0 && (
        <table className="mb-4 w-full text-sm">
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-line align-top">
                <td className="py-2 pr-2 font-medium">{r.step}</td>
                <td className="w-20 py-2 pr-2 text-right font-mono tabular-nums">{r.ms != null ? `${(r.ms / 1000).toFixed(2)}s` : ''}</td>
                <td className="py-2 text-xs text-slate-400">{r.note}</td>
              </tr>
            ))}
            <tr>
              <td className="py-2 font-semibold">합계</td>
              <td className="py-2 text-right font-mono font-semibold">{(total / 1000).toFixed(2)}s</td>
              <td />
            </tr>
          </tbody>
        </table>
      )}
      {songs.length > 0 && (
        <div className="card mb-4">
          <h3 className="mb-2 font-semibold">곡별 시작/끝 (원본 오디오 기준)</h3>
          <ol className="space-y-1 font-mono text-sm">
            {songs.map((s, i) => (
              <li key={i}>
                {i + 1}. {s.s.toFixed(3)}s ~ {s.e.toFixed(3)}s ({formatTime(s.e - s.s)})
              </li>
            ))}
          </ol>
        </div>
      )}
      {thumb && <img src={thumb} alt="캡처" className="mx-auto max-h-80 rounded-xl" />}
    </Screen>
  );
}
