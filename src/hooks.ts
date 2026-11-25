import { useEffect, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { player } from './audio/player';
import { useSession } from './store/session';

/** player 상태 구독 + 재생 중 rAF로 위치 갱신 */
export function usePlayer() {
  useSyncExternalStore(
    (cb) => player.subscribe(cb),
    () => `${player.playing}|${player.song?.id}|${player.relStart}|${player.relEnd}`,
  );
  const [pos, setPos] = useState(player.position());
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setPos(player.position());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return { playing: player.playing, song: player.song, position: pos };
}

/** URL의 세션을 로드 */
export function useSessionById(id: string | undefined) {
  const open = useSession((s) => s.open);
  const session = useSession((s) => s.session);
  const nav = useNavigate();
  const [ready, setReady] = useState(session?.id === id);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    open(id).then((s) => {
      if (!alive) return;
      if (!s) nav('/', { replace: true });
      else setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [id, open, nav]);
  return ready && session?.id === id ? session : null;
}
