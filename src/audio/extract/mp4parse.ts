/**
 * 경량 MP4/MOV 파서 — 파일 전체를 메모리에 올리지 않고 File.slice()로
 * 박스 헤더와 moov만 읽은 뒤, 오디오 트랙(AAC) 샘플 위치표를 만든다.
 * (기획서 F3-1의 mp4box.js 경로와 동일한 목적: 청크 읽기 + 재인코딩 없음)
 */

export interface ByteSource {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export function fileSource(file: Blob): ByteSource {
  return {
    size: file.size,
    async read(offset, length) {
      const end = Math.min(file.size, offset + length);
      return new Uint8Array(await file.slice(offset, end).arrayBuffer());
    },
  };
}

export function bufferSource(buf: Uint8Array): ByteSource {
  return {
    size: buf.length,
    async read(offset, length) {
      return buf.subarray(offset, Math.min(buf.length, offset + length));
    },
  };
}

export interface AudioTrackInfo {
  trackId: number;
  codec: string; // 'mp4a'
  objectType: number; // 2 = AAC-LC
  sampleRate: number; // AudioSpecificConfig 기준
  channels: number;
  timescale: number;
  asc: Uint8Array; // AudioSpecificConfig
  sampleCount: number;
  sampleSizes: Uint32Array;
  sampleOffsets: Float64Array; // 파일 내 절대 위치
  sampleDts: Float64Array; // timescale 단위
  /** edit list 기반: 오디오 미디어 시간 0이 영상(무비) 타임라인에서 몇 초인지 */
  presentationOffsetSec: number;
  mediaTimeSkipSec: number;
  durationSec: number;
  fragmented: boolean;
}

export interface Mp4Info {
  audio: AudioTrackInfo | null;
  hasVideo: boolean;
  videoPresentationOffsetSec: number;
  fragmented: boolean;
}

class Reader {
  p = 0;
  constructor(public b: Uint8Array) {}
  get dv() {
    return new DataView(this.b.buffer, this.b.byteOffset, this.b.byteLength);
  }
  u8() {
    return this.b[this.p++];
  }
  u16() {
    const v = this.dv.getUint16(this.p);
    this.p += 2;
    return v;
  }
  u32() {
    const v = this.dv.getUint32(this.p);
    this.p += 4;
    return v;
  }
  i32() {
    const v = this.dv.getInt32(this.p);
    this.p += 4;
    return v;
  }
  u64() {
    const hi = this.u32();
    const lo = this.u32();
    return hi * 4294967296 + lo;
  }
  i64() {
    const hi = this.dv.getInt32(this.p);
    this.p += 4;
    const lo = this.u32();
    return hi * 4294967296 + lo;
  }
  type() {
    const s = String.fromCharCode(this.b[this.p], this.b[this.p + 1], this.b[this.p + 2], this.b[this.p + 3]);
    this.p += 4;
    return s;
  }
}

interface Box {
  type: string;
  start: number; // payload start in buffer
  end: number;
}

function children(b: Uint8Array, start: number, end: number): Box[] {
  const out: Box[] = [];
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = start;
  while (p + 8 <= end) {
    let size = dv.getUint32(p);
    const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
    let hdr = 8;
    if (size === 1) {
      size = dv.getUint32(p + 8) * 4294967296 + dv.getUint32(p + 12);
      hdr = 16;
    } else if (size === 0) size = end - p;
    if (size < hdr || p + size > end) break;
    out.push({ type, start: p + hdr, end: p + size });
    p += size;
  }
  return out;
}

const find = (bs: Box[], t: string) => bs.find((x) => x.type === t);

/** 최상위 박스를 헤더만 읽어 순회하고 moov를 찾는다 */
async function readMoov(src: ByteSource): Promise<{ moov: Uint8Array; fragmented: boolean }> {
  let p = 0;
  let moov: Uint8Array | null = null;
  let fragmented = false;
  while (p + 8 <= src.size) {
    const h = await src.read(p, 16);
    const dv = new DataView(h.buffer, h.byteOffset, h.byteLength);
    let size = dv.getUint32(0);
    const type = String.fromCharCode(h[4], h[5], h[6], h[7]);
    let hdr = 8;
    if (size === 1) {
      size = dv.getUint32(8) * 4294967296 + dv.getUint32(12);
      hdr = 16;
    } else if (size === 0) size = src.size - p;
    if (size < hdr) throw new Error('잘못된 MP4 박스 구조');
    if (type === 'moov') {
      if (size > 200 * 1024 * 1024) throw new Error('moov 박스가 너무 큽니다');
      moov = await src.read(p + hdr, size - hdr);
    } else if (type === 'moof') {
      fragmented = true;
    }
    p += size;
    if (moov && fragmented) break;
  }
  if (!moov) throw new Error('moov 박스를 찾을 수 없습니다 (MP4/MOV 아님)');
  return { moov, fragmented };
}

function parseEsds(b: Uint8Array, start: number, end: number) {
  // full box: version/flags 4 bytes
  let p = start + 4;
  const readLen = () => {
    let len = 0;
    for (let i = 0; i < 4; i++) {
      const c = b[p++];
      len = (len << 7) | (c & 0x7f);
      if (!(c & 0x80)) break;
    }
    return len;
  };
  let objectTypeIndication = 0;
  let asc: Uint8Array | null = null;
  while (p < end) {
    const tag = b[p++];
    const len = readLen();
    const descEnd = p + len;
    if (tag === 0x03) {
      p += 2; // ES_ID
      const flags = b[p++];
      if (flags & 0x80) p += 2;
      if (flags & 0x40) p += 1 + b[p];
      if (flags & 0x20) p += 2;
      continue; // 하위 디스크립터로 진입
    } else if (tag === 0x04) {
      objectTypeIndication = b[p];
      p += 13;
      continue;
    } else if (tag === 0x05) {
      asc = b.slice(p, descEnd);
      break;
    }
    p = descEnd;
  }
  return { objectTypeIndication, asc };
}

const SR_TABLE = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

export function parseAsc(asc: Uint8Array) {
  let bit = 0;
  const read = (n: number) => {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const byte = asc[(bit >> 3)] ?? 0;
      v = (v << 1) | ((byte >> (7 - (bit & 7))) & 1);
      bit++;
    }
    return v;
  };
  let objectType = read(5);
  if (objectType === 31) objectType = 32 + read(6);
  const freqIdx = read(4);
  const sampleRate = freqIdx === 15 ? read(24) : (SR_TABLE[freqIdx] ?? 44100);
  const channelConfig = read(4);
  return { objectType, freqIdx, sampleRate, channelConfig: channelConfig || 2 };
}

