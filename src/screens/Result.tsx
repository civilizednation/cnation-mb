import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Screen } from '../components/Layout';
import { StarRating } from '../components/StarRating';
import { Thumb } from '../components/Thumb';
import { Mp3Sheet } from '../components/Mp3Sheet';
import { useSessionById, usePlayer } from '../hooks';
import { useSession, averageRating } from '../store/session';
import { player } from '../audio/player';
import { rangeFor } from './ComparePlay';
import { formatTime } from '../utils/time';
import { toast } from '../components/Toast';
import type { Rating, Round, Song } from '../types';

const roundName = (r: Round, i: number) =>
  `R${i + 1} ${r.mode === 'full' ? '전체' : `${formatTime(r.relStartSec ?? 0, 0)}~${formatTime(r.relEndSec ?? 0, 0)}`}`;

export default function Result() {
  const { id } = useParams();
  const session = useSessionById(id);
  const store = useSession();
  const songs = useSession((s) => s.songs);
  const nav = useNavigate();
  const { playing, song: cur } = usePlayer();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [mp3, setMp3] = useState<Song[] | null>(null);

  const rounds = useMemo(() => (session?.rounds ?? []).filter((r) => r.songOrder.length), [session]);
  const last = rounds[rounds.length - 1];

  const rows = useMemo(() => {
    if (!session) return [];
    const list = session.songIds.map((x) => songs[x]).filter(Boolean);
    return list
      .map((s, order) => ({ s, order, avg: averageRating(rounds, s.id) }))
      .sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1) || a.order - b.order);
  }, [session, songs, rounds]);

  if (!session) return <Screen title="결과" back="/">불러오는 중…</Screen>;

  const lastIds = new Set(last?.songOrder ?? []);
  const unrated = last ? last.songOrder.filter((x) => songs[x] && !last.ratings[x]) : [];
  const topAvg = rows[0]?.avg;
  const tied = topAvg != null ? rows.filter((r) => r.avg === topAvg) : [];
  const best = session.bestSongId ? songs[session.bestSongId] : undefined;

  const replay = (s: Song) => {
    if (playing && cur?.id === s.id) return player.stop();
    const r = last ? rangeFor(last, s) : { start: 0, end: s.endInBlobSec - s.startInBlobSec };
    player.play(s, r.start, r.end);
  };

  const finalRound = async () => {
    player.stop();
    const ids = tied.map((t) => t.s.id);
    const round = await store.startRound({
      mode: last?.mode ?? 'full',
      relStartSec: last?.relStartSec,
      relEndSec: last?.relEndSec,
      referenceSongId: last?.referenceSongId,
      songOrder: ids,
      blind: last?.blind ?? false,
      label: '결승',
    });
    nav(`/s/${session.id}/play/${round.id}`);
  };

  const shareText = () =>
    rows
      .map((r) => `${session.bestSongId === r.s.id ? '🏆 ' : ''}${r.s.displayTitle} ${r.avg != null ? '★' + (Number.isInteger(r.avg) ? r.avg : r.avg.toFixed(1)) : '-'}`)
      .join(' / ');

  const copyText = async () => {
    const t = `[${session.name}] ${shareText()}`;
    try {
      await navigator.clipboard.writeText(t);
      toast('결과를 복사했어요');
    } catch {
      prompt('복사하세요', t);
    }
  };

  const saveImage = async () => {
    const W = 1080;
    const rowH = 96;
    const H = 220 + rows.length * rowH + 60;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#0b0d12';
    ctx.fillRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, '#7c5cff');
    g.addColorStop(1, '#22d3ee');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, 8);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 52px -apple-system, "Apple SD Gothic Neo", sans-serif';
    ctx.fillText('cnation 음악 비교 결과', 60, 100);
    ctx.font = '32px -apple-system, "Apple SD Gothic Neo", sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(session.name, 60, 155);
    rows.forEach((r, i) => {
      const y = 220 + i * rowH;
      ctx.fillStyle = i % 2 ? '#151922' : '#1d2230';
      ctx.fillRect(40, y, W - 80, rowH - 10);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 40px -apple-system, "Apple SD Gothic Neo", sans-serif';
      ctx.fillText(`${i + 1}`, 70, y + 58);
      const title = (session.bestSongId === r.s.id ? '🏆 ' : '') + r.s.displayTitle;
      ctx.font = '36px -apple-system, "Apple SD Gothic Neo", sans-serif';
      ctx.fillText(title.length > 24 ? title.slice(0, 23) + '…' : title, 140, y + 58);
      ctx.fillStyle = '#fbbf24';
      const stars = r.avg != null ? '★'.repeat(Math.round(r.avg)) + '☆'.repeat(5 - Math.round(r.avg)) : '—';
      ctx.fillText(stars, W - 330, y + 58);
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '28px -apple-system, sans-serif';
      if (r.avg != null) ctx.fillText(r.avg.toFixed(1), W - 110, y + 56);
    });
    const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b!), 'image/png'));
    const file = new File([blob], 'cnation-result.png', { type: 'image/png' });
    const nv = navigator as any;
    if (nv.canShare?.({ files: [file] })) {
      try {
        await nv.share({ files: [file] });
        return;
      } catch {
        /* fallthrough */
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = file.name;
    a.click();
  };

  const toggleCheck = (sid: string) => {
    const n = new Set(checked);
    if (n.has(sid)) n.delete(sid);
    else n.add(sid);
    setChecked(n);
  };

  const segRound = [...rounds].reverse().find((r) => r.mode === 'segment');

  return (
    <Screen title="결과" back="/" wide right={<button className="btn text-sm text-accent2" onClick={() => nav(`/s/${session.id}/setup`)}>새 라운드</button>}>
      {best && (
        <div className="card mb-4 flex items-center gap-3 border-star/40 bg-star/10">
          <Thumb blobKey={best.thumbnailBlobKey} className="h-16 w-12" />
          <div className="min-w-0 flex-1">
            <div className="text-xs text-star">🏆 BEST</div>
            <div className="truncate text-lg font-bold">{best.displayTitle}</div>
          </div>
        </div>
      )}

      {unrated.length > 0 && (
        <div className="mb-3 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-300">미평가 {unrated.length}곡 — 아래에서 바로 평가할 수 있어요.</div>
      )}
      {tied.length > 1 && (
        <button className="btn mb-3 w-full bg-amber-500 text-black" onClick={finalRound}>
          동점 {tied.length}곡 — 결승 라운드
        </button>
      )}

      <div className="mb-3 flex flex-wrap gap-2">
        <button className="btn-ghost h-10 min-h-0 text-sm" onClick={copyText}>
          📋 텍스트 복사
        </button>
        <button className="btn-ghost h-10 min-h-0 text-sm" onClick={saveImage}>
          🖼 이미지 저장
        </button>
        <button
          className="btn-primary ml-auto h-10 min-h-0 text-sm"
          disabled={!checked.size}
          onClick={() => setMp3(rows.filter((r) => checked.has(r.s.id)).map((r) => r.s))}
        >
          💾 선택 곡 MP3 저장 ({checked.size})
        </button>
      </div>

      {rounds.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1 text-xs text-slate-400">
          {rounds.map((r, i) => (
            <span key={r.id} className="chip bg-panel2">
              {roundName(r, i)}
              {r.label ? ` · ${r.label}` : ''}
              {r.blind ? ' · 블라인드' : ''}
            </span>
          ))}
        </div>
      )}

      <ul className="space-y-2">
        {rows.map((r, rank) => {
          const s = r.s;
          const isBest = session.bestSongId === s.id;
          return (
            <li key={s.id} className={`card ${isBest ? 'border-star/60' : ''}`}>
              <div className="flex items-center gap-3">
                <button
                  role="checkbox"
                  aria-checked={checked.has(s.id)}
                  aria-label="MP3 저장 선택"
                  onClick={() => toggleCheck(s.id)}
                  className={`flex h-11 w-9 shrink-0 items-center justify-center rounded-lg border ${checked.has(s.id) ? 'border-accent bg-accent' : 'border-line'}`}
                >
                  {checked.has(s.id) ? '✓' : ''}
                </button>
                <span className="w-6 text-center text-lg font-bold text-slate-300">{rank + 1}</span>
                <Thumb blobKey={s.thumbnailBlobKey} className="h-14 w-10" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{s.displayTitle}</div>
                  <div className="flex items-center gap-2">
                    <StarRating value={r.avg != null ? (Math.round(r.avg) as Rating) : undefined} readOnly size="sm" />
                    <span className="text-xs tabular-nums text-slate-400">{r.avg != null ? `평균 ${r.avg.toFixed(1)}` : '미평가'}</span>
                  </div>
                </div>
                <button className={`btn h-11 w-11 p-0 text-xl ${isBest ? '' : 'opacity-40 grayscale'}`} aria-label="Best 선택" onClick={() => store.setBest(isBest ? undefined : s.id)}>
                  🏆
                </button>
              </div>

              {rounds.length > 1 && (
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 pl-12 text-xs text-slate-400">
                  {rounds.map((rd, i) => (
                    <span key={rd.id}>
                      R{i + 1}: {rd.ratings[s.id] ? '★' + rd.ratings[s.id] : rd.songOrder.includes(s.id) ? '—' : '·'}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-2 pl-12">
                <button className="btn-ghost h-10 min-h-0 px-3 text-sm" onClick={() => replay(s)}>
                  {playing && cur?.id === s.id ? '⏹ 정지' : '▶ 다시 듣기'}
                </button>
                <button className="btn-ghost h-10 min-h-0 px-3 text-sm" onClick={() => setMp3([s])}>
                  💾 MP3
                </button>
                {last && lastIds.has(s.id) && (
                  <div className="ml-auto">
                    <StarRating size="md" value={last.ratings[s.id]} onChange={(v) => store.rate(last.id, s.id, v)} />
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {last && <p className="mt-3 text-xs text-slate-500">별점 수정은 마지막 라운드({roundName(last, rounds.length - 1)})에 적용돼요. 평균은 모든 라운드 기준입니다.</p>}

      {mp3 && <Mp3Sheet songs={mp3} rounds={rounds} segmentRound={segRound} onClose={() => setMp3(null)} />}
    </Screen>
  );
}
