import { useEffect, useState, useSyncExternalStore } from 'react';
import { canPromptInstall, detectPlatform, isStandalone, promptInstall, subscribeInstall, APP_URL, HOME_NAME } from '../install';
import { toast } from './Toast';

export function useInstallState() {
  const canPrompt = useSyncExternalStore(subscribeInstall, canPromptInstall);
  const [standalone, setStandalone] = useState(isStandalone());
  useEffect(() => {
    const mq = window.matchMedia?.('(display-mode: standalone)');
    const on = () => setStandalone(isStandalone());
    mq?.addEventListener?.('change', on);
    return () => mq?.removeEventListener?.('change', on);
  }, []);
  return { canPrompt, standalone, platform: detectPlatform() };
}

/** iOS 공유 아이콘 (네모 + 위쪽 화살표) */
const ShareIcon = () => (
  <svg viewBox="0 0 24 24" className="inline h-5 w-5 align-[-3px] text-sky-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="공유">
    <path d="M12 3v12M8 7l4-4 4 4" />
    <path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
  </svg>
);
const PlusBox = () => (
  <svg viewBox="0 0 24 24" className="inline h-5 w-5 align-[-3px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-label="추가">
    <rect x="3" y="3" width="18" height="18" rx="4" />
    <path d="M12 8v8M8 12h8" />
  </svg>
);

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold">{n}</span>
      <div className="pt-0.5 text-[15px] leading-relaxed text-slate-200">{children}</div>
    </li>
  );
}

/** 플랫폼별 홈 화면 추가 안내 본문 */
export function InstallInstructions({ onInstalled }: { onInstalled?: () => void }) {
  const { canPrompt, standalone, platform } = useInstallState();

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(APP_URL);
      toast('주소를 복사했어요. Safari에 붙여넣어 여세요.');
    } catch {
      prompt('주소를 복사하세요', APP_URL);
    }
  };

  return (
    <div>
      <div className="mb-5 flex items-center gap-4">
        <img src="/apple-touch-icon.png" alt="" className="h-16 w-16 rounded-[22%] shadow-lg shadow-accent/30" />
        <div>
          <div className="text-lg font-bold">{HOME_NAME}</div>
          <div className="text-xs text-slate-400">{APP_URL.replace('https://', '')}</div>
          <div className="mt-1 text-xs text-slate-400">홈 화면에서 앱처럼 전체 화면으로 실행돼요</div>
        </div>
      </div>

      {standalone ? (
        <p className="rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-300">✓ 이미 홈 화면 앱으로 실행 중이에요.</p>
      ) : canPrompt ? (
        <button
          className="btn-primary w-full py-4 text-lg"
          onClick={async () => {
            const r = await promptInstall();
            if (r === 'accepted') {
              toast('홈 화면에 추가했어요');
              onInstalled?.();
            }
          }}
        >
          <PlusBox /> 홈 화면에 추가
        </button>
      ) : platform === 'inapp' ? (
        <div className="space-y-3">
          <p className="rounded-xl bg-amber-500/10 p-3 text-sm text-amber-200">
            카카오톡·인스타그램 등 앱 안의 브라우저에서는 홈 화면에 추가할 수 없어요. <b>Safari</b>(안드로이드는 Chrome)로 열어 주세요.
          </p>
          <ol className="space-y-3">
            <Step n={1}>오른쪽 아래(또는 위) <b>⋯ 메뉴</b> → <b>"다른 브라우저로 열기" / "Safari로 열기"</b></Step>
            <Step n={2}>Safari에서 열리면 이 안내를 다시 따라 하세요</Step>
          </ol>
          <button className="btn-ghost w-full" onClick={copyUrl}>
            📋 주소 복사 ({APP_URL.replace('https://', '')})
          </button>
        </div>
      ) : platform === 'ios-safari' || platform === 'ios-other' ? (
        <ol className="space-y-4">
          {platform === 'ios-other' && (
            <p className="rounded-xl bg-panel2 p-3 text-xs text-slate-300">💡 Safari에서 여는 것을 권장해요. 다른 브라우저는 iOS 16.4 이상에서만 지원돼요.</p>
          )}
          <Step n={1}>
            화면 아래(iPad는 위)의 <b>공유 버튼</b> <ShareIcon /> 을 누르세요
            <div className="text-xs text-slate-400">주소창이 접혀 있으면 화면을 살짝 위로 스크롤하면 보여요</div>
          </Step>
          <Step n={2}>
            목록을 위로 올려 <b>"홈 화면에 추가"</b> <PlusBox /> 를 누르세요
          </Step>
          <Step n={3}>
            이름이 <b>"{HOME_NAME}"</b> 인지 확인하고 오른쪽 위 <b>"추가"</b>를 누르세요
          </Step>
        </ol>
      ) : platform === 'android' ? (
        <ol className="space-y-4">
          <Step n={1}>Chrome 오른쪽 위 <b>⋮ 메뉴</b>를 누르세요</Step>
          <Step n={2}>
            <b>"홈 화면에 추가"</b> 또는 <b>"앱 설치"</b>를 누르세요
          </Step>
          <Step n={3}>
            <b>"설치" / "추가"</b>를 눌러 완료하세요
          </Step>
        </ol>
      ) : (
        <ol className="space-y-4">
          <Step n={1}>Chrome/Edge 주소창 오른쪽의 <b>설치 아이콘</b>(⊕ 모니터 모양)을 누르거나 메뉴 → <b>"앱 설치"</b></Step>
          <Step n={2}>
            아이폰에서는 Safari로 <b>{APP_URL.replace('https://', '')}</b> 를 열고 공유 → "홈 화면에 추가"
          </Step>
        </ol>
      )}
    </div>
  );
}

