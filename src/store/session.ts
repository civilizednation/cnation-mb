import { create } from 'zustand';
import { Sessions, Songs } from '../db';
import type { Rating, Round, SegmentPreset, Session, Song } from '../types';
import { computeDisplayTitles } from '../ocr/titles';
import { uid } from '../utils/id';
import { formatDate } from '../utils/time';

interface S {
  session: Session | null;
  songs: Record<string, Song>;
  loading: boolean;
  recent: Session[];
  loadRecent: () => Promise<void>;
  open: (id: string) => Promise<Session | null>;
  close: () => void;
  createSession: () => Session;
  save: (s?: Session) => Promise<void>;
  rename: (name: string) => Promise<void>;
  orderedSongs: () => Song[];
  addSongs: (sessionId: string, songs: Song[]) => Promise<void>;
  updateSong: (id: string, patch: Partial<Song>) => Promise<void>;
  removeSong: (id: string) => Promise<void>;
  reorder: (ids: string[]) => Promise<void>;
  startRound: (r: Omit<Round, 'id' | 'startedAt' | 'ratings'>) => Promise<Round>;
  rate: (roundId: string, songId: string, rating: Rating | undefined) => Promise<void>;
  completeRound: (roundId: string) => Promise<void>;
  deleteRound: (roundId: string) => Promise<void>;
  setBest: (songId: string | undefined) => Promise<void>;
  savePreset: (p: Omit<SegmentPreset, 'id'>) => Promise<void>;
  deletePreset: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
}

/** 제목 변경 시 중복 번호 재계산 */
function recomputeTitles(order: string[], songs: Record<string, Song>): Record<string, Song> {
  const list = order.map((id) => songs[id]).filter(Boolean);
  const disp = computeDisplayTitles(list.map((s) => s.title));
  const next = { ...songs };
  list.forEach((s, i) => {
    if (s.displayTitle !== disp[i]) next[s.id] = { ...s, displayTitle: disp[i] };
  });
  return next;
}

export const useSession = create<S>((set, get) => ({
  session: null,
  songs: {},
  loading: false,
  recent: [],

  loadRecent: async () => set({ recent: await Sessions.list() }),

  open: async (id) => {
    if (get().session?.id === id) return get().session;
    set({ loading: true });
    const s = await Sessions.get(id);
    if (!s) {
      set({ loading: false });
      return null;
    }
    const songs = await Songs.bySession(id);
    const map: Record<string, Song> = {};
    for (const so of songs) map[so.id] = so;
    // songIds에 없는 곡(비정상 종료 등) 정리
    const songIds = s.songIds.filter((x) => map[x]);
    set({ session: { ...s, songIds }, songs: map, loading: false });
    return s;
  },

  close: () => set({ session: null, songs: {} }),

  createSession: () => {
    const now = Date.now();
    const s: Session = {
      id: uid('s_'),
      name: `${formatDate(now)} 비교`,
      createdAt: now,
      updatedAt: now,
      songIds: [],
      rounds: [],
      segmentPresets: [],
    };
    set({ session: s, songs: {} });
    return s;
  },

  save: async (s) => {
    const sess = s ?? get().session;
    if (!sess) return;
    const next = { ...sess, updatedAt: Date.now() };
    set({ session: next });
    await Sessions.put(next);
  },

  rename: async (name) => {
    const s = get().session;
    if (!s) return;
    await get().save({ ...s, name: name.trim() || s.name });
  },

  orderedSongs: () => {
    const { session, songs } = get();
    return session ? session.songIds.map((id) => songs[id]).filter(Boolean) : [];
  },

  addSongs: async (sessionId, list) => {
    let s = get().session;
    if (!s || s.id !== sessionId) {
      await get().open(sessionId);
      s = get().session;
    }
    if (!s) throw new Error('세션 없음');
    const songIds = [...s.songIds, ...list.map((x) => x.id)];
    let songs = { ...get().songs };
    for (const so of list) songs[so.id] = so;
    songs = recomputeTitles(songIds, songs);
    set({ songs });
    await Songs.putMany(songIds.map((id) => songs[id]));
    await get().save({ ...s, songIds });
  },

  updateSong: async (id, patch) => {
    const { session } = get();
    let songs = { ...get().songs, [id]: { ...get().songs[id], ...patch } };
    if ('title' in patch && session) {
      songs = recomputeTitles(session.songIds, songs);
      set({ songs });
      await Songs.putMany(session.songIds.map((x) => songs[x]));
    } else {
      set({ songs });
      await Songs.put(songs[id]);
    }
    if (session) await get().save();
  },

  removeSong: async (id) => {
    const { session } = get();
    const song = get().songs[id];
    if (!session || !song) return;
    const songIds = session.songIds.filter((x) => x !== id);
    const songs = { ...get().songs };
    delete songs[id];
    const next = recomputeTitles(songIds, songs);
    set({ songs: next });
    await Songs.delete(song);
    await Songs.putMany(songIds.map((x) => next[x]));
    await get().save({
      ...session,
      songIds,
      bestSongId: session.bestSongId === id ? undefined : session.bestSongId,
      rounds: session.rounds.map((r) => ({ ...r, songOrder: r.songOrder.filter((x) => x !== id) })),
    });
  },

  reorder: async (ids) => {
    const { session } = get();
    if (!session) return;
    const songs = recomputeTitles(ids, get().songs);
    set({ songs });
    await Songs.putMany(ids.map((x) => songs[x]));
    await get().save({ ...session, songIds: ids });
  },

  startRound: async (r) => {
    const s = get().session!;
    const round: Round = { ...r, id: uid('r_'), startedAt: Date.now(), ratings: {} };
    await get().save({ ...s, rounds: [...s.rounds, round] });
    return round;
  },

  rate: async (roundId, songId, rating) => {
    const s = get().session!;
    await get().save({
      ...s,
      rounds: s.rounds.map((r) => (r.id === roundId ? { ...r, ratings: { ...r.ratings, [songId]: rating } } : r)),
    });
  },

  completeRound: async (roundId) => {
    const s = get().session!;
    await get().save({ ...s, rounds: s.rounds.map((r) => (r.id === roundId ? { ...r, completedAt: r.completedAt ?? Date.now() } : r)) });
  },

  deleteRound: async (roundId) => {
    const s = get().session!;
    await get().save({ ...s, rounds: s.rounds.filter((r) => r.id !== roundId) });
  },

  setBest: async (songId) => {
    const s = get().session!;
    await get().save({ ...s, bestSongId: songId });
  },

  savePreset: async (p) => {
    const s = get().session!;
    await get().save({ ...s, segmentPresets: [...s.segmentPresets, { ...p, id: uid('p_') }] });
  },

  deletePreset: async (id) => {
    const s = get().session!;
    await get().save({ ...s, segmentPresets: s.segmentPresets.filter((p) => p.id !== id) });
  },

  deleteSession: async (id) => {
    await Sessions.delete(id);
    if (get().session?.id === id) set({ session: null, songs: {} });
    await get().loadRecent();
  },
}));

/** 곡별 평균 별점 (평가된 라운드만) */
export function averageRating(rounds: Round[], songId: string): number | null {
  const v = rounds.map((r) => r.ratings[songId]).filter((x): x is Rating => !!x);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
