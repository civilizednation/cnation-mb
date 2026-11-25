# cnation 음악 비교 분석 (cnation-mb) — 상세 기획서

> 버전: v1.1 최종 (2026-11-25) — MP3 변환/저장 기능(F12) 포함
> 작성 목적: Claude Code에서 바로 개발을 시작하기 위한 상세 기획 및 기술 사양
> 대상 기기: **iPhone 14 Pro Max / iOS Safari (홈 화면 추가 PWA)** 우선, 데스크톱 Chrome/Safari 보조 지원

---

## 0. 한 줄 요약

Suno로 만든 여러 곡을 **아이폰 화면 녹화 영상 1개**(또는 개별 음악 파일)로 불러오면, 앱이 **자동으로 곡을 분리하고, 앞뒤 무음을 제거해 각 곡의 시작점을 0:00으로 맞추고, 화면에서 곡 제목을 읽어**낸다. 사용자는 **전체 구간** 또는 **특정 구간**을 곡별로 차례로 들으며 **원터치 별점(1~5)**을 매기고, 마지막에 결과표를 보고 **Best 곡**을 고른다. 원하는 곡(1곡 또는 여러 곡)은 **시작~끝만 정확히 잘라 MP3(음질 선택)로 저장**할 수 있다.

---

## 1. 배경 및 핵심 결정사항

### 1.1 왜 "화면 녹화 영상"이 메인 입력인가
- Suno 다운로드 정책: 2026-09-03부터 **Pro 월 20곡 / Premier 월 60곡**으로 다운로드가 제한된다(한 곡 = 1회, 포맷 무관, 기존 곡에도 적용).
- Suno는 **공식 API가 없다**. 비공식 라이브러리(쿠키 기반, 내부 엔드포인트 역설계)는 Suno 약관(스크래핑·데이터 추출 금지, 위반 시 계정 정지)에 걸리므로 **사용하지 않는다**.
- 따라서 사용자의 실제 작업 흐름은 다음과 같다.
  1. Suno에서 후보곡 3~4곡을 생성한다.
  2. 아이폰 화면 녹화를 켜고(마이크 OFF, 방해금지 ON) Suno에서 3~4곡을 연속 재생한다.
     - 녹화는 **첫 곡 재생 몇 초 전에 시작**하고, **마지막 곡이 끝나고 몇 초 뒤에 종료**한다.
  3. 4곡 기준 약 15분, **약 300~400MB(FHD)**의 영상 파일이 생긴다.
  4. 이 영상 1개를 앱에 불러와 자동 분리, 비교, 별점을 진행한다.
- 최종으로 선택한 곡만 Suno에서 정식 다운로드하면 다운로드 한도를 아낄 수 있다.

### 1.2 확정된 설계 원칙
| 항목 | 결정 |
|---|---|
| 처리 위치 | **100% 클라이언트(브라우저) 처리**. 서버 업로드 없음 → 데이터 소모 없음, 개인정보 안전 |
| 대용량 영상 | 영상 파일을 **통째로 메모리에 올리지 않는다**. 파일을 조각(chunk)으로 읽어 **오디오 트랙만 추출**한다 |
| 영상 화질 | 사용자가 SD로 재인코딩할 필요 **없음**(재인코딩은 음질 저하와 페이드 삽입 위험). FHD 원본 그대로 사용 |
| 분석 | 저샘플레이트(8kHz)로 분석해 메모리를 절약하고, 결과(시간값)만 저장한 뒤 메모리를 해제한다 |
| 재생 | 곡별로 잘라낸 작은 오디오만 고음질로 디코딩해 Web Audio로 **샘플 단위 정확 재생**한다 |
| 백엔드 | v1은 **백엔드 없음**(Firebase/Supabase 불필요). 정적 사이트로 Vercel에 배포한다 |
| 저장 | IndexedDB에 **추출된 곡별 오디오(수 MB)와 메타데이터, 별점**만 저장한다. 원본 영상은 저장하지 않는다 |

---

## 2. 사용자 시나리오

### 2.1 메인 시나리오 — 녹화 영상 1개로 비교 (가장 자주 사용)
1. 앱 실행 → 홈 화면 → **[녹화 영상 불러오기]**
2. 파일 앱에서 녹화 영상(.mp4/.mov)을 선택한다.
   - 안내 문구: "사진 앱보다 **파일 앱**에서 선택하면 더 빨라요(사진 앱은 iOS가 변환 대기를 할 수 있음)"
3. **곡 수 입력**(기본값: 자동 / 선택: 2~8). 사용자가 4를 입력하면 정확도가 올라간다.
4. 진행 표시: `오디오 추출 → 분석 → 곡 분리 → 제목 인식` (예상 수 초~수십 초)
5. **분리 결과 확인 화면**
   - 전체 파형 위에 곡 경계 마커와 각 곡의 시작/끝 마커를 표시한다.
   - 각 곡 카드에는 캡처 썸네일, 인식된 제목, 길이를 표시한다.
   - 마커 드래그로 보정할 수 있고, 제목은 탭해서 수정한다.
   - (최초 1회) **제목 영역 지정**: 캡처 화면에서 제목 부분을 드래그로 박스 지정 → 저장되어 다음부터 자동 사용
