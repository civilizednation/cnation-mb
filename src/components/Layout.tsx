import { type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { APP_VERSION } from '../version';

export function Screen({
  title,
  back,
  right,
  children,
  footer = true,
  wide = false,
}: {
  title?: ReactNode;
  back?: string | boolean;
  right?: ReactNode;
  children: ReactNode;
  footer?: boolean;
  wide?: boolean;
}) {
  const nav = useNavigate();
  return (
    <div className="flex min-h-[100dvh] flex-col">
      {title !== undefined && (
        <header className="safe-top sticky top-0 z-20 border-b border-line/60 bg-bg/90 backdrop-blur">
          <div className={`mx-auto flex h-14 items-center gap-2 px-2 ${wide ? 'max-w-3xl' : 'max-w-xl'}`}>
            {back ? (
              <button
                aria-label="뒤로"
                className="btn min-w-[44px] px-2 text-2xl text-slate-300"
                onClick={() => (typeof back === 'string' ? nav(back) : nav(-1))}
              >
                ‹
              </button>
            ) : (
              <span className="w-2" />
            )}
            <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{title}</h1>
            <div className="flex items-center gap-1">{right}</div>
          </div>
        </header>
      )}
      <main className={`mx-auto w-full flex-1 px-4 py-4 ${wide ? 'max-w-3xl' : 'max-w-xl'}`}>{children}</main>
      {footer && <VersionFooter />}
    </div>
  );
}

export function VersionFooter() {
  return (
    <footer className="safe-bottom pt-6 text-center text-xs text-slate-500">
      <span>cnation 음악 비교 분석 · version {APP_VERSION}</span>{' '}
      <Link to="/history" className="text-slate-400 underline underline-offset-2 hover:text-accent2">
        (rev. history)
      </Link>
    </footer>
  );
}

export function Section({ title, children, right }: { title: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="mb-5">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 py-1">
      <span>
        <span className="block">{label}</span>
        {hint && <span className="block text-xs text-slate-400">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 shrink-0 rounded-full transition ${checked ? 'bg-accent' : 'bg-line'}`}
      >
        <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </label>
  );
}

export function ProgressBar({ value, className = '' }: { value: number; className?: string }) {
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-line ${className}`}>
      <div className="h-full rounded-full bg-gradient-to-r from-accent to-accent2 transition-[width]" style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
    </div>
  );
}
