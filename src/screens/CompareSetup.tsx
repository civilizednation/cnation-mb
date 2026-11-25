import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Screen, Section, Toggle } from '../components/Layout';
import { Thumb } from '../components/Thumb';
import { SegmentEditor, type Segment } from '../components/SegmentEditor';
import { useSession } from '../store/session';
import { useSettings } from '../store/settings';
import { useSessionById } from '../hooks';
import { player, songLength } from '../audio/player';
import { formatDuration } from '../utils/time';
import { unlockAudio, supportsAudioSession } from '../audio/decode';
import type { RoundMode } from '../types';

function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

export default function CompareSetup() {
  const { id } = useParams();
  const session = useSessionById(id);
  const nav = useNavigate();
  const store = useSession();
  const { settings, update } = useSettings();
  const songs = useSession((s) => s.songs);
  const [mode, setMode] = useState<RoundMode>('full');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [refId, setRefId] = useState<string | null>(null);
  const [seg, setSeg] = useState<Segment>({ relStart: 30, relEnd: 60 });
  const [blind, setBlind] = useState(settings.blindDefault);
  const [editing, setEditing] = useState<string | null>(null);

  const list = useMemo(() => (session ? session.songIds.map((x) => songs[x]).filter(Boolean) : []), [session, songs]);

  useEffect(() => {
    if (!session) return;
    setSelected(new Set(session.songIds));
    const lastSeg = [...session.rounds].reverse().find((r) => r.mode === 'segment');
    if (lastSeg?.relStartSec != null && lastSeg.relEndSec != null) {
      setSeg({ relStart: lastSeg.relStartSec, relEnd: lastSeg.relEndSec });
      if (lastSeg.referenceSongId) setRefId(lastSeg.referenceSongId);
    }
  }, [session?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => player.stop(), []);

  // 이전 구간 라운드가 없으면 기준곡 길이에 맞춰 기본 구간 설정 (30~60s, 짧은 곡은 비례)
  const refKey = session && (refId ?? session.songIds.find((x) => selected.has(x)));
  useEffect(() => {
    if (!session || !refKey || session.rounds.some((r) => r.mode === 'segment')) return;
    const s = songs[refKey];
    if (!s) return;
    const len = songLength(s);
    setSeg(len >= 75 ? { relStart: 30, relEnd: 60 } : { relStart: Math.round(len * 0.4 * 10) / 10, relEnd: Math.round(len * 0.7 * 10) / 10 });
  }, [refKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!session) return <Screen title="비교 설정" back="/">불러오는 중…</Screen>;

  const chosen = list.filter((s) => selected.has(s.id));
  const ref = chosen.find((s) => s.id === refId) ?? chosen[0];

  const move = (sid: string, d: number) => {
    const ids = [...session.songIds];
    const i = ids.indexOf(sid);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    store.reorder(ids);
  };

  const start = async () => {
    await unlockAudio();
    player.stop();
    const order = chosen.map((s) => s.id);
    const round = await store.startRound({
      mode,
      relStartSec: mode === 'segment' ? seg.relStart : undefined,
      relEndSec: mode === 'segment' ? seg.relEnd : undefined,
      referenceSongId: mode === 'segment' ? ref?.id : undefined,
      songOrder: blind ? shuffle(order) : order,
      blind,
    });
    nav(`/s/${session.id}/play/${round.id}`);
  };

  const hasResults = session.rounds.some((r) => Object.values(r.ratings).some(Boolean));

  return (
    <Screen
      title={session.name}
      back="/"
      right={
        hasResults ? (
          <Link to={`/s/${session.id}/result`} className="btn text-sm text-accent2">
            결과
          </Link>
        ) : null
      }
    >
      <div className="mb-4 flex gap-2">
        <button
          className="btn-ghost h-10 min-h-0 flex-1 text-sm"
          onClick={() => {
            const n = prompt('세션 이름', session.name);
            if (n) store.rename(n);
          }}
        >
          ✏️ 이름 변경
        </button>
        <button className="btn-ghost h-10 min-h-0 flex-1 text-sm" onClick={() => nav(`/import?session=${session.id}`)}>
          ＋ 곡 추가
        </button>
      </div>

      <Section title={`곡 목록 (${chosen.length}/${list.length} 선택)`}>
        <ul className="space-y-2">
          {list.map((s, i) => {
            const on = selected.has(s.id);
            const short = mode === 'segment' && songLength(s) < seg.relEnd + s.userOffsetSec;
            return (
              <li key={s.id} className={`card flex flex-col gap-2 py-3 ${on ? '' : 'opacity-50'}`}>
                <div className="flex items-center gap-3">
                  <button
                    role="checkbox"
                    aria-checked={on}
                    aria-label="비교 대상"
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border ${on ? 'border-accent bg-accent text-white' : 'border-line'}`}
                    onClick={() => {
                      const n = new Set(selected);
                      if (on) n.delete(s.id);
                      else n.add(s.id);
                      setSelected(n);
                    }}
                  >
                    {on ? '✓' : ''}
                  </button>
                  <Thumb blobKey={s.thumbnailBlobKey} className="h-14 w-10" />
                  <div className="min-w-0 flex-1">
                    {editing === s.id ? (
                      <input
                        autoFocus
                        className="input min-h-[36px] py-1"
                        defaultValue={s.title}
                        onBlur={(e) => {
                          store.updateSong(s.id, { title: e.target.value.trim() || s.title, needsReview: false });
                          setEditing(null);
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      />
                    ) : (
                      <button className="block w-full truncate text-left font-medium" onClick={() => setEditing(s.id)}>
                        {s.displayTitle} <span className="text-xs text-slate-500">✏️</span>
                      </button>
                    )}
                    <div className="flex flex-wrap gap-x-2 text-xs text-slate-400">
                      <span>{s.sourceKind === 'recording' ? '🎬' : s.sourceKind === 'gdrive' ? '☁️' : '🎵'}</span>
                      <span>{formatDuration(songLength(s))}</span>
                      {s.needsReview && <span className="text-amber-300">확인 필요</span>}
                      {short && <span className="text-amber-300">⚠️ 구간보다 짧음</span>}
                    </div>
                  </div>
                  <div className="flex flex-col">
                    <button className="h-8 w-9 text-slate-400" aria-label="위로" onClick={() => move(s.id, -1)} disabled={i === 0}>
                      ↑
                    </button>
                    <button className="h-8 w-9 text-slate-400" aria-label="아래로" onClick={() => move(s.id, 1)} disabled={i === list.length - 1}>
                      ↓
                    </button>
                  </div>
                </div>
                {mode === 'segment' && on && (
                  <div className="flex items-center gap-1 pl-14 text-sm">
                    <span className="mr-1 text-xs text-slate-400">오프셋</span>
                    <button className="btn-ghost h-9 min-h-0 min-w-0 px-2" onClick={() => store.updateSong(s.id, { userOffsetSec: Math.round((s.userOffsetSec - 0.1) * 10) / 10 })}>
                      −0.1
                    </button>
                    <span className="w-14 text-center font-mono tabular-nums">{s.userOffsetSec >= 0 ? '+' : ''}{s.userOffsetSec.toFixed(1)}s</span>
                    <button className="btn-ghost h-9 min-h-0 min-w-0 px-2" onClick={() => store.updateSong(s.id, { userOffsetSec: Math.round((s.userOffsetSec + 0.1) * 10) / 10 })}>
                      +0.1
                    </button>
                    <button
                      className="btn-ghost ml-auto h-9 min-h-0 px-3"
                      onClick={() => player.play(s, seg.relStart + s.userOffsetSec, seg.relEnd + s.userOffsetSec)}
                      aria-label="이 곡 구간 미리듣기"
                    >
                      ▶
                    </button>
                    {ref?.id !== s.id && (
                      <button className="btn h-9 min-h-0 px-2 text-xs text-slate-400" onClick={() => setRefId(s.id)}>
                        기준곡
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="비교 모드">
        <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-panel p-1">
          {(['full', 'segment'] as const).map((m) => (
            <button key={m} className={`btn ${mode === m ? 'bg-accent text-white' : 'text-slate-300'}`} onClick={() => setMode(m)}>
              {m === 'full' ? '전체 구간' : '특정 구간'}
            </button>
          ))}
        </div>
        {mode === 'full' ? (
          <p className="text-sm text-slate-400">선택한 곡들을 목록 순서대로 각 곡의 0:00 ~ 곡 끝까지 이어서 재생합니다.</p>
        ) : ref ? (
          <SegmentEditor
            refSong={ref}
            segment={seg}
            onChange={setSeg}
            presets={session.segmentPresets}
            onSavePreset={(label) => store.savePreset({ label, relStartSec: seg.relStart, relEndSec: seg.relEnd })}
            onDeletePreset={(pid) => store.deletePreset(pid)}
          />
        ) : (
          <p className="text-sm text-slate-400">곡을 선택하세요.</p>
        )}
      </Section>

      <Section title="옵션">
        <div className="card">
          <Toggle checked={blind} onChange={setBlind} label="블라인드 모드" hint="제목 숨김 + 순서 셔플, 결과 화면에서 공개" />
          <Toggle checked={settings.autoNext} onChange={(v) => update({ autoNext: v })} label="별점 주면 자동으로 다음 곡" />
          <div className="flex min-h-[44px] items-center justify-between">
            <span>곡 사이 간격</span>
            <div className="flex items-center gap-2">
              <input type="range" min={0} max={3} step={0.5} value={settings.gapSec} onChange={(e) => update({ gapSec: Number(e.target.value) })} className="accent-accent" />
              <span className="w-10 text-right tabular-nums">{settings.gapSec}s</span>
            </div>
          </div>
        </div>
        {!supportsAudioSession() && <p className="mt-2 text-xs text-amber-300">🔕 소리가 안 나면 아이폰 측면의 무음 스위치를 꺼주세요.</p>}
      </Section>

      <div className="sticky bottom-0 -mx-4 bg-gradient-to-t from-bg via-bg to-transparent px-4 pb-2 pt-4">
        <button className="btn-primary w-full py-4 text-lg" disabled={chosen.length < 1 || (mode === 'segment' && seg.relEnd <= seg.relStart)} onClick={start}>
          비교 ({chosen.length}곡)
        </button>
      </div>
    </Screen>
  );
}