6. **[확인]** → 비교 설정 화면으로 이동한다.
7. **비교 모드 선택**: `전체 구간` / `특정 구간`
8. **[비교]** → 곡 순서대로 재생하며 곡마다 ★1~5를 원터치로 선택한다.
9. 모든 곡 재생 완료 → **결과 화면**(별점순 정렬, Best 선택)
10. (선택) 결과 화면에서 원하는 곡을 체크 → **[선택 곡 MP3 저장]** → 음질 선택 → 공유 시트에서 "파일에 저장"
11. 세션은 자동 저장되어 나중에 기록에서 다시 열 수 있다.

### 2.2 보조 시나리오 — 개별 음악 파일
- **[곡 불러오기]** → 기기 파일(다중 선택) 또는 **구글 드라이브**(본인 계정 연결, 다중 선택)
- 지원 포맷: mp3, wav, m4a, webm (+ mp4, mov)
- 파일마다 앞뒤 무음을 자동 제거하고 시작점을 0:00으로 맞춘다.
- 이후 흐름(비교, 별점, 결과)은 메인 시나리오와 동일하다.
- 녹화 영상과 개별 파일을 **한 세션에 섞어서** 비교할 수 있다(곡 목록에 추가).

---

## 3. 기능 상세 사양

### F1. 앱 기본
- 앱 이름: **cnation 음악 비교 분석**, 짧은 이름/레포명: **cnation-mb**
- PWA: manifest, 아이콘, 홈 화면 추가, 오프라인 앱 셸 캐시(Service Worker; OCR 언어 데이터와 ffmpeg 코어도 캐시)
- 다크 테마 기본, 모바일 우선, 큰 터치 타깃(최소 44×44pt)
- 언어: 한국어 UI

