import { Blobs } from '../db';
import type { Song } from '../types';
import { getAudioContext, unlockAudio } from './decode';

const FADE = 0.01; // 10ms
const MAX_CACHE = 3;

type Listener = () => void;

/**
 * Web Audio 재생 엔진.
 * - 곡별 Blob을 AudioBuffer로 디코딩, 최대 3곡 LRU 캐시 (현재 + 다음 프리로드)
 * - AudioBufferSourceNode.start(when, offset, duration)으로 샘플 단위 구간 재생
 * - 모든 위치는 곡의 0:00(첫 소리) 기준 상대 초(rel)로 다룬다
 */
class Player {
  private cache = new Map<string, AudioBuffer>();
  private loading = new Map<string, Promise<AudioBuffer>>();
  private src: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private listeners = new Set<Listener>();

  song: Song | null = null;
  relStart = 0;
  relEnd = 0;
  loop = false;
  playing = false;
  private startedAtCtx = 0;
  private startedRel = 0;
  private pausedRel = 0;
  private onEnded: (() => void) | null = null;
  private token = 0;

  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  private emit() {
    for (const l of this.listeners) l();
  }

  async load(song: Song): Promise<AudioBuffer> {
    const hit = this.cache.get(song.id);
    if (hit) {
      this.cache.delete(song.id);
      this.cache.set(song.id, hit);
      return hit;
    }
    const inflight = this.loading.get(song.id);
    if (inflight) return inflight;
    const p = (async () => {
      const blob = await Blobs.get(song.audioBlobKey);
      if (!blob) throw new Error('오디오 데이터가 없습니다');
      const ab = await getAudioContext().decodeAudioData(await blob.arrayBuffer());
      this.cache.set(song.id, ab);
      while (this.cache.size > MAX_CACHE) {
        const oldest = [...this.cache.keys()].find((k) => k !== this.song?.id);
        if (!oldest) break;
        this.cache.delete(oldest);
      }
      return ab;
    })().finally(() => this.loading.delete(song.id));
    this.loading.set(song.id, p);
    return p;
  }

  preload(song: Song | undefined) {
    if (song) this.load(song).catch(() => {});
  }

  /** 곡의 실제 재생 가능 길이 (0:00 ~ 끝) */
  static lengthOf(song: Song) {
    return song.endInBlobSec - song.startInBlobSec;
  }

  position(): number {
    if (!this.playing) return this.pausedRel;
    const ctx = getAudioContext();
    let rel = this.startedRel + (ctx.currentTime - this.startedAtCtx);
    if (this.loop && this.relEnd > this.relStart) {
      const len = this.relEnd - this.relStart;
      rel = this.relStart + ((rel - this.relStart) % len);
    }
    return Math.min(rel, this.relEnd);
  }

  /**
   * 구간 재생. relStart/relEnd는 곡 0:00 기준 초 (offsetSec 보정 포함해서 넘길 것).
   * relEnd가 곡 끝보다 길면 곡 끝까지만.
   */
  async play(song: Song, relStart: number, relEnd: number, opts: { onEnded?: () => void; loop?: boolean; from?: number } = {}) {
    await unlockAudio();
    const token = ++this.token;
    this.stopNode();
    this.song = song;
    const len = Player.lengthOf(song);
    this.relStart = Math.max(-song.startInBlobSec, relStart);
    this.relEnd = Math.min(len, relEnd);
    this.loop = !!opts.loop;
    this.onEnded = opts.onEnded ?? null;
    this.pausedRel = opts.from ?? this.relStart;
    this.emit();
    const buf = await this.load(song);
    if (token !== this.token) return;
    this.startAt(buf, this.pausedRel);
  }

