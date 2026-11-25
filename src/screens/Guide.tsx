import { Screen } from '../components/Layout';

const STEPS: [string, string][] = [
  ['🔕 방해금지 모드 ON', '알림음이 섞이면 무음 구간이 깨져 곡 분리가 어려워져요.'],
  ['🎙 마이크 OFF 확인', '제어 센터의 화면 녹화 버튼을 길게 눌러 마이크가 꺼져 있는지 확인하세요. (앱 내부 소리만 녹음)'],
  ['🎵 곡 제목이 보이는 화면 유지', 'Suno 재생 화면에서 곡 제목이 보이는 상태를 유지하고, 곡마다 같은 화면 구성을 유지하세요.'],
  ['⏱ 앞뒤 여유', '녹화는 첫 곡 재생 몇 초 전에 시작하고, 마지막 곡이 끝나고 몇 초 뒤에 종료하세요. 앞뒤 여유는 자동 제거돼요.'],
  ['↔️ 곡 사이 간격', '곡 사이 간격이 길어도 괜찮아요. 오히려 분리가 쉬워집니다.'],
  ['📁 파일 앱에 저장', '녹화 파일은 파일 앱에 저장한 뒤 앱에서 선택하면 더 빨라요.'],
  ['🎞 화질은 그대로', 'FHD 원본 그대로 사용하세요. 재인코딩(SD 변환)은 음질 저하 위험이 있어 불필요해요.'],
];

export default function Guide() {
  return (
    <Screen title="녹화 가이드" back>
      <ol className="space-y-3">
        {STEPS.map(([t, d], i) => (
          <li key={i} className="card">
            <div className="mb-1 font-semibold">
              {i + 1}. {t}
            </div>
            <p className="text-sm text-slate-300">{d}</p>
          </li>
        ))}
      </ol>
      <div className="card mt-4 text-sm text-slate-300">
        <b>Tip.</b> 최종으로 고른 곡만 Suno에서 정식 다운로드하면 월 다운로드 한도를 아낄 수 있어요. 이 앱은 모든 처리를 기기 안에서 하므로 영상이 서버로 업로드되지 않아요.
      </div>
    </Screen>
  );
}
