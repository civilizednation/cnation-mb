let sharedCtx: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!sharedCtx) {
    const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
    sharedCtx = new AC({ latencyHint: 'playback' } as AudioContextOptions);
  }
  return sharedCtx;
}

/** iOS: 사용자 제스처 안에서 호출 */
export async function unlockAudio() {
  const ctx = getAudioContext();
  try {
    const nav = navigator as any;
    if (nav.audioSession && nav.audioSession.type !== 'playback') nav.audioSession.type = 'playback';
  } catch {
    /* noop */
  }
  if (ctx.state !== 'running') {
    try {
      await ctx.resume();
    } catch {
      /* noop */
    }
  }
  // 무음 버퍼 한 번 재생 (iOS 잠금 해제)
  try {
    const b = ctx.createBuffer(1, 1, ctx.sampleRate);
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.connect(ctx.destination);
    s.start();
  } catch {
    /* noop */
  }
}

export function supportsAudioSession(): boolean {
  return typeof (navigator as any).audioSession !== 'undefined';
}

function offline(channels: number, sampleRate: number): OfflineAudioContext {
  const OAC: typeof OfflineAudioContext = (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  return new OAC(channels, 1, sampleRate);
}

function decodeWith(ctx: BaseAudioContext, buf: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    try {
      const p = ctx.decodeAudioData(buf, resolve, (e) => reject(e ?? new Error('decodeAudioData 실패')));
      if (p && typeof (p as Promise<AudioBuffer>).catch === 'function') (p as Promise<AudioBuffer>).catch(reject);
    } catch (e) {
      reject(e);
    }
  });
}

/** 지정 샘플레이트로 디코딩 (OfflineAudioContext 리샘플) */
export async function decodeAt(data: ArrayBuffer, sampleRate: number): Promise<AudioBuffer> {
  return decodeWith(offline(2, sampleRate), data);
}

/** 분석용 8kHz mono */
export async function decodeMono8k(data: ArrayBuffer): Promise<{ samples: Float32Array; sampleRate: number }> {
  const sr = 8000;
  const ab = await decodeAt(data, sr);
  return { samples: mixToMono(ab), sampleRate: sr };
}

export function mixToMono(ab: AudioBuffer): Float32Array {
  if (ab.numberOfChannels === 1) return new Float32Array(ab.getChannelData(0));
  const out = new Float32Array(ab.length);
  for (let c = 0; c < ab.numberOfChannels; c++) {
    const d = ab.getChannelData(c);
    for (let i = 0; i < d.length; i++) out[i] += d[i];
  }
  const k = 1 / ab.numberOfChannels;
  for (let i = 0; i < out.length; i++) out[i] *= k;
  return out;
}

/** 원본 샘플레이트 그대로 디코딩: 알 수 없으면 AudioContext 기본값 */
export async function decodeNative(data: ArrayBuffer, sampleRate?: number): Promise<AudioBuffer> {
  if (sampleRate) {
    try {
      return await decodeAt(data.slice(0), sampleRate);
    } catch {
      /* fallthrough */
    }
  }
  return decodeWith(getAudioContext(), data);
}

/** AudioBuffer 구간 → 16-bit WAV Blob */
export function encodeWav(channels: Float32Array[], sampleRate: number): Blob {
  const nCh = channels.length;
  const len = channels[0]?.length ?? 0;
  const buf = new ArrayBuffer(44 + len * nCh * 2);
  const dv = new DataView(buf);
  const w = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i));
  };
  w(0, 'RIFF');
  dv.setUint32(4, 36 + len * nCh * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, nCh, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * nCh * 2, true);
  dv.setUint16(32, nCh * 2, true);
  dv.setUint16(34, 16, true);
  w(36, 'data');
  dv.setUint32(40, len * nCh * 2, true);
  let o = 44;
  for (let i = 0; i < len; i++)
    for (let c = 0; c < nCh; c++) {
      const v = Math.max(-1, Math.min(1, channels[c][i]));
      dv.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  return new Blob([buf], { type: 'audio/wav' });
}

/** 간단 평균 다운샘플 (분석용) */
export function downsample(x: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return x;
  const ratio = from / to;
  const n = Math.floor(x.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.min(x.length, Math.floor((i + 1) * ratio));
    let s = 0;
    let peak = 0;
    for (let j = a; j < b; j++) {
      s += x[j];
      if (Math.abs(x[j]) > Math.abs(peak)) peak = x[j];
    }
    // 피크 보존(무음 판정이 평균으로 희석되지 않게)
    out[i] = Math.abs(peak) > Math.abs(s / Math.max(1, b - a)) ? peak : s / Math.max(1, b - a);
  }
  return out;
}
