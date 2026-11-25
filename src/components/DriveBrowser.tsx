import { useEffect, useRef, useState } from 'react';
import { listDrive, type DriveItem, type ListMode, type MediaKind, RedirectingError } from '../gdrive';
import { formatBytes } from '../utils/time';

type Tab = 'mine' | 'recent' | 'shared';

/**
 * 앱 자체 구글 드라이브 탐색 화면 (구글 Picker 대체 — iPhone에서도 동작).
 * 폴더 이동 · 최근 · 공유 문서함 · 검색 · 여러 개 선택.
 */
export function DriveBrowser({ kind, onClose, onPick }: { kind: MediaKind; onClose: () => void; onPick: (items: DriveItem[]) => void }) {
  const [tab, setTab] = useState<Tab>('mine');
  const [path, setPath] = useState<{ id: string; name: string }[]>([]);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<DriveItem[]>([]);
  const [next, setNext] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<Map<string, DriveItem>>(new Map());
  const reqId = useRef(0);

  const folder = path[path.length - 1];
  const mode: ListMode = search ? 'search' : tab === 'recent' ? 'recent' : tab === 'shared' && !folder ? 'shared' : 'folder';
  const folderId = folder?.id ?? 'root';

  const load = async (pageToken?: string) => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const r = await listDrive({ mode, kind, folderId, query: search, pageToken });
      if (id !== reqId.current) return;
      setItems((prev) => (pageToken ? [...prev, ...r.items] : r.items));
      setNext(r.nextPageToken);
    } catch (e) {
      if (e instanceof RedirectingError) return;
      if (id === reqId.current) setError(String((e as Error)?.message ?? e));
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  };

  useEffect(() => {
    setItems([]);
    load();
  }, [mode, folderId, search]); // eslint-disable-line react-hooks/exhaustive-deps

  const openFolder = (f: DriveItem) => {
    setSearch('');
    setQuery('');
    setPath((p) => [...p, { id: f.id, name: f.name }]);
  };

  const switchTab = (t: Tab) => {
    setTab(t);
    setPath([]);
    setSearch('');
    setQuery('');
  };

  const toggle = (f: DriveItem) => {
    const n = new Map(sel);
    if (n.has(f.id)) n.delete(f.id);
    else n.set(f.id, f);
    setSel(n);
  };

  const files = items.filter((i) => !i.isFolder);
  const allSelected = files.length > 0 && files.every((f) => sel.has(f.id));

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg">
      <header className="safe-top border-b border-line bg-panel">
        <div className="mx-auto flex h-14 max-w-xl items-center gap-2 px-2">
          <button className="btn min-w-[44px] px-2 text-lg text-slate-300" onClick={onClose} aria-label="닫기">
            ✕
          </button>
          <h2 className="flex-1 truncate font-semibold">☁️ 구글 드라이브</h2>
          <span className="pr-2 text-xs text-slate-400">{kind === 'audio' ? '음악 파일' : '음악·영상 파일'}</span>
        </div>
        <div className="mx-auto max-w-xl px-3 pb-2">
          <form
            className="mb-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(query.trim());
            }}
          >
            <input className="input min-h-[40px] py-1.5" placeholder="파일·폴더 이름 검색" value={query} onChange={(e) => setQuery(e.target.value)} enterKeyHint="search" />
            {search ? (
              <button type="button" className="btn-ghost h-10 min-h-0 shrink-0 whitespace-nowrap px-3 text-sm" onClick={() => (setSearch(''), setQuery(''))}>
                취소
              </button>
            ) : (
              <button type="submit" className="btn-ghost h-10 min-h-0 shrink-0 whitespace-nowrap px-3 text-sm">
                검색
              </button>
            )}
          </form>
          {!search && (
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-bg p-1 text-sm">
              {(
                [
                  ['mine', '내 드라이브'],
                  ['recent', '최근'],
                  ['shared', '공유 문서함'],
                ] as [Tab, string][]
              ).map(([t, label]) => (
                <button key={t} className={`btn h-9 min-h-0 px-1 ${tab === t ? 'bg-accent text-white' : 'text-slate-300'}`} onClick={() => switchTab(t)}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 overflow-y-auto px-3 py-2">
        {/* 경로 */}
        {!search && tab !== 'recent' && (
          <nav className="mb-2 flex flex-wrap items-center gap-1 text-sm text-slate-400">
            <button className="underline-offset-2 hover:underline" onClick={() => setPath([])}>
              {tab === 'shared' ? '공유 문서함' : '내 드라이브'}
            </button>
            {path.map((p, i) => (
              <span key={p.id} className="flex items-center gap-1">
                <span>›</span>
                <button className={i === path.length - 1 ? 'text-slate-200' : 'hover:underline'} onClick={() => setPath(path.slice(0, i + 1))}>
                  {p.name}
                </button>
              </span>
            ))}
          </nav>
        )}
        {search && <p className="mb-2 text-sm text-slate-400">"{search}" 검색 결과</p>}

        {files.length > 1 && (
          <button className="mb-2 text-sm text-accent2" onClick={() => setSel((s) => {
            const n = new Map(s);
            if (allSelected) files.forEach((f) => n.delete(f.id));
            else files.forEach((f) => n.set(f.id, f));
            return n;
          })}>
            {allSelected ? '이 목록 선택 해제' : `이 목록 파일 모두 선택 (${files.length})`}
          </button>
        )}

        <ul className="space-y-1.5">
          {items.map((f) =>
            f.isFolder ? (
              <li key={f.id}>
                <button className="flex min-h-[52px] w-full items-center gap-3 rounded-xl border border-line bg-panel px-3 text-left active:bg-panel2" onClick={() => openFolder(f)}>
                  <span className="text-xl">📁</span>
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <span className="text-slate-500">›</span>
                </button>
              </li>
            ) : (
              <li key={f.id}>
                <button
                  role="checkbox"
                  aria-checked={sel.has(f.id)}
                  className={`flex min-h-[56px] w-full items-center gap-3 rounded-xl border px-3 text-left ${sel.has(f.id) ? 'border-accent/60 bg-accent/10' : 'border-line bg-panel'}`}
                  onClick={() => toggle(f)}
                >
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-sm ${sel.has(f.id) ? 'border-accent bg-accent text-white' : 'border-slate-500'}`}>
                    {sel.has(f.id) ? '✓' : ''}
                  </span>
                  <span className="text-lg">{f.mimeType.startsWith('video/') ? '🎬' : '🎵'}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{f.name}</span>
                    <span className="block text-xs text-slate-500">
                      {f.sizeBytes ? formatBytes(f.sizeBytes) : ''}
                      {f.modifiedTime ? ` · ${f.modifiedTime.slice(0, 10)}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            ),
          )}
        </ul>

        {loading && <p className="py-6 text-center text-sm text-slate-400">불러오는 중…</p>}
        {!loading && !error && items.length === 0 && (
          <p className="py-10 text-center text-sm text-slate-400">{kind === 'audio' ? '음악 파일이나 폴더가 없어요' : '음악·영상 파일이나 폴더가 없어요'}</p>
        )}
        {error && (
          <div className="my-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-300">
            {error}
            <button className="ml-2 underline" onClick={() => load()}>
              다시 시도
            </button>
          </div>
        )}
        {next && !loading && (
          <button className="btn-ghost my-3 w-full" onClick={() => load(next)}>
            더 보기
          </button>
        )}
      </main>

      <footer className="safe-bottom border-t border-line bg-panel px-3 pt-3">
        <div className="mx-auto max-w-xl">
          <button className="btn-primary w-full py-4 text-lg" disabled={!sel.size} onClick={() => onPick([...sel.values()])}>
            {sel.size ? `선택한 ${sel.size}개 불러오기` : '파일을 선택하세요'}
          </button>
        </div>
      </footer>
    </div>
  );
}
