export const APP_VERSION = '1.0.0';

export interface Revision {
  version: string;
  date: string;
  title: string;
  changes: string[];
}

/** 개정 이력 (최신이 위) — 앱 하단 (rev. history) 링크에서 표시 */
export const REVISIONS: Revision[] = [
  {
    version: '1.0.0',
    date: '2026-11-25',
    title: '첫 번째 완성 버전',
    changes: [
      '녹화 영상 1개에서 여러 곡 자동 분리 (청크 단위 오디오 추출, 재인코딩 없음, 8kHz 분석)',
      '개별 음악 파일(mp3/wav/m4a/webm/mp4/mov) 다중 선택 불러오기 및 녹화 영상과 혼합 비교',
      '앞뒤 무음 자동 제거 — 모든 곡의 0:00을 첫 소리에 맞춤 (샘플 단위 정밀 보정)',
      '분리 결과 확인: 전체 파형, 시작/끝 마커 드래그, 경계 추가/삭제, 곡 수 재분리, 마커 미리듣기',
      '곡 제목 자동 인식(OCR, kor+eng) + 제목 영역(ROI) 지정 + 중복 제목 번호 규칙',
      '전체 구간 / 특정 구간 비교, 구간 편집기(스크럽·핸들·숫자 입력·±0.1/±1s·반복 미리듣기), 곡별 오프셋 보정, 구간 프리셋',
      '원터치 별점, 자동 다음 곡, 블라인드 모드, 라운드 누적·평균 별점, 동점 결승 라운드, Best 선택',
      '선택 곡 MP3 저장 (128/192/256/320kbps, 페이드, ID3, 공유 시트/ZIP)',
      '구글 드라이브 불러오기 (환경변수 설정 시)',
      '세션 자동 저장(IndexedDB), 최근 세션, 저장공간 관리, 녹화 가이드, PWA 오프라인 지원',
    ],
  },
];