### F2. 파일 불러오기
| 입력 | 방식 | 비고 |
|---|---|---|
| 기기 파일 | `<input type="file" multiple accept="audio/*,video/*,.mp3,.wav,.m4a,.webm,.mp4,.mov">` | iOS는 파일 앱/사진 앱 선택 가능 |
| 구글 드라이브 | Google Picker API + Google Identity Services(OAuth 토큰) | 다중 선택, MIME 필터: audio/*, video/mp4, video/quicktime, video/webm |
| 지원 확장자 | **mp3, wav, m4a, webm, mp4, mov** | webm은 iOS 디코딩 실패 시 ffmpeg.wasm 폴백 |

- 영상(mp4/mov) 1개 → **녹화 영상 처리 파이프라인(F3)**으로 보낸다.
- 오디오 파일 → **단일 곡 처리(F4)**로 보낸다.
- 녹화 영상인지 일반 단일 곡 영상인지는 사용자가 선택한다(불러올 때 토글 "여러 곡이 연속 녹화된 영상" 기본 ON).

### F3. 녹화 영상 처리 파이프라인 (핵심)

#### F3-1. 오디오 트랙 추출 (재인코딩 없음)
- **1순위: mp4box.js**
  - `File.slice()`로 1~4MB씩 읽어 `mp4boxFile.appendBuffer()`에 넣는다(`fileStart` 지정). **전체 파일을 메모리에 올리지 않는다.**
  - 오디오 트랙(AAC, `mp4a`)만 `setExtractionOptions` → `onSamples`로 샘플을 받는다.
  - 각 AAC 프레임에 **ADTS 헤더**(AudioSpecificConfig의 profile, sampleRate, channel 사용)를 붙여 `.aac`(ADTS) Blob을 만든다.
  - 각 샘플의 타임스탬프(cts/timescale)를 함께 보관한다 → 나중에 **곡별 잘라내기(F3-5)**에 사용
  - 오디오 트랙의 edit list / 시작 오프셋을 확인해 **영상 타임라인과 오디오 타임라인의 오프셋**을 기록한다(OCR 프레임 캡처 시각 보정용).
- **2순위(폴백): ffmpeg.wasm (single-thread core)**
  - `WORKERFS`로 File을 마운트해 **복사 없이** 읽는다.
  - `ffmpeg -i /in/video.mov -vn -c:a copy /out/audio.m4a`
  - single-thread 코어 사용(SharedArrayBuffer 불필요 → COOP/COEP 헤더 불필요, Google Picker와 충돌 없음)
  - 코어는 첫 사용 시 다운로드하고 Service Worker로 캐시한다.
- **3순위(최후 폴백)**: 파일이 200MB 미만이면 `decodeAudioData(전체 ArrayBuffer)`를 직접 시도한다.
- ⚠️ **Phase 0 PoC로 실기기 검증 필수**: iPhone 14 Pro Max, Safari에서 400MB / 15분 녹화 파일로 1순위 경로의 동작, 시간, 메모리를 확인한다. Safari의 ADTS `decodeAudioData` 지원 여부도 확인한다(미지원이면 mp4box로 audio-only mp4를 만들거나 ffmpeg 경로로 m4a를 만든다).

#### F3-2. 분석용 디코딩 (저해상도)
- `new OfflineAudioContext(1, 1, 8000)`의 `decodeAudioData()`로 디코딩한다 → 8kHz로 리샘플된 AudioBuffer
  - 15분 스테레오 8kHz Float32 ≈ 58MB (허용 범위)
- 채널을 평균해 mono Float32Array를 만든 뒤 AudioBuffer 참조를 해제한다.
- 분석은 **Web Worker**에서 수행한다(UI 멈춤 방지; 배열은 transferable로 전달).

#### F3-3. 무음 탐지 및 곡 분리 알고리즘
파라미터(설정 화면에서 조정 가능, 기본값):
| 파라미터 | 기본값 | 설명 |
|---|---|---|
| `windowMs` | 20ms | RMS 계산 창 |
| `silenceDb` | -50 dBFS | 이 값 미만이면 무음 |
| `minGapSec` | 1.0s | 곡 경계 후보 무음의 최소 길이 |
| `minSongSec` | 30s | 이보다 짧은 소리 덩어리는 곡이 아님(잡음, 알림음) |
| `clickMaxMs` | 300ms | 무음 구간 안의 이보다 짧은 소리는 잡음으로 무시 |
| `tailDb` | -60 dBFS | 곡 끝(페이드아웃) 판정 임계값(시작보다 낮게 잡아 꼬리를 보존) |

절차:
1. 20ms 창마다 RMS → dBFS 배열 `env[]`를 만든다.
2. `env < silenceDb`인 연속 구간을 무음 구간으로 수집한다. 무음 사이에 낀 `clickMaxMs` 이하의 짧은 소리는 무음으로 병합한다(알림음, 클릭 제거).
3. **맨 앞/맨 뒤 무음**(녹화 여유 구간)은 경계 후보에서 제외한다.
4. 내부 무음 구간 중 길이가 `minGapSec` 이상인 것이 경계 후보다.
5. **곡 수 N이 입력된 경우**: 후보 중 **가장 긴 N-1개**를 경계로 채택한다(곡 중간의 짧은 브레이크 오인식 방지).
   **자동인 경우**: 길이 ≥ 2.0s인 후보를 모두 경계로 채택한 뒤, `minSongSec` 미만의 조각은 인접 곡에 병합한다.
6. 각 곡 구간 안에서:
   - **시작점**: 처음으로 `env ≥ silenceDb`인 창을 찾고, 그 창 안(앞 창 포함)에서 원본 샘플 기준 `|x| ≥ 10^(silenceDb/20)`인 첫 샘플로 정밀화한다(목표 오차 ±10ms).
   - **끝점**: 마지막으로 `env ≥ tailDb`인 창의 끝 + 0.3s
7. 결과: `songs[] = { id, srcStartSec, srcEndSec }` (원본 오디오 타임라인 기준)
8. 신뢰도 표시: 채택된 경계 무음의 길이와 다음 후보와의 길이 차이가 작으면 "확인 필요" 배지를 표시한다.

#### F3-4. 분리 결과 확인·보정 UI
- 전체 파형: 분석 데이터에서 peaks(약 2000포인트)를 만들어 Canvas로 그린다(wavesurfer 등 무거운 라이브러리 지양).
- 곡 구간을 색상 밴드로 표시하고, 각 곡의 시작(▶)과 끝(■) 마커를 드래그할 수 있게 한다.
- 핀치/버튼 줌, 마커 근처 미리듣기(마커 기준 앞뒤 2초 재생)를 제공한다.
- 곡 추가/삭제(경계 추가·제거), 곡 수를 바꾸면 재분리한다.
- 보정 값은 즉시 저장한다.

#### F3-5. 곡별 오디오 잘라내기 (재생용)
- F3-1에서 보관한 AAC 프레임과 타임스탬프로 `[srcStartSec - 0.5, srcEndSec + 0.5]` 범위의 프레임만 모아 **곡별 ADTS Blob**(약 3~5MB)을 만든다. 재인코딩은 없다.
- 곡별 Blob 안에서의 정확한 시작 오프셋(`playStartInBlob`)과 끝 오프셋을 계산해 저장한다.
- ffmpeg 경로의 경우: `-ss/-to` + `-c:a copy`로 곡별 m4a를 만든다(프레임 경계 오차는 오프셋으로 보정).
- 이후 원본 영상과 전체 오디오의 참조는 **해제**한다(OCR 완료 후).

#### F3-6. 곡 제목 자동 인식 (OCR)
- 라이브러리: **Tesseract.js v5**, 언어 `kor+eng`(언어 데이터는 첫 사용 시 다운로드 후 캐시)
- 프레임 캡처:
  - 원본 File의 objectURL을 숨겨진 `<video muted playsinline>`에 연결한다(스트리밍 방식이라 메모리 부담 적음).
  - 각 곡 `srcStartSec + 3s`(오디오→영상 타임라인 오프셋 보정) 지점으로 `currentTime` seek → `seeked` 이벤트 → `canvas.drawImage`
  - 썸네일(JPEG, 폭 360px)은 저장한다.
- **제목 영역(ROI) 지정**:
  - 최초 1회, 첫 곡 캡처 화면에서 사용자가 드래그로 박스를 지정한다(영상 해상도 대비 **비율 좌표**로 저장 → 해상도가 달라도 재사용).
  - localStorage `cnation-mb:titleRoi`에 저장하고, 설정에서 재지정할 수 있다.
  - ROI를 지정하지 않으면 전체 화면 OCR 후 가장 큰 글자 줄을 제목 후보로 쓴다(정확도 낮음, 안내 표시).
- 전처리: ROI 크롭 → 2배 업스케일 → 그레이스케일 → 대비 강화 → (다크 UI면) 반전 → 이진화
- 후처리: 앞뒤 공백·특수문자 정리, 신뢰도 < 60이면 "확인 필요" 표시
- 인식 실패 시 기본 이름 `곡 1`, `곡 2` …
- **중복 제목 규칙**:
  - 정규화(trim, 연속 공백 1개, 대소문자 무시) 기준으로 같은 제목이 2개 이상이면 **재생 순서대로 `제목 1`, `제목 2`**처럼 공백 + 숫자를 붙인다.
  - 중복이 없는 제목은 번호 없이 표시한다.
  - 사용자가 제목을 수정하면 중복 번호를 다시 계산한다.
  - 개별 파일 입력 시에는 파일명(확장자 제외)을 제목으로 쓰고 같은 중복 규칙을 적용한다.

### F4. 개별 음악 파일 처리
- 파일 → `decodeAudioData` 시도(실패하면 ffmpeg.wasm으로 wav/m4a 변환 후 재시도)
- 분석: F3-3의 6번(시작/끝점 탐지)만 수행한다(곡 분리 없음).
- 재생용 Blob = 원본 파일, 오프셋 = 탐지된 시작/끝
- 구글 드라이브 파일은 `GET https://www.googleapis.com/drive/v3/files/{id}?alt=media`(Bearer 토큰)로 Blob 다운로드 후 동일하게 처리한다. 다운로드 진행률을 표시한다.

### F5. 재생 엔진
- **Web Audio API** 사용(샘플 단위 정확한 시작/끝).
  - 재생할 곡만 고음질 디코딩한다: 곡별 Blob → `AudioContext.decodeAudioData` (3.5분 스테레오 44.1kHz ≈ 37MB)
  - **메모리 예산**: 동시에 디코딩 상태로 유지하는 곡은 **현재 곡 + 다음 곡(프리로드)** 최대 2~3곡. LRU 방식으로 해제한다.
  - `AudioBufferSourceNode.start(when, offset, duration)`으로 구간을 재생한다.
  - 곡 전환 시 10ms 페이드(GainNode)로 클릭 노이즈를 방지한다.
- iOS 대응:
  - 첫 사용자 제스처에서 `audioContext.resume()`
  - `navigator.audioSession.type = 'playback'`(지원 시)으로 **무음 스위치 상태에서도 재생**되게 한다. 미지원 시 "무음 스위치를 꺼주세요" 안내
  - 재생 중 Screen Wake Lock(지원 시)
  - Media Session API로 잠금화면 메타데이터(곡 제목, 이전/다음)를 표시한다.
- 시간 표시 기준: 모든 곡의 **0:00 = 탐지된 첫 소리 시점**

### F6. 비교 설정

#### F6-1. 전체 구간 비교
- 선택된 곡들을 목록 순서대로, 각 곡의 `0:00 ~ 곡 끝`까지 이어서 재생한다.
- 곡 사이 간격: 기본 1.0s(설정 0~3s), 다음 곡 시작 전 제목 안내 토스트를 띄운다.

#### F6-2. 특정 구간 비교
- **기준곡 = 목록의 첫 번째 곡**(목록에서 기준곡 변경 가능)
- 기준곡 플레이어:
  - 재생/일시정지, 큰 프로그레스바(스크럽 가능, 드래그 중 현재 시간 실시간 표시)
  - **[시작 지점 설정]** / **[끝 지점 설정]** 버튼: 현재 재생 위치를 시작/끝으로 지정한다.
  - 프로그레스바 위에 시작/끝 핸들을 표시하고 **드래그로 미세 조정**한다.
  - **시작/끝 시간 별도 표시 + 직접 입력**: `mm:ss.s` 형식의 숫자 입력(iOS 숫자 키패드 `inputmode="decimal"`)
  - 미세 조정 버튼: `-1s`, `-0.1s`, `+0.1s`, `+1s` (시작·끝 각각)
  - **[구간 미리듣기]**(구간 반복 재생 토글)
  - 구간 길이 표시(예: `0:45.2 ~ 1:30.0 (44.8초)`)
- 지정된 구간(`relStart ~ relEnd`)을 **모든 곡의 같은 상대 시간에 적용**한다.
- **곡별 오프셋 보정**(선택 기능): 곡마다 인트로 길이가 달라 같은 마디가 아닐 수 있으므로, 곡별로 `±` 오프셋(0.1s 단위)을 조정하고 해당 곡만 미리듣기할 수 있다.
- 어떤 곡이 구간 끝보다 짧으면 → 그 곡은 곡 끝까지만 재생하고 ⚠️ 표시한다.
- 구간 프리셋 저장(예: "후렴1", "인트로") → 세션 내에서 여러 구간을 빠르게 전환한다.

### F7. 비교 재생 & 별점 (원터치)
- **[비교]** 버튼 → 비교 재생 화면
- 화면 구성:
  - 상단: `라운드 정보(전체 / 구간 0:45~1:30)`, `2 / 4`
  - 중앙: 현재 곡 제목(크게), 썸네일, 진행바(구간 기준)
  - 하단: **★ 5개 대형 버튼** — 한 번 탭하면 즉시 해당 별점 확정(다시 탭하면 변경)
  - 컨트롤: 이전 곡 / 다시 듣기 / 일시정지 / 다음 곡(건너뛰기)
- 별점은 곡 재생 중에도, 재생 후 간격 시간에도 줄 수 있다.
- 옵션: "별점 주면 자동으로 다음 곡"(기본 OFF)
- 옵션: **블라인드 모드**(제목 숨김, 순서 셔플 → 결과 화면에서 공개)
- 모든 곡 재생이 끝나면 결과 화면으로 자동 이동한다. 별점이 없는 곡이 있으면 "미평가 n곡" 안내와 함께 결과 화면에서 바로 평가할 수 있게 한다.

### F8. 결과 화면
- 곡 목록을 **별점 높은 순**으로 정렬(동점은 재생 순서)
- 각 행: 순위, 제목, 썸네일, ★ 표시, [▶ 다시 듣기(해당 라운드 구간)], [별점 수정]
- 동점 1위가 여러 곡이면 "동점 — 결승 라운드" 버튼: 동점 곡만 모아 같은 구간으로 다시 비교한다.
- **라운드 누적**: 한 세션에서 전체 라운드 1회 + 구간 라운드 여러 회를 진행할 수 있고, 결과표에 라운드별 별점과 **평균 별점** 열을 표시한다.
- **Best 선택**: 행의 🏆 버튼 → 세션에 `bestSongId`를 저장하고 결과 상단에 강조 표시한다.
- 공유/내보내기: 결과를 텍스트로 복사(예: `🏆 제목 2 ★5 / 제목 1 ★4 …`) 또는 이미지(Canvas)로 저장한다.

### F9. 세션 저장 / 기록
- 자동 저장(IndexedDB): 세션 메타, 곡 목록, 곡별 오디오 Blob, 썸네일, 마커, 라운드, 별점, Best
- 홈 화면에 **최근 세션 목록**(날짜, 곡 수, Best 제목) → 탭하면 결과 또는 비교 화면으로 이동
- 세션 이름 변경, 삭제, 저장 용량 표시(설정)
- 원본 영상은 저장하지 않는다 → "추출 완료 후 원본 영상은 삭제해도 됩니다" 안내

### F10. 설정
- 무음 탐지 파라미터(F3-3 표) — 고급 섹션
- 곡 사이 간격, 자동 다음 곡, 블라인드 모드 기본값
- 제목 영역(ROI) 재지정 / 초기화
- 구글 계정 연결 / 해제
- 저장공간 관리(세션별 용량, 전체 삭제)
- 녹화 가이드 보기(F11)

### F11. 녹화 가이드 (앱 내 도움말)
1. 방해금지 모드 ON (알림음이 섞이면 무음 구간이 깨짐)
2. 제어 센터 화면 녹화 버튼을 길게 눌러 **마이크 OFF** 확인
3. Suno 재생 화면에서 **곡 제목이 보이는 상태**를 유지하고, 곡마다 같은 화면 구성 유지
4. 녹화는 첫 곡 재생 **몇 초 전**에 시작하고, 마지막 곡이 끝나고 **몇 초 뒤**에 종료(앞뒤 여유는 자동 제거됨)
5. 곡 사이 간격이 길어도 괜찮음(오히려 분리가 쉬움)
6. 녹화 파일은 **파일 앱에 저장** 후 앱에서 선택 권장
7. 화질은 FHD 그대로 사용(재인코딩 불필요)

### F12. MP3 내보내기 (구간 정확 잘라내기)
- 진입: 결과 화면(F8)의 각 행 [💾 MP3] 버튼, 상단 **[선택 곡 MP3 저장]**(체크박스로 1곡 또는 여러 곡 선택), 분리 결과 화면(S5)의 곡 카드 메뉴
- **잘라내기 범위**: 기본은 곡의 **시작(첫 소리) ~ 끝(페이드아웃 꼬리 포함)**, 즉 `startInBlobSec ~ endInBlobSec`(앞뒤 녹화 여유와 곡 사이 무음 제외). 옵션으로 "현재 비교 구간만" 저장도 제공한다.
- **음질 선택**: 128 / 192 / **256(기본)** / 320 kbps CBR, 샘플레이트는 원본 유지(44.1kHz 또는 48kHz), 스테레오
  - 안내: "녹화 원본 오디오(AAC) 이상의 음질은 만들 수 없어요. 256kbps면 충분합니다"
- **페이드 옵션**: 시작/끝 페이드 0 / 10ms(기본, 클릭 노이즈 방지) / 1s / 3s
- **파일명**: `{displayTitle}.mp3` (파일명 금지 문자 치환), 중복 시 ` (2)`
- **ID3 태그**: 제목(displayTitle), 아티스트 `cnation`(설정에서 변경 가능), 별점은 코멘트에 기록 (`browser-id3-writer`)
- 인코딩:
  - 곡별 오디오 Blob → `decodeAudioData`(원본 샘플레이트) → 구간 샘플 추출 → 페이드 적용 → **lamejs**(`@breezystack/lamejs`) MP3 인코딩
  - **Web Worker**에서 1152샘플 단위 청크 인코딩, 진행률 표시, 여러 곡은 순차 처리(메모리 절약)
  - 예상: 3.5분 곡 1개 인코딩 수 초~10여 초 (iPhone 14 Pro Max)
- 저장(iOS):
  - 1곡: `navigator.share({ files: [mp3File] })` → 공유 시트에서 **"파일에 저장"** 선택(파일 앱). 미지원 환경에서는 `<a download>` 폴백
  - 여러 곡: `navigator.share({ files: [...] })`로 한 번에 공유. 실패하거나 많으면 **ZIP**(`fflate`)으로 묶어 저장
  - 데스크톱: `<a download>` 개별 또는 ZIP
- 주의 안내(첫 사용 시 1회): "화면 녹화에서 추출한 파일이므로 개인 감상과 비교 용도로 사용하세요. 배포나 업로드용 최종 음원은 Suno 정식 다운로드를 권장합니다."

---

## 4. 화면 구성 (Screen List)

| # | 화면 | 주요 요소 |
|---|---|---|
| S1 | 홈 | [녹화 영상 불러오기](메인, 큰 버튼), [곡 불러오기], 최근 세션 목록, 설정, 녹화 가이드 |
| S2 | 불러오기 시트 | 기기 파일 / 구글 드라이브 선택, "여러 곡 연속 녹화" 토글, 곡 수 입력 |
| S3 | 처리 진행 | 단계별 진행바(추출 → 분석 → 분리 → 제목 인식), 취소 |
| S4 | 제목 영역 지정(최초 1회) | 캡처 이미지 + 드래그 박스, [이 영역 사용] |
| S5 | 분리 결과 확인 | 전체 파형 + 마커, 곡 카드 목록(썸네일, 제목 수정, 길이, 미리듣기, 삭제, 순서 변경 드래그), [확인] |
| S6 | 비교 설정 | 곡 목록(체크박스로 비교 대상 선택, 순서 변경), 모드 탭(전체/구간), 구간 편집기(F6-2), [비교] |
| S7 | 비교 재생 | F7 |
| S8 | 결과 | F8 + MP3 저장(F12) |
| S8-1 | MP3 저장 시트 | 대상 곡 확인, 범위(곡 전체/현재 구간), 음질(128/192/256/320), 페이드, 진행률, [저장] |
| S9 | 설정 | F10 |

내비게이션: 단일 페이지 앱, 해시 라우팅 또는 React Router(뒤로가기 제스처 대응)

---

## 5. 기술 스택

| 영역 | 선택 | 비고 |
|---|---|---|
| 빌드 | **Vite + React 18 + TypeScript** | |
| 스타일 | Tailwind CSS | 모바일 우선, 다크 테마 |
| 상태관리 | Zustand | |
| 저장 | IndexedDB (`idb` 라이브러리) | Blob 저장 |
| 오디오 추출 | **mp4box.js** (1순위), **@ffmpeg/ffmpeg + @ffmpeg/core(single-thread)** (폴백) | ffmpeg는 동적 import(초기 번들에서 제외) |
| 분석 | Web Worker + Web Audio `OfflineAudioContext` | |
| 재생 | Web Audio API | |
| 파형 | 자체 Canvas 렌더러 | |
| OCR | **tesseract.js v5** (`kor+eng`) | Worker 재사용 |
| 구글 드라이브 | Google Identity Services(token client) + Google Picker API + Drive REST v3 | scope: `https://www.googleapis.com/auth/drive.readonly` (또는 Picker 사용 시 `drive.file`) |
| PWA | vite-plugin-pwa | OCR 언어 데이터와 ffmpeg 코어 런타임 캐시 |
| 배포 | GitHub `cnation-mb` 레포 → **Vercel** 자동 배포 | |
| MP3 인코딩 | **@breezystack/lamejs** (Worker) + browser-id3-writer | 동적 import |
| ZIP | fflate | 여러 곡 내보내기 |
| 테스트 | Vitest(알고리즘 단위 테스트), 실기기 수동 테스트 | |

### 5.1 환경변수 (Vercel / `.env.local`)
```
VITE_GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
VITE_GOOGLE_API_KEY=xxxxx
VITE_GOOGLE_APP_ID=xxxxx   # Cloud 프로젝트 번호 (Picker용)
```
- Google Cloud Console: 프로젝트 생성 → Drive API, Picker API 활성화 → OAuth 동의 화면(테스트 사용자에 본인 계정) → OAuth 클라이언트(웹) 생성 → **승인된 JavaScript 원본**: `http://localhost:5173`, `https://cnation-mb.vercel.app`(실제 도메인)
- 구글 드라이브 기능은 환경변수가 없으면 버튼을 비활성화하고 안내를 표시한다(나머지 기능은 정상 동작).

### 5.2 헤더 주의
- **COOP/COEP 헤더를 설정하지 않는다**(Google Picker iframe, OAuth 팝업과 충돌). 그래서 ffmpeg는 single-thread 코어를 사용한다.

---

## 6. 데이터 모델 (TypeScript)

```ts
type SourceKind = 'recording' | 'file' | 'gdrive';

interface Session {
  id: string;
  name: string;              // 기본: "2026-11-25 10:40 비교"
  createdAt: number;
  updatedAt: number;
  songIds: string[];         // 표시/재생 순서
  rounds: Round[];
  bestSongId?: string;
  segmentPresets: SegmentPreset[];
}

interface Song {
  id: string;
  sessionId: string;
  sourceKind: SourceKind;
  sourceName: string;        // 원본 파일명
  rawTitle: string;          // OCR/파일명 원문
  title: string;             // 사용자 수정 반영 제목
  displayTitle: string;      // 중복 번호 적용 결과 ("제목 2")
  ocrConfidence?: number;
  thumbnailBlobKey?: string;
  audioBlobKey: string;      // 곡별 재생용 오디오 Blob (IndexedDB)
  audioMime: string;         // 'audio/aac' | 'audio/mp4' | 'audio/mpeg' ...
  startInBlobSec: number;    // 0:00(첫 소리)의 Blob 내 위치
  endInBlobSec: number;      // 곡 끝
  durationSec: number;       // end - start
  userOffsetSec: number;     // 구간 비교용 곡별 보정(기본 0)
  needsReview: boolean;      // 분리/OCR 신뢰도 낮음
  peaks?: Float32Array;      // 파형 미리보기(곡 단위)
}

type RoundMode = 'full' | 'segment';

interface Round {
  id: string;
  mode: RoundMode;
  relStartSec?: number;      // segment 모드
  relEndSec?: number;
  referenceSongId?: string;
  songOrder: string[];       // 블라인드 셔플 반영
  blind: boolean;
  ratings: Record<string, 1 | 2 | 3 | 4 | 5 | undefined>;
  startedAt: number;
  completedAt?: number;
}

interface SegmentPreset { id: string; label: string; relStartSec: number; relEndSec: number; }

interface TitleRoi { x: number; y: number; w: number; h: number; } // 0~1 비율 좌표
```

IndexedDB 스토어: `sessions`, `songs`, `blobs`(key → Blob), `settings`

---

## 7. 폴더 구조 (제안)

```
cnation-mb/
├─ public/ (icons, manifest)
├─ src/
│  ├─ app/            # 라우팅, 레이아웃
│  ├─ screens/        # Home, Import, Processing, RoiSelect, SplitReview, CompareSetup, ComparePlay, Result, Settings
│  ├─ components/     # Waveform, StarRating, TimeInput, SegmentEditor, SongCard, ProgressScrubber
│  ├─ audio/
│  │  ├─ extract/     # mp4boxExtractor.ts, adts.ts, ffmpegExtractor.ts
│  │  ├─ analyze/     # analysis.worker.ts, silence.ts (순수 함수), peaks.ts
│  │  ├─ slice.ts     # 곡별 Blob 생성
│  │  ├─ player.ts    # Web Audio 재생 엔진 (LRU 디코드 캐시)
│  │  └─ export/      # mp3.worker.ts (lamejs), id3.ts, zip.ts, share.ts
│  ├─ ocr/            # frameCapture.ts, preprocess.ts, ocr.ts, titles.ts(중복 번호)
│  ├─ gdrive/         # auth.ts, picker.ts, download.ts
│  ├─ store/          # zustand stores
│  ├─ db/             # idb 래퍼
│  └─ utils/          # time format/parse(mm:ss.s), id
├─ tests/             # silence.test.ts, titles.test.ts, timeFormat.test.ts
└─ vercel.json
```

---

## 8. 개발 단계 (Milestones)

### Phase 0 — 기술 검증 PoC (최우선, 실기기)
- [x] mp4box.js로 iPhone 화면 녹화(.mov/.mp4, FHD, 15분, 약 400MB)에서 AAC 추출 → ADTS Blob 생성
- [x] (자동 판별 구현: ADTS 실패 시 audio-only M4A 먹스) iOS Safari에서 ADTS Blob의 `decodeAudioData`(8kHz OfflineAudioContext) 성공 여부 확인. 실패 시 대안 결정(audio-only mp4 mux 또는 ffmpeg)
- [ ] 처리 시간과 메모리 측정(Safari Web Inspector로 원격 디버깅) — **실기기 측정 필요**: 앱 내 `설정 → 기술 검증(PoC)` 화면 사용
- [x] `<video>` seek + canvas 캡처가 iOS에서 되는지 확인
- [x] `navigator.audioSession` 동작 확인
- 산출물: 측정 결과를 `docs/poc-result.md`에 기록하고 추출 경로를 확정한다.

### Phase 1 — MVP (메인 시나리오 완주)
- [x] 프로젝트 셋업(Vite/React/TS/Tailwind/PWA), Vercel 배포 연결
- [x] 녹화 영상 불러오기 → 추출 → 분석 → 곡 분리(곡 수 입력) → 앞뒤 무음 제거
- [x] 분리 결과 확인 화면(파형 + 마커 드래그)
- [x] 전체 구간 비교 + 원터치 별점 + 결과 화면 + Best 선택
- [x] 세션 자동 저장 및 최근 세션

### Phase 2 — 구간 비교 & 제목 인식
- [x] 특정 구간 편집기(스크럽, 시작/끝 설정, 핸들 드래그, 숫자 입력, ±0.1/±1s, 미리듣기 반복)
- [x] 곡별 오프셋 보정
- [x] OCR: 프레임 캡처, ROI 지정, kor+eng 인식, 중복 제목 번호, 수정 UI
- [x] 라운드 누적 + 평균 별점, 동점 결승 라운드

### Phase 3 — 보조 입력 & 마감
- [x] 개별 파일(mp3/wav/m4a/webm/mp4/mov) 불러오기 + 무음 제거
- [x] 구글 드라이브 연결(Picker, 다중 선택, 다운로드 진행률)
- [x] **MP3 내보내기(F12)**: 1곡/여러 곡, 음질 선택, 정확한 시작~끝 잘라내기, 페이드, ID3, 공유 시트/ZIP 저장
- [x] 블라인드 모드, 결과 텍스트/이미지 공유
- [x] 설정 화면, 녹화 가이드, 저장공간 관리
- [x] Media Session, Wake Lock, 오프라인 캐시 마감

---

> v1.0.0 (2026-11-25): Phase 0~3 구현 완료. Phase 0의 아이폰 실기기 측정값은 `docs/poc-result.md`에 기록 예정.

## 9. 수용 기준 (Acceptance Criteria)

| # | 기준 |
|---|---|
| AC1 | iPhone 14 Pro Max Safari에서 **15분 / 400MB 화면 녹화**를 불러와 **60초 이내**에 곡 분리까지 완료하고, 처리 중 탭이 재로드(크래시)되지 않는다 |
| AC2 | 곡 수 4를 입력한 표준 녹화(곡 사이 무음 ≥ 1초)에서 **곡 경계 100% 정확** |
| AC3 | 각 곡 시작점(첫 소리) 탐지 오차 **±20ms 이내**(원본 Suno 다운로드 파일과 비교 검증) |
| AC4 | 페이드아웃 꼬리가 잘리지 않는다(끝점이 실제 소리 종료 이후) |
| AC5 | 녹화 앞뒤 여유(3~10초 무음)가 결과에 포함되지 않는다 |
| AC6 | 구간 비교 시 모든 곡이 지정한 상대 시간에서 **샘플 정확도로** 시작하고 끝난다 |
| AC7 | 별점은 1탭으로 확정되고, 결과 화면이 별점순으로 정렬된다 |
| AC8 | 같은 제목 2곡이 `제목 1`, `제목 2`로 재생 순서대로 표시된다 |
| AC9 | 앱을 닫았다 열어도 세션(곡, 마커, 별점, Best)이 유지된다 |
| AC10 | 무음 스위치 ON 상태에서도 재생된다(지원 iOS 버전). 미지원 시 안내가 표시된다 |
| AC12 | 선택한 곡을 지정 음질의 MP3로 저장하면, 파일이 곡의 첫 소리에서 시작해 꼬리까지 포함하고 앞뒤 녹화 여유는 없다(±20ms). 여러 곡 선택 시 모두 저장된다 |
| AC11 | 데이터 전송 없음: 기기 파일 처리 시 네트워크 요청은 앱 정적 리소스와 OCR/ffmpeg 최초 다운로드뿐이다 |

---

## 10. 예외 상황 & 처리

| 상황 | 처리 |
|---|---|
| 녹화 중 알림음/클릭음 유입 | 짧은 소리(≤300ms)는 무음으로 병합. 그 외는 분리 결과 화면에서 수동 보정 |
| 곡 중간에 긴 무음(브레이크) | 곡 수 입력 시 가장 긴 N-1개만 경계로 채택 → 대부분 해결. "확인 필요" 배지 표시 |
| 곡 수 입력값과 탐지된 후보 수 불일치 | 후보가 부족하면 가장 긴 무음 순으로 채우고 경고, 사용자가 파형에서 경계 추가 |
| 영상에 오디오 트랙 없음(마이크/내부 오디오 꺼짐) | "오디오가 없는 녹화입니다 — 녹화 가이드 확인" 안내 |
| mp4box 추출 실패(비표준 컨테이너) | ffmpeg.wasm 폴백 → 실패 시 오류 안내 |
| webm 디코딩 실패(iOS) | ffmpeg.wasm으로 변환 후 재시도 |
| 저장공간 부족(IndexedDB QuotaExceeded) | 오래된 세션 삭제 유도, `navigator.storage.persist()` 요청 |
| 구간 끝 > 곡 길이 | 곡 끝까지만 재생하고 ⚠️ 표시 |
| OCR 실패/저신뢰 | `곡 n` 기본 이름 + "확인 필요", 썸네일 탭으로 수정 |
| 처리 중 앱 이탈(백그라운드) | 처리 상태를 잃을 수 있음 → 재개 불가 시 처음부터, 진행 중 화면 꺼짐 방지(Wake Lock) |

---

## 11. 향후 확장 아이디어 (v2 이후)
- 파형/스펙트럼 기반 **자동 마디 정렬**(교차상관으로 곡 간 오프셋 자동 추정)
- 라우드니스 정규화(LUFS 맞춤) 옵션 — 볼륨 차이로 인한 편향 제거
- A/B 즉시 전환 모드(같은 시점에서 곡만 바꿔 듣기)
- Supabase/Firebase로 세션 동기화(기기 간), 지인에게 블라인드 투표 링크 공유
- 결과를 유튜브(cnation) 작업 메모로 내보내기

---

## 12. Claude Code 작업 시작 지시 (붙여넣기용)

```
이 기획서(cnation-mb-spec.md)를 기준으로 "cnation-mb" 웹앱을 만들어줘.
- 스택: Vite + React + TypeScript + Tailwind + Zustand + idb + vite-plugin-pwa
- 먼저 Phase 0 PoC부터 진행: mp4box.js로 아이폰 화면 녹화 파일에서 AAC를 청크 단위로 추출해
  ADTS Blob을 만들고, OfflineAudioContext(8kHz)로 디코딩 → 무음 탐지(silence.ts, 순수 함수 + Vitest 테스트)
  → 곡 분리 결과를 화면에 출력하는 최소 페이지를 만들어줘.
- PoC 페이지는 처리 단계별 소요 시간과 결과(곡별 시작/끝 초)를 표시해서 내가 아이폰에서 직접 검증할 수 있게 해줘.
- 이후 Phase 1 → 2 → 3 순서로 진행하고(MP3 내보내기 F12는 Phase 3에 포함), 각 Phase 완료 시 체크리스트를 업데이트해줘.
- GitHub 레포 cnation-mb에 커밋하고 Vercel로 배포할 수 있게 vercel.json과 README를 준비해줘.
```
