import { containerBytes, containerMime } from '../audio/extract';
import { decodeAt, encodeWav, mixToMono } from '../audio/decode';
import { computeEnvelope, silentMask, computePeaks } from '../audio/analyze/silence';
import { Blobs } from '../db';
import type { SilenceParams, Song } from '../types';
import { uid } from '../utils/id';
import type { Candidate, RecordingCandidate } from './types';
import { toArrayBuffer } from './process';

const PAD = 0.5;

/** 디코딩된 곡 버퍼에서 예상 시작점 주변(±radius)의 첫 소리를 샘플 단위로 찾는다 */
export function refineStart(mono: Float32Array, sr: number, expected: number, p: SilenceParams, radius = 0.25): number | null {
  const a = Math.max(0, Math.floor((expected - radius) * sr));
  const b = Math.min(mono.length, Math.ceil((expected + radius + 0.5) * sr));
  if (b <= a) return null;
  const region = mono.subarray(a, b);
  const env = computeEnvelope(region, sr, p.windowMs);
  const mask = silentMask(env, p.silenceDb, Math.max(1, Math.round(p.clickMaxMs / p.windowMs)));
  const win = Math.max(1, Math.round((sr * p.windowMs) / 1000));
  let first = -1;
  for (let w = 0; w < mask.length; w++)
    if (mask[w] === 0) {
      first = w;
      break;
    }
  if (first < 0) return null;
  const thr = Math.pow(10, p.silenceDb / 20);
  const s0 = Math.max(0, (first - 1) * win);
  const s1 = Math.min(region.length, (first + 1) * win);
  let idx = first * win;
  for (let i = s0; i < s1; i++)
    if (Math.abs(region[i]) >= thr) {
      idx = i;
      break;
    }
  const t = (a + idx) / sr;
  return Math.abs(t - expected) <= radius ? t : null;
}

function median(v: number[]) {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export interface CommitProgress {
  (ratio: number, label: string): void;
}

async function commitRecording(c: RecordingCandidate, sessionId: string, p: SilenceParams, onProgress: CommitProgress, base: number, span: number): Promise<{ key: string; song: Song }[]> {
  const ex = c.extracted;
  const enabled = c.songs.filter((s) => s.enabled);
  const prepared: { rs: (typeof enabled)[number]; blob: Blob; mime: string; start: number; end: number; refined: number | null }[] = [];

  for (let i = 0; i < enabled.length; i++) {
    const rs = enabled[i];
    onProgress(base + (i / enabled.length) * span, `곡 잘라내기 ${i + 1}/${enabled.length}`);
    if (ex.kind === 'frames') {
      const spf = ex.frames.samplesPerFrame;
      const sr = ex.frames.sampleRate;
      const n = ex.frames.frameStarts.length - 1;
      const from = Math.max(0, Math.floor(((rs.srcStartSec - PAD) * sr) / spf));
      const to = Math.min(n, Math.ceil(((rs.srcEndSec + PAD) * sr) / spf));
      const bytes = containerBytes(ex, from, to);
      const blobStart = (from * spf) / sr;
      const start = rs.srcStartSec - blobStart;
      const end = rs.srcEndSec - blobStart;
      let refined: number | null = null;
      if (!rs.startEdited) {
        try {
          const ab = await decodeAt(toArrayBuffer(bytes), sr);
          refined = refineStart(mixToMono(ab), sr, start, p);
        } catch {
          refined = null;
        }
      }
      prepared.push({ rs, blob: new Blob([bytes], { type: containerMime(ex.container) }), mime: containerMime(ex.container), start, end, refined });
    } else {
      const buf = ex.buffer;
      const sr = buf.sampleRate;
      const a = Math.max(0, Math.floor((rs.srcStartSec - PAD) * sr));
      const b = Math.min(buf.length, Math.ceil((rs.srcEndSec + PAD) * sr));
      const chs = Array.from({ length: buf.numberOfChannels }, (_, ch) => buf.getChannelData(ch).subarray(a, b));
      prepared.push({ rs, blob: encodeWav(chs, sr), mime: 'audio/wav', start: rs.srcStartSec - a / sr, end: rs.srcEndSec - a / sr, refined: null });
    }
  }

  // 디코더 오프셋 보정: 자동 탐지 곡들의 (정밀 시작 - 예상 시작) 중앙값을 수동 보정 곡에도 적용
  const deltas = prepared.filter((x) => x.refined != null && Math.abs(x.refined! - x.start) < 0.12).map((x) => x.refined! - x.start);
  const delta = median(deltas);

  const songs: { key: string; song: Song }[] = [];
  for (const x of prepared) {
    const start = x.refined ?? x.start + delta;
    const end = Math.max(start + 0.5, x.end + delta);
    const audioKey = uid('b_');
    await Blobs.put(audioKey, x.blob);
    let thumbKey: string | undefined;
    if (x.rs.thumb) {
      thumbKey = uid('t_');
      await Blobs.put(thumbKey, x.rs.thumb);
    }
    const a = Math.floor(x.rs.srcStartSec * 8000);
    const b = Math.ceil(x.rs.srcEndSec * 8000);
    songs.push({ key: x.rs.id, song: {
      id: uid('song_'),
      sessionId,
      sourceKind: c.sourceKind === 'gdrive' ? 'gdrive' : 'recording',
      sourceName: c.name,
      rawTitle: x.rs.rawTitle,
      title: x.rs.title,
      displayTitle: x.rs.title,
      ocrConfidence: x.rs.ocrConfidence,
      thumbnailBlobKey: thumbKey,
      audioBlobKey: audioKey,
      audioMime: x.mime,
      startInBlobSec: Math.max(0, start),
      endInBlobSec: end,
      durationSec: end - Math.max(0, start),
      userOffsetSec: 0,
      needsReview: x.rs.needsReview,
      peaks: computePeaks(c.samples8k.subarray(a, b), 400),
      sizeBytes: x.blob.size + (x.rs.thumb?.size ?? 0),
    } });
  }
  return songs;
}

export async function commitCandidates(candidates: Candidate[], sessionId: string, p: SilenceParams, onProgress: CommitProgress): Promise<{ key: string; song: Song }[]> {
  const out: { key: string; song: Song }[] = [];
  const total = candidates.length || 1;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (c.kind === 'recording') {
      out.push(...(await commitRecording(c, sessionId, p, onProgress, i / total, 1 / total)));
    } else {
      if (!c.enabled) continue;
      onProgress(i / total, `저장: ${c.name}`);
      const audioKey = uid('b_');
      await Blobs.put(audioKey, c.blob);
      // 파일 peaks는 전체 길이 기준 → 곡 구간만 잘라 400포인트로
      const a = Math.floor((c.startSec / c.totalSec) * c.peaks.length);
      const b = Math.ceil((c.endSec / c.totalSec) * c.peaks.length);
      out.push({ key: c.id, song: {
        id: uid('song_'),
        sessionId,
        sourceKind: c.sourceKind,
        sourceName: c.name,
        rawTitle: c.rawTitle,
        title: c.title,
        displayTitle: c.title,
        audioBlobKey: audioKey,
        audioMime: c.mime,
        startInBlobSec: c.startSec,
        endInBlobSec: c.endSec,
        durationSec: c.endSec - c.startSec,
        userOffsetSec: 0,
        needsReview: false,
        peaks: c.peaks.slice(a, Math.max(a + 1, b)),
        sizeBytes: c.blob.size,
      } });
    }
  }
  onProgress(1, '저장 완료');
  return out;
}
