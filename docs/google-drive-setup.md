# 구글 드라이브 연결 설정 (앱 관리자 1회)

이 설정은 **앱 주인이 한 번만** 하면 됩니다. 이후에는 앱을 쓰는 모든 사람이 **각자 자기 폰에서 자기 구글 계정으로 로그인**만 하면 자동으로 연결됩니다.
(앱 안에서도 `설정 → 구글 드라이브 → 관리자용: 구글 드라이브 켜는 방법`에서 같은 내용을 볼 수 있습니다.)

## 1. Google Cloud 설정

1. [Google Cloud Console](https://console.cloud.google.com/projectcreate) → 새 프로젝트 (예: `cnation-mb`)
2. **API 및 서비스 → 라이브러리** → `Google Drive API` 사용 설정
3. **OAuth 동의 화면 (Google 인증 플랫폼)**
   - 대상: **외부**
   - 앱 이름 `c.음악비교분석`, 지원 이메일, 개발자 연락처
   - 브랜딩: 홈페이지 `https://cnation-mb.vercel.app`, 개인정보처리방침 `https://cnation-mb.vercel.app/privacy.html`, 승인된 도메인 `cnation-mb.vercel.app` (로고는 비워 둠)
   - 데이터 액세스(범위): `https://www.googleapis.com/auth/drive.readonly` (+ 기본 `openid`, `email`)
   - **앱 게시(프로덕션으로 푸시)**
   - `drive.readonly`는 '제한된 범위'라 구글 인증 전에는 로그인 시 "확인되지 않은 앱" 안내(고급 → 이동)가 나오고 사용자 수가 최대 100명으로 제한됨
4. **사용자 인증 정보 → OAuth 클라이언트 ID → 웹 애플리케이션**
   - 승인된 JavaScript 원본: `https://cnation-mb.vercel.app` (개발용 `http://localhost:5173`)
   - 승인된 리디렉션 URI: `https://cnation-mb.vercel.app/oauth.html` (개발용 `http://localhost:5173/oauth.html`)
5. ~~API 키 / 프로젝트 번호~~ — 더 이상 필요 없음 (v1.6.0부터 구글 Picker 대신 앱 자체 드라이브 화면 사용)

## 2. Vercel 환경변수

Vercel → `cnation-mb` → Settings → Environment Variables (Production):

| 이름 | 값 |
|---|---|
| `VITE_GOOGLE_CLIENT_ID` | 4번 클라이언트 ID (`…apps.googleusercontent.com`) |

저장 후 **Deployments → Redeploy** (값은 빌드할 때 앱에 들어갑니다). 클라이언트 ID는 브라우저에 공개되는 값으로 비밀 정보가 아닙니다.

## 3. 사용하는 사람

- `설정 → 구글 드라이브 → 구글 계정으로 로그인`, 또는 불러오기/연속 듣기 화면의 **☁️ 구글 드라이브** 버튼
- 처음 한 번 로그인 → 앱으로 돌아오면 드라이브 탐색 화면이 자동으로 열림 (내 드라이브 · 최근 · 공유 문서함 · 검색 · 여러 개 선택)
- 다음부터는 버튼만 누르면 바로 탐색 화면 (1시간마다 만료되는 토큰은 기억된 계정으로 화면 없이 자동 갱신)
- 읽기 전용(`drive.readonly`), 고른 파일만 그 사람 기기로 내려받습니다

## 왜 구글 Picker를 쓰지 않나요?

구글 파일 선택 창(Picker)은 앱 안에 끼워진 구글 화면(iframe)이라 iPhone Safari·홈 화면 앱의 서드파티 쿠키 차단에 걸려 "Google 계정에 액세스할 수 없습니다 / 쿠키 액세스를 허용하세요" 오류가 납니다. 그래서 Drive REST API로 목록을 직접 불러오는 앱 자체 화면(`src/components/DriveBrowser.tsx`)을 씁니다.

## 동작 방식 (개발 참고)

- 로그인은 리디렉션 방식(OAuth 2.0 토큰 응답): iOS 홈 화면 앱에서 팝업이 막히는 문제를 피하기 위함
- `public/oauth.html`이 토큰을 `localStorage`에 저장하고 원래 화면(`/#/...`)으로 돌아감
- 기억된 계정이 있으면 `prompt=none`으로 화면 없이 재발급, 동의가 다시 필요하면 자동으로 로그인 화면으로
- 서비스 워커는 `/oauth.html`을 가로채지 않음 (`navigateFallbackDenylist`)
