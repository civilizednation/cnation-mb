import { describe, it, expect } from 'vitest';
import { Mp3Encoder } from '@breezystack/lamejs';
import { addGaplessTag, countFrames, parseFrameHeader, crc16 } from '../src/audio/export/lameTag';

describe('gapless LAME tag', () => {
  for (const [kbps, sr] of [[64, 44100], [64, 48000]] as const) {
    it(`fits Info frame at ${kbps}kbps / ${sr}Hz`, () => {
      const n = sr;
      const enc = new Mp3Encoder(2, sr, kbps);
      const l = new Int16Array(n).map((_, i) => Math.round(8000 * Math.sin(i / 10)));
      const parts = [enc.encodeBuffer(l, l), enc.flush()];
      const mp3 = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
      let o = 0;
      for (const p of parts) {
        mp3.set(p, o);
        o += p.length;
      }
      const out = addGaplessTag(mp3, n, sr);
      const h = parseFrameHeader(out, 0)!;
      expect(h.bitrate).toBe(kbps);
      // LAME은 64kbps에서 MPEG-2(24kHz, 576샘플/프레임)로 인코딩 → side info 17바이트
      expect(h.mpeg1).toBe(false);
      expect(h.sampleRate).toBe(24000);
      const tag = 4 + 17;
      expect(String.fromCharCode(...out.subarray(tag, tag + 4))).toBe('Info');
      const lame = tag + 120;
      expect(String.fromCharCode(...out.subarray(lame, lame + 9))).toBe('LAME3.100');
      const delay = (out[lame + 21] << 4) | (out[lame + 22] >> 4);
      const pad = ((out[lame + 22] & 0xf) << 8) | out[lame + 23];
      const frames = countFrames(mp3);
      expect(delay).toBe(576);
      expect(frames * 576 - delay - pad).toBe(Math.round((n * 24000) / sr));
      expect(countFrames(out)).toBe(frames + 1);
    });
  }

  it('prepends a valid Info frame with delay/padding', () => {
    const sr = 44100;
    const n = sr; // 1s
    const enc = new Mp3Encoder(2, sr, 256);
    const l = new Int16Array(n).map((_, i) => Math.round(8000 * Math.sin(i / 10)));
    const parts = [enc.encodeBuffer(l, l), enc.flush()];
    const mp3 = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
    let o = 0;
    for (const p of parts) {
      mp3.set(p, o);
      o += p.length;
    }
    const frames = countFrames(mp3);
    const out = addGaplessTag(mp3, n);
    const h = parseFrameHeader(out, 0)!;
    expect(h.bitrate).toBe(256);
    const tag = 36;
    expect(String.fromCharCode(...out.subarray(tag, tag + 4))).toBe('Info');
    const dv = new DataView(out.buffer);
    expect(dv.getUint32(tag + 8)).toBe(frames);
    const lame = tag + 120;
    expect(String.fromCharCode(...out.subarray(lame, lame + 9))).toBe('LAME3.100');
    const delay = (out[lame + 21] << 4) | (out[lame + 22] >> 4);
    const pad = ((out[lame + 22] & 0xf) << 8) | out[lame + 23];
    expect(delay).toBe(576);
    expect(frames * 1152 - delay - pad).toBe(n);
    expect(dv.getUint16(lame + 34)).toBe(crc16(out, 190));
    expect(countFrames(out)).toBe(frames + 1);
  });
});
