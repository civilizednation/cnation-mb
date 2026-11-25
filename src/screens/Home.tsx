import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Screen, Section } from '../components/Layout';
import { useSession } from '../store/session';
import { Songs } from '../db';
import { formatDate } from '../utils/time';

export default function Home() {
  const nav = useNavigate();
  const { recent, loadRecent } = useSession();
  const [meta, setMeta] = useState<Record<string, { count: number; best?: string }>>({});

  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  useEffect(() => {
    (async () => {
      const m: Record<string, { count: number; best?: string }> = {};
      for (const s of recent.slice(0, 30)) {
        const songs = await Songs.bySession(s.id);
        m[s.id] = { count: s.songIds.length, best: songs.find((x) => x.id === s.bestSongId)?.displayTitle };
      }
      setMeta(m);
    })();
  }, [recent]);

  return (
    <Screen>
      <div className="safe-top" />
      <div className="mb-6 mt-2 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            cnation <span className="bg-gradient-to-r from-accent to-accent2 bg-clip-text text-transparent">음악 비교 분석</span>
          </h1>
          <p className="text-sm text-slate-400">녹화 영상·음악 파일로 곡을 비교하고 Best를 고르세요</p>
        </div>
        <Link to="/settings" aria-label="설정" className="btn-ghost h-11 w-11 p-0 text-xl">
          ⚙︎
        </Link>
      </div>

      <button className="btn-primary mb-3 w-full flex-col py-6 text-lg" onClick={() => nav('/import?mode=recording')}>
        <span className="text-3xl">🎬</span>
        녹화 영상 불러오기
        <span className="text-xs font-normal text-white/70">여러 곡이 연속 녹화된 화면 녹화 1개 → 자동 분리</span>
      </button>
      <button className="btn-ghost mb-2 w-full flex-col py-5" onClick={() => nav('/import?mode=files')}>
        <span className="text-2xl">🎵</span>
        곡 불러오기 (개별 음악 파일)
        <span className="text-xs font-normal text-slate-400">mp3 · wav · m4a · webm · mp4 · mov 여러 개 선택</span>
      </button>
      <Link to="/guide" className="mb-6 block py-2 text-center text-sm text-accent2 underline underline-offset-2">
        📖 녹화 가이드 보기
      </Link>

      <Section title="최근 세션">
        {recent.length === 0 ? (
          <p className="card text-center text-sm text-slate-400">아직 세션이 없어요. 위에서 영상이나 곡을 불러오세요.</p>
        ) : (
          <ul className="space-y-2">
            {recent.map((s) => {
              const m = meta[s.id];
              const hasRounds = s.rounds.some((r) => Object.keys(r.ratings).length);
              return (
                <li key={s.id}>
                  <button className="card flex w-full items-center gap-3 text-left active:bg-panel2" onClick={() => nav(hasRounds ? `/s/${s.id}/result` : `/s/${s.id}/setup`)}>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{s.name}</div>
                      <div className="text-xs text-slate-400">
                        {formatDate(s.updatedAt)} · {m?.count ?? s.songIds.length}곡 · 라운드 {s.rounds.length}
                      </div>
                      {m?.best && <div className="mt-1 truncate text-sm text-star">🏆 {m.best}</div>}
                    </div>
                    <span className="text-slate-500">›</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </Screen>
  );
}
