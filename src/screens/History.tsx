import { Screen } from '../components/Layout';
import { APP_VERSION, REVISIONS } from '../version';

export default function History() {
  return (
    <Screen title="개정 이력 (rev. history)" back>
      <p className="mb-4 text-sm text-slate-400">현재 버전: v{APP_VERSION}</p>
      <ol className="space-y-4">
        {REVISIONS.map((r) => (
          <li key={r.version} className="card">
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="text-lg font-bold">v{r.version}</span>
              <span className="text-xs text-slate-400">{r.date}</span>
            </div>
            <div className="mb-2 text-sm text-accent2">{r.title}</div>
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-300">
              {r.changes.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </Screen>
  );
}
