/** 홈 화면 추가(PWA 설치) 상태·플랫폼 감지 */
type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

let deferred: BIPEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** main.tsx에서 가장 먼저 호출 — 이벤트가 일찍 발생해도 놓치지 않도록 */
export function initInstallCapture() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BIPEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    try {
      localStorage.setItem('cnation-mb:installed', '1');
    } catch {
      /* noop */
    }
    emit();
  });
}

export function subscribeInstall(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export const canPromptInstall = () => !!deferred;

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferred) return 'unavailable';
  const e = deferred;
  deferred = null;
  emit();
  await e.prompt();
  return (await e.userChoice).outcome;
}

export function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
}

export type Platform = 'ios-safari' | 'ios-other' | 'inapp' | 'android' | 'desktop';

export function detectPlatform(ua = navigator.userAgent): Platform {
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
  if (/KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\/|DaumApps|everytimeApp|; wv\)/i.test(ua)) return 'inapp';
  if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS|Whale/i.test(ua) ? 'ios-other' : 'ios-safari';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

export const APP_URL = 'https://cnation-mb.vercel.app';
export const HOME_NAME = 'c.음악비교분석';
