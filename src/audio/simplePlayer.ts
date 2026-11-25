import { create } from 'zustand';
import { titleFromFileName } from '../ocr/titles';
import { uid } from '../utils/id';
import { encodeWav } from './decode';
import { claimAudio, onOtherAudio } from './exclusive';

/**
 * 단순 연속 재생 플레이어 (HTML <audio>).
 * - 여러 곡을 순서대로 이어서 재생, 전체 반복
 * - iOS: 무음 스위치와 무관하게 재생, 잠금화면/백그라운드 재생, 잠금화면 컨트롤
 */
export interface Track {
  id: string;
  name: string;
  title: string;
  url: string;
  size: number;
  error?: boolean;
}

interface S {
  tracks: Track[];
  index: number; // -1 = 없음
  playing: boolean;
  repeatAll: boolean;
  time: number;
  duration: number;
  addFiles: (files: File[], autoplay?: boolean) => void;
  playAt: (i: number) => void;
  toggle: () => void;
  next: (auto?: boolean) => void;
  prev: () => void;
  seek: (t: number) => void;
  remove: (id: string) => void;
  clear: () => void;
  setRepeat: (v: boolean) => void;
}

let audio: HTMLAudioElement | null = null;
let silentUrl: string | null = null;

function el(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.preload = 'auto';
    audio.setAttribute('playsinline', '');
    audio.addEventListener('timeupdate', () => useSimplePlayer.setState({ time: audio!.currentTime }));
    audio.addEventListener('durationchange', () => useSimplePlayer.setState({ duration: Number.isFinite(audio!.duration) ? audio!.duration : 0 }));
    audio.addEventListener('play', () => useSimplePlayer.setState({ playing: true }));
    audio.addEventListener('pause', () => useSimplePlayer.setState({ playing: false }));
    audio.addEventListener('ended', () => useSimplePlayer.getState().next(true));
    audio.addEventListener('error', () => {
      const s = useSimplePlayer.getState();
      const cur = s.tracks[s.index];
      if (!cur || !audio!.src || audio!.src === silentUrl) return;
      // 재생할 수 없는 파일은 표시하고 다음 곡으로
      useSimplePlayer.setState({ tracks: s.tracks.map((t) => (t.id === cur.id ? { ...t, error: true } : t)) });
      if (s.tracks.some((t) => !t.error && t.id !== cur.id)) s.next(true);
    });
    onOtherAudio('simple', () => audio?.pause());
  }
  return audio;
}

/**
 * iOS: 파일 선택 창을 여는 '탭' 안에서 미리 호출해 두면,
 * 파일을 고른 뒤(제스처 밖에서) 바로 재생할 수 있다.
 */
export function primeSimpleAudio() {
  const a = el();
  if (useSimplePlayer.getState().playing) return;
  try {
    if (!silentUrl) silentUrl = URL.createObjectURL(encodeWav([new Float32Array(4410)], 44100));
    if (!a.src || a.src === silentUrl) {
      a.src = silentUrl;
      a.play().then(() => a.pause()).catch(() => {});
    }
  } catch {
    /* noop */
  }
}

function updateMediaSession(t: Track | undefined) {
  const ms = (navigator as any).mediaSession;
  if (!ms || !t) return;
  try {
    ms.metadata = new (window as any).MediaMetadata({
      title: t.title,
      artist: 'c.음악비교분석',
      album: '연속 듣기',
      artwork: [{ src: '/icon-512.png', sizes: '512x512', type: 'image/png' }],
    });
    const s = useSimplePlayer.getState;
    ms.setActionHandler('play', () => s().toggle());
    ms.setActionHandler('pause', () => s().toggle());
    ms.setActionHandler('previoustrack', () => s().prev());
    ms.setActionHandler('nexttrack', () => s().next());
    ms.setActionHandler('seekto', (d: any) => d?.seekTime != null && s().seek(d.seekTime));
  } catch {
    /* noop */
  }
}

