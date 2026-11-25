import { extractAudio, containerBytes, type ExtractedAudio } from '../audio/extract';
import { decodeMono8k, decodeNative, downsample, mixToMono } from '../audio/decode';
import { computePeaks } from '../audio/analyze/silence';
import { analyzeSplit, analyzeBounds } from './analysisClient';
import type { Candidate, FileCandidate, ImportItem, RecordingCandidate, RecSong } from './types';
import type { SilenceParams, TitleRoi } from '../types';
import { uid } from '../utils/id';
import { FrameGrabber, thumbnailOf } from '../ocr/frameCapture';
import { titleFromFileName } from '../ocr/titles';

export type Stage = 'extract' | 'analyze' | 'split' | 'ocr' | 'file';

export interface ProcessHooks {
  progress: (stage: Stage, ratio: number, label: string) => void;
  log: (msg: string) => void;
  /** ROI가 없으면 첫 곡 캡처 화면을 보여주고 사용자 지정을 기다림. null = 건너뛰기(전체 OCR) */
  requestRoi: (frame: HTMLCanvasElement) => Promise<TitleRoi | null>;
  roi: TitleRoi | null;
  signal: AbortSignal;
}

const isVideo = (f: File) => /^video\//.test(f.type) || /\.(mp4|mov|m4v)$/i.test(f.name);

const abortCheck = (s: AbortSignal) => {
  if (s.aborted) throw new DOMException('취소됨', 'AbortError');
};

