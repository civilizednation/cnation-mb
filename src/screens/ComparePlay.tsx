import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Screen } from '../components/Layout';
import { StarRating } from '../components/StarRating';
import { Thumb, useBlobUrl } from '../components/Thumb';
import { useSessionById, usePlayer } from '../hooks';
import { useSession } from '../store/session';
import { useSettings } from '../store/settings';
import { player, songLength, keepAwake, setMediaSession } from '../audio/player';
import { formatTime } from '../utils/time';
import { toast } from '../components/Toast';
import type { Rating, Round, Song } from '../types';

export const blindLabel = (i: number) => `곡 ${String.fromCharCode(65 + i)}`;

export function rangeFor(round: Round, song: Song) {
  const len = songLength(song);
  if (round.mode === 'segment' && round.relStartSec != null && round.relEndSec != null) {
    const s = round.relStartSec + song.userOffsetSec;
    const e = round.relEndSec + song.userOffsetSec;
    return { start: s, end: Math.min(e, len), short: e > len };
  }
  return { start: 0, end: len, short: false };
}

export default function ComparePlay() {
  const { id, roundId } = useParams();
  const session = useSessionById(id);
  const nav = useNavigate();
  const store = useSession();
  const songs = useSession((s) => s.songs);
  const { settings } = useSettings();
  const { playing, position, song: cur } = usePlayer();
  const [idx, setIdx] = useState(0);
  const [inGap, setInGap] = useState(false);
  const [paused, setPaused] = useState(false);
  const gapTimer = useRef<ReturnType<typeof setTimeout>>();
  const idxRef = useRef(0);
  idxRef.current = idx;

  const round = session?.rounds.find((r) => r.id === roundId);
  const order = round?.songOrder.filter((x) => songs[x]) ?? [];
  const song = songs[order[idx]];
  const thumbUrl = useBlobUrl(song?.thumbnailBlobKey);

  const finish = useCallback(async () => {
    player.stop();
    if (round) await store.completeRound(round.id);
    nav(`/s/${id}/result`, { replace: true });
  }, [round, store, nav, id]);

  const playIndex = useCallback(
    async (i: number) => {
      clearTimeout(gapTimer.current);
      setInGap(false);
      setPaused(false);
      if (!round) return;
      if (i >= order.length) return finish();
      const s = songs[order[i]];
      if (!s) return;
      setIdx(i);
      const r = rangeFor(round, s);
      const title = round.blind ? blindLabel(i) : s.displayTitle;
      setMediaSession(title, settings.artist, {
        prev: () => playIndex(Math.max(0, idxRef.current - 1)),
        next: () => playIndex(idxRef.current + 1),
        play: () => player.resume(),
        pause: () => player.pause(),
      });
      player.preload(songs[order[i + 1]]);
      try {
        await player.play(s, r.start, r.end, {
          onEnded: () => {
            if (idxRef.current !== i) return;
            if (i + 1 >= order.length) {
              setInGap(true);
              gapTimer.current = setTimeout(finish, 600);
              return;
            }
            setInGap(true);
            const next = songs[order[i + 1]];
            toast(`다음: ${round.blind ? blindLabel(i + 1) : next?.displayTitle}`, 'info', Math.max(1200, settings.gapSec * 1000));
            gapTimer.current = setTimeout(() => playIndex(i + 1), settings.gapSec * 1000);
          },
        });
      } catch (e) {
        toast('재생 실패: ' + String((e as Error)?.message ?? e), 'error');
      }
    },
    [round, order, songs, settings.gapSec, settings.artist, finish],
  );

  useEffect(() => {
    if (!round) return;
    keepAwake(true);
    // 첫 미평가 곡부터 시작
    const firstUnrated = order.findIndex((x) => !round.ratings[x]);
    playIndex(firstUnrated >= 0 ? firstUnrated : 0);
    return () => {
      clearTimeout(gapTimer.current);
      player.stop();
      keepAwake(false);
    };
  }, [round?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!session || !round) return <Screen title="비교" back>불러오는 중…</Screen>;
  if (!song) return <Screen title="비교" back>곡이 없습니다.</Screen>;

  const r = rangeFor(round, song);
  const isCur = cur?.id === song.id;
  const pos = isCur ? position : r.start;
  const rating = round.ratings[song.id];

  const rate = async (v: Rating) => {
    await store.rate(round.id, song.id, v);
    if (settings.autoNext) setTimeout(() => playIndex(idx + 1), 350);
  };

  const roundLabel =
    round.mode === 'full' ? '전체 구간' : `구간 ${formatTime(round.relStartSec ?? 0, 0)}~${formatTime(round.relEndSec ?? 0, 0)}`;

  return (
    <Screen
      title={`${roundLabel}`}
      back={`/s/${id}/setup`}
      right={
        <button className="btn text-sm text-slate-300" onClick={finish}>
          결과 ›
        </button>
      }
      footer={false}
    >
      <div className="flex min-h-[calc(100dvh-7rem)] flex-col">
        <div className="mb-3 flex items-center justify-between text-sm text-slate-400">
          <span>{round.blind ? '🙈 블라인드' : ''}</span>
          <span className="font-semibold tabular-nums text-slate-200">
            {idx + 1} / {order.length}
          </span>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <Thumb url={thumbUrl} blobKey={song.thumbnailBlobKey} hidden={round.blind} className="mb-4 h-48 w-32 rounded-2xl" />
          <h2 className="mb-1 line-clamp-2 text-3xl font-bold">{round.blind ? blindLabel(idx) : song.displayTitle}</h2>
          {r.short && <p className="text-sm text-amber-300">⚠️ 이 곡은 구간 끝보다 짧아 곡 끝까지만 재생해요</p>}
          {inGap && <p className="mt-1 text-sm text-accent2">곡 사이 간격…</p>}
        </div>

        <div className="mb-4">
          <div className="relative h-2 overflow-hidden rounded-full bg-line">
            <div className="h-full bg-gradient-to-r from-accent to-accent2" style={{ width: `${Math.max(0, Math.min(1, (pos - r.start) / Math.max(0.01, r.end - r.start))) * 100}%` }} />
          </div>
          <div className="mt-1 flex justify-between font-mono text-xs tabular-nums text-slate-400">
            <span>{formatTime(pos)}</span>
            <span>{formatTime(r.end)}</span>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-4 gap-2">
          <button className="btn-ghost text-xl" aria-label="이전 곡" onClick={() => playIndex(Math.max(0, idx - 1))}>
            ⏮
          </button>
          <button className="btn-ghost text-xl" aria-label="다시 듣기" onClick={() => playIndex(idx)}>
            ↺
          </button>
          <button
            className="btn-primary text-xl"
            aria-label={playing ? '일시정지' : '재생'}
            onClick={() => {
              if (playing) {
                player.pause();
                setPaused(true);
              } else if (inGap) {
                playIndex(idx + 1);
              } else if (isCur && paused) {
                player.resume();
                setPaused(false);
              } else playIndex(idx);
            }}
          >
            {playing ? '❚❚' : '▶'}
          </button>
          <button className="btn-ghost text-xl" aria-label="다음 곡" onClick={() => playIndex(idx + 1)}>
            ⏭
          </button>
        </div>

        <div className="safe-bottom">
          <StarRating value={rating} onChange={rate} />
          <p className="mt-2 text-center text-xs text-slate-500">
            탭하면 즉시 확정 (다시 탭하면 변경){settings.autoNext ? ' · 자동 다음 곡 ON' : ''}
          </p>
        </div>
      </div>
    </Screen>
  );
}