/** 하단 시트 형태 */
export function InstallSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/70" onClick={onClose}>
      <div className="safe-bottom max-h-[90dvh] w-full max-w-xl overflow-auto rounded-t-3xl bg-panel p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-4 h-1 w-10 rounded bg-line" />
        <h2 className="mb-4 text-lg font-semibold">홈 화면에 추가</h2>
        <InstallInstructions onInstalled={onClose} />
        <button className="btn-ghost mt-5 w-full" onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}

const DISMISS_KEY = 'cnation-mb:installBannerDismissed';

/** 홈 상단 배너: 아직 설치 안 했을 때만 */
export function InstallBanner() {
  const { standalone, canPrompt } = useInstallState();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      const v = Number(localStorage.getItem(DISMISS_KEY) || 0);
      return Date.now() - v < 7 * 24 * 3600 * 1000; // 닫으면 7일간 숨김
    } catch {
      return false;
    }
  });
  if (standalone || dismissed) return null;
  return (
    <>
      <div className="card mb-4 flex items-center gap-3 border-accent/40 bg-accent/10 py-3">
        <img src="/apple-touch-icon.png" alt="" className="h-11 w-11 rounded-[22%]" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">홈 화면에 앱 추가</div>
          <div className="text-xs text-slate-400">"{HOME_NAME}" 아이콘으로 바로 실행</div>
        </div>
        <button
          className="btn-primary h-10 min-h-0 px-3 text-sm"
          onClick={async () => {
            if (canPrompt) {
              const r = await promptInstall();
              if (r !== 'unavailable') return;
            }
            setOpen(true);
          }}
        >
          추가
        </button>
        <button
          aria-label="배너 닫기"
          className="btn h-10 min-h-0 w-8 min-w-0 p-0 text-slate-500"
          onClick={() => {
            try {
              localStorage.setItem(DISMISS_KEY, String(Date.now()));
            } catch {
              /* noop */
            }
            setDismissed(true);
          }}
        >
          ✕
        </button>
      </div>
      {open && <InstallSheet onClose={() => setOpen(false)} />}
    </>
  );
}