function parseElst(b: Uint8Array, box: Box | undefined, movieTimescale: number, mediaTimescale: number) {
  if (!box) return { presentationOffsetSec: 0, mediaTimeSkipSec: 0 };
  const r = new Reader(b.subarray(box.start, box.end));
  const version = r.u8();
  r.p += 3;
  const count = r.u32();
  let emptyDur = 0;
  let mediaTime = 0;
  for (let i = 0; i < count; i++) {
    const dur = version === 1 ? r.u64() : r.u32();
    const mt = version === 1 ? r.i64() : r.i32();
    r.p += 4; // rate
    if (mt === -1) emptyDur += dur;
    else {
      mediaTime = mt;
      break;
    }
  }
  return {
    presentationOffsetSec: emptyDur / movieTimescale,
    mediaTimeSkipSec: mediaTime / mediaTimescale,
  };
}

export async function parseMp4(src: ByteSource): Promise<Mp4Info> {
  const { moov, fragmented } = await readMoov(src);
  const top = children(moov, 0, moov.length);
  let movieTimescale = 1000;
  const mvhd = find(top, 'mvhd');
  if (mvhd) {
    const r = new Reader(moov.subarray(mvhd.start, mvhd.end));
    const v = r.u8();
    r.p += 3 + (v === 1 ? 16 : 8);
    movieTimescale = r.u32();
  }
  let audio: AudioTrackInfo | null = null;
  let hasVideo = false;
  let videoPresentationOffsetSec = 0;

  for (const trak of top.filter((x) => x.type === 'trak')) {
    const tk = children(moov, trak.start, trak.end);
    const tkhd = find(tk, 'tkhd');
    let trackId = 0;
    if (tkhd) {
      const r = new Reader(moov.subarray(tkhd.start, tkhd.end));
      const v = r.u8();
      r.p += 3 + (v === 1 ? 16 : 8);
      trackId = r.u32();
    }
    const mdia = find(tk, 'mdia');
    if (!mdia) continue;
    const md = children(moov, mdia.start, mdia.end);
    const hdlr = find(md, 'hdlr');
    if (!hdlr) continue;
    const handler = String.fromCharCode(...moov.subarray(hdlr.start + 8, hdlr.start + 12));
    const mdhd = find(md, 'mdhd');
    let timescale = 44100;
    let mediaDuration = 0;
    if (mdhd) {
      const r = new Reader(moov.subarray(mdhd.start, mdhd.end));
      const v = r.u8();
      r.p += 3 + (v === 1 ? 16 : 8);
      timescale = r.u32();
      mediaDuration = v === 1 ? r.u64() : r.u32();
    }
    const edts = find(tk, 'edts');
    const elst = edts ? find(children(moov, edts.start, edts.end), 'elst') : undefined;
    const edit = parseElst(moov, elst, movieTimescale, timescale);

    if (handler === 'vide') {
      hasVideo = true;
      videoPresentationOffsetSec = edit.presentationOffsetSec - edit.mediaTimeSkipSec;
      continue;
    }
    if (handler !== 'soun' || audio) continue;

    const minf = find(md, 'minf');
    if (!minf) continue;
    const stblBox = find(children(moov, minf.start, minf.end), 'stbl');
    if (!stblBox) continue;
    const st = children(moov, stblBox.start, stblBox.end);
    const stsd = find(st, 'stsd');
    if (!stsd) continue;
    // stsd: fullbox(4) + count(4) + entry
    const entries = children(moov, stsd.start + 8, stsd.end);
    const entry = entries[0];
    if (!entry) continue;
    const codec = entry.type;
    if (codec !== 'mp4a') {
      audio = {
        trackId,
        codec,
        objectType: 0,
        sampleRate: timescale,
        channels: 2,
        timescale,
        asc: new Uint8Array(),
        sampleCount: 0,
        sampleSizes: new Uint32Array(),
        sampleOffsets: new Float64Array(),
        sampleDts: new Float64Array(),
        presentationOffsetSec: edit.presentationOffsetSec,
        mediaTimeSkipSec: edit.mediaTimeSkipSec,
        durationSec: mediaDuration / timescale,
        fragmented,
      };
      continue;
    }
    // AudioSampleEntry: 6 reserved + 2 dataRefIdx + 8 (version/revision/vendor) + ... = 28 bytes, QuickTime v1/v2 더 김
    const er = new Reader(moov.subarray(entry.start, entry.end));
    er.p = 8;
    const qtVersion = er.u16();
    let childStart = entry.start + 28;
    if (qtVersion === 1) childStart += 16;
    else if (qtVersion === 2) childStart += 36;
    // esds 탐색 (QuickTime은 wave 박스 안에 있을 수 있음)
    let esdsBox: Box | undefined;
    const scan = (s: number, e: number, depth: number) => {
      for (const c of children(moov, s, e)) {
        if (c.type === 'esds') {
          esdsBox = c;
          return;
        }
        if (depth < 3 && (c.type === 'wave' || c.type === 'mp4a')) scan(c.start, c.end, depth + 1);
      }
    };
    scan(childStart, entry.end, 0);
    if (!esdsBox) throw new Error('AAC 설정(esds)을 찾을 수 없습니다');
    const { asc } = parseEsds(moov, esdsBox.start, esdsBox.end);
    if (!asc || asc.length < 2) throw new Error('AudioSpecificConfig 없음');
    const ascInfo = parseAsc(asc);

    // 샘플 테이블
    const stsz = find(st, 'stsz');
    const stz2 = find(st, 'stz2');
    const stco = find(st, 'stco');
    const co64 = find(st, 'co64');
    const stsc = find(st, 'stsc');
    const stts = find(st, 'stts');
    let sizes: Uint32Array;
    if (stsz) {
      const r = new Reader(moov.subarray(stsz.start, stsz.end));
      r.p = 4;
      const fixed = r.u32();
      const count = r.u32();
      sizes = new Uint32Array(count);
      for (let i = 0; i < count; i++) sizes[i] = fixed || r.u32();
    } else if (stz2) {
      const r = new Reader(moov.subarray(stz2.start, stz2.end));
      r.p = 7;
      const fieldSize = r.u8();
      const count = r.u32();
      sizes = new Uint32Array(count);
      for (let i = 0; i < count; i++) {
        if (fieldSize === 16) sizes[i] = r.u16();
        else if (fieldSize === 8) sizes[i] = r.u8();
        else {
          const byte = r.b[r.p + (i >> 1)];
          sizes[i] = i & 1 ? byte & 0xf : byte >> 4;
        }
      }
    } else throw new Error('stsz 없음');
    const count = sizes.length;
    let chunkOffsets: Float64Array;
    if (stco || co64) {
      const bx = (stco || co64)!;
      const r = new Reader(moov.subarray(bx.start, bx.end));
      r.p = 4;
      const n = r.u32();
      chunkOffsets = new Float64Array(n);
      for (let i = 0; i < n; i++) chunkOffsets[i] = co64 ? r.u64() : r.u32();
    } else throw new Error('stco 없음');
    if (!stsc) throw new Error('stsc 없음');
    const scr = new Reader(moov.subarray(stsc.start, stsc.end));
    scr.p = 4;
    const scn = scr.u32();
    const scFirst: number[] = [];
    const scPer: number[] = [];
    for (let i = 0; i < scn; i++) {
      scFirst.push(scr.u32());
      scPer.push(scr.u32());
      scr.u32();
    }
    const offsets = new Float64Array(count);
    let si = 0;
    for (let e = 0; e < scn && si < count; e++) {
      const firstChunk = scFirst[e] - 1;
      const lastChunk = e + 1 < scn ? scFirst[e + 1] - 1 : chunkOffsets.length;
      for (let c = firstChunk; c < lastChunk && si < count; c++) {
        let off = chunkOffsets[c];
        for (let k = 0; k < scPer[e] && si < count; k++) {
          offsets[si] = off;
          off += sizes[si];
          si++;
        }
      }
    }
    const dts = new Float64Array(count);
    if (stts) {
      const r = new Reader(moov.subarray(stts.start, stts.end));
      r.p = 4;
      const n = r.u32();
      let t = 0;
      let i = 0;
      for (let e = 0; e < n; e++) {
        const c = r.u32();
        const d = r.u32();
        for (let k = 0; k < c && i < count; k++) {
          dts[i++] = t;
          t += d;
        }
      }
    }

    audio = {
      trackId,
      codec,
      objectType: ascInfo.objectType,
      sampleRate: ascInfo.sampleRate,
      channels: ascInfo.channelConfig,
      timescale,
      asc,
      sampleCount: count,
      sampleSizes: sizes,
      sampleOffsets: offsets,
      sampleDts: dts,
      presentationOffsetSec: edit.presentationOffsetSec,
      mediaTimeSkipSec: edit.mediaTimeSkipSec,
      durationSec: mediaDuration / timescale,
      fragmented,
    };
  }
  return { audio, hasVideo, videoPresentationOffsetSec, fragmented };
}

