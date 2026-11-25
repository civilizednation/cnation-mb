import { useEffect, useState } from 'react';
import { player } from '../audio/player';

/**
 * iOS에서 오디오가 멈춰 있으면(재생 중인데 시계가 흐르지 않음) 화면 위에 복구 버튼을 띄운다.
 * iOS는 사용자의 탭 안에서만 오디오를 다시 깨울 수 있다.
 */
export function AudioStallBanner() {
  const [stalled, setStalled] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setStalled(player.isStalled()), 300);
    return () => clearInterval(t);
  }, []);
  if (!stalled) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-50 flex justify-center px-3" style={{ paddingTop: 'max(env(safe-area-inset-top), 8px)' }}>
      <button
        className="btn w-full max-w-xl bg-amber-500 py-4 text-base font-semibold text-black shadow-2xl"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await player.recover();
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? '다시 연결하는 중…' : '🔇 소리가 멈춰 있어요 — 여기를 탭해서 다시 재생'}
      </button>
    </div>
  );
}
