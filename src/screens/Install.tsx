import { Screen } from '../components/Layout';
import { InstallInstructions } from '../components/InstallGuide';

/** 공유용 안내 페이지: https://cnation-mb.vercel.app/#/install */
export default function Install() {
  return (
    <Screen title="홈 화면에 추가" back="/">
      <div className="card">
        <InstallInstructions />
      </div>
      <p className="mt-4 text-xs text-slate-500">홈 화면 앱은 처음 한 번 연 뒤에는 오프라인에서도 열려요. 모든 처리는 기기 안에서 이루어지고 파일이 업로드되지 않아요.</p>
    </Screen>
  );
}