  private startAt(buf: AudioBuffer, rel: number) {
    const ctx = getAudioContext();
    const song = this.song!;
    rel = Math.max(this.relStart, Math.min(rel, this.relEnd));
    const offset = Math.max(0, song.startInBlobSec + rel);
    const dur = Math.max(0, this.relEnd - rel);
    if (dur <= 0.005 && !this.loop) {
      this.finish();
      return;
    }
    const g = ctx.createGain();
    g.connect(ctx.destination);
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.connect(g);
    const now = ctx.currentTime + 0.02;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(1, now + FADE);
    if (this.loop) {
      s.loop = true;
      s.loopStart = Math.max(0, song.startInBlobSec + this.relStart);
      s.loopEnd = Math.max(s.loopStart + 0.05, song.startInBlobSec + this.relEnd);
      s.start(now, offset);
    } else {
      s.start(now, offset, dur);
      g.gain.setValueAtTime(1, now + Math.max(FADE, dur - FADE));
      g.gain.linearRampToValueAtTime(0, now + dur);
    }
    const token = this.token;
    s.onended = () => {
      if (token === this.token && this.src === s) this.finish();
    };
    this.src = s;
    this.gain = g;
    this.startedAtCtx = now;
    this.startedRel = rel;
    this.playing = true;
    this.emit();
  }

  private finish() {
    this.playing = false;
    this.pausedRel = this.relEnd;
    this.src = null;
    this.emit();
    const cb = this.onEnded;
    this.onEnded = null;
    cb?.();
  }

  private stopNode() {
    const s = this.src;
    const g = this.gain;
    this.src = null;
    this.gain = null;
    if (s && g) {
      const ctx = getAudioContext();
      const t = ctx.currentTime;
      try {
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(g.gain.value, t);
        g.gain.linearRampToValueAtTime(0, t + FADE);
        s.stop(t + FADE + 0.005);
      } catch {
        /* noop */
      }
    }
  }

  pause() {
    if (!this.playing) return;
    this.pausedRel = this.position();
    this.token++;
    this.stopNode();
    this.playing = false;
    this.emit();
  }

  async resume() {
    if (this.playing || !this.song) return;
    await unlockAudio();
    const token = ++this.token;
    const buf = await this.load(this.song);
    if (token !== this.token) return;
    if (this.pausedRel >= this.relEnd - 0.01) this.pausedRel = this.relStart;
    this.startAt(buf, this.pausedRel);
  }

  async seek(rel: number) {
    rel = Math.max(this.relStart, Math.min(rel, this.relEnd));
    if (!this.song) return;
    if (this.playing) {
      const token = ++this.token;
      this.stopNode();
      const buf = await this.load(this.song);
      if (token !== this.token) return;
      this.startAt(buf, rel);
    } else {
      this.pausedRel = rel;
      this.emit();
    }
  }

  setRange(relStart: number, relEnd: number) {
    this.relStart = relStart;
    this.relEnd = Math.min(relEnd, this.song ? Player.lengthOf(this.song) : relEnd);
    this.emit();
  }

  stop() {
    this.token++;
    this.stopNode();
    this.playing = false;
    this.onEnded = null;
    this.emit();
  }

  clear() {
    this.stop();
    this.cache.clear();
    this.song = null;
  }
}

export const player = new Player();
export const songLength = Player.lengthOf;

// ---- 화면 꺼짐 방지 / 잠금화면 메타데이터 ----
let wakeLock: any = null;
export async function keepAwake(on: boolean) {
  try {
    if (on && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await (navigator as any).wakeLock.request('screen');
      wakeLock.addEventListener?.('release', () => (wakeLock = null));
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    wakeLock = null;
  }
}

export function setMediaSession(
  title: string,
  artist: string,
  handlers: { prev?: () => void; next?: () => void; play?: () => void; pause?: () => void },
  artworkUrl?: string,
) {
  const ms = (navigator as any).mediaSession;
  if (!ms) return;
  try {
    ms.metadata = new (window as any).MediaMetadata({
      title,
      artist,
      album: 'cnation 음악 비교',
      artwork: artworkUrl ? [{ src: artworkUrl, sizes: '360x640', type: 'image/jpeg' }] : [{ src: '/icon-512.png', sizes: '512x512', type: 'image/png' }],
    });
    ms.setActionHandler('previoustrack', handlers.prev ?? null);
    ms.setActionHandler('nexttrack', handlers.next ?? null);
    ms.setActionHandler('play', handlers.play ?? null);
    ms.setActionHandler('pause', handlers.pause ?? null);
  } catch {
    /* noop */
  }
}
