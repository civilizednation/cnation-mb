import type { Rating } from '../types';

export function StarRating({ value, onChange, size = 'lg', readOnly = false }: { value?: Rating; onChange?: (r: Rating) => void; size?: 'sm' | 'md' | 'lg'; readOnly?: boolean }) {
  const cls = size === 'lg' ? 'h-16 text-4xl' : size === 'md' ? 'h-11 text-2xl' : 'h-6 text-base';
  return (
    <div className={`flex ${size === 'lg' ? 'gap-1' : 'gap-0'}`} role="radiogroup" aria-label="별점">
      {([1, 2, 3, 4, 5] as Rating[]).map((n) => {
        const on = !!value && n <= value;
        return readOnly ? (
          <span key={n} className={`${size === 'sm' ? 'text-sm' : 'text-xl'} ${on ? 'text-star' : 'text-line'}`}>
            ★
          </span>
        ) : (
          <button
            key={n}
            role="radio"
            aria-checked={value === n}
            aria-label={`${n}점`}
            onClick={() => onChange?.(n)}
            className={`flex-1 select-none rounded-xl transition active:scale-90 ${cls} ${size === 'lg' ? 'min-w-[56px] bg-panel2' : 'min-w-[44px]'} ${
              on ? 'text-star' : 'text-slate-600'
            }`}
          >
            ★
          </button>
        );
      })}
    </div>
  );
}
