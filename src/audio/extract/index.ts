import { parseMp4, fileSource, readAudioSamples, type AudioTrackInfo } from './mp4parse';
import { buildAdts, type AacFrames } from './adts';
import { buildM4a } from './m4aMux';
import { decodeAt, decodeNative } from '../decode';

export type AacContainer = 'adts' | 'm4a';

export type ExtractedAudio =
  | {
      kind: 'frames';
      frames: AacFrames;
      container: AacContainer;
      /** 디코딩 타임라인 t초 → video.currentTime = t + audioToVideoSec */
      audioToVideoSec: number;
      durationSec: number;
      method: 'parser' | 'ffmpeg';
    }
  | {
      kind: 'pcm';
      buffer: AudioBuffer;
      audioToVideoSec: number;
      durationSec: number;
      method: 'decode';
    };

export class NoAudioError extends Error {
  constructor() {
    super('오디오가 없는 녹화입니다 — 녹화 가이드를 확인하세요 (내부 오디오가 녹음되어야 합니다).');
  }
}

let containerSupport: AacContainer | null | undefined;

/** 이 브라우저가 ADTS를 디코딩할 수 있는지 1회 확인 (안 되면 m4a 먹스) */
async function pickContainer(frames: AacFrames): Promise<AacContainer> {
  if (containerSupport) return containerSupport;
  const n = Math.min(frames.frameStarts.length - 1, 200);
  try {
    const adts = buildAdts(frames, 0, n);
    const ab = await decodeAt(adts.buffer.slice(adts.byteOffset, adts.byteOffset + adts.byteLength) as ArrayBuffer, 8000);
    if (ab.length > 0) return (containerSupport = 'adts');
  } catch {
    /* fallthrough */
  }
  const m4a = buildM4a(frames, 0, n);
  await decodeAt(m4a.buffer.slice(m4a.byteOffset, m4a.byteOffset + m4a.byteLength) as ArrayBuffer, 8000);
  return (containerSupport = 'm4a');
}

export function containerBytes(e: Extract<ExtractedAudio, { kind: 'frames' }>, from: number, to: number): Uint8Array {
  return e.container === 'adts' ? buildAdts(e.frames, from, to) : buildM4a(e.frames, from, to);
}

export function containerMime(c: AacContainer) {
  return c === 'adts' ? 'audio/aac' : 'audio/mp4';
}

function framesFromTrack(t: AudioTrackInfo, data: Uint8Array, frameStarts: Uint32Array): AacFrames {
  return {
    data,
    frameStarts,
    objectType: t.objectType,
    sampleRate: t.sampleRate,
    channels: t.channels,
    asc: t.asc,
    samplesPerFrame: 1024,
  };
}

const isAacLc = (t: AudioTrackInfo) => t.codec === 'mp4a' && t.objectType >= 1 && t.objectType <= 4 && !t.fragmented;

export interface ExtractProgress {
  (stage: string, ratio: number, detail?: string): void;
}

export async function extractAudio(file: File, onProgress: ExtractProgress, signal?: AbortSignal): Promise<ExtractedAudio> {
  // 1순위: 경량 파서 (청크 읽기, 재인코딩 없음)
  let parserError: unknown = null;
  try {
    const info = await parseMp4(fileSource(file));
    if (!info.audio) throw new NoAudioError();
    const t = info.audio;
    if (isAacLc(t)) {
      const { data, frameStarts } = await readAudioSamples(fileSource(file), t, (r) => onProgress('extract', r), signal);
      const frames = framesFromTrack(t, data, frameStarts);
      const container = await pickContainer(frames);
      return {
        kind: 'frames',
        frames,
        container,
        audioToVideoSec: t.presentationOffsetSec - t.mediaTimeSkipSec,
        durationSec: (frames.frameStarts.length - 1) * 1024 / t.sampleRate,
        method: 'parser',
      };
    }
    parserError = new Error(`지원하지 않는 오디오 코덱(${t.codec}/${t.objectType})`);
  } catch (e) {
    if (e instanceof NoAudioError) throw e;
    if ((e as Error)?.name === 'AbortError') throw e;
    parserError = e;
  }
  console.warn('[extract] parser failed, falling back to ffmpeg:', parserError);

  // 2순위: ffmpeg.wasm
  try {
    onProgress('extract', 0, 'ffmpeg 폴백 (최초 1회 코어 다운로드)');
    const { ffmpegExtractAudio } = await import('./ffmpegExtractor');
    const m4a = await ffmpegExtractAudio(file, (r) => onProgress('extract', r, 'ffmpeg'));
    const mf = new File([m4a], 'audio.m4a', { type: 'audio/mp4' });
    const info = await parseMp4(fileSource(mf));
    if (!info.audio) throw new NoAudioError();
    const { data, frameStarts } = await readAudioSamples(fileSource(mf), info.audio);
    const frames = framesFromTrack(info.audio, data, frameStarts);
    const container = await pickContainer(frames);
    return {
      kind: 'frames',
      frames,
      container,
      audioToVideoSec: 0,
      durationSec: (frames.frameStarts.length - 1) * 1024 / info.audio.sampleRate,
      method: 'ffmpeg',
    };
  } catch (e) {
    if (e instanceof NoAudioError) throw e;
    console.warn('[extract] ffmpeg failed:', e);
  }

  // 3순위: 200MB 미만이면 전체 decodeAudioData
  if (file.size < 200 * 1024 * 1024) {
    onProgress('extract', 0.5, '전체 디코딩 시도');
    const buffer = await decodeNative(await file.arrayBuffer());
    return { kind: 'pcm', buffer, audioToVideoSec: 0, durationSec: buffer.duration, method: 'decode' };
  }
  throw new Error(`오디오 추출 실패: ${String((parserError as Error)?.message ?? parserError)}`);
}
