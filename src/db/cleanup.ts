import { db, SettingsStore } from './index';

/**
 * 자동 정리: blobs 저장소에서 어디에도 연결되지 않은 파일(고아 파일)을 지운다.
 * 연결 대상 = 비교 세션 곡의 오디오·썸네일 + 저장된/현재 연속 듣기 목록.
 * (예: 곡을 추가하는 도중 목록을 비운 경우 남을 수 있는 파일)
 */
export async function cleanupOrphanBlobs(liveKeys: () => string[]): Promise<{ count: number; bytes: number }> {
  const d = await db();
  const songs = await d.getAll('songs');
  const saved = await SettingsStore.get<{ tracks?: { blobKey: string }[] }>('playlist');
  const keep = new Set<string>();
  for (const s of songs) {
    keep.add(s.audioBlobKey);
    if (s.thumbnailBlobKey) keep.add(s.thumbnailBlobKey);
  }
  for (const t of saved?.tracks ?? []) keep.add(t.blobKey);
  const keys = (await d.getAllKeys('blobs')) as string[];
  // 지우기 직전에 지금 화면의 목록도 다시 확인 (그 사이 추가된 곡 보호)
  for (const k of liveKeys()) keep.add(k);
  const orphans = keys.filter((k) => !keep.has(k));
  let bytes = 0;
  for (const k of orphans) {
    const b = await d.get('blobs', k);
    bytes += b?.size ?? 0;
  }
  if (orphans.length) {
    const tx = d.transaction('blobs', 'readwrite');
    for (const k of orphans) tx.store.delete(k);
    await tx.done;
  }
  return { count: orphans.length, bytes };
}
