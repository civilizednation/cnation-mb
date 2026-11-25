import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Screen, Section, Toggle } from '../components/Layout';
import { useSettings } from '../store/settings';
import { useSession } from '../store/session';
import { storageUsage, clearAll } from '../db';
import { formatBytes, formatDate } from '../utils/time';
import { gdriveConfigured, isConnected, getToken, disconnect } from '../gdrive';
import { DEFAULT_SILENCE, OCR_LANGS, type SilenceParams } from '../types';
import { toast } from '../components/Toast';
import { APP_VERSION } from '../version';

const PARAMS: { k: keyof SilenceParams; label: string; unit: string; step: number; min: number; max: number }[] = [
  { k: 'windowMs', label: 'RMS 창', unit: 'ms', step: 5, min: 5, max: 100 },
  { k: 'silenceDb', label: '무음 임계값', unit: 'dBFS', step: 1, min: -90, max: -20 },
  { k: 'minGapSec', label: '경계 최소 무음', unit: 's', step: 0.1, min: 0.2, max: 10 },
  { k: 'minSongSec', label: '최소 곡 길이', unit: 's', step: 1, min: 5, max: 180 },
  { k: 'clickMaxMs', label: '잡음 무시 길이', unit: 'ms', step: 10, min: 0, max: 2000 },
  { k: 'tailDb', label: '곡 끝(꼬리) 임계값', unit: 'dBFS', step: 1, min: -100, max: -30 },
];

