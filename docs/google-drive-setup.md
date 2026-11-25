# 구글 드라이브 연결 설정 (앱 관리자 1회)

이 설정은 **앱 주인이 한 번만** 하면 됩니다. 이후에는 앱을 쓰는 모든 사람이 **각자 자기 폰에서 자기 구글 계정으로 로그인**만 하면 자동으로 연결됩니다.
(앱 안에서도 `설정 → 구글 드라이브 → 관리자용: 구글 드라이브 켜는 방법`에서 같은 내용을 볼 수 있습니다.)

## 1. Google Cloud 설정

1. [Google Cloud Console](https://console.cloud.google.com/projectcreate) → 새 프로젝트 (예: `cnation-mb`)
2. **API 및 서비스 → 라이브러리** → `Google Drive API`, `Google Picker API` 사용 설정
3. **OAuth 동의 화면 (Google 인증 플랫폼)**
   - 대상: **외부**
   - 앱 이름 `c.음악비교분석`, 지원 이메일, 개발자 연락처
   - 데이터 액세스(범위): `https://www.googleapis.com/auth/drive.file` (+ 기본 `openid`, `email`)
   - **앱 게시(프로덕션으로 푸시)** — `drive.file`은 민감하지 않은 범위라 보안 심사 없이 누구나 사용 가능
     (게시하지 않고 '테스트' 상태로 두면 등록한 테스트 사용자만 로그인 가능)
4. **사용자 인증 정보 → OAuth 클라이언트 ID → 웹 애플리케이션**
   - 승인된 JavaScript 원본: `https://cnation-mb.vercel.app` (개발용 `http://localhost:5173`)
   - 승인된 리디렉션 URI: `https://cnation-mb.vercel.app/oauth.html` (개발용 `http://localhost:5173/oauth.html`)
5. **사용자 인증 정보 → API 키**
   - 애플리케이션 제한: 웹사이트 → `https://cnation-mb.vercel.app/*`
   - API 제한: Google Picker API, Google Drive API
6. 프로젝트 대시보드에서 **프로젝트 번호**(숫자) 확인

## 2. Vercel 환경변수

Vercel → `cnation-mb` → Settings → Environment Variables (Production):

| 이름 | 값 |
|---|---|
| `VITE_GOOGLE_CLIENT_ID` | 4번 클라이언트 ID (`…apps.googleusercontent.com`) |
| `VITE_GOOGLE_API_KEY` | 5번 API 키 |
| `VITE_GOOGLE_APP_ID` | 6번 프로젝트 번호 |

저장 후 **Deployments → Redeploy** (값은 빌드할 때 앱에 들어갑니다). 세 값은 브라우저에 공개되는 값으로 비밀 정보가 아닙니다.

## 3. 사용하는 사람

- `설정 → 구글 드라이브 → 구글 계정으로 로그인`, 또는 불러오기/연속 듣기 화면의 **☁️ 구글 드라이브** 버튼
- 처음 한 번 로그인 → 앱으로 돌아오면 파일 선택 창이 자동으로 열림
- 다음부터는 버튼만 누르면 바로 선택 (1시간마다 만료되는 토큰은 기억된 계정으로 화면 없이 자동 갱신)
- 앱은 사용자가 선택 창에서 고른 파일만 접근(`drive.file`)하고, 파일은 그 사람 기기로만 내려받습니다

## 동작 방식 (개발 참고)

- 로그인은 리디렉션 방식(OAuth 2.0 토큰 응답): iOS 홈 화면 앱에서 팝업이 막히는 문제를 피하기 위함
- `public/oauth.html`이 토큰을 `localStorage`에 저장하고 원래 화면(`/#/...`)으로 돌아감
- 기억된 계정이 있으면 `prompt=none`으로 화면 없이 재발급, 동의가 다시 필요하면 자동으로 로그인 화면으로
- 서비스 워커는 `/oauth.html`을 가로채지 않음 (`navigateFallbackDenylist`)
