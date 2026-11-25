import { describe, it, expect } from 'vitest';
import { adtsHeader, buildAdts } from '../src/audio/extract/adts';
import { parseAsc, parseMp4, bufferSource, readAudioSamples } from '../src/audio/extract/mp4parse';
import { buildM4a } from '../src/audio/extract/m4aMux';

describe('adts', () => {
  it('builds valid header', () => {
    const h = adtsHeader(100, 2, 44100, 2);
    expect(h[0]).toBe(0xff);
    expect(h[1] & 0xf0).toBe(0xf0);
    const len = ((h[3] & 3) << 11) | (h[4] << 3) | (h[5] >> 5);
    expect(len).toBe(107);
    expect((h[2] >> 2) & 0xf).toBe(4);
  });
  it('parses ASC', () => {
    // AAC-LC 44.1k stereo = 0x12 0x10
    expect(parseAsc(new Uint8Array([0x12, 0x10]))).toMatchObject({ objectType: 2, sampleRate: 44100, channelConfig: 2 });
    // AAC-LC 48k stereo = 0x11 0x90
    expect(parseAsc(new Uint8Array([0x11, 0x90]))).toMatchObject({ objectType: 2, sampleRate: 48000, channelConfig: 2 });
  });
  it('m4a mux roundtrip through parser', async () => {
    const frames = {
      data: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]),
      frameStarts: new Uint32Array([0, 3, 5, 9]),
      objectType: 2,
      sampleRate: 48000,
      channels: 2,
      asc: new Uint8Array([0x11, 0x90]),
      samplesPerFrame: 1024,
    };
    const m4a = buildM4a(frames, 0, 3);
    const info = await parseMp4(bufferSource(m4a));
    expect(info.audio?.sampleCount).toBe(3);
    expect(info.audio?.sampleRate).toBe(48000);
    const r = await readAudioSamples(bufferSource(m4a), info.audio!);
    expect(Array.from(r.data)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const adts = buildAdts({ ...frames, data: r.data, frameStarts: r.frameStarts }, 1, 3);
    expect(adts.length).toBe(6 + 14);
  });
});