export function toArrayBuffer(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

export async function decodeForAnalysis(ex: ExtractedAudio): Promise<Float32Array> {
  if (ex.kind === 'frames') {
    const n = ex.frames.frameStarts.length - 1;
    const bytes = containerBytes(ex, 0, n);
    const { samples } = await decodeMono8k(toArrayBuffer(bytes));
    return samples;
  }
  return downsample(mixToMono(ex.buffer), ex.buffer.sampleRate, 8000);
}

export async function processRecording(
  item: ImportItem,
  songCount: number | null,
  params: SilenceParams,
  h: ProcessHooks,
): Promise<RecordingCandidate> {
  const timings: Record<string, number> = {};
  let t0 = performance.now();
  h.progress('extract', 0, `오디오 추출: ${item.file.name}`);
  const extracted = await extractAudio(item.file, (_s, r, d) => h.progress('extract', r, d ? `오디오 추출 (${d})` : '오디오 추출'), h.signal);
  timings.extract = performance.now() - t0;
  h.log(`추출 완료 (${extracted.method}${extracted.kind === 'frames' ? ', ' + extracted.container : ''}) ${(timings.extract / 1000).toFixed(2)}s, 길이 ${extracted.durationSec.toFixed(1)}s`);
  abortCheck(h.signal);

  t0 = performance.now();
  h.progress('analyze', 0.1, '분석용 디코딩 (8kHz)');
  const samples = await decodeForAnalysis(extracted);
  timings.decode = performance.now() - t0;
  h.log(`8kHz 디코딩 ${(timings.decode / 1000).toFixed(2)}s (${samples.length} 샘플)`);
  abortCheck(h.signal);

  t0 = performance.now();
  h.progress('split', 0.2, '무음 탐지 및 곡 분리');
  const r = await analyzeSplit(samples, 8000, params, songCount);
  timings.split = performance.now() - t0;
  h.log(`곡 분리 ${(timings.split / 1000).toFixed(2)}s → ${r.result.songs.length}곡`);
  for (const w of r.result.warnings) h.log('⚠️ ' + w);

  const songs: RecSong[] = r.result.songs.map((s, i) => ({
    id: uid('rs_'),
    srcStartSec: s.srcStartSec,
    srcEndSec: s.srcEndSec,
    needsReview: s.needsReview,
    rawTitle: '',
    title: `곡 ${i + 1}`,
    startEdited: false,
    endEdited: false,
    enabled: true,
  }));

  const cand: RecordingCandidate = {
    kind: 'recording',
    id: uid('rc_'),
    name: item.file.name,
    sourceKind: item.sourceKind,
    file: item.file,
    extracted,
    samples8k: r.samples,
    peaks: r.peaks,
    durationSec: r.result.durationSec,
    songCount,
    songs,
    warnings: r.result.warnings,
    timings,
  };

  t0 = performance.now();
  await captureAndOcr(cand, h).catch((e) => {
    if ((e as Error)?.name === 'AbortError') throw e;
    for (const s of cand.songs) if (!s.rawTitle) s.needsReview = true;
    h.log('⚠️ 제목 인식 실패: ' + String((e as Error)?.message ?? e));
  });
  timings.ocr = performance.now() - t0;
  return cand;
}

/** 각 곡 시작+3s 프레임 캡처 → 썸네일 + OCR */
export async function captureAndOcr(cand: RecordingCandidate, h: ProcessHooks) {
  if (!cand.songs.length) return;
  const grabber = new FrameGrabber(cand.file);
  try {
    h.progress('ocr', 0, '화면 캡처');
    const frames: HTMLCanvasElement[] = [];
    for (let i = 0; i < cand.songs.length; i++) {
      abortCheck(h.signal);
      const s = cand.songs[i];
      const t = Math.min(s.srcStartSec + 3, (s.srcStartSec + s.srcEndSec) / 2) + cand.extracted.audioToVideoSec;
      const c = await grabber.grab(t);
      frames.push(c);
      s.thumb = await thumbnailOf(c);
      s.thumbUrl = URL.createObjectURL(s.thumb);
      h.progress('ocr', ((i + 1) / cand.songs.length) * 0.3, `화면 캡처 ${i + 1}/${cand.songs.length}`);
    }
    let roi = h.roi;
    if (!roi && frames[0]) roi = await h.requestRoi(frames[0]);
    h.progress('ocr', 0.3, '제목 인식 준비 (최초 1회 언어 데이터 다운로드)');
    const { recognizeTitle, getOcrWorker } = await import('../ocr/ocr');
    await getOcrWorker((p, st) => {
      if (st.includes('loading')) h.progress('ocr', 0.3 + p * 0.2, `언어 데이터 로드 ${Math.round(p * 100)}%`);
    });
    for (let i = 0; i < frames.length; i++) {
      abortCheck(h.signal);
      h.progress('ocr', 0.5 + (i / frames.length) * 0.5, `제목 인식 ${i + 1}/${frames.length}`);
      const s = cand.songs[i];
      try {
        const res = await recognizeTitle(frames[i], roi);
        s.rawTitle = res.text;
        s.ocrConfidence = res.confidence;
        if (res.text) s.title = res.text;
        if (!res.text || res.confidence < 60) s.needsReview = true;
        h.log(`제목 ${i + 1}: "${res.text}" (신뢰도 ${Math.round(res.confidence)})`);
      } catch (e) {
        s.needsReview = true;
        h.log('⚠️ OCR 오류: ' + String((e as Error)?.message ?? e));
      }
      frames[i].width = frames[i].height = 0; // 메모리 해제
    }
    h.progress('ocr', 1, '제목 인식 완료');
  } finally {
    grabber.dispose();
  }
}

/** 개별 음악 파일: 디코딩 → 앞뒤 무음 제거 */
export async function processFile(item: ImportItem, params: SilenceParams, h: ProcessHooks): Promise<FileCandidate> {
  const timings: Record<string, number> = {};
  const t0 = performance.now();
  let blob: Blob = item.file;
  let mime = item.file.type || guessMime(item.file.name);
  h.progress('file', 0, `파일 처리: ${item.file.name}`);

  let buffer: AudioBuffer | null = null;
  if (isVideo(item.file)) {
    // 단일 곡 영상: 오디오 트랙만 추출
    const ex = await extractAudio(item.file, (_s, r) => h.progress('file', r * 0.5, `오디오 추출: ${item.file.name}`), h.signal);
    if (ex.kind === 'frames') {
      const bytes = containerBytes(ex, 0, ex.frames.frameStarts.length - 1);
      mime = ex.container === 'adts' ? 'audio/aac' : 'audio/mp4';
      blob = new Blob([bytes], { type: mime });
    } else {
      buffer = ex.buffer;
      const { encodeWav } = await import('../audio/decode');
      const chs = Array.from({ length: ex.buffer.numberOfChannels }, (_, c) => ex.buffer.getChannelData(c));
      blob = encodeWav(chs, ex.buffer.sampleRate);
      mime = 'audio/wav';
    }
  }
  if (!buffer) {
    try {
      buffer = await decodeNative(await blob.arrayBuffer());
    } catch {
      h.log(`디코딩 실패 → ffmpeg 변환: ${item.file.name}`);
      h.progress('file', 0.3, `변환 중 (ffmpeg): ${item.file.name}`);
      const { ffmpegToM4a } = await import('../audio/extract/ffmpegExtractor');
      blob = await ffmpegToM4a(new File([blob], item.file.name, { type: mime }), (r) => h.progress('file', 0.3 + r * 0.5, '변환 중 (ffmpeg)'));
      mime = 'audio/mp4';
      buffer = await decodeNative(await blob.arrayBuffer());
    }
  }
  abortCheck(h.signal);
  h.progress('file', 0.85, `무음 제거: ${item.file.name}`);
  const mono = mixToMono(buffer);
  const peaks = computePeaks(mono, 1000);
  const totalSec = buffer.duration;
  const sampleRate = buffer.sampleRate;
  buffer = null;
  const bounds = await analyzeBounds(mono, sampleRate, params);
  timings.total = performance.now() - t0;
  h.log(`파일 ${item.file.name}: ${bounds.startSec.toFixed(3)}s ~ ${bounds.endSec.toFixed(3)}s (${(timings.total / 1000).toFixed(2)}s)`);
  const title = titleFromFileName(item.file.name);
  return {
    kind: 'file',
    id: uid('fc_'),
    name: item.file.name,
    sourceKind: item.sourceKind,
    blob,
    mime,
    startSec: bounds.startSec,
    endSec: bounds.endSec,
    totalSec,
    sampleRate,
    peaks,
    rawTitle: title,
    title,
    enabled: true,
    timings,
  };
}

export function guessMime(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  return (
    {
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      m4a: 'audio/mp4',
      aac: 'audio/aac',
      webm: 'audio/webm',
      mp4: 'video/mp4',
      mov: 'video/quicktime',
      ogg: 'audio/ogg',
      flac: 'audio/flac',
    } as Record<string, string>
  )[ext ?? ''] ?? 'application/octet-stream';
}

export async function processAll(
  items: ImportItem[],
  opts: { multiSong: boolean; songCount: number | null; params: SilenceParams },
  h: ProcessHooks,
): Promise<{ candidates: Candidate[]; errors: string[] }> {
  const candidates: Candidate[] = [];
  const errors: string[] = [];
  // 개별 파일 먼저 (빠름), 녹화 영상은 그 다음
  const files = items.filter((i) => !(opts.multiSong && isVideo(i.file)));
  const recs = items.filter((i) => opts.multiSong && isVideo(i.file));
  for (const it of files) {
    try {
      candidates.push(await processFile(it, opts.params, h));
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e;
      errors.push(`${it.file.name}: ${String((e as Error)?.message ?? e)}`);
      h.log('❌ ' + errors[errors.length - 1]);
    }
  }
  for (const it of recs) {
    try {
      candidates.push(await processRecording(it, opts.songCount, opts.params, h));
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e;
      errors.push(`${it.file.name}: ${String((e as Error)?.message ?? e)}`);
      h.log('❌ ' + errors[errors.length - 1]);
    }
  }
  // 화면에는 사용자가 선택한 파일 순서대로
  const idx = (c: Candidate) => items.findIndex((i) => i.file.name === c.name);
  candidates.sort((a, b) => idx(a) - idx(b));
  return { candidates, errors };
}

export { isVideo };
