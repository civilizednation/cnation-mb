import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Session, Song } from '../types';

interface MbDB extends DBSchema {
  sessions: { key: string; value: Session; indexes: { updatedAt: number } };
  songs: { key: string; value: Song; indexes: { sessionId: string } };
  blobs: { key: string; value: Blob };
  settings: { key: string; value: unknown };
}

let dbp: Promise<IDBPDatabase<MbDB>> | null = null;

export function db() {
  if (!dbp) {
    dbp = openDB<MbDB>('cnation-mb', 1, {
      upgrade(d) {
        const s = d.createObjectStore('sessions', { keyPath: 'id' });
        s.createIndex('updatedAt', 'updatedAt');
        const so = d.createObjectStore('songs', { keyPath: 'id' });
        so.createIndex('sessionId', 'sessionId');
        d.createObjectStore('blobs');
        d.createObjectStore('settings');
      },
    });
  }
  return dbp;
}

export async function requestPersist() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* noop */
  }
}

export class QuotaError extends Error {
  constructor() {
    super('저장공간이 부족합니다. 설정 → 저장공간에서 오래된 세션을 삭제해 주세요.');
  }
}

function wrapQuota<T>(p: Promise<T>): Promise<T> {
  return p.catch((e) => {
    if (e?.name === 'QuotaExceededError') throw new QuotaError();
    throw e;
  });
}

export const Sessions = {
  async list(): Promise<Session[]> {
    const all = await (await db()).getAll('sessions');
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async get(id: string) {
    return (await db()).get('sessions', id);
  },
  async put(s: Session) {
    return wrapQuota((await db()).put('sessions', s));
  },
  async delete(id: string) {
    const d = await db();
    const songs = await d.getAllFromIndex('songs', 'sessionId', id);
    const tx = d.transaction(['sessions', 'songs', 'blobs'], 'readwrite');
    for (const s of songs) {
      tx.objectStore('songs').delete(s.id);
      tx.objectStore('blobs').delete(s.audioBlobKey);
      if (s.thumbnailBlobKey) tx.objectStore('blobs').delete(s.thumbnailBlobKey);
    }
    tx.objectStore('sessions').delete(id);
    await tx.done;
  },
};

export const Songs = {
  async bySession(sessionId: string): Promise<Song[]> {
    return (await db()).getAllFromIndex('songs', 'sessionId', sessionId);
  },
  async get(id: string) {
    return (await db()).get('songs', id);
  },
  async put(s: Song) {
    return wrapQuota((await db()).put('songs', s));
  },
  async putMany(list: Song[]) {
    const d = await db();
    const tx = d.transaction('songs', 'readwrite');
    for (const s of list) tx.store.put(s);
    await wrapQuota(tx.done);
  },
  async delete(s: Song) {
    const d = await db();
    const tx = d.transaction(['songs', 'blobs'], 'readwrite');
    tx.objectStore('songs').delete(s.id);
    tx.objectStore('blobs').delete(s.audioBlobKey);
    if (s.thumbnailBlobKey) tx.objectStore('blobs').delete(s.thumbnailBlobKey);
    await tx.done;
  },
};

export const Blobs = {
  async get(key: string) {
    return (await db()).get('blobs', key);
  },
  async put(key: string, b: Blob) {
    return wrapQuota((await db()).put('blobs', b, key));
  },
  async delete(key: string) {
    return (await db()).delete('blobs', key);
  },
};

export const SettingsStore = {
  async get<T>(key: string): Promise<T | undefined> {
    return (await db()).get('settings', key) as Promise<T | undefined>;
  },
  async put(key: string, v: unknown) {
    return (await db()).put('settings', v, key);
  },
};

export async function storageUsage(): Promise<{ usage: number; quota: number; perSession: Record<string, number> }> {
  const d = await db();
  const songs = await d.getAll('songs');
  const perSession: Record<string, number> = {};
  for (const s of songs) {
    let size = s.sizeBytes ?? 0;
    if (!size) {
      const b = await d.get('blobs', s.audioBlobKey);
      size = b?.size ?? 0;
    }
    perSession[s.sessionId] = (perSession[s.sessionId] ?? 0) + size;
  }
  let usage = 0;
  let quota = 0;
  try {
    const est = await navigator.storage?.estimate?.();
    usage = est?.usage ?? 0;
    quota = est?.quota ?? 0;
  } catch {
    /* noop */
  }
  return { usage, quota, perSession };
}

/** 비교 세션·곡 데이터만 모두 삭제 (연속 듣기 목록은 유지) */
export async function clearAll() {
  const d = await db();
  const songs = await d.getAll('songs');
  const tx = d.transaction(['sessions', 'songs', 'blobs'], 'readwrite');
  for (const s of songs) {
    tx.objectStore('blobs').delete(s.audioBlobKey);
    if (s.thumbnailBlobKey) tx.objectStore('blobs').delete(s.thumbnailBlobKey);
  }
  await Promise.all([tx.objectStore('sessions').clear(), tx.objectStore('songs').clear()]);
  await tx.done;
}
