import { useEffect, useRef, useState } from 'react';
import {
  gdriveConfigured,
  ensureToken,
  downloadDriveFile,
  consumePendingPick,
  consumeAuthError,
  rememberAccount,
  isConnected,
  needsLogin,
  RedirectingError,
  type DriveItem,
  type MediaKind,
} from '../gdrive';
import { ProgressBar } from './Layout';
import { DriveBrowser } from './DriveBrowser';
import { toast } from './Toast';

/**
 * 구글 드라이브에서 불러오기 버튼.
 * - 처음: 구글 로그인 화면으로 이동 → 돌아오면 드라이브 탐색 화면이 자동으로 열림
 * - 다음부터: 바로 탐색 화면 (토큰 만료 시 화면 없이 자동 재연결)
 */
export function DriveButton({
  kind,
  onFile,
  onBeforeLogin,
  className = 'btn-ghost py-4',
}: {
  kind: MediaKind;
  onFile: (f: File) => void;
  /** 로그인 화면으로 이동하기 전 확인 (false면 취소) */
  onBeforeLogin?: () => boolean;
  className?: string;
}) {
  const [dl, setDl] = useState<{ name: string; ratio: number; i: number; n: number } | null>(null);
  const [connected, setConnected] = useState(isConnected());
  const [browsing, setBrowsing] = useState(false);
  const ran = useRef(false);

  const open = () => {
    try {
      ensureToken(); // 없으면 로그인으로 이동 → 돌아와서 자동으로 다시 열림
      setBrowsing(true);
    } catch (e) {
      if (!(e instanceof RedirectingError)) toast(String((e as Error)?.message ?? e), 'error', 5000);
    }
  };

  const download = async (docs: DriveItem[]) => {
    setBrowsing(false);
    setConnected(true);
    try {
      for (let i = 0; i < docs.length; i++) {
        const d = docs[i];
        setDl({ name: d.name, ratio: 0, i, n: docs.length });
        const f = await downloadDriveFile(d, (l, t) => setDl({ name: d.name, ratio: t ? l / t : 0, i, n: docs.length }));
        onFile(f);
      }
    } catch (e) {
      if (!(e instanceof RedirectingError)) toast(String((e as Error)?.message ?? e), 'error', 5000);
    } finally {
      setDl(null);
    }
  };

  // 로그인에서 돌아온 직후: 계정 기억 + 드라이브 탐색 화면을 자동으로 다시 열기
  useEffect(() => {
    if (ran.current || !gdriveConfigured) return;
    ran.current = true;
    const err = consumeAuthError();
    if (err) {
      toast(err, 'error', 6000);
      return;
    }
    rememberAccount().then(() => setConnected(isConnected()));
    if (consumePendingPick()) setBrowsing(true);
  }, []);

  return (
    <>
      <button
        className={`${className} flex-col gap-0`}
        disabled={!gdriveConfigured || !!dl}
        onClick={() => {
          if (needsLogin() && onBeforeLogin && !onBeforeLogin()) return;
          open();
        }}
      >
        <span>☁️ 구글 드라이브</span>
        <span className="text-[11px] font-normal opacity-70">{!gdriveConfigured ? '준비 중' : connected ? '연결됨' : '처음 한 번 구글 로그인'}</span>
      </button>
      {dl && (
        <div className="card col-span-2 mt-2">
          <div className="mb-2 truncate text-sm">
            드라이브에서 받는 중 ({dl.i + 1}/{dl.n}): {dl.name}
          </div>
          <ProgressBar value={dl.ratio} />
        </div>
      )}
      {browsing && <DriveBrowser kind={kind} onClose={() => setBrowsing(false)} onPick={download} />}
    </>
  );
}
