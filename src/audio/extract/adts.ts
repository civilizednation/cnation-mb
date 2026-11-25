/** AAC raw 프레임에 ADTS 헤더(7바이트)를 붙인다. */
const SR_TABLE = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

export function freqIndexOf(sampleRate: number): number {
  const i = SR_TABLE.indexOf(sampleRate);
  return i < 0 ? 4 : i;
}

export function adtsHeader(frameLen: number, objectType: number, sampleRate: number, channels: number): Uint8Array {
  const profile = Math.max(0, Math.min(3, objectType - 1));
  const fi = freqIndexOf(sampleRate);
  const len = frameLen + 7;
  const h = new Uint8Array(7);
  h[0] = 0xff;
  h[1] = 0xf1; // MPEG-4, layer 0, no CRC
  h[2] = (profile << 6) | (fi << 2) | ((channels >> 2) & 1);
  h[3] = ((channels & 3) << 6) | ((len >> 11) & 3);
  h[4] = (len >> 3) & 0xff;
  h[5] = ((len & 7) << 5) | 0x1f;
  h[6] = 0xfc;
  return h;
}

export interface AacFrames {
  data: Uint8Array;
  frameStarts: Uint32Array; // length = n+1
  objectType: number;
  sampleRate: number;
  channels: number;
  asc: Uint8Array;
  samplesPerFrame: number;
}

export function frameCount(f: AacFrames) {
  return f.frameStarts.length - 1;
}

/** 프레임 [from, to) 범위를 ADTS 스트림으로 */
export function buildAdts(f: AacFrames, from: number, to: number): Uint8Array {
  from = Math.max(0, from);
  to = Math.min(frameCount(f), to);
  const payload = f.frameStarts[to] - f.frameStarts[from];
  const out = new Uint8Array(payload + 7 * (to - from));
  let w = 0;
  for (let i = from; i < to; i++) {
    const s = f.frameStarts[i];
    const e = f.frameStarts[i + 1];
    out.set(adtsHeader(e - s, f.objectType, f.sampleRate, f.channels), w);
    w += 7;
    out.set(f.data.subarray(s, e), w);
    w += e - s;
  }
  return out;
}
