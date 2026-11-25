/** 숨겨진 <video>로 특정 시각의 프레임을 캡처 (스트리밍 방식, 메모리 부담 적음) */
export class FrameGrabber {
  private video: HTMLVideoElement;
  private url: string;
  private ready: Promise<void>;

  constructor(file: Blob) {
    this.url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    v.preload = 'auto';
    Object.assign(v.style, { position: 'fixed', left: '-10px', top: '-10px', width: '2px', height: '2px', opacity: '0.01', pointerEvents: 'none' });
    document.body.appendChild(v);
    v.src = this.url;
    this.video = v;
    this.ready = new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('영상 메타데이터 로드 시간 초과')), 20000);
      v.addEventListener(
        'loadedmetadata',
        async () => {
          clearTimeout(t);
          // iOS: 한 번 재생→정지해야 프레임이 그려지는 경우가 있음
          try {
            await v.play();
            v.pause();
          } catch {
            /* noop */
          }
          resolve();
        },
        { once: true },
      );
      v.addEventListener('error', () => reject(new Error('영상을 열 수 없습니다')), { once: true });
    });
    v.load();
  }

  get size() {
    return { w: this.video.videoWidth, h: this.video.videoHeight, duration: this.video.duration };
  }

  async grab(timeSec: number, maxWidth = 1440): Promise<HTMLCanvasElement> {
    await this.ready;
    const v = this.video;
    const t = Math.max(0, Math.min((v.duration || timeSec) - 0.05, timeSec));
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(to);
        resolve();
      };
      const to = setTimeout(done, 8000);
      v.addEventListener('seeked', done, { once: true });
      v.currentTime = t;
    });
    // 프레임 디코딩 대기
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const scale = Math.min(1, maxWidth / (v.videoWidth || maxWidth));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round((v.videoWidth || 360) * scale));
    c.height = Math.max(1, Math.round((v.videoHeight || 640) * scale));
    c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
    return c;
  }

  dispose() {
    this.video.removeAttribute('src');
    this.video.load();
    this.video.remove();
    URL.revokeObjectURL(this.url);
  }
}

export function canvasToBlob(c: HTMLCanvasElement, type = 'image/jpeg', q = 0.8): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob 실패'))), type, q));
}

export async function thumbnailOf(c: HTMLCanvasElement, width = 360): Promise<Blob> {
  const s = width / c.width;
  const t = document.createElement('canvas');
  t.width = width;
  t.height = Math.round(c.height * s);
  t.getContext('2d')!.drawImage(c, 0, 0, t.width, t.height);
  return canvasToBlob(t, 'image/jpeg', 0.78);
}
