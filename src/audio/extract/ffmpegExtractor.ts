/**
 * ffmpeg.wasm (single-thread core) 폴백.
 * WORKERFS로 File을 복사 없이 마운트한다. COOP/COEP 불필요.
 */
// 자체 호스팅 (scripts/copy-vendor.mjs가 @ffmpeg/core를 public/vendor/ffmpeg로 복사)
const BASE = '/vendor/ffmpeg';

let ffmpegPromise: Promise<any> | null = null;

async function getFFmpeg(onLog?: (s: string) => void) {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const [{ FFmpeg }, { toBlobURL }] = await Promise.all([import('@ffmpeg/ffmpeg'), import('@ffmpeg/util')]);
      const ff = new FFmpeg();
      await ff.load({
        coreURL: await toBlobURL(new URL(`${BASE}/ffmpeg-core.js`, location.href).href, 'text/javascript'),
        wasmURL: await toBlobURL(new URL(`${BASE}/ffmpeg-core.wasm`, location.href).href, 'application/wasm'),
      });
      return ff;
    })().catch((e) => {
      ffmpegPromise = null;
      throw e;
    });
  }
  const ff = await ffmpegPromise;
  if (onLog) ff.on('log', ({ message }: { message: string }) => onLog(message));
  return ff;
}

async function run(file: File, args: (inPath: string) => string[], outName: string, onProgress?: (r: number) => void): Promise<Uint8Array> {
  const ff = await getFFmpeg();
  const { FFFSType } = await import('@ffmpeg/ffmpeg');
  const handler = ({ progress }: { progress: number }) => onProgress?.(Math.max(0, Math.min(1, progress)));
  ff.on('progress', handler);
  try {
    try {
      await ff.createDir('/in');
    } catch {
      /* exists */
    }
    await ff.mount(FFFSType.WORKERFS, { files: [file] }, '/in');
    try {
      const code = await ff.exec(args(`/in/${file.name}`));
      if (code !== 0) throw new Error(`ffmpeg 종료 코드 ${code}`);
      const data = (await ff.readFile(outName)) as Uint8Array;
      await ff.deleteFile(outName).catch(() => {});
      return data;
    } finally {
      await ff.unmount('/in').catch(() => {});
    }
  } finally {
    ff.off('progress', handler);
  }
}

/** 영상에서 오디오 트랙만 m4a로 (copy → 실패 시 AAC 재인코딩) */
export async function ffmpegExtractAudio(file: File, onProgress?: (r: number) => void): Promise<Blob> {
  try {
    const d = await run(file, (i) => ['-i', i, '-vn', '-c:a', 'copy', '-f', 'mp4', 'out.m4a'], 'out.m4a', onProgress);
    return new Blob([d], { type: 'audio/mp4' });
  } catch {
    const d = await run(file, (i) => ['-i', i, '-vn', '-c:a', 'aac', '-b:a', '256k', '-f', 'mp4', 'out.m4a'], 'out.m4a', onProgress);
    return new Blob([d], { type: 'audio/mp4' });
  }
}

/** 디코딩 불가 포맷(iOS webm 등) → m4a(AAC 256k) */
export async function ffmpegToM4a(file: File, onProgress?: (r: number) => void): Promise<Blob> {
  const d = await run(file, (i) => ['-i', i, '-vn', '-c:a', 'aac', '-b:a', '256k', '-f', 'mp4', 'out.m4a'], 'out.m4a', onProgress);
  return new Blob([d], { type: 'audio/mp4' });
}