export default function Settings() {
  const { settings, update, roi, setRoi } = useSettings();
  const { recent, loadRecent, deleteSession } = useSession();
  const [usage, setUsage] = useState<{ usage: number; quota: number; perSession: Record<string, number> } | null>(null);
  const [gConnected, setGConnected] = useState(isConnected());
  const [adv, setAdv] = useState(false);

  const refresh = async () => {
    await loadRecent();
    setUsage(await storageUsage());
  };
  useEffect(() => {
    refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setParam = (k: keyof SilenceParams, v: number) => update({ silence: { ...settings.silence, [k]: v } });

  return (
    <Screen title="설정" back="/">
      <Section title="비교 재생">
        <div className="card">
          <div className="flex min-h-[44px] items-center justify-between">
            <span>곡 사이 간격</span>
            <div className="flex items-center gap-2">
              <input type="range" min={0} max={3} step={0.5} value={settings.gapSec} onChange={(e) => update({ gapSec: Number(e.target.value) })} className="accent-accent" />
              <span className="w-10 text-right tabular-nums">{settings.gapSec}s</span>
            </div>
          </div>
          <Toggle checked={settings.autoNext} onChange={(v) => update({ autoNext: v })} label="별점 주면 자동으로 다음 곡" />
          <Toggle checked={settings.blindDefault} onChange={(v) => update({ blindDefault: v })} label="블라인드 모드 기본값" />
        </div>
      </Section>

      <Section title="제목 인식 (OCR)">
        <div className="card mb-2">
          <span className="label">인식 언어 (여러 개 선택 가능)</span>
          <div className="grid grid-cols-2 gap-2">
            {OCR_LANGS.map((l) => {
              const on = settings.ocrLangs.includes(l.code);
              return (
                <button
                  key={l.code}
                  role="checkbox"
                  aria-checked={on}
                  className={`btn ${on ? 'bg-accent text-white' : 'bg-panel2 text-slate-300'}`}
                  onClick={() => {
                    const next = on ? settings.ocrLangs.filter((x) => x !== l.code) : [...settings.ocrLangs, l.code];
                    if (next.length) update({ ocrLangs: OCR_LANGS.map((x) => x.code).filter((c) => next.includes(c)) });
                  }}
                >
                  {on ? '✓ ' : ''}
                  {l.label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-slate-500">쓰지 않는 언어를 끄면 인식이 더 빠르고 정확해져요. 언어 데이터는 처음 사용할 때 한 번만 내려받아요 (언어당 약 1.6MB).</p>
        </div>
        <div className="card flex items-center justify-between gap-3">
          <div className="text-sm">
            제목 영역(ROI): {roi ? <span className="text-emerald-300">지정됨</span> : <span className="text-slate-400">미지정</span>}
            <div className="text-xs text-slate-500">초기화하면 다음 녹화 영상 불러올 때 다시 지정해요.</div>
          </div>
          <button className="btn-ghost shrink-0" disabled={!roi} onClick={() => setRoi(null)}>
            재지정/초기화
          </button>
        </div>
      </Section>

      <Section title="MP3 내보내기">
        <div className="card">
          <label className="label" htmlFor="artist">
            아티스트 (ID3 태그)
          </label>
          <input id="artist" className="input" value={settings.artist} onChange={(e) => update({ artist: e.target.value })} />
        </div>
      </Section>

      <Section title="구글 드라이브">
        <div className="card flex items-center justify-between gap-3">
          <span className="text-sm">{!gdriveConfigured ? '환경변수가 설정되지 않아 비활성화됨' : gConnected ? '연결됨' : '연결 안 됨'}</span>
          {gdriveConfigured &&
            (gConnected ? (
              <button
                className="btn-ghost"
                onClick={async () => {
                  await disconnect();
                  setGConnected(false);
                }}
              >
                연결 해제
              </button>
            ) : (
              <button
                className="btn-primary"
                onClick={async () => {
                  try {
                    await getToken('consent');
                    setGConnected(true);
                  } catch (e) {
                    toast(String((e as Error)?.message ?? e), 'error');
                  }
                }}
              >
                구글 계정 연결
              </button>
            ))}
        </div>
      </Section>

      <Section title="저장공간">
        <div className="card">
          {usage && (
            <p className="mb-3 text-sm text-slate-300">
              사용 중 {formatBytes(usage.usage)}
              {usage.quota ? ` / 가능 ${formatBytes(usage.quota)}` : ''}
            </p>
          )}
          <ul className="mb-3 space-y-1">
            {recent.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate">{s.name}</div>
                  <div className="text-xs text-slate-500">
                    {formatDate(s.updatedAt)} · {s.songIds.length}곡 · {formatBytes(usage?.perSession[s.id] ?? 0)}
                  </div>
                </div>
                <button
                  className="btn-danger h-9 min-h-0 px-3 text-sm"
                  onClick={async () => {
                    if (confirm(`"${s.name}" 세션을 삭제할까요?`)) {
                      await deleteSession(s.id);
                      refresh();
                    }
                  }}
                >
                  삭제
                </button>
              </li>
            ))}
            {!recent.length && <li className="text-sm text-slate-500">저장된 세션이 없어요</li>}
          </ul>
          <button
            className="btn-danger w-full"
            disabled={!recent.length}
            onClick={async () => {
              if (confirm('모든 세션과 곡을 삭제할까요? 되돌릴 수 없어요.')) {
                await clearAll();
                refresh();
              }
            }}
          >
            전체 삭제
          </button>
        </div>
      </Section>

      <Section
        title="무음 탐지 (고급)"
        right={
          <button className="text-sm text-accent2" onClick={() => setAdv(!adv)}>
            {adv ? '접기' : '펼치기'}
          </button>
        }
      >
        {adv && (
          <div className="card space-y-3">
            {PARAMS.map((p) => (
              <div key={p.k} className="flex items-center justify-between gap-3">
                <span className="text-sm">{p.label}</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    inputMode="decimal"
                    className="input w-24 text-right"
                    step={p.step}
                    min={p.min}
                    max={p.max}
                    value={settings.silence[p.k]}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v)) setParam(p.k, Math.max(p.min, Math.min(p.max, v)));
                    }}
                  />
                  <span className="w-10 text-xs text-slate-400">{p.unit}</span>
                </div>
              </div>
            ))}
            <button className="btn-ghost w-full" onClick={() => update({ silence: DEFAULT_SILENCE })}>
              기본값으로
            </button>
          </div>
        )}
      </Section>

      <Section title="도움말">
        <div className="card flex flex-col gap-2">
          <Link to="/install" className="btn-ghost">
            📲 홈 화면에 추가
          </Link>
          <Link to="/guide" className="btn-ghost">
            📖 녹화 가이드
          </Link>
          <Link to="/poc" className="btn-ghost">
            🧪 기술 검증(PoC) / 진단
          </Link>
          <Link to="/history" className="btn-ghost">
            📝 개정 이력 (v{APP_VERSION})
          </Link>
        </div>
      </Section>
    </Screen>
  );
}
