import { useEffect, useState } from 'react';
import { gdriveConfigured, isConnected, connectedEmail, disconnect, startLogin, consumeAuthError, rememberAccount, redirectUri, RedirectingError } from '../gdrive';
import { toast } from './Toast';

/** 설정 → 구글 드라이브: 사용자용 연결/해제 + 안내, 관리자용 설정 방법 */
export function DriveSettings() {
  const [connected, setConnected] = useState(isConnected());
  const [email, setEmail] = useState(connectedEmail());
  const [ownerOpen, setOwnerOpen] = useState(false);

  useEffect(() => {
    const err = consumeAuthError();
    if (err) toast(err, 'error', 6000);
    rememberAccount().then(() => {
      setConnected(isConnected());
      setEmail(connectedEmail());
    });
  }, []);

  if (!gdriveConfigured) {
    return (
      <div className="card">
        <p className="text-sm">구글 드라이브 연결은 아직 준비 중이에요.</p>
        <p className="mt-1 text-xs text-slate-400">기기에 있는 파일은 지금 바로 불러올 수 있어요. 앱 관리자가 한 번 설정하면 모든 사람이 각자 자기 구글 계정으로 로그인해 쓸 수 있어요.</p>
        <button className="mt-3 text-sm text-accent2 underline" onClick={() => setOwnerOpen(!ownerOpen)}>
          {ownerOpen ? '관리자용 설정 방법 닫기' : '🔧 관리자용: 구글 드라이브 켜는 방법'}
        </button>
        {ownerOpen && <OwnerGuide />}
      </div>
    );
  }

  return (
    <div className="card">
      {connected ? (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 text-sm">
            <div className="text-emerald-300">✓ 연결됨</div>
            <div className="truncate text-xs text-slate-400">{email || '구글 계정'}</div>
          </div>
          <button
            className="btn-ghost shrink-0"
            onClick={async () => {
              if (!confirm('이 기기에서 구글 드라이브 연결을 해제할까요?')) return;
              await disconnect();
              setConnected(false);
              setEmail(null);
              toast('연결을 해제했어요');
            }}
          >
            연결 해제
          </button>
        </div>
      ) : (
        <button
          className="btn w-full bg-white py-3 font-semibold text-slate-800"
          onClick={() => {
            try {
              startLogin({ forceInteractive: true });
            } catch (e) {
              if (!(e instanceof RedirectingError)) toast(String((e as Error)?.message ?? e), 'error');
            }
          }}
        >
          <GoogleG /> 구글 계정으로 로그인
        </button>
      )}
      <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-slate-400">
        <li>각자 <b>자기 폰에서 자기 구글 계정</b>으로 한 번만 로그인하면, 다음부터는 드라이브 버튼만 누르면 자동으로 연결돼요.</li>
        <li>내가 드라이브 선택 창에서 고른 파일만 이 기기로 내려받아요. 다른 파일이나 다른 사람 드라이브에는 접근하지 않아요.</li>
        <li>"Google에서 확인하지 않은 앱" 화면이 나오면 <b>고급 → (앱 이름)(으)로 이동</b>을 누르세요.</li>
        <li>"액세스 차단됨"이 나오면 앱 관리자에게 내 구글 이메일 등록을 요청하세요.</li>
      </ul>
      {connected && (
        <button className="mt-3 text-xs text-slate-400 underline" onClick={() => { try { startLogin({ forceInteractive: true }); } catch { /* redirect */ } }}>
          다른 구글 계정으로 다시 로그인
        </button>
      )}
    </div>
  );
}

function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/** 관리자(앱 주인)용 1회 설정 방법 */
function OwnerGuide() {
  const origin = location.origin;
  return (
    <ol className="mt-3 list-decimal space-y-2 pl-5 text-xs leading-relaxed text-slate-300">
      <li>
        <a className="text-accent2 underline" href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">
          Google Cloud Console
        </a>
        에서 새 프로젝트 만들기 (예: cnation-mb)
      </li>
      <li>API 및 서비스 → 라이브러리 → <b>Google Drive API</b>, <b>Google Picker API</b> 사용 설정</li>
      <li>
        OAuth 동의 화면(Google 인증 플랫폼) → 외부 → 앱 이름 <b>c.음악비교분석</b>, 이메일 입력 → 데이터 액세스(범위)에 <code>drive.file</code> 추가 → <b>앱 게시</b>(프로덕션) — drive.file만 쓰므로 보안 심사 없이 누구나 사용 가능
      </li>
      <li>
        사용자 인증 정보 → OAuth 클라이언트 ID → <b>웹 애플리케이션</b>
        <br />· 승인된 JavaScript 원본: <code>{origin}</code>
        <br />· 승인된 리디렉션 URI: <code>{redirectUri()}</code>
      </li>
      <li>
        사용자 인증 정보 → <b>API 키</b> 만들기 → 웹사이트 제한 <code>{origin}/*</code>, API 제한: Picker API·Drive API
      </li>
      <li>프로젝트 대시보드의 <b>프로젝트 번호</b>(숫자) 확인</li>
      <li>
        Vercel → cnation-mb → Settings → Environment Variables에 추가 후 <b>Redeploy</b>
        <br />
        <code>VITE_GOOGLE_CLIENT_ID</code> (4번) · <code>VITE_GOOGLE_API_KEY</code> (5번) · <code>VITE_GOOGLE_APP_ID</code> (6번)
      </li>
    </ol>
  );
}
