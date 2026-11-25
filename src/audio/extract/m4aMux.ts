import type { AacFrames } from './adts';

/** 최소 audio-only MP4(M4A) 먹서 — ADTS 디코딩을 지원하지 않는 환경용 */
function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const len = 8 + parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(len);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, len);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  let o = 8;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
function u32(...vals: number[]) {
  const b = new Uint8Array(vals.length * 4);
  const dv = new DataView(b.buffer);
  vals.forEach((v, i) => dv.setUint32(i * 4, v >>> 0));
  return b;
}
function u16(...vals: number[]) {
  const b = new Uint8Array(vals.length * 2);
  const dv = new DataView(b.buffer);
  vals.forEach((v, i) => dv.setUint16(i * 2, v));
  return b;
}
const bytes = (...v: number[]) => new Uint8Array(v);
const full = (v: number, f: number) => u32((v << 24) | f);
const matrix = u32(0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000);

function esds(asc: Uint8Array) {
  const dsi = new Uint8Array([0x05, asc.length, ...asc]);
  const dcd = new Uint8Array([0x04, 13 + dsi.length, 0x40, 0x15, 0, 0, 0, 0, 0x01, 0xf4, 0x00, 0, 0x01, 0xf4, 0x00, ...dsi]);
  const sl = new Uint8Array([0x06, 1, 0x02]);
  const es = new Uint8Array([0x03, 3 + dcd.length + sl.length, 0, 1, 0, ...dcd, ...sl]);
  return box('esds', full(0, 0), es);
}

export function buildM4a(f: AacFrames, from: number, to: number): Uint8Array {
  const n = to - from;
  const sr = f.sampleRate;
  const dur = n * f.samplesPerFrame;
  const sizes = new Uint32Array(n);
  let payload = 0;
  for (let i = 0; i < n; i++) {
    sizes[i] = f.frameStarts[from + i + 1] - f.frameStarts[from + i];
    payload += sizes[i];
  }
  const ftyp = box('ftyp', bytes(0x4d, 0x34, 0x41, 0x20), u32(0), bytes(0x4d, 0x34, 0x41, 0x20, 0x6d, 0x70, 0x34, 0x32, 0x69, 0x73, 0x6f, 0x6d));
  const mvhd = box('mvhd', full(0, 0), u32(0, 0, sr, dur, 0x10000), u16(0x100, 0), u32(0, 0), matrix, u32(0, 0, 0, 0, 0, 0), u32(2));
  const tkhd = box('tkhd', full(0, 7), u32(0, 0, 1, 0, dur, 0, 0), u16(0, 0, 0x100, 0), matrix, u32(0, 0));
  const mdhd = box('mdhd', full(0, 0), u32(0, 0, sr, dur), u16(0x55c4, 0));
  const hdlr = box('hdlr', full(0, 0), u32(0), bytes(0x73, 0x6f, 0x75, 0x6e), u32(0, 0, 0), bytes(0x53, 0x6f, 0x75, 0x6e, 0x64, 0));
  const smhd = box('smhd', full(0, 0), u32(0));
  const dinf = box('dinf', box('dref', full(0, 0), u32(1), box('url ', full(0, 1))));
  const mp4a = box('mp4a', bytes(0, 0, 0, 0, 0, 0), u16(1), u32(0, 0), u16(f.channels, 16, 0, 0), u32(sr * 65536), esds(f.asc));
  const stsd = box('stsd', full(0, 0), u32(1), mp4a);
  const stts = box('stts', full(0, 0), u32(1, n, f.samplesPerFrame));
  const stsc = box('stsc', full(0, 0), u32(1, 1, n, 1));
  const stszBody = new Uint8Array(4 * n);
  const sdv = new DataView(stszBody.buffer);
  for (let i = 0; i < n; i++) sdv.setUint32(i * 4, sizes[i]);
  const stsz = box('stsz', full(0, 0), u32(0, n), stszBody);
  // stco 오프셋은 moov 길이를 알아야 하므로 2단계로 계산
  const makeMoov = (chunkOffset: number) => {
    const stco = box('stco', full(0, 0), u32(1, chunkOffset));
    const stbl = box('stbl', stsd, stts, stsc, stsz, stco);
    const minf = box('minf', smhd, dinf, stbl);
    const mdia = box('mdia', mdhd, hdlr, minf);
    const trak = box('trak', tkhd, mdia);
    return box('moov', mvhd, trak);
  };
  const moovLen = makeMoov(0).length;
  const moov = makeMoov(ftyp.length + moovLen + 8);
  const out = new Uint8Array(ftyp.length + moov.length + 8 + payload);
  out.set(ftyp, 0);
  out.set(moov, ftyp.length);
  const mdatOff = ftyp.length + moov.length;
  new DataView(out.buffer).setUint32(mdatOff, 8 + payload);
  out.set([0x6d, 0x64, 0x61, 0x74], mdatOff + 4);
  out.set(f.data.subarray(f.frameStarts[from], f.frameStarts[to]), mdatOff + 8);
  return out;
}
