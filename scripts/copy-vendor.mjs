// OCR(Tesseract)·ffmpeg 코어와 언어 데이터를 public/vendor로 복사한다 (외부 CDN 의존 제거).
// npm run dev / build 전에 자동 실행된다. public/vendor는 git에 커밋하지 않는다.
import { cpSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = (p) => join(root, 'node_modules', p);
const out = (p) => join(root, 'public', 'vendor', p);

const files = [
  [nm('tesseract.js/dist/worker.min.js'), out('tesseract/worker.min.js')],
  [nm('tesseract.js-core/tesseract-core-lstm.wasm.js'), out('tesseract/core/tesseract-core-lstm.wasm.js')],
  [nm('tesseract.js-core/tesseract-core-simd-lstm.wasm.js'), out('tesseract/core/tesseract-core-simd-lstm.wasm.js')],
  [nm('@tesseract.js-data/kor/4.0.0_best_int/kor.traineddata.gz'), out('tesseract/lang/kor.traineddata.gz')],
  [nm('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'), out('tesseract/lang/eng.traineddata.gz')],
  [nm('@ffmpeg/core/dist/esm/ffmpeg-core.js'), out('ffmpeg/ffmpeg-core.js')],
  [nm('@ffmpeg/core/dist/esm/ffmpeg-core.wasm'), out('ffmpeg/ffmpeg-core.wasm')],
];

let copied = 0;
for (const [src, dst] of files) {
  if (!existsSync(src)) {
    console.warn(`[copy-vendor] missing: ${src}`);
    continue;
  }
  if (existsSync(dst) && statSync(dst).size === statSync(src).size) continue;
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(src, dst);
  copied++;
}
console.log(`[copy-vendor] ${copied} file(s) copied to public/vendor`);
