/**
 * 구글 드라이브 연결
 * - 각 사용자가 자기 기기에서 "구글 계정으로 로그인"을 한 번 하면 이후 자동 연결
 * - 로그인은 리디렉션 방식 (iOS 홈 화면 앱에서 팝업이 막히는 문제 회피):
 *   accounts.google.com → /oauth.html(토큰 저장) → 원래 화면으로 복귀 → 하려던 파일 선택을 자동으로 이어서 진행
 * - 토큰(1시간)이 만료되면 기억해 둔 계정으로 화면 없이 다시 받아 옴 (prompt=none)
 * - 권한: drive.file — 사용자가 Picker에서 직접 고른 파일만 접근 (구글 보안 심사 불필요)
 *
 * 앱 관리자 1회 설정: VITE_GOOGLE_CLIENT_ID / VITE_GOOGLE_API_KEY / VITE_GOOGLE_APP_ID (docs/google-drive-setup.md)
 */
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;
const APP_ID = import.meta.env.VITE_GOOGLE_APP_ID as string | undefined;

export const SCOPE = 'https://www.googleapis.com/auth/drive.file openid email';
export const AUTH_KEY = 'cnation-mb:gauth';
export const PENDING_KEY = 'cnation-mb:gpending';
const ACCOUNT_KEY = 'cnation-mb:gaccount';

/** 앱 관리자가 Google Cloud 설정(환경변수)을 마쳤는지 */
export const gdriveConfigured = !!(CLIENT_ID && API_KEY && APP_ID);

export interface StoredAuth {
  token: string;
  exp: number;
  error?: string;
}

function readJson<T>(k: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(k) || 'null') as T | null;
  } catch {
    return null;
  }
}

function validToken(): string | null {
  const a = readJson<StoredAuth>(AUTH_KEY);
  return a?.token && a.exp > Date.now() + 60_000 ? a.token : null;
}

/** 지금 드라이브를 쓰려면 로그인 화면으로 다녀와야 하는지 */
export function needsLogin(): boolean {
  return !validToken();
}

/** 이 기기에서 구글 계정 연결(로그인)을 한 적이 있는지 */
export function isConnected(): boolean {
  return !!readJson<{ email?: string }>(ACCOUNT_KEY) || !!validToken();
}

export function connectedEmail(): string | null {
  return readJson<{ email?: string }>(ACCOUNT_KEY)?.email ?? null;
}

export function redirectUri(): string {
  return `${location.origin}/oauth.html`;
}

