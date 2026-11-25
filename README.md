# cnation 음악 비교 분석 (cnation-mb)

Suno로 만든 여러 곡을 **아이폰 화면 녹화 영상 1개** 또는 **개별 음악 파일**로 불러와서
곡을 자동으로 분리하고, 앞뒤 무음을 잘라 각 곡을 0:00에 맞춘 뒤, 전체/특정 구간을 차례로 들으며
원터치 별점으로 **Best 곡**을 고르는 웹앱(PWA)입니다. 고른 곡은 정확히 잘라 MP3로 저장할 수 있습니다.

- 모든 처리는 **브라우저 안에서** 이루어집니다 (서버 업로드 없음, 백엔드 없음).
- 우선 지원: iPhone / iOS Safari (홈 화면에 추가). 데스크톱 Chrome·Safari 보조 지원.
- 버전: **v1.0.0** — 앱 맨 아래 `(rev. history)` 링크에서 개정 이력을 볼 수 있습니다. ([CHANGELOG](CHANGELOG.md))

## 사용 흐름

1. 홈 → **녹화 영상 불러오기** 또는 **곡 불러오기** (두 종류를 한 세션에 섞어도 됩니다)
2. 곡 수 입력(선택) → 자동 처리: 오디오 추출 → 분석 → 곡 분리 → 제목 인식
3. 분리 결과 확인: 파형 위 마커 드래그로 보정, 제목 수정, 순서 변경
4. 비교 설정: 전체 구간 / 특정 구간(구간 편집기), 블라인드 모드 등
5. 비교 재생: 곡마다 ★1~5 원터치
6. 결과: 평균 별점순 정렬, 🏆 Best, 동점 결승, 텍스트/이미지 공유, **MP3 저장**

## 개발

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest (무음 탐지·제목 규칙·시간 포맷·MP4 파서·MP3 태그)
npm run build      # dist/
```

`npm run dev`/`build` 전에 `scripts/copy-vendor.mjs`가 Tesseract(OCR) 워커·코어·한/영 언어 데이터와
ffmpeg 코어를 `public/vendor/`로 복사합니다 (외부 CDN 불필요, git에는 커밋하지 않음).

### 기술 스택

Vite + React 18 + TypeScript · Tailwind CSS · Zustand · IndexedDB(idb) · vite-plugin-pwa ·
Web Audio API · Web Worker · tesseract.js v5 · ffmpeg.wasm(single-thread, 폴백) ·
@breezystack/lamejs + browser-id3-writer · fflate

### 폴더 구조

```
src/
├─ app/            # 라우팅 (HashRouter)
├─ screens/        # Home, Import, Processing, SplitReview, CompareSetup, ComparePlay, Result, Settings, Guide, History, Poc
├─ components/     # Waveform, StarRating, TimeInput, SegmentEditor, ProgressScrubber, RoiSelect, Mp3Sheet …
├─ audio/
│  ├─ extract/     # mp4parse.ts(청크 파서), adts.ts, m4aMux.ts, ffmpegExtractor.ts
│  ├─ analyze/     # silence.ts(순수 함수), analysis.worker.ts
│  ├─ player.ts    # Web Audio 재생 엔진 (LRU 디코드 캐시)
│  └─ export/      # mp3.worker.ts, lameTag.ts(갭리스), 저장/ZIP/공유
├─ pipeline/       # 처리 오케스트레이션, 곡별 잘라내기·정밀 보정, 미리듣기
├─ ocr/            # 프레임 캡처, 전처리, Tesseract, 제목 규칙
├─ gdrive/         # Google Identity Services + Picker + Drive REST
├─ store/ · db/ · utils/
└─ version.ts      # 앱 버전 + 개정 이력
docs/              # 기획서, PoC 결과
```

## 배포 (Vercel)

1. Vercel에서 이 GitHub 레포를 Import → Framework: **Vite** (vercel.json 포함, 설정 그대로)
2. (선택) 구글 드라이브: 환경변수 설정 후 재배포

```
VITE_GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
VITE_GOOGLE_API_KEY=xxxxx
VITE_GOOGLE_APP_ID=xxxxx   # Cloud 프로젝트 번호 (Picker용)
```

Google Cloud Console: Drive API·Picker API 활성화 → OAuth 동의 화면(테스트 사용자에 본인 계정) →
OAuth 클라이언트(웹) → 승인된 JavaScript 원본에 `http://localhost:5173`, 배포 도메인 추가.
환경변수가 없으면 드라이브 버튼만 비활성화되고 나머지 기능은 정상 동작합니다.

> COOP/COEP 헤더는 설정하지 않습니다 (Google Picker·OAuth 팝업과 충돌). 그래서 ffmpeg는 single-thread 코어를 씁니다.

## 기획서 대비 변경점

- 오디오 추출 1순위를 mp4box.js 대신 **자체 경량 MP4/MOV 파서**로 구현 — 영상 데이터를 메모리에 올리지 않기 위함 ([docs/poc-result.md](docs/poc-result.md))
- OCR·ffmpeg 리소스를 CDN 대신 **자체 호스팅** (오프라인·외부 요청 최소화)
- MP3에 **갭리스(LAME/Info) 태그** 추가 — 인코더 지연(≈25ms) 제거로 AC12(±20ms) 충족

## 남은 확인 사항

- 아이폰 14 Pro Max 실기기에서 15분/400MB 녹화로 처리 시간·메모리 측정 (앱의 `설정 → 기술 검증(PoC)` 화면) → `docs/poc-result.md`에 기록
