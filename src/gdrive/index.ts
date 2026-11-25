/**
 * 구글 드라이브: Google Identity Services(token client) + Picker API + Drive REST v3
 * 환경변수 VITE_GOOGLE_CLIENT_ID / VITE_GOOGLE_API_KEY / VITE_GOOGLE_APP_ID 필요.
 */
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;
const APP_ID = import.meta.env.VITE_GOOGLE_APP_ID as string | undefined;
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const TOKEN_KEY = 'cnation-mb:gtoken';

export const gdriveConfigured = !!(CLIENT_ID && API_KEY);

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`스크립트 로드 실패: ${src}`));
    document.head.appendChild(s);
  });
}

let gisReady: Promise<void> | null = null;
let pickerReady: Promise<void> | null = null;

function ensureGis() {
  if (!gisReady) gisReady = loadScript('https://accounts.google.com/gsi/client');
  return gisReady;
}
function ensurePicker() {
  if (!pickerReady)
    pickerReady = loadScript('https://apis.google.com/js/api.js').then(
      () => new Promise<void>((resolve) => (window as any).gapi.load('picker', () => resolve())),
    );
  return pickerReady;
}

interface Tok {
  token: string;
  exp: number;
}

function cachedToken(): string | null {
  try {
    const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null') as Tok | null;
    if (t && t.exp > Date.now() + 60000) return t.token;
  } catch {
    /* noop */
  }
  return null;
}

export function isConnected() {
  return !!cachedToken() || localStorage.getItem('cnation-mb:gconnected') === '1';
}

export async function getToken(prompt: '' | 'consent' = ''): Promise<string> {
  if (!gdriveConfigured) throw new Error('구글 드라이브가 설정되지 않았습니다 (환경변수 없음)');
  const c = cachedToken();
  if (c) return c;
  await ensureGis();
  return new Promise((resolve, reject) => {
    const client = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (resp: any) => {
        if (resp.error) return reject(new Error(resp.error_description || resp.error));
        try {
          sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token: resp.access_token, exp: Date.now() + (resp.expires_in ?? 3600) * 1000 }));
          localStorage.setItem('cnation-mb:gconnected', '1');
        } catch {
          /* noop */
        }
        resolve(resp.access_token);
      },
      error_callback: (e: any) => reject(new Error(e?.message || '구글 로그인 취소')),
    });
    client.requestAccessToken({ prompt });
  });
}

export async function disconnect() {
  const t = cachedToken();
  sessionStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem('cnation-mb:gconnected');
  if (t) {
    try {
      await ensureGis();
      (window as any).google.accounts.oauth2.revoke(t, () => {});
    } catch {
      /* noop */
    }
  }
}

export interface DriveDoc {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
}

export const DRIVE_AUDIO_MIMES = 'audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,audio/flac,audio/webm,audio/opus';

export async function pickFiles(mimeTypes?: string): Promise<DriveDoc[]> {
  const token = await getToken();
  await ensurePicker();
  const g = (window as any).google;
  return new Promise((resolve) => {
    const view = new g.picker.DocsView(g.picker.ViewId.DOCS)
      .setMimeTypes(mimeTypes ?? 'audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac,audio/webm,video/mp4,video/quicktime,video/webm')
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false);
    const builder = new g.picker.PickerBuilder()
      .addView(view)
      .enableFeature(g.picker.Feature.MULTISELECT_ENABLED)
      .setOAuthToken(token)
      .setDeveloperKey(API_KEY)
      .setLocale('ko')
      .setCallback((data: any) => {
        if (data.action === g.picker.Action.PICKED) {
          resolve(
            (data.docs as any[]).map((d) => ({ id: d.id, name: d.name, mimeType: d.mimeType, sizeBytes: d.sizeBytes ? Number(d.sizeBytes) : undefined })),
          );
        } else if (data.action === g.picker.Action.CANCEL) resolve([]);
      });
    if (APP_ID) builder.setAppId(APP_ID);
    builder.build().setVisible(true);
  });
}

/** Drive 파일 다운로드 (진행률) */
export async function downloadDriveFile(doc: DriveDoc, onProgress: (loaded: number, total: number) => void, signal?: AbortSignal): Promise<File> {
  const token = await getToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(doc.id)}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
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