export const useSimplePlayer = create<S>((set, get) => ({
  tracks: [],
  index: -1,
  playing: false,
  repeatAll: (() => {
    try {
      return localStorage.getItem('cnation-mb:repeatAll') !== '0';
    } catch {
      return true;
    }
  })(),
  time: 0,
  duration: 0,

  addFiles: (files, autoplay = true) => {
    const add: Track[] = files.map((f) => ({ id: uid('t_'), name: f.name, title: titleFromFileName(f.name), url: URL.createObjectURL(f), size: f.size }));
    if (!add.length) return;
    const wasEmpty = get().index < 0 || !get().playing;
    const start = get().tracks.length;
    set({ tracks: [...get().tracks, ...add] });
    if (autoplay && wasEmpty) get().playAt(start);
  },

  playAt: (i) => {
    const t = get().tracks[i];
    if (!t) return;
    const a = el();
    claimAudio('simple');
    set({ index: i, time: 0, duration: 0 });
    a.src = t.url;
    a.currentTime = 0;
    a.play().catch(() => set({ playing: false }));
    updateMediaSession(t);
  },

  toggle: () => {
    const a = el();
    const { index, tracks } = get();
    if (index < 0) {
      if (tracks.length) get().playAt(0);
      return;
    }
    if (a.paused) {
      claimAudio('simple');
      if (!a.src || a.src === silentUrl) get().playAt(index);
      else a.play().catch(() => {});
    } else a.pause();
  },

  next: (auto = false) => {
    const { index, tracks, repeatAll } = get();
    if (!tracks.length) return;
    let i = index + 1;
    if (i >= tracks.length) {
      if (!repeatAll && auto) {
        // 마지막 곡이 끝남 → 처음으로 돌아가 멈춤
        set({ index: 0, time: 0 });
        el().src = tracks[0].url;
        return;
      }
      i = 0;
    }
    get().playAt(i);
  },

  prev: () => {
    const { index, tracks } = get();
    if (!tracks.length) return;
    // 3초 이상 들었으면 처음부터, 아니면 이전 곡
    if (el().currentTime > 3) return get().seek(0);
    get().playAt(index - 1 < 0 ? tracks.length - 1 : index - 1);
  },

  seek: (t) => {
    const a = el();
    a.currentTime = Math.max(0, Math.min(t, a.duration || t));
    set({ time: a.currentTime });
  },

  remove: (id) => {
    const { tracks, index } = get();
    const i = tracks.findIndex((t) => t.id === id);
    if (i < 0) return;
    URL.revokeObjectURL(tracks[i].url);
    const rest = tracks.filter((t) => t.id !== id);
    if (i === index) {
      el().pause();
      set({ tracks: rest, index: -1, time: 0, duration: 0 });
      if (rest.length) get().playAt(Math.min(i, rest.length - 1));
    } else set({ tracks: rest, index: i < index ? index - 1 : index });
  },

  clear: () => {
    const a = el();
    a.pause();
    a.removeAttribute('src');
    a.load();
    for (const t of get().tracks) URL.revokeObjectURL(t.url);
    set({ tracks: [], index: -1, playing: false, time: 0, duration: 0 });
  },

  setRepeat: (v) => {
    try {
      localStorage.setItem('cnation-mb:repeatAll', v ? '1' : '0');
    } catch {
      /* noop */
    }
    set({ repeatAll: v });
  },
}));

/** 재생 가능한 오디오 파일만 (영상 제외) */
export const AUDIO_ACCEPT = 'audio/*,.mp3,.wav,.m4a,.aac,.ogg,.oga,.flac,.webm,.opus';
export function isAudioFile(f: File): boolean {
  if (/^video\//.test(f.type) || /\.(mp4|mov|m4v|avi|mkv)$/i.test(f.name)) return false;
  return /^audio\//.test(f.type) || /\.(mp3|wav|m4a|aac|ogg|oga|flac|webm|opus)$/i.test(f.name);
}