/**
 * 오디오 샘플 바이트를 모두 읽어 하나의 연속 버퍼에 담는다.
 * 인접한 샘플은 묶어서 읽고(최대 4MB), 영상 데이터는 건너뛴다.
 */
export async function readAudioSamples(
  src: ByteSource,
  t: AudioTrackInfo,
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<{ data: Uint8Array; frameStarts: Uint32Array }> {
  const n = t.sampleCount;
  let total = 0;
  for (let i = 0; i < n; i++) total += t.sampleSizes[i];
  const data = new Uint8Array(total);
  const frameStarts = new Uint32Array(n + 1);
  let w = 0;
  for (let i = 0; i < n; i++) {
    frameStarts[i] = w;
    w += t.sampleSizes[i];
  }
  frameStarts[n] = w;

  const MAX = 4 * 1024 * 1024;
  const GAP = 64 * 1024;
  let i = 0;
  while (i < n) {
    if (signal?.aborted) throw new DOMException('취소됨', 'AbortError');
    const start = t.sampleOffsets[i];
    let end = start + t.sampleSizes[i];
    let j = i + 1;
    while (j < n) {
      const s = t.sampleOffsets[j];
      const e = s + t.sampleSizes[j];
      if (s < end - 0 && s < start) break;
      if (s - end > GAP || e - start > MAX || s < start) break;
      end = Math.max(end, e);
      j++;
    }
    const buf = await src.read(start, end - start);
    for (let k = i; k < j; k++) {
      const rel = t.sampleOffsets[k] - start;
      data.set(buf.subarray(rel, rel + t.sampleSizes[k]), frameStarts[k]);
    }
    i = j;
    onProgress?.(i / n);
  }
  return { data, frameStarts };
}
