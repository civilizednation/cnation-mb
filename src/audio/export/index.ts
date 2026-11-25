import { Blobs } from '../../db';
import type { Song } from '../../types';
import { decodeNative } from '../decode';
import { safeFileName, uniqueFileNames } from '../../ocr/titles';

export interface ExportOptions {
  kbps: 128 | 192 | 256 | 320;
  fadeMs: number;
  artist: string;
  /** 지정 시 곡 0:00 기준 상대 구간만 저장 */
  range?: { relStart: number; relEnd: number } | null;
  comment?: (song: Song) => string;
}

async function encodeInWorker(channels: Float32Array[], sampleRate: number, kbps: number, fadeSamples: number, onProgress: (p: number) => void): Promise<Uint8Array> {
  const w = new Worker(new URL('./mp3.worker.ts', import.meta.url), { type: 'module' });
  try {
    return await new Promise<Uint8Array>((resolve, reject) => {
      w.onmessage = (e) => {
        if (e.data.type === 'progress') onProgress(e.data.progress);
        else if (e.data.type === 'done') resolve(e.data.data);
        else reject(new Error(e.data.error));
      };
      w.onerror = (e) => reject(new Error(e.message || 'MP3 인코딩 오류'));
      w.postMessage({ channels, sampleRate, kbps, fadeInSamples: fadeSamples, fadeOutSamples: fadeSamples }, channels.map((c) => c.buffer));
    });
  } finally {
    w.terminate();
  }
}

/** MP3 인코더가 지원하는 샘플레이트로 제한 */
const MP3_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];

async function decodeOriginal(song: Song, blob: Blob): Promise<AudioBuffer> {
  const data = await blob.arrayBuffer();
  // 원본 샘플레이트 유지: 컨테이너 헤더에서 읽어 그 샘플레이트로 디코딩
  void song;
  const hint = await sniffSampleRate(blob);
  return decodeNative(data, hint && MP3_RATES.includes(hint) ? hint : undefined);
}

/** 컨테이너 헤더에서 샘플레이트 추출 (ADTS / WAV / MP3 / MP4) */
export async function sniffSampleRate(blob: Blob): Promise<number | undefined> {
  const h = new Uint8Array(await blob.slice(0, 64 * 1024).arrayBuffer());
  if (h[0] === 0xff && (h[1] & 0xf6) === 0xf0) {
    const SR = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
    return SR[(h[2] >> 2) & 0xf];
  }
  if (h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46) {
    return new DataView(h.buffer).getUint32(24, true);
  }
  // MP3 (ID3 건너뛰기)
  let p = 0;
  if (h[0] === 0x49 && h[1] === 0x44 && h[2] === 0x33) p = 10 + ((h[6] << 21) | (h[7] << 14) | (h[8] << 7) | h[9]);
  for (let i = p; i < Math.min(h.length - 4, p + 4096); i++) {
    if (h[i] === 0xff && (h[i + 1] & 0xe0) === 0xe0) {
      const ver = (h[i + 1] >> 3) & 3;
      const idx = (h[i + 2] >> 2) & 3;
      const base = [44100, 48000, 32000][idx];
      if (!base) break;
      return ver === 3 ? base : ver === 2 ? base / 2 : ver === 0 ? base / 4 : undefined;
    }
  }
  // MP4: mdhd timescale = 오디오 샘플레이트 (대부분)
  for (let i = 0; i < h.length - 24; i++) {
    if (h[i] === 0x6d && h[i + 1] === 0x64 && h[i + 2] === 0x68 && h[i + 3] === 0x64) {
      const dv = new DataView(h.buffer, i + 4);
      const v = dv.getUint8(0);
      return dv.getUint32(v === 1 ? 20 : 12);
    }
  }
  return undefined;
}

export async function exportSongMp3(song: Song, opts: ExportOptions, onProgress: (p: number, label: string) => void): Promise<File> {
  onProgress(0, '디코딩');
  const blob = await Blobs.get(song.audioBlobKey);
  if (!blob) throw new Error('오디오 데이터가 없습니다');
  const ab = await decodeOriginal(song, blob);
  const sr = ab.sampleRate;
  const len = song.endInBlobSec - song.startInBlobSec;
  let relStart = 0;
  let relEnd = len;
  if (opts.range) {
    relStart = Math.max(0, opts.range.relStart + song.userOffsetSec);
    relEnd = Math.min(len, opts.range.relEnd + song.userOffsetSec);
  }
  const a = Math.max(0, Math.round((song.startInBlobSec + relStart) * sr));
  const b = Math.min(ab.length, Math.round((song.startInBlobSec + relEnd) * sr));
  const nCh = Math.min(2, ab.numberOfChannels);
  const channels: Float32Array[] = [];
  for (let c = 0; c < nCh; c++) channels.push(new Float32Array(ab.getChannelData(c).subarray(a, b)));
  if (channels.length === 1) channels.push(new Float32Array(channels[0])); // 스테레오 출력
  const fade = Math.round((opts.fadeMs / 1000) * sr);
  onProgress(0.05, '인코딩');
  const mp3 = await encodeInWorker(channels, sr, opts.kbps, fade, (p) => onProgress(0.05 + p * 0.9, `인코딩 ${Math.round(p * 100)}%`));
  onProgress(0.97, 'ID3 태그');
  const { ID3Writer } = await import('browser-id3-writer');
  const writer = new ID3Writer(mp3.buffer as ArrayBuffer);
  writer.setFrame('TIT2', song.displayTitle).setFrame('TPE1', [opts.artist || 'cnation']);
  const comment = opts.comment?.(song);
  if (comment) writer.setFrame('COMM', { description: 'rating', text: comment, language: 'kor' });
  writer.addTag();
  onProgress(1, '완료');
  return new File([writer.getBlob()], `${safeFileName(song.displayTitle)}.mp3`, { type: 'audio/mpeg' });
}

export function dedupeFiles(files: File[]): File[] {
  const names = uniqueFileNames(files.map((f) => f.name));
  return files.map((f, i) => (f.name === names[i] ? f : new File([f], names[i], { type: f.type })));
}

export async function zipFiles(files: File[], zipName: string): Promise<File> {
  const { zipSync } = await import('fflate');
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const f of files) entries[f.name] = [new Uint8Array(await f.arrayBuffer()), { level: 0 }];
  const z = zipSync(entries);
  return new File([z], zipName, { type: 'application/zip' });
}

export function downloadFile(f: File) {
  const url = URL.createObjectURL(f);
  const a = document.createElement('a');
  a.href = url;
  a.download = f.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** iOS: 공유 시트("파일에 저장"), 미지원 시 다운로드 */
export async function saveFiles(files: File[], zipName: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  files = dedupeFiles(files);
  const nav = navigator as any;
  const canShare = (fs: File[]) => !!nav.canShare && nav.canShare({ files: fs });
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));
  if (isMobile && nav.share) {
    const tryShare = async (fs: File[]) => {
      try {
        await nav.share({ files: fs, title: fs.length > 1 ? zipName : fs[0].name });
        return 'shared' as const;
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return 'cancelled' as const;
        return null;
      }
    };
    if (files.length <= 10 && canShare(files)) {
      const r = await tryShare(files);
      if (r) return r;
    }
    const zip = await zipFiles(files, zipName);
    if (canShare([zip])) {
      const r = await tryShare([zip]);
      if (r) return r;
    }
    downloadFile(zip);
    return 'downloaded';
  }
  if (files.length === 1) downloadFile(files[0]);
  else downloadFile(await zipFiles(files, zipName));
  return 'downloaded';
}
