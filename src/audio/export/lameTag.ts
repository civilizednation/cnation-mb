/**
 * MP3 갭리스 정보(Xing "Info" + LAME 확장) 프레임 생성.
 * lamejs는 이 태그를 쓰지 않아 디코더가 인코더 지연(576+529 샘플 ≈ 25ms)만큼
 * 무음을 앞에 붙인다. 태그에 지연/패딩을 기록하면 디코더(ffmpeg/Chrome/Apple 등)가
 * 이를 건너뛰어 파일이 첫 소리에서 정확히 시작한다.
 */
const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const SR_V1 = [44100, 48000, 32000, 0];
const SR_V2 = [22050, 24000, 16000, 0];
const SR_V25 = [11025, 12000, 8000, 0];
export const LAME_ENCODER_DELAY = 576;

interface FrameHdr {
  /** MPEG-1이면 true. 저비트레이트(예: 64kbps)에서는 LAME이 MPEG-2(24kHz 등)로 내려 인코딩함 */
  mpeg1: boolean;
  bitrate: number;
  sampleRate: number;
  padding: number;
  size: number;
  mono: boolean;
  samplesPerFrame: number;
}

export function parseFrameHeader(b: Uint8Array, o: number): FrameHdr | null {
  if (o + 4 > b.length || b[o] !== 0xff || (b[o + 1] & 0xe0) !== 0xe0) return null;
  const version = (b[o + 1] >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
  const layer = (b[o + 1] >> 1) & 3; // 1 = Layer III
  if (version === 1 || layer !== 1) return null;
  const mpeg1 = version === 3;
  const bitrate = (mpeg1 ? BITRATES_V1_L3 : BITRATES_V2_L3)[(b[o + 2] >> 4) & 0xf];
  const sampleRate = (mpeg1 ? SR_V1 : version === 2 ? SR_V2 : SR_V25)[(b[o + 2] >> 2) & 3];
  if (!bitrate || !sampleRate) return null;
  const padding = (b[o + 2] >> 1) & 1;
  const mono = ((b[o + 3] >> 6) & 3) === 3;
  const coef = mpeg1 ? 144000 : 72000;
  return { mpeg1, bitrate, sampleRate, padding, size: Math.floor((coef * bitrate) / sampleRate) + padding, mono, samplesPerFrame: mpeg1 ? 1152 : 576 };
}

export function countFrames(mp3: Uint8Array): number {
  let o = 0;
  let n = 0;
  while (o < mp3.length) {
    const h = parseFrameHeader(mp3, o);
    if (!h) break;
    o += h.size;
    n++;
  }
  return n;
}

const CRC_TABLE = (() => {
  const t = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xa001 : c >>> 1;
    t[i] = c;
  }
  return t;
})();

export function crc16(b: Uint8Array, len: number): number {
  let crc = 0;
  for (let i = 0; i < len; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ b[i]) & 0xff];
  return crc & 0xffff;
}

/**
 * 인코딩 결과 앞에 Info/LAME 프레임을 붙인다. 지원하지 않는 형식이면 그대로 반환.
 * @param totalSamples 인코더에 넣은 샘플 수 (채널당)
 * @param inputSampleRate 인코더에 넣은 샘플레이트 — LAME이 리샘플(예: 44.1k → 24k)했으면 출력 기준으로 환산
 */
export function addGaplessTag(mp3: Uint8Array, totalSamples: number, inputSampleRate?: number): Uint8Array {
  const first = parseFrameHeader(mp3, 0);
  if (!first) return mp3;
  const frames = countFrames(mp3);
  const outSamples = inputSampleRate ? Math.round((totalSamples * first.sampleRate) / inputSampleRate) : totalSamples;
  const size = Math.floor(((first.mpeg1 ? 144000 : 72000) * first.bitrate) / first.sampleRate); // 패딩 없음
  const sideInfo = first.mpeg1 ? (first.mono ? 17 : 32) : first.mono ? 9 : 17;
  const tagStart = 4 + sideInfo;
  if (tagStart + 120 + 36 > size) return mp3;
  const f = new Uint8Array(size);
  f[0] = 0xff;
  f[1] = mp3[1] | 0x01; // CRC 보호 없음
  f[2] = mp3[2] & ~0x02; // 패딩 비트 0
  f[3] = mp3[3];
  const dv = new DataView(f.buffer);
  const total = size + mp3.length;
  let p = tagStart;
  f.set([0x49, 0x6e, 0x66, 0x6f], p); // "Info" (CBR)
  p += 4;
  dv.setUint32(p, 0x0000000f); // frames | bytes | toc | quality
  p += 4;
  dv.setUint32(p, frames);
  p += 4;
  dv.setUint32(p, total);
  p += 4;
  for (let i = 0; i < 100; i++) f[p + i] = Math.floor((i * 256) / 100);
  p += 100;
  dv.setUint32(p, 0);
  p += 4;
  // LAME 확장 (36 bytes)
  const lame = p;
  f.set(Array.from('LAME3.100', (c) => c.charCodeAt(0)), p);
  p += 9;
  f[p++] = 0x01; // revision 0, CBR
  f[p++] = 0; // lowpass
  p += 4 + 2 + 2; // peak, radio gain, audiophile gain
  f[p++] = 0; // flags/ATH
  f[p++] = Math.min(255, first.bitrate);
  const delay = LAME_ENCODER_DELAY;
  const padding = Math.max(0, Math.min(4095, frames * first.samplesPerFrame - delay - outSamples));
  f[p++] = (delay >> 4) & 0xff;
  f[p++] = ((delay & 0xf) << 4) | ((padding >> 8) & 0xf);
  f[p++] = padding & 0xff;
  f[p++] = 0; // misc
  f[p++] = 0; // mp3 gain
  p += 2; // preset/surround
  dv.setUint32(p, total);
  p += 4;
  p += 2; // music CRC (선택)
  dv.setUint16(p, crc16(f, lame + 34)); // tag CRC: 프레임 처음 190바이트
  const out = new Uint8Array(total);
  out.set(f, 0);
  out.set(mp3, size);
  return out;
}