/** 구글 로그인 주소 (리디렉션 방식, 토큰 바로 받기) */
export function buildAuthUrl(opts: { returnTo: string; silent: boolean; hint?: string | null }): string {
  const state = btoa(
    unescape(
      encodeURIComponent(
        JSON.stringify({ r: opts.returnTo, s: opts.silent ? 1 : 0, c: CLIENT_ID, h: opts.hint ?? '', sc: SCOPE }),
      ),
    ),
  );
  const p = new URLSearchParams({
    client_id: CLIENT_ID ?? '',
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: SCOPE,
    include_granted_scopes: 'true',
    state,
  });
  if (opts.hint) p.set('login_hint', opts.hint);
  if (opts.silent) p.set('prompt', 'none');
  else p.set('prompt', opts.hint ? 'consent' : 'select_account consent');
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

/** 지금 화면 경로 (해시 라우터) */
function currentRoute(): string {
  return location.hash.replace(/^#/, '') || '/';
}

export class RedirectingError extends Error {
  constructor() {
    super('구글 로그인 화면으로 이동합니다');
    this.name = 'RedirectingError';
  }
}

/**
 * 구글 로그인 시작 (페이지 이동). pending='pick'이면 돌아온 뒤 같은 화면에서 파일 선택을 자동으로 이어서 연다.
 * 기억된 계정이 있으면 화면 없이(prompt=none) 토큰만 새로 받는다.
 */
export function startLogin(opts: { pending?: 'pick'; forceInteractive?: boolean } = {}): never {
  if (!gdriveConfigured) throw new Error('구글 드라이브가 아직 설정되지 않았어요 (앱 관리자 설정 필요)');
  const returnTo = currentRoute();
  try {
    if (opts.pending) localStorage.setItem(PENDING_KEY, JSON.stringify({ route: returnTo, action: opts.pending, at: Date.now() }));
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    /* noop */
  }
  const hint = connectedEmail();
  location.assign(buildAuthUrl({ returnTo, silent: !!hint && !opts.forceInteractive, hint }));
  throw new RedirectingError();
}

/** 유효한 토큰. 없으면 로그인 화면으로 이동(돌아와서 파일 선택 이어서) */
export function ensureToken(): string {
  const t = validToken();
  if (t) return t;
  return startLogin({ pending: 'pick' });
}

/**
 * 로그인에서 돌아온 직후 이 화면에서 이어서 할 일(파일 선택)이 있으면 true.
 * 한 번 꺼내면 지워진다. 10분 지난 요청은 무시.
 */
export function consumePendingPick(): boolean {
  const p = readJson<{ route: string; action: string; at: number }>(PENDING_KEY);
  if (!p) return false;
  if (p.route !== currentRoute()) return false;
  localStorage.removeItem(PENDING_KEY);
  return p.action === 'pick' && Date.now() - p.at < 10 * 60_000 && !!validToken();
}

/** 로그인 결과 오류 (사용자 취소·차단 등) — 한 번 꺼내면 지워진다 */
export function consumeAuthError(): string | null {
  const a = readJson<StoredAuth>(AUTH_KEY);
  if (!a?.error) return null;
  localStorage.removeItem(AUTH_KEY);
  localStorage.removeItem(PENDING_KEY);
  return friendlyAuthError(a.error);
}

export function friendlyAuthError(code: string): string {
  if (/access_denied/.test(code)) return '구글 로그인이 취소되었거나 이 계정은 아직 허용되지 않았어요. ("액세스 차단됨"이 나왔다면 앱 관리자에게 이메일 등록을 요청하세요)';
  if (/redirect_uri|origin/.test(code)) return '구글 드라이브 설정 오류: 승인된 리디렉션 주소가 맞지 않아요 (앱 관리자 확인 필요)';
  return `구글 로그인 실패: ${code}`;
}

/** 로그인 직후: 계정 이메일을 받아 기억 (다음부터 자동 연결에 사용) */
export async function rememberAccount(): Promise<void> {
  const t = validToken();
  if (!t) return;
  const prev = readJson<{ email?: string }>(ACCOUNT_KEY);
  if (prev?.email) return;
  try {
    const r = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${t}` } });
    const j = r.ok ? await r.json() : {};
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ email: j.email ?? '' }));
  } catch {
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ email: '' }));
  }
}

/** 연결 해제: 권한 취소 + 이 기기의 기억 삭제 */
export async function disconnect() {
  const a = readJson<StoredAuth>(AUTH_KEY);
  localStorage.removeItem(AUTH_KEY);
  localStorage.removeItem(ACCOUNT_KEY);
  localStorage.removeItem(PENDING_KEY);
  if (a?.token) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(a.token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
    } catch {
      /* noop */
    }
  }
}

// ---- Picker ----
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('구글 드라이브 화면을 불러오지 못했어요 (인터넷 연결 확인)'));
    document.head.appendChild(s);
  });
}

let pickerReady: Promise<void> | null = null;
function ensurePicker() {
  if (!pickerReady)
    pickerReady = loadScript('https://apis.google.com/js/api.js')
      .then(() => new Promise<void>((resolve) => (window as any).gapi.load('picker', () => resolve())))
      .catch((e) => {
        pickerReady = null;
        throw e;
      });
  return pickerReady;
}

export interface DriveDoc {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
}

export const DRIVE_AUDIO_MIMES =
  'audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,audio/flac,audio/webm,audio/opus';
export const DRIVE_MEDIA_MIMES =
  'audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac,audio/webm,video/mp4,video/quicktime,video/webm';

/**
 * 드라이브 파일 선택 창. 로그인이 안 되어 있거나 만료됐으면 로그인으로 이동했다가
 * 돌아와서(consumePendingPick) 다시 호출되면 바로 열린다.
 */
export async function pickFiles(mimeTypes: string = DRIVE_MEDIA_MIMES): Promise<DriveDoc[]> {
  const token = ensureToken();
  await ensurePicker();
  const g = (window as any).google;
  return new Promise((resolve) => {
    const view = new g.picker.DocsView(g.picker.ViewId.DOCS).setMimeTypes(mimeTypes).setIncludeFolders(true).setSelectFolderEnabled(false);
    const builder = new g.picker.PickerBuilder()
      .addView(view)
      .enableFeature(g.picker.Feature.MULTISELECT_ENABLED)
      .enableFeature(g.picker.Feature.SUPPORT_DRIVES)
      .setOAuthToken(token)
      .setDeveloperKey(API_KEY)
      .setAppId(APP_ID) // drive.file: 고른 파일에 이 앱의 접근 권한이 부여됨
      .setLocale('ko')
      .setOrigin(location.origin)
      .setCallback((data: any) => {
        if (data.action === g.picker.Action.PICKED) {
          resolve((data.docs as any[]).map((d) => ({ id: d.id, name: d.name, mimeType: d.mimeType, sizeBytes: d.sizeBytes ? Number(d.sizeBytes) : undefined })));
        } else if (data.action === g.picker.Action.CANCEL) resolve([]);
      });
    builder.build().setVisible(true);
  });
}

/** Drive 파일 다운로드 (진행률). 토큰이 만료되면 다시 로그인. */
export async function downloadDriveFile(doc: DriveDoc, onProgress: (loaded: number, total: number) => void, signal?: AbortSignal): Promise<File> {
  const token = ensureToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(doc.id)}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (res.status === 401) {
    localStorage.removeItem(AUTH_KEY);
    startLogin({ pending: 'pick' });
  }
  if (!res.ok) throw new Error(`드라이브 다운로드 실패 (${res.status})`);
  const total = Number(res.headers.get('content-length')) || doc.sizeBytes || 0;
  const reader = res.body?.getReader();
  if (!reader) {
    const b = await res.blob();
    return new File([b], doc.name, { type: doc.mimeType });
  }
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded, total);
  }
  return new File(chunks as BlobPart[], doc.name, { type: doc.mimeType });
}
