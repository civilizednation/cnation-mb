import { useEffect, useState } from 'react';
import { formatTime, parseTime } from '../utils/time';

export function TimeInput({ value, onChange, label, min = -30, max = 3600 }: { value: number; onChange: (v: number) => void; label?: string; min?: number; max?: number }) {
  const [text, setText] = useState(formatTime(value));
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    if (!focus) setText(formatTime(value));
  }, [value, focus]);
  const commit = () => {
    const v = parseTime(text);
    if (v == null) setText(formatTime(value));
    else onChange(Math.max(min, Math.min(max, v)));
  };
  return (
    <input
      aria-label={label}
      className="input w-28 text-center font-mono tabular-nums"
      inputMode="decimal"
      value={text}
      onFocus={(e) => {
        setFocus(true);
        e.target.select();
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        setFocus(false);
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}
